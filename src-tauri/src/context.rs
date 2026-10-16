//! Where a document lives (`documentContext`).
//!
//! - `obsidianVault`: some folder above the document, up to the root of the volume, contains a
//!   `.obsidian` folder.
//! - `location`, from the canonical path: iCloud Drive is
//!   `~/Library/Mobile Documents/com~apple~CloudDocs/`, OneDrive is
//!   `~/Library/CloudStorage/OneDrive*`, Dropbox is `~/Library/CloudStorage/Dropbox*` or
//!   `~/Dropbox/`, Google Drive is `~/Library/CloudStorage/GoogleDrive*`. Everything else is
//!   local. The shell shows "Saved to iCloud Drive" and so on from it.

use serde::Serialize;
use std::path::{Component, Path};

/// `LocationKind` in `src/lib/platform.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocationKind {
    Icloud,
    Onedrive,
    Dropbox,
    GoogleDrive,
    Local,
}

/// `DocumentContext` in `src/lib/platform.ts` (camelCase on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContext {
    pub obsidian_vault: bool,
    pub location: LocationKind,
}

/// The context of the document at `path` (canonical). `home` is the canonical home folder.
pub fn document_context(path: &Path, home: Option<&Path>) -> DocumentContext {
    DocumentContext {
        obsidian_vault: in_obsidian_vault(path),
        location: detect_location(path, home),
    }
}

/// True if a folder above `path` contains a `.obsidian` folder. A file with that name does not
/// count.
pub fn in_obsidian_vault(path: &Path) -> bool {
    path.ancestors()
        .skip(1)
        .any(|folder| folder.join(".obsidian").is_dir())
}

fn name_of(component: Component<'_>) -> Option<String> {
    match component {
        Component::Normal(name) => Some(name.to_string_lossy().to_ascii_lowercase()),
        _ => None,
    }
}

/// The cloud service a path belongs to, judged on the path alone. A path below the home folder
/// is matched on the folders after it, ignoring letter case; a path elsewhere is local.
pub fn detect_location(path: &Path, home: Option<&Path>) -> LocationKind {
    let Some(rest) = home.and_then(|home| path.strip_prefix(home).ok()) else {
        return LocationKind::Local;
    };
    let names: Vec<String> = rest.components().filter_map(name_of).collect();
    // A document is at least one folder deep: the cloud folder itself is not a document.
    if names.len() < 2 {
        return LocationKind::Local;
    }
    let first = names[0].as_str();
    if first == "dropbox" {
        return LocationKind::Dropbox;
    }
    if first != "library" {
        return LocationKind::Local;
    }
    let second = names[1].as_str();
    if second == "mobile documents"
        && names.get(2).map(String::as_str) == Some("com~apple~clouddocs")
    {
        return if names.len() > 3 {
            LocationKind::Icloud
        } else {
            LocationKind::Local
        };
    }
    if second == "cloudstorage" {
        let Some(provider) = names.get(2) else {
            return LocationKind::Local;
        };
        if names.len() < 4 {
            return LocationKind::Local;
        }
        if provider.starts_with("onedrive") {
            return LocationKind::Onedrive;
        }
        if provider.starts_with("dropbox") {
            return LocationKind::Dropbox;
        }
        if provider.starts_with("googledrive") {
            return LocationKind::GoogleDrive;
        }
    }
    LocationKind::Local
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::path::PathBuf;

    const HOME: &str = "/Users/alex";

    fn location(path: &str) -> LocationKind {
        detect_location(Path::new(path), Some(Path::new(HOME)))
    }

    // ---- location ------------------------------------------------------------------------

    #[test]
    fn r07_icloud_drive_is_the_cloud_docs_folder() {
        assert_eq!(
            location("/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/a.md"),
            LocationKind::Icloud
        );
        assert_eq!(
            location("/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/Notes/2026/a.md"),
            LocationKind::Icloud
        );
    }

    #[test]
    fn r07_other_icloud_containers_are_not_icloud_drive() {
        assert_eq!(
            location("/Users/alex/Library/Mobile Documents/iCloud~md~obsidian/Documents/a.md"),
            LocationKind::Local
        );
        assert_eq!(
            location("/Users/alex/Library/Mobile Documents/a.md"),
            LocationKind::Local
        );
    }

    #[test]
    fn r07_onedrive_is_any_cloud_storage_folder_that_starts_with_onedrive() {
        for path in [
            "/Users/alex/Library/CloudStorage/OneDrive/a.md",
            "/Users/alex/Library/CloudStorage/OneDrive-Personal/Notes/a.md",
            "/Users/alex/Library/CloudStorage/OneDrive-Contoso/a.md",
        ] {
            assert_eq!(location(path), LocationKind::Onedrive, "{path}");
        }
    }

    #[test]
    fn r07_dropbox_is_a_cloud_storage_folder_or_the_old_home_folder() {
        for path in [
            "/Users/alex/Library/CloudStorage/Dropbox/a.md",
            "/Users/alex/Library/CloudStorage/Dropbox-Work/Notes/a.md",
            "/Users/alex/Dropbox/a.md",
            "/Users/alex/Dropbox/Notes/a.md",
        ] {
            assert_eq!(location(path), LocationKind::Dropbox, "{path}");
        }
    }

    #[test]
    fn r07_google_drive_is_a_cloud_storage_folder_that_starts_with_googledrive() {
        for path in [
            "/Users/alex/Library/CloudStorage/GoogleDrive-alex@example.org/My Drive/a.md",
            "/Users/alex/Library/CloudStorage/GoogleDrive/a.md",
        ] {
            assert_eq!(location(path), LocationKind::GoogleDrive, "{path}");
        }
    }

    #[test]
    fn r07_everything_else_is_local() {
        for path in [
            "/Users/alex/Documents/a.md",
            "/Users/alex/a.md",
            "/Users/alex/Desktop/Dropbox notes/a.md",
            "/Users/alex/Dropboxy/a.md",
            "/Users/alex/Library/CloudStorage/Box-Box/a.md",
            "/Users/alex/Library/CloudStorage/a.md",
            "/Users/alex/Library/Application Support/a.md",
            "/Volumes/USB/a.md",
            "/tmp/a.md",
            "/Users/someone-else/Dropbox/a.md",
            "/Users/someone-else/Library/CloudStorage/OneDrive/a.md",
        ] {
            assert_eq!(location(path), LocationKind::Local, "{path}");
        }
    }

    #[test]
    fn r07_the_cloud_folder_itself_is_not_a_document_location() {
        for path in [
            "/Users/alex/Dropbox",
            "/Users/alex/Library/CloudStorage/Dropbox",
            "/Users/alex/Library/Mobile Documents/com~apple~CloudDocs",
        ] {
            assert_eq!(location(path), LocationKind::Local, "{path}");
        }
    }

    #[test]
    fn r07_folder_names_are_matched_without_regard_to_letter_case() {
        assert_eq!(
            location("/Users/alex/library/cloudstorage/dropbox/a.md"),
            LocationKind::Dropbox
        );
        assert_eq!(location("/Users/alex/DROPBOX/a.md"), LocationKind::Dropbox);
    }

    #[test]
    fn r07_without_a_home_folder_everything_is_local() {
        assert_eq!(
            detect_location(Path::new("/Users/alex/Dropbox/a.md"), None),
            LocationKind::Local
        );
    }

    #[test]
    fn r07_a_relative_or_unrelated_path_is_local() {
        assert_eq!(location("Dropbox/a.md"), LocationKind::Local);
        assert_eq!(location(""), LocationKind::Local);
    }

    // ---- Obsidian vault ------------------------------------------------------------------

    fn vault_in(dir: &TempDir) -> PathBuf {
        let vault = dir.path().join("vault");
        std::fs::create_dir_all(vault.join(".obsidian")).expect("mkdir");
        vault
    }

    #[test]
    fn r07_a_document_directly_in_a_vault_is_in_the_vault() {
        let dir = TempDir::new();
        let vault = vault_in(&dir);
        let note = vault.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        assert!(in_obsidian_vault(&note));
    }

    #[test]
    fn r07_a_document_deep_below_the_vault_folder_is_in_the_vault() {
        let dir = TempDir::new();
        let vault = vault_in(&dir);
        let deep = vault.join("a").join("b").join("c");
        std::fs::create_dir_all(&deep).expect("mkdir");
        let note = deep.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        assert!(in_obsidian_vault(&note));
    }

    #[test]
    fn r07_a_document_beside_the_vault_is_not_in_it() {
        let dir = TempDir::new();
        vault_in(&dir);
        let beside = dir.path().join("other");
        std::fs::create_dir(&beside).expect("mkdir");
        let note = beside.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        assert!(!in_obsidian_vault(&note));
    }

    #[test]
    fn r07_a_file_named_obsidian_is_not_a_vault_marker() {
        let dir = TempDir::new();
        let folder = dir.path().join("fake");
        std::fs::create_dir(&folder).expect("mkdir");
        std::fs::write(folder.join(".obsidian"), b"I am a file").expect("write");
        let note = folder.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        assert!(!in_obsidian_vault(&note));
    }

    #[test]
    fn r07_the_search_goes_all_the_way_up() {
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join(".obsidian")).expect("mkdir");
        let deep = dir.path().join("1").join("2").join("3").join("4");
        std::fs::create_dir_all(&deep).expect("mkdir");
        let note = deep.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        assert!(in_obsidian_vault(&note));
    }

    #[test]
    fn r07_the_marker_may_be_in_the_documents_own_folder() {
        let dir = TempDir::new();
        let folder = dir.path().join("plain");
        std::fs::create_dir(&folder).expect("mkdir");
        let note = folder.join("note.md");
        std::fs::write(&note, b"x").expect("write");
        assert!(!in_obsidian_vault(&note));

        std::fs::create_dir(folder.join(".obsidian")).expect("mkdir");

        assert!(
            in_obsidian_vault(&note),
            "the folder that holds the document is the vault root"
        );
    }

    #[test]
    fn r07_the_vault_fixture_is_recognized_and_the_plain_fixture_is_not() {
        let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("flavors");
        let in_vault =
            crate::fs_util::canonicalize(fixtures.join("vault").join("notes").join("idea.md"))
                .expect("fixture exists");
        let outside =
            crate::fs_util::canonicalize(fixtures.join("plain.md")).expect("fixture exists");

        assert!(in_obsidian_vault(&in_vault));
        assert!(!in_obsidian_vault(&outside));
    }

    #[test]
    fn a_path_at_the_root_does_not_fail() {
        assert!(!in_obsidian_vault(Path::new("/a.md")));
        assert!(!in_obsidian_vault(Path::new("/")));
    }

    #[test]
    fn the_context_combines_both_answers_and_serializes_for_the_frontend() {
        let dir = TempDir::new();
        let vault = vault_in(&dir);
        let note = vault.join("note.md");
        std::fs::write(&note, b"x").expect("write");

        let context = document_context(&note, Some(Path::new("/Users/nobody")));

        assert_eq!(
            context,
            DocumentContext {
                obsidian_vault: true,
                location: LocationKind::Local
            }
        );
        assert_eq!(
            serde_json::to_value(context).expect("serializes"),
            serde_json::json!({ "obsidianVault": true, "location": "local" })
        );
        for (kind, name) in [
            (LocationKind::Icloud, "icloud"),
            (LocationKind::Onedrive, "onedrive"),
            (LocationKind::Dropbox, "dropbox"),
            (LocationKind::GoogleDrive, "google-drive"),
            (LocationKind::Local, "local"),
        ] {
            assert_eq!(
                serde_json::to_value(kind).expect("serializes"),
                serde_json::json!(name)
            );
        }
    }
}
