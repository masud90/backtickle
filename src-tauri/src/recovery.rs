//! Crash recovery: the text of documents with unsaved changes, kept in
//! `recovery/` in the app's data folder (the folder `BACKTICKLE_CONFIG_DIR` points to in tests).
//!
//! One file per document, named by a random id the page chose (`<id>.json`, the id is checked
//! here: letters, digits and `-` only, so it cannot name another folder). The folder is mode 0700
//! and every file 0600. A file is written to a temporary name, flushed and renamed, so a crash
//! in the middle of a write leaves the previous entry. Nothing is kept except what
//! lists: text, path, flavor, view, cursor and window.
//!
//! The text never goes to the session file, a trace or any other place. Traces name counts only.
//!
//! Trust: the page writes the entries and Rust grants the files in them at the next launch
//! (`paths`, used by `lib.rs`), exactly like the session. A path that is not granted when it is
//! written is not kept.

use crate::fs_util;
use serde::Serialize;
use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

/// Entries beyond this many are not written (a runaway page cannot fill the disk).
pub const MAX_ENTRIES: usize = 500;
const MAX_TEXT_BYTES: usize = crate::text_file::MAX_TEXT_FILE_BYTES as usize;
const VIEWS: [&str; 3] = ["editor", "split", "preview"];

/// One kept document: `RecoveryEntry` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub text: String,
    /// The canonical path, or `None` for a document that has no file.
    pub path: Option<String>,
    pub name: String,
    pub flavor: String,
    pub view: String,
    pub line: u64,
    pub column: u64,
    /// The window it was in (`main`, `doc-1`, ...).
    pub window: String,
    /// The file's modification time when the document was opened or saved, to notice a change on
    /// disk since.
    pub modified_ms: Option<u64>,
    pub saved_at_ms: u64,
}

/// An id the page may use: 8 to 64 letters, digits or `-`.
pub fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

impl Entry {
    /// An entry from what the page sent; `None` when it is not usable. `permitted` says whether
    /// a path may be kept.
    pub fn from_value(id: &str, value: &Value, permitted: impl Fn(&Path) -> bool) -> Option<Entry> {
        if !valid_id(id) {
            return None;
        }
        let text = value.get("text")?.as_str()?;
        if text.len() > MAX_TEXT_BYTES {
            return None;
        }
        let string = |key: &str, max: usize| {
            value
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| s.len() <= max && !s.contains('\0'))
                .map(str::to_owned)
        };
        let path = string("path", 4096).filter(|p| permitted(Path::new(p)));
        let view = string("view", 16)
            .filter(|v| VIEWS.contains(&v.as_str()))
            .unwrap_or_else(|| "split".to_owned());
        let number = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_u64)
                .filter(|n| *n < u64::from(u32::MAX))
        };
        Some(Entry {
            id: id.to_owned(),
            text: text.to_owned(),
            path,
            name: string("name", 512).unwrap_or_else(|| "Untitled".to_owned()),
            flavor: string("flavor", 32).unwrap_or_else(|| "gfm".to_owned()),
            view,
            line: number("line").unwrap_or(1).max(1),
            column: number("column").unwrap_or(0),
            window: string("window", 32).unwrap_or_else(|| "main".to_owned()),
            modified_ms: value.get("modifiedMs").and_then(Value::as_u64),
            saved_at_ms: fs_util::now_ms(),
        })
    }

    fn to_value(&self) -> Value {
        json!({
            "version": 1,
            "id": self.id,
            "text": self.text,
            "path": self.path,
            "name": self.name,
            "flavor": self.flavor,
            "view": self.view,
            "line": self.line,
            "column": self.column,
            "window": self.window,
            "modifiedMs": self.modified_ms,
            "savedAtMs": self.saved_at_ms,
        })
    }

    fn from_stored(id: &str, value: &Value) -> Option<Entry> {
        if value.get("version")?.as_u64()? != 1 || value.get("id")?.as_str()? != id {
            return None;
        }
        let mut entry = Entry::from_value(id, value, |_| true)?;
        entry.saved_at_ms = value.get("savedAtMs").and_then(Value::as_u64).unwrap_or(0);
        Some(entry)
    }
}

/// The folder of the entries.
#[derive(Debug, Clone)]
pub struct RecoveryStore {
    dir: PathBuf,
}

impl RecoveryStore {
    pub fn new(dir: PathBuf) -> Self {
        RecoveryStore { dir }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn file(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn ensure_dir(&self) -> io::Result<()> {
        if self.dir.is_dir() {
            return Ok(());
        }
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        // On Windows the app's data folder is already private to the user.
        #[cfg(unix)]
        builder.mode(0o700);
        builder.create(&self.dir)
    }

    /// Writes (or replaces) an entry: temporary file with mode 0600, flushed, renamed.
    pub fn write(&self, entry: &Entry) -> io::Result<()> {
        if !valid_id(&entry.id) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad id"));
        }
        self.ensure_dir()?;
        let target = self.file(&entry.id);
        if !target.exists() && self.ids().len() >= MAX_ENTRIES {
            return Err(io::Error::other("too many entries"));
        }
        let mut bytes = serde_json::to_vec(&entry.to_value()).map_err(io::Error::other)?;
        bytes.push(b'\n');
        let temp = fs_util::temp_sibling(&target);
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temp)?;
            file.write_all(&bytes)?;
            fs_util::fsync_file(&file)?;
            drop(file);
            fs::rename(&temp, &target)
        })();
        if result.is_err() {
            fs_util::discard_temp(&temp);
        }
        result
    }

    /// Removes an entry; a missing one is not an error.
    pub fn remove(&self, id: &str) {
        if valid_id(id) {
            // The one place that deletes files is `fs_util` (a test checks it).
            fs_util::discard_temp(&self.file(id));
        }
    }

    /// The ids of the entry files in the folder (no file is opened).
    pub fn ids(&self) -> Vec<String> {
        let Ok(read) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut ids: Vec<String> = read
            .flatten()
            .filter_map(|item| {
                let name = item.file_name().to_string_lossy().into_owned();
                name.strip_suffix(".json")
                    .filter(|id| valid_id(id))
                    .map(str::to_owned)
            })
            .collect();
        ids.sort();
        ids
    }

    /// Every readable entry, oldest first. A file that cannot be read or is not an entry is
    /// skipped (and left where it is).
    pub fn list(&self) -> Vec<Entry> {
        let mut entries: Vec<Entry> = self
            .ids()
            .iter()
            .filter_map(|id| {
                let bytes = fs::read(self.file(id)).ok()?;
                let value: Value = serde_json::from_slice(&bytes).ok()?;
                Entry::from_stored(id, &value)
            })
            .collect();
        entries.sort_by(|a, b| a.saved_at_ms.cmp(&b.saved_at_ms).then(a.id.cmp(&b.id)));
        entries
    }

    /// The paths of the entries that have one, for granting them again at launch.
    pub fn paths(&self) -> Vec<String> {
        if self.ids().is_empty() {
            return Vec::new();
        }
        self.list().into_iter().filter_map(|e| e.path).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn entry(id: &str, text: &str, path: Option<&str>) -> Entry {
        let value = json!({ "text": text, "path": path, "name": "a.md", "view": "editor",
            "line": 3, "column": 4, "window": "main", "modifiedMs": 7 });
        Entry::from_value(id, &value, |_| true).expect("valid")
    }

    fn store() -> (TempDir, RecoveryStore) {
        let dir = TempDir::new();
        let store = RecoveryStore::new(dir.path().join("recovery"));
        (dir, store)
    }

    #[test]
    fn an_entry_round_trips_with_everything_the_spec_keeps() {
        let (_dir, store) = store();
        store
            .write(&entry("abcd1234", "hello\nworld é", Some("/tmp/a.md")))
            .expect("writes");

        let list = store.list();

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].text, "hello\nworld é");
        assert_eq!(list[0].path.as_deref(), Some("/tmp/a.md"));
        assert_eq!((list[0].line, list[0].column), (3, 4));
        assert_eq!(list[0].view, "editor");
        assert_eq!(list[0].window, "main");
        assert_eq!(list[0].modified_ms, Some(7));
    }

    #[cfg(unix)]
    #[test]
    fn the_folder_is_private_and_the_files_are_0600() {
        let (_dir, store) = store();
        store.write(&entry("abcd1234", "x", None)).expect("writes");

        let folder = fs::metadata(store.dir()).expect("folder").permissions();
        let file = fs::metadata(store.file("abcd1234"))
            .expect("file")
            .permissions();

        assert_eq!(folder.mode() & 0o777, 0o700);
        assert_eq!(file.mode() & 0o777, 0o600);
    }

    #[test]
    fn writing_again_replaces_the_entry_and_leaves_no_temporary_file() {
        let (_dir, store) = store();
        store.write(&entry("abcd1234", "one", None)).expect("one");
        store.write(&entry("abcd1234", "two", None)).expect("two");

        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].text, "two");
        let names: Vec<_> = fs::read_dir(store.dir())
            .expect("read")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["abcd1234.json"]);
    }

    #[test]
    fn remove_deletes_the_entry_and_a_missing_one_is_fine() {
        let (_dir, store) = store();
        store.write(&entry("abcd1234", "x", None)).expect("writes");

        store.remove("abcd1234");
        store.remove("abcd1234");

        assert!(store.list().is_empty());
        assert!(store.ids().is_empty());
    }

    #[test]
    fn an_id_cannot_leave_the_folder() {
        for bad in ["../evil123", "a/b/c/d/e/f", "short", "", "x.json.tmp1234"] {
            assert!(!valid_id(bad), "{bad}");
        }
        let value = json!({ "text": "x" });
        assert!(Entry::from_value("../../etc/passwd", &value, |_| true).is_none());
        let (_dir, store) = store();
        store.remove("../../something");
    }

    #[test]
    fn a_path_that_is_not_permitted_is_not_kept() {
        let value = json!({ "text": "x", "path": "/etc/passwd" });

        let kept = Entry::from_value("abcd1234", &value, |_| false).expect("valid");

        assert_eq!(kept.path, None);
    }

    #[test]
    fn broken_files_are_skipped_not_fatal() {
        let (_dir, store) = store();
        store.write(&entry("abcd1234", "good", None)).expect("ok");
        fs::write(store.dir().join("deadbeef.json"), b"{ not json").expect("bad");
        fs::write(store.dir().join("readme.txt"), b"x").expect("other");
        // An entry whose id inside differs from its file name is not trusted.
        fs::write(
            store.dir().join("11111111.json"),
            br#"{"version":1,"id":"22222222","text":"x"}"#,
        )
        .expect("mismatch");

        let list = store.list();

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "abcd1234");
    }

    #[test]
    fn an_empty_or_missing_folder_has_nothing_and_is_not_created_by_reading() {
        let (_dir, store) = store();

        assert!(store.list().is_empty());
        assert!(store.paths().is_empty());
        assert!(!store.dir().exists());
    }

    #[test]
    fn the_paths_of_the_entries_are_listed_for_granting() {
        let (_dir, store) = store();
        store
            .write(&entry("abcd1234", "x", Some("/a.md")))
            .expect("a");
        store.write(&entry("abcd5678", "y", None)).expect("b");

        assert_eq!(store.paths(), ["/a.md"]);
    }

    #[test]
    fn the_number_of_entries_is_limited() {
        let (_dir, store) = store();
        fs::create_dir_all(store.dir()).expect("mkdir");
        for n in 0..MAX_ENTRIES {
            fs::write(store.dir().join(format!("{n:08}.json")), b"{}").expect("fill");
        }

        assert!(store.write(&entry("abcd1234", "x", None)).is_err());
        // Replacing an existing one is still allowed.
        assert!(store.write(&entry("00000001", "x", None)).is_ok());
    }
}
