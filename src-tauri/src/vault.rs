//! The Obsidian vault of a document (`vaultIndex`).
//!
//! The vault root is the nearest folder above the document that contains a `.obsidian` folder.
//! The index lists its notes (Markdown family files) and attachments (images and PDF files) with
//! paths relative to the root, `/` separated, so the preview can resolve `[[wikilinks]]` and
//! `![[embeds]]` without touching the file system for every link.
//!
//! Skipped: hidden files and folders (which covers `.obsidian` and `.trash`), `node_modules`,
//! and anything that is a symbolic link. No ignore file (`.gitignore`, `.ignore`) is read.

use crate::file_types;
use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// At most this many entries (notes plus attachments) are listed; then `truncated` is set.
pub const MAX_INDEX_ENTRIES: usize = 20_000;

/// Folder names that are never walked, besides hidden ones.
const SKIPPED_FOLDERS: [&str; 3] = [".obsidian", ".trash", "node_modules"];

/// `VaultIndex` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultIndex {
    /// The canonical path of the vault root.
    pub root: String,
    pub notes: Vec<String>,
    pub attachments: Vec<String>,
    pub truncated: bool,
}

/// The nearest folder above `doc` (canonical) that contains a `.obsidian` folder.
pub fn vault_root(doc: &Path) -> Option<PathBuf> {
    doc.ancestors()
        .skip(1)
        .find(|folder| folder.join(".obsidian").is_dir())
        .map(Path::to_path_buf)
}

fn is_pdf(path: &Path) -> bool {
    file_types::extension_lower(path).as_deref() == Some("pdf")
}

/// The index of the vault that holds `doc`, or `None` when it is in no vault.
pub fn vault_index(doc: &Path) -> Option<VaultIndex> {
    vault_root(doc).map(|root| index_of(&root, MAX_INDEX_ENTRIES))
}

/// The index of the vault at `root`, with at most `cap` entries.
pub fn index_of(root: &Path, cap: usize) -> VaultIndex {
    let mut notes = Vec::new();
    let mut attachments = Vec::new();
    let mut truncated = false;

    let walk = WalkBuilder::new(root)
        .standard_filters(false)
        .hidden(true)
        .follow_links(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(|entry| {
            let is_folder = entry.file_type().is_some_and(|kind| kind.is_dir());
            !(is_folder
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| SKIPPED_FOLDERS.contains(&name)))
        })
        .build();

    for entry in walk.flatten() {
        // A symbolic link is neither a file nor a folder here, so it is never listed.
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry.path();
        let is_note = file_types::is_markdown_path(path);
        if !is_note && !file_types::is_image_path(path) && !is_pdf(path) {
            continue;
        }
        let Some(relative) = path
            .strip_prefix(root)
            .ok()
            .and_then(|relative| relative.to_str())
        else {
            continue;
        };
        if notes.len() + attachments.len() >= cap {
            truncated = true;
            break;
        }
        let relative = relative.replace(std::path::MAIN_SEPARATOR, "/");
        if is_note {
            notes.push(relative);
        } else {
            attachments.push(relative);
        }
    }

    VaultIndex {
        root: root.to_string_lossy().into_owned(),
        notes,
        attachments,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::os::unix::fs::symlink;

    fn fixture_vault() -> PathBuf {
        std::fs::canonicalize(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("tests")
                .join("fixtures")
                .join("flavors")
                .join("obsidian")
                .join("vault"),
        )
        .expect("fixture vault exists")
    }

    fn make(dir: &TempDir, relative: &str) {
        let path = dir.path().join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(path, b"x").expect("write");
    }

    #[test]
    fn the_root_is_the_nearest_folder_with_obsidian_above_the_document() {
        let vault = fixture_vault();
        let note = vault.join("Notes").join("Note A.md");

        assert_eq!(vault_root(&note), Some(vault.clone()));
        assert_eq!(vault_root(&vault.join("Home.md")), Some(vault));
    }

    #[test]
    fn the_nearest_vault_wins_over_an_outer_one() {
        let dir = TempDir::new();
        make(&dir, ".obsidian/app.json");
        make(&dir, "inner/.obsidian/app.json");
        make(&dir, "inner/deep/note.md");

        assert_eq!(
            vault_root(&dir.path().join("inner/deep/note.md")),
            Some(dir.path().join("inner"))
        );
    }

    #[test]
    fn a_document_outside_every_vault_has_none() {
        let dir = TempDir::new();
        let doc = dir.write("note.md", b"x");
        // A file called .obsidian is not a vault marker.
        dir.write(".obsidian", b"x");

        assert_eq!(vault_root(&doc), None);
        assert_eq!(vault_index(&doc), None);
        let outside = fixture_vault().join("..").join("outside.md");
        assert_eq!(
            vault_root(&std::fs::canonicalize(outside).expect("fixture")),
            None
        );
    }

    #[test]
    fn the_fixture_vault_lists_notes_and_attachments_and_skips_the_rest() {
        let vault = fixture_vault();
        let index = vault_index(&vault.join("Home.md")).expect("in a vault");

        assert_eq!(index.root, vault.to_string_lossy());
        assert!(!index.truncated);
        assert_eq!(
            index.notes,
            vec![
                "Archive/Old/Plan.md",
                "Cycle A.md",
                "Cycle B.md",
                "Home.md",
                "Notes/Note A.md",
                "Projects/Plan.md"
            ]
        );
        assert_eq!(
            index.attachments,
            vec!["attachments/diagram.png", "attachments/report.pdf"]
        );
    }

    #[test]
    fn hidden_and_skipped_folders_are_not_walked() {
        let dir = TempDir::new();
        make(&dir, ".obsidian/app.json");
        make(&dir, ".obsidian/notes.md");
        make(&dir, ".trash/old.md");
        make(&dir, ".hidden/secret.md");
        make(&dir, "node_modules/pkg/README.md");
        make(&dir, "a/node_modules/x.md");
        make(&dir, "a/.git/y.md");
        make(&dir, ".dot.md");
        make(&dir, "a/keep.md");
        make(&dir, "a/pic.JPG");
        make(&dir, "a/notes.txt");
        make(&dir, "a/data.json");

        let index = index_of(dir.path(), MAX_INDEX_ENTRIES);

        assert_eq!(index.notes, vec!["a/keep.md"]);
        assert_eq!(index.attachments, vec!["a/pic.JPG"]);
    }

    #[test]
    fn symbolic_links_are_not_followed_or_listed() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        make(&outside, "linked/secret.md");
        make(&dir, ".obsidian/app.json");
        make(&dir, "real/n.md");
        symlink(
            outside.path().join("linked"),
            dir.path().join("folder-link"),
        )
        .expect("symlink");
        symlink(
            dir.path().join("real/n.md"),
            dir.path().join("file-link.md"),
        )
        .expect("symlink");

        let index = index_of(dir.path(), MAX_INDEX_ENTRIES);

        assert_eq!(index.notes, vec!["real/n.md"]);
    }

    #[test]
    fn a_gitignore_inside_the_vault_does_not_hide_notes() {
        let dir = TempDir::new();
        dir.write(".gitignore", b"*.md\n");
        make(&dir, "a.md");

        assert_eq!(index_of(dir.path(), MAX_INDEX_ENTRIES).notes, vec!["a.md"]);
    }

    #[test]
    fn the_index_stops_at_the_cap_and_says_so() {
        let dir = TempDir::new();
        for number in 0..30 {
            make(&dir, &format!("n{number:02}.md"));
        }

        let exact = index_of(dir.path(), 30);
        let over = index_of(dir.path(), 29);

        assert_eq!(exact.notes.len(), 30);
        assert!(!exact.truncated);
        assert_eq!(over.notes.len(), 29);
        assert!(over.truncated);
    }

    #[test]
    fn the_real_cap_is_twenty_thousand() {
        assert_eq!(MAX_INDEX_ENTRIES, 20_000);
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join("many")).expect("mkdir");
        for number in 0..=MAX_INDEX_ENTRIES {
            std::fs::write(dir.path().join("many").join(format!("{number}.md")), b"")
                .expect("write");
        }

        let index = index_of(dir.path(), MAX_INDEX_ENTRIES);

        assert_eq!(index.notes.len(), MAX_INDEX_ENTRIES);
        assert!(index.truncated);
    }
}
