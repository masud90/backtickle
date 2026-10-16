//! Recent documents (Recents).
//!
//! Only Rust writes the list. It is most recent first, has no duplicates (by canonical path),
//! is capped at `settings.recentLimit` and is stored in the app data folder as
//! `{"version": 1, "entries": [{"path": "...", "openedAtMs": 1700000000000}]}`.
//!
//! An entry whose file is gone is kept and reported with `exists: false`; the welcome screen
//! and the Open Recent menu hide such entries. A store that cannot be parsed is replaced by an
//! empty one (and logged, see `store.rs`).

use crate::store::{self, Loaded};
use serde::Serialize;
use serde_json::{Value, json};
use std::io;
use std::path::{Path, PathBuf};

/// The largest `recentLimit`, and so the most that is ever stored.
pub const MAX_STORED: usize = 100;

/// An entry as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRecent {
    pub path: String,
    pub opened_at_ms: u64,
}

/// `RecentEntry` in `src/lib/platform.ts` (camelCase on the wire).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    /// The file name.
    pub name: String,
    /// The folder, for display, with the home folder shown as `~`.
    pub folder: String,
    pub opened_at_ms: u64,
    /// The size of the file now, or null if it is missing.
    pub bytes: Option<u64>,
    pub exists: bool,
}

pub struct Recents {
    entries: Vec<StoredRecent>,
    file: PathBuf,
}

impl Recents {
    /// Reads the store. A missing file is an empty list; a broken one is replaced by an empty
    /// list (the broken file is kept as `<name>.corrupt`).
    pub fn load(file: PathBuf) -> Self {
        let entries = match store::read_json(&file) {
            Loaded::Valid(value) => parse(&value).unwrap_or_else(|| {
                store::quarantine(&file);
                Vec::new()
            }),
            Loaded::Missing | Loaded::Corrupt => Vec::new(),
        };
        Recents { entries, file }
    }

    pub fn entries(&self) -> &[StoredRecent] {
        &self.entries
    }

    pub fn contains(&self, path: &str) -> bool {
        self.entries.iter().any(|entry| entry.path == path)
    }

    /// Moves `path` to the front (adding it if needed), stamps it and caps the list at `limit`.
    /// Returns true if the order or the members changed, not only the time of the first entry.
    pub fn touch(&mut self, path: &str, now_ms: u64, limit: usize) -> bool {
        let limit = limit.clamp(1, MAX_STORED);
        let was_first = self.entries.first().is_some_and(|entry| entry.path == path);
        let before = self.entries.len();
        self.entries.retain(|entry| entry.path != path);
        let existed = self.entries.len() != before;
        self.entries.insert(
            0,
            StoredRecent {
                path: path.to_owned(),
                opened_at_ms: now_ms,
            },
        );
        let truncated = self.entries.len() > limit;
        self.entries.truncate(limit);
        truncated || !existed || !was_first
    }

    /// Removes one path. Returns true if it was in the list.
    pub fn remove(&mut self, path: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|entry| entry.path != path);
        self.entries.len() != before
    }

    /// A rename or a move (Phase 3): the entry of `from`, and the entries below it when it was
    /// a folder, now point at `to`. They keep their place and time; an entry that already had
    /// a new path is dropped in favor of the moved one. Returns true if anything changed.
    pub fn moved(&mut self, from: &str, to: &str) -> bool {
        let below = format!("{}/", from.trim_end_matches('/'));
        let new_path = |stored: &str| -> Option<String> {
            if stored == from {
                Some(to.to_owned())
            } else {
                stored
                    .strip_prefix(&below)
                    .map(|rest| format!("{}/{rest}", to.trim_end_matches('/')))
            }
        };
        let new_paths: Vec<String> = self
            .entries
            .iter()
            .filter_map(|entry| new_path(&entry.path))
            .collect();
        if new_paths.is_empty() {
            return false;
        }
        let mut result = Vec::with_capacity(self.entries.len());
        for entry in std::mem::take(&mut self.entries) {
            match new_path(&entry.path) {
                Some(path) => result.push(StoredRecent { path, ..entry }),
                None if new_paths.contains(&entry.path) => {}
                None => result.push(entry),
            }
        }
        self.entries = result;
        true
    }

    /// Empties the list. Returns true if it was not empty.
    pub fn clear(&mut self) -> bool {
        let changed = !self.entries.is_empty();
        self.entries.clear();
        changed
    }

    /// Cuts the list to `limit` entries. Returns true if entries were dropped.
    pub fn trim(&mut self, limit: usize) -> bool {
        let limit = limit.clamp(1, MAX_STORED);
        let changed = self.entries.len() > limit;
        self.entries.truncate(limit);
        changed
    }

    pub fn save(&self) -> io::Result<()> {
        let entries: Vec<Value> = self
            .entries
            .iter()
            .map(|entry| json!({ "path": entry.path, "openedAtMs": entry.opened_at_ms }))
            .collect();
        store::write_json(&self.file, &json!({ "version": 1, "entries": entries }))
    }
}

/// The entries of a parsed store, or `None` if it does not have the shape of a recents file.
/// Entries without a path are dropped, duplicates keep their first (most recent) place, and
/// the list is cut at `MAX_STORED`.
fn parse(value: &Value) -> Option<Vec<StoredRecent>> {
    let list = value.as_object()?.get("entries")?.as_array()?;
    let mut entries: Vec<StoredRecent> = Vec::new();
    for item in list {
        let Some(path) = item.get("path").and_then(Value::as_str) else {
            continue;
        };
        if path.is_empty() || entries.iter().any(|entry| entry.path == path) {
            continue;
        }
        let opened_at_ms = item
            .get("openedAtMs")
            .and_then(Value::as_f64)
            .map_or(0, |ms| ms.max(0.0) as u64);
        entries.push(StoredRecent {
            path: path.to_owned(),
            opened_at_ms,
        });
    }
    entries.truncate(MAX_STORED);
    Some(entries)
}

/// The folder as shown to the user: the home folder is `~`, folders below it start with `~/`.
pub fn display_folder(folder: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home {
        if folder == home {
            return "~".to_owned();
        }
        if let Ok(rest) = folder.strip_prefix(home) {
            return format!("~/{}", crate::fs_util::path_text(rest));
        }
    }
    crate::fs_util::path_text(folder)
}

/// Turns stored entries into what the frontend gets, looking at the file system for the size
/// and for whether each file still exists.
pub fn describe(entries: &[StoredRecent], home: Option<&Path>) -> Vec<RecentEntry> {
    entries
        .iter()
        .map(|entry| {
            let path = Path::new(&entry.path);
            let metadata = std::fs::metadata(path).ok().filter(|m| m.is_file());
            RecentEntry {
                path: entry.path.clone(),
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| entry.path.clone()),
                folder: path
                    .parent()
                    .map(|folder| display_folder(folder, home))
                    .unwrap_or_default(),
                opened_at_ms: entry.opened_at_ms,
                bytes: metadata.as_ref().map(std::fs::Metadata::len),
                exists: metadata.is_some(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn paths(recents: &Recents) -> Vec<&str> {
        recents
            .entries()
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    fn empty(dir: &TempDir) -> Recents {
        Recents::load(dir.path().join("recents.json"))
    }

    #[test]
    fn the_most_recent_path_comes_first() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);

        recents.touch("/a.md", 1, 20);
        recents.touch("/b.md", 2, 20);
        recents.touch("/c.md", 3, 20);

        assert_eq!(paths(&recents), ["/c.md", "/b.md", "/a.md"]);
        assert_eq!(recents.entries()[0].opened_at_ms, 3);
    }

    #[test]
    fn opening_a_path_again_moves_it_to_the_front_without_a_duplicate() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/a.md", 1, 20);
        recents.touch("/b.md", 2, 20);
        recents.touch("/c.md", 3, 20);

        recents.touch("/a.md", 4, 20);

        assert_eq!(paths(&recents), ["/a.md", "/c.md", "/b.md"]);
        assert_eq!(recents.entries()[0].opened_at_ms, 4);
    }

    #[test]
    fn touch_reports_whether_the_order_or_the_members_changed() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);

        assert!(recents.touch("/a.md", 1, 20), "a new entry");
        assert!(recents.touch("/b.md", 2, 20), "a new entry");
        assert!(recents.touch("/a.md", 3, 20), "moved to the front");
        assert!(
            !recents.touch("/a.md", 4, 20),
            "already first: only the time changed"
        );
        assert_eq!(recents.entries()[0].opened_at_ms, 4);
    }

    #[test]
    fn the_list_is_capped_at_the_limit_and_the_oldest_entries_go() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);

        for index in 0..5 {
            recents.touch(&format!("/{index}.md"), index, 3);
        }

        assert_eq!(paths(&recents), ["/4.md", "/3.md", "/2.md"]);
    }

    #[test]
    fn the_limit_is_clamped_to_one_through_one_hundred() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);

        for index in 0..150 {
            recents.touch(&format!("/{index}.md"), index, 1000);
        }
        assert_eq!(recents.entries().len(), MAX_STORED);
        recents.touch("/last.md", 200, 0);
        assert_eq!(
            paths(&recents),
            ["/last.md"],
            "a limit of 0 still keeps one"
        );
    }

    #[test]
    fn trim_cuts_the_list_when_the_limit_is_lowered() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        for index in 0..6 {
            recents.touch(&format!("/{index}.md"), index, 20);
        }

        assert!(recents.trim(2));
        assert_eq!(paths(&recents), ["/5.md", "/4.md"]);
        assert!(!recents.trim(2), "nothing left to cut");
    }

    #[test]
    fn remove_and_clear_report_whether_they_changed_anything() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/a.md", 1, 20);
        recents.touch("/b.md", 2, 20);

        assert!(recents.remove("/a.md"));
        assert!(!recents.remove("/a.md"));
        assert_eq!(paths(&recents), ["/b.md"]);
        assert!(recents.clear());
        assert!(!recents.clear());
        assert!(recents.entries().is_empty());
    }

    #[test]
    fn contains_matches_the_exact_path_only() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/a/b.md", 1, 20);

        assert!(recents.contains("/a/b.md"));
        assert!(!recents.contains("/a/../a/b.md"));
        assert!(!recents.contains("/a/b"));
    }

    #[test]
    fn the_list_survives_a_restart() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/a.md", 100, 20);
        recents.touch("/b é.md", 200, 20);
        recents.save().expect("saves");

        let reloaded = empty(&dir);

        assert_eq!(paths(&reloaded), ["/b é.md", "/a.md"]);
        assert_eq!(reloaded.entries()[1].opened_at_ms, 100);
    }

    #[test]
    fn the_stored_file_has_the_documented_shape() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/a.md", 100, 20);
        recents.save().expect("saves");

        let text = std::fs::read_to_string(dir.path().join("recents.json")).expect("read");
        let value: Value = serde_json::from_str(&text).expect("json");

        assert_eq!(
            value,
            json!({ "version": 1, "entries": [{ "path": "/a.md", "openedAtMs": 100 }] })
        );
    }

    #[test]
    fn a_missing_store_is_an_empty_list() {
        let dir = TempDir::new();

        assert!(empty(&dir).entries().is_empty());
    }

    #[test]
    fn a_corrupt_store_is_replaced_by_an_empty_list_and_a_copy_is_kept() {
        let dir = TempDir::new();
        let file = dir.write("recents.json", b"{ this is not json");

        let recents = Recents::load(file.clone());

        assert!(recents.entries().is_empty());
        assert_eq!(
            std::fs::read(store::corrupt_copy_path(&file)).expect("copy"),
            b"{ this is not json"
        );
    }

    #[test]
    fn a_store_with_the_wrong_shape_is_corrupt_too() {
        for text in [
            &b"[1, 2, 3]"[..],
            b"{}",
            br#"{"entries": "nope"}"#,
            b"null",
            b"42",
        ] {
            let dir = TempDir::new();
            let file = dir.write("recents.json", text);

            let recents = Recents::load(file.clone());

            assert!(
                recents.entries().is_empty(),
                "{:?}",
                String::from_utf8_lossy(text)
            );
            assert!(store::corrupt_copy_path(&file).exists());
        }
    }

    #[test]
    fn bad_entries_are_dropped_and_good_ones_kept() {
        let dir = TempDir::new();
        let file = dir.write(
            "recents.json",
            br#"{"version": 1, "entries": [
                {"path": "/good.md", "openedAtMs": 5},
                {"path": 7},
                {"openedAtMs": 9},
                "text",
                {"path": ""},
                {"path": "/good.md", "openedAtMs": 1},
                {"path": "/no-time.md"},
                {"path": "/negative.md", "openedAtMs": -4}
            ]}"#,
        );

        let recents = Recents::load(file);

        assert_eq!(paths(&recents), ["/good.md", "/no-time.md", "/negative.md"]);
        assert_eq!(
            recents.entries()[0].opened_at_ms,
            5,
            "the first duplicate wins"
        );
        assert_eq!(recents.entries()[1].opened_at_ms, 0);
        assert_eq!(recents.entries()[2].opened_at_ms, 0);
    }

    #[test]
    fn a_hand_made_store_with_too_many_entries_is_cut_at_one_hundred() {
        let dir = TempDir::new();
        let entries: Vec<Value> = (0..250)
            .map(|index| json!({ "path": format!("/{index}.md"), "openedAtMs": index }))
            .collect();
        let file = dir.write(
            "recents.json",
            json!({ "version": 1, "entries": entries })
                .to_string()
                .as_bytes(),
        );

        assert_eq!(Recents::load(file).entries().len(), MAX_STORED);
    }

    #[test]
    fn the_folder_is_shown_with_the_home_folder_as_a_tilde() {
        let home = Path::new("/Users/alex");

        assert_eq!(display_folder(Path::new("/Users/alex"), Some(home)), "~");
        assert_eq!(
            display_folder(Path::new("/Users/alex/Documents/Notes"), Some(home)),
            "~/Documents/Notes"
        );
        assert_eq!(
            display_folder(Path::new("/Users/alex2/Documents"), Some(home)),
            "/Users/alex2/Documents",
            "a folder that only starts with the same letters is not below home"
        );
        assert_eq!(
            display_folder(Path::new("/Volumes/Work"), Some(home)),
            "/Volumes/Work"
        );
        assert_eq!(
            display_folder(Path::new("/Users/alex/x"), None),
            "/Users/alex/x"
        );
    }

    #[test]
    fn describe_reports_name_folder_size_and_existence() {
        let dir = TempDir::new();
        let real = dir.write("notes.md", b"twelve bytes");
        let gone = dir.path().join("gone.md");
        let entries = [
            StoredRecent {
                path: real.to_string_lossy().into_owned(),
                opened_at_ms: 11,
            },
            StoredRecent {
                path: gone.to_string_lossy().into_owned(),
                opened_at_ms: 10,
            },
        ];

        let described = describe(&entries, Some(dir.path()));

        assert_eq!(described[0].name, "notes.md");
        assert_eq!(described[0].folder, "~");
        assert_eq!(described[0].bytes, Some(12));
        assert!(described[0].exists);
        assert_eq!(described[0].opened_at_ms, 11);
        assert_eq!(described[1].name, "gone.md");
        assert_eq!(described[1].bytes, None);
        assert!(!described[1].exists, "a missing file is kept but flagged");
    }

    #[test]
    fn a_folder_with_the_name_of_a_recent_file_does_not_count_as_existing() {
        let dir = TempDir::new();
        let folder = dir.path().join("looks-like-a-file.md");
        std::fs::create_dir(&folder).expect("mkdir");
        let entries = [StoredRecent {
            path: folder.to_string_lossy().into_owned(),
            opened_at_ms: 1,
        }];

        assert!(!describe(&entries, None)[0].exists);
    }

    #[test]
    fn a_described_entry_serializes_with_the_names_of_the_frontend_type() {
        let entry = RecentEntry {
            path: "/a/b.md".into(),
            name: "b.md".into(),
            folder: "/a".into(),
            opened_at_ms: 5,
            bytes: None,
            exists: false,
        };

        assert_eq!(
            serde_json::to_value(entry).expect("serializes"),
            json!({
                "path": "/a/b.md", "name": "b.md", "folder": "/a",
                "openedAtMs": 5, "bytes": null, "exists": false
            })
        );
    }

    #[test]
    fn a_move_points_the_entry_at_the_new_path_and_keeps_its_place() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/c.md", 1, 10);
        recents.touch("/old.md", 2, 10);
        recents.touch("/a.md", 3, 10);

        assert!(recents.moved("/old.md", "/new.md"));

        assert_eq!(paths(&recents), ["/a.md", "/new.md", "/c.md"]);
        assert_eq!(recents.entries()[1].opened_at_ms, 2);
        assert!(!recents.moved("/missing.md", "/x.md"));
    }

    #[test]
    fn moving_a_folder_moves_the_entries_below_it_only() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/d2/c.md", 1, 10);
        recents.touch("/d/sub/b.md", 2, 10);
        recents.touch("/d/a.md", 3, 10);

        assert!(recents.moved("/d", "/e"));

        assert_eq!(paths(&recents), ["/e/a.md", "/e/sub/b.md", "/d2/c.md"]);
    }

    #[test]
    fn a_move_onto_a_listed_path_leaves_one_entry() {
        let dir = TempDir::new();
        let mut recents = empty(&dir);
        recents.touch("/b.md", 1, 10);
        recents.touch("/a.md", 2, 10);

        recents.moved("/a.md", "/b.md");

        assert_eq!(paths(&recents), ["/b.md"]);
        assert_eq!(recents.entries()[0].opened_at_ms, 2);
    }
}
