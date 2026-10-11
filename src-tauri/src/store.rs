//! JSON files in the app's data and config folders (recents, settings, document state).
//!
//! A file that cannot be parsed is not trusted: the app starts from an empty store and the
//! broken file is kept next to it as `<name>.corrupt` (one copy, replaced each time) so a
//! hand-edit gone wrong is not lost. Every such event is logged to stderr.

use crate::fs_util;
use serde_json::Value;
use std::io;
use std::path::{Path, PathBuf};

/// What reading a store found.
#[derive(Debug, Clone, PartialEq)]
pub enum Loaded {
    /// There is no file yet.
    Missing,
    Valid(Value),
    /// The file exists but is not valid JSON (it has been set aside, see `quarantine`).
    Corrupt,
}

/// Reads and parses a JSON file. An unreadable or unparsable file is quarantined and reported
/// as `Corrupt`.
pub fn read_json(path: &Path) -> Loaded {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Loaded::Missing,
        Err(error) => {
            log(path, &format!("cannot be read ({:?})", error.kind()));
            return Loaded::Corrupt;
        }
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => Loaded::Valid(value),
        Err(_) => {
            quarantine(path);
            Loaded::Corrupt
        }
    }
}

/// The path of the set-aside copy of a broken file.
pub fn corrupt_copy_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".corrupt");
    PathBuf::from(name)
}

/// Keeps a copy of a broken file as `<name>.corrupt` and logs it. The broken file itself is left
/// in place; the next write replaces it.
pub fn quarantine(path: &Path) {
    let copy = corrupt_copy_path(path);
    match std::fs::copy(path, &copy) {
        Ok(_) => log(
            path,
            &format!("is not valid JSON, a copy was kept as {}", copy.display()),
        ),
        Err(_) => log(path, "is not valid JSON and could not be copied aside"),
    }
}

fn log(path: &Path, what: &str) {
    eprintln!(
        "writedown: the store {} {what}; starting empty.",
        path.display()
    );
}

/// Writes pretty-printed JSON (two spaces, trailing newline: the files are meant to be
/// hand-editable) atomically.
pub fn write_json(path: &Path, value: &Value) -> io::Result<()> {
    let mut text = serde_json::to_string_pretty(value).map_err(io::Error::other)?;
    text.push('\n');
    fs_util::write_atomic(path, text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use serde_json::json;

    #[test]
    fn a_missing_file_is_reported_as_missing() {
        let dir = TempDir::new();

        assert_eq!(read_json(&dir.path().join("none.json")), Loaded::Missing);
    }

    #[test]
    fn valid_json_is_returned_as_is() {
        let dir = TempDir::new();
        let path = dir.write("a.json", br#"{"a": [1, 2], "b": null}"#);

        assert_eq!(
            read_json(&path),
            Loaded::Valid(json!({ "a": [1, 2], "b": null }))
        );
    }

    #[test]
    fn broken_json_is_reported_as_corrupt_and_a_copy_is_kept() {
        let dir = TempDir::new();
        let path = dir.write("a.json", b"{ not json");

        assert_eq!(read_json(&path), Loaded::Corrupt);

        let copy = corrupt_copy_path(&path);
        assert_eq!(std::fs::read(&copy).expect("copy exists"), b"{ not json");
        assert_eq!(
            std::fs::read(&path).expect("original stays"),
            b"{ not json",
            "the broken file is only replaced by the next write"
        );
    }

    #[test]
    fn an_empty_file_is_corrupt_json() {
        let dir = TempDir::new();
        let path = dir.write("a.json", b"");

        assert_eq!(read_json(&path), Loaded::Corrupt);
    }

    #[test]
    fn a_folder_where_the_file_should_be_is_corrupt_not_a_crash() {
        let dir = TempDir::new();
        let path = dir.path().join("a.json");
        std::fs::create_dir(&path).expect("mkdir");

        assert_eq!(read_json(&path), Loaded::Corrupt);
    }

    #[test]
    fn written_json_is_pretty_printed_with_a_trailing_newline_and_round_trips() {
        let dir = TempDir::new();
        let path = dir.path().join("sub").join("a.json");
        let value = json!({ "version": 1, "list": [1, 2], "name": "é" });

        write_json(&path, &value).expect("writes");

        let text = std::fs::read_to_string(&path).expect("read");
        assert!(text.ends_with("}\n"));
        assert!(text.contains("\n  \"version\": 1"), "{text}");
        assert_eq!(read_json(&path), Loaded::Valid(value));
    }

    #[test]
    fn written_json_keeps_the_key_order_it_was_given() {
        let dir = TempDir::new();
        let path = dir.path().join("a.json");
        let value: Value =
            serde_json::from_str(r#"{"zeta": 1, "alpha": 2, "mid": 3}"#).expect("parses");

        write_json(&path, &value).expect("writes");

        let text = std::fs::read_to_string(&path).expect("read");
        let zeta = text.find("zeta").expect("zeta");
        let alpha = text.find("alpha").expect("alpha");
        let mid = text.find("mid").expect("mid");
        assert!(zeta < alpha && alpha < mid, "{text}");
    }
}
