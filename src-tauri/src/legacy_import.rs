//! The one-time import of the stores kept by Writedown, the app's earlier name.
//!
//! The stores live in folders named after the bundle identifier, which changed with the name
//! (`app.writedown.desktop` became `app.backtickle.desktop`). At the first launch after the
//! rename, the settings, snippets, recents, document state, session and crash recovery entries
//! are copied from the old folders into the new ones, so nothing is lost. The old folders are
//! left as they are: Writedown may still be installed next to Backtickle.
//!
//! A store already in the new folder is never replaced, and a marker file in the new config
//! folder makes sure the import runs only once.

use std::io;
use std::path::{Path, PathBuf};

/// The bundle identifier of Writedown, which names its folders.
pub const OLD_IDENTIFIER: &str = "app.writedown.desktop";
/// Written to the new config folder once the import ran.
pub const MARKER: &str = ".imported-from-writedown";

const CONFIG_FILES: [&str; 2] = ["settings.json", "snippets.json"];
const DATA_FILES: [&str; 3] = ["recents.json", "doc-state.json", "session.json"];
const RECOVERY_FOLDER: &str = "recovery";

/// Writedown's folder for `folder`, an app folder named after `identifier`: the folder next to
/// it with the old identifier. `None` when the folder is not named after the identifier (a
/// folder chosen with `BACKTICKLE_CONFIG_DIR`, or the fallback).
pub fn old_folder(folder: &Path, identifier: &str) -> Option<PathBuf> {
    if identifier == OLD_IDENTIFIER || folder.file_name()? != identifier {
        return None;
    }
    Some(folder.with_file_name(OLD_IDENTIFIER))
}

/// Copies Writedown's stores from `old_data` and `old_config` into `data` and `config` where the
/// new folders do not have them yet. Returns the names of the copied stores; empty when there
/// was nothing to import or the import already ran.
pub fn import(
    old_data: &Path,
    old_config: &Path,
    data: &Path,
    config: &Path,
) -> io::Result<Vec<String>> {
    if config.join(MARKER).exists() || (!old_data.is_dir() && !old_config.is_dir()) {
        return Ok(Vec::new());
    }
    let mut copied = Vec::new();
    for (from, to, names) in [
        (old_config, config, &CONFIG_FILES[..]),
        (old_data, data, &DATA_FILES[..]),
    ] {
        for name in names {
            if copy_if_missing(&from.join(name), &to.join(name))? {
                copied.push(name.to_string());
            }
        }
    }
    let old_recovery = old_data.join(RECOVERY_FOLDER);
    if old_recovery.is_dir() {
        for entry in std::fs::read_dir(&old_recovery)? {
            let entry = entry?;
            let name = entry.file_name();
            if !entry.file_type()?.is_file() {
                continue;
            }
            let target = data.join(RECOVERY_FOLDER).join(&name);
            if copy_if_missing(&entry.path(), &target)? {
                copied.push(format!("{RECOVERY_FOLDER}/{}", name.to_string_lossy()));
            }
        }
    }
    std::fs::create_dir_all(config)?;
    std::fs::write(config.join(MARKER), b"")?;
    Ok(copied)
}

fn copy_if_missing(from: &Path, to: &Path) -> io::Result<bool> {
    if !from.is_file() || to.exists() {
        return Ok(false);
    }
    if let Some(folder) = to.parent() {
        std::fs::create_dir_all(folder)?;
    }
    std::fs::copy(from, to)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::fs;

    const NEW: &str = "app.backtickle.desktop";

    #[test]
    fn the_old_folder_is_the_sibling_named_after_the_old_identifier() {
        let folder = Path::new("/home/me/.config").join(NEW);
        assert_eq!(
            old_folder(&folder, NEW),
            Some(Path::new("/home/me/.config").join(OLD_IDENTIFIER))
        );
        assert_eq!(old_folder(Path::new("/tmp/measure"), NEW), None);
        assert_eq!(
            old_folder(&folder.with_file_name(OLD_IDENTIFIER), OLD_IDENTIFIER),
            None
        );
    }

    #[test]
    fn the_stores_are_copied_once_and_never_replace_new_ones() {
        let root = TempDir::new();
        let old = root.path().join(OLD_IDENTIFIER);
        let new = root.path().join(NEW);
        fs::create_dir_all(old.join("recovery")).unwrap();
        fs::write(old.join("settings.json"), b"{\"theme\":\"dark\"}").unwrap();
        fs::write(old.join("recents.json"), b"[\"old\"]").unwrap();
        fs::write(old.join("recovery/0001.json"), b"{}").unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("recents.json"), b"[\"new\"]").unwrap();

        let copied = import(&old, &old, &new, &new).unwrap();
        assert_eq!(copied, ["settings.json", "recovery/0001.json"]);
        assert_eq!(
            fs::read(new.join("settings.json")).unwrap(),
            b"{\"theme\":\"dark\"}"
        );
        assert_eq!(fs::read(new.join("recents.json")).unwrap(), b"[\"new\"]");
        assert!(new.join("recovery/0001.json").is_file());
        assert!(
            old.join("settings.json").is_file(),
            "the old folder is left alone"
        );

        // A second launch imports nothing, even when the user cleared a store meanwhile.
        fs::write(old.join("snippets.json"), b"[]").unwrap();
        assert!(import(&old, &old, &new, &new).unwrap().is_empty());
        assert!(!new.join("snippets.json").exists());
    }

    #[test]
    fn without_old_folders_nothing_is_written() {
        let root = TempDir::new();
        let old = root.path().join(OLD_IDENTIFIER);
        let new = root.path().join(NEW);
        assert!(import(&old, &old, &new, &new).unwrap().is_empty());
        assert!(!new.exists());
    }

    #[test]
    fn data_and_config_can_be_separate_folders() {
        let root = TempDir::new();
        let (old_data, old_config) = (root.path().join("od"), root.path().join("oc"));
        let (data, config) = (root.path().join("nd"), root.path().join("nc"));
        fs::create_dir_all(&old_data).unwrap();
        fs::create_dir_all(&old_config).unwrap();
        fs::write(old_config.join("snippets.json"), b"[]").unwrap();
        fs::write(old_data.join("session.json"), b"{}").unwrap();
        let copied = import(&old_data, &old_config, &data, &config).unwrap();
        assert_eq!(copied, ["snippets.json", "session.json"]);
        assert!(config.join("snippets.json").is_file() && data.join("session.json").is_file());
        assert!(config.join(MARKER).is_file());
    }
}
