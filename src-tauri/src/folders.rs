//! Listing an open folder: one level for the Files tree (`list_folder`) and
//! every Markdown-family file below the folder for Quick Open (`file_index`).
//!
//! The skip rules, shared with the search and the watcher (`skipped_name`):
//! - hidden entries (the name starts with a dot) and names in the `files.ignore` setting, at any
//!   depth;
//! - files that are not in the Markdown family (`file_types::DOCUMENT_EXTENSIONS`);
//! - links to folders (never followed, so no loops and no way out of the folder);
//! - links to files that point outside the granted folder.
//!
//! The folder must be granted (`grants.rs`).

use crate::error::{PlatformError, PlatformResult};
use crate::file_types;
use crate::fs_util;
use crate::grants::PathGrants;
use ignore::WalkBuilder;
use serde::Serialize;
use std::fs::Metadata;
use std::path::{Path, PathBuf};

/// The most entries one level of the tree lists; then `truncated` is set.
pub const MAX_LEVEL_ENTRIES: usize = 5_000;
/// The most files `file_index` lists; then `truncated` is set.
pub const MAX_INDEX_FILES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Folder,
    File,
}

/// `FolderEntry` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    /// The size of a file; null for a folder.
    pub bytes: Option<u64>,
    pub modified_ms: Option<u64>,
}

/// `FolderListing` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FolderListing {
    pub path: String,
    pub entries: Vec<FolderEntry>,
    pub truncated: bool,
}

/// `{ paths, truncated }` of `fileIndex`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileIndex {
    pub paths: Vec<String>,
    pub truncated: bool,
}

/// True for a name that is never listed, searched or watched: hidden, or in the ignore list.
pub fn skipped_name(name: &str, ignore: &[String]) -> bool {
    name.starts_with('.') || ignore.iter().any(|ignored| ignored == name)
}

/// True for a file name in the Markdown family.
pub fn is_listed_file(name: &str) -> bool {
    file_types::is_document_path(Path::new(name))
}

/// A link below a granted folder: its canonical target if that is a file inside `root`.
pub(crate) fn inside_file_target(link: &Path, root: &Path) -> Option<(PathBuf, Metadata)> {
    let target = crate::fs_util::canonicalize(link).ok()?;
    if !target.starts_with(root) {
        return None;
    }
    let metadata = std::fs::metadata(&target).ok()?;
    metadata.is_file().then_some((target, metadata))
}

fn sort_key(entry: &FolderEntry) -> (u8, String) {
    (
        u8::from(entry.kind == EntryKind::File),
        entry.name.to_lowercase(),
    )
}

/// One level of a granted folder. Folders come first, then files, each by name without regard to
/// letter case; the front end sorts again with natural order.
pub fn list_folder(
    grants: &PathGrants,
    folder: &Path,
    ignore: &[String],
) -> PlatformResult<FolderListing> {
    let folder = grants.check_folder(folder)?;
    let root = grants
        .folder_root_of(&folder)
        .unwrap_or_else(|| folder.clone());
    let reader = std::fs::read_dir(&folder).map_err(|e| PlatformError::from_read(&e))?;

    let mut entries = Vec::new();
    for item in reader.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if skipped_name(&name, ignore) {
            continue;
        }
        let Ok(kind) = item.file_type() else {
            continue;
        };
        let path = folder.join(&name);
        let (entry_kind, metadata) = if kind.is_symlink() {
            if !is_listed_file(&name) {
                continue; // links to folders are never followed
            }
            let Some((_, metadata)) = inside_file_target(&path, &root) else {
                continue;
            };
            (EntryKind::File, metadata)
        } else if kind.is_dir() {
            let Ok(metadata) = item.metadata() else {
                continue;
            };
            (EntryKind::Folder, metadata)
        } else if kind.is_file() && is_listed_file(&name) {
            let Ok(metadata) = item.metadata() else {
                continue;
            };
            (EntryKind::File, metadata)
        } else {
            continue;
        };
        entries.push(FolderEntry {
            name,
            path: crate::fs_util::path_text(&path),
            kind: entry_kind,
            bytes: (entry_kind == EntryKind::File).then_some(metadata.len()),
            modified_ms: Some(fs_util::modified_ms(&metadata)),
        });
    }

    entries.sort_by_key(sort_key);
    let truncated = entries.len() > MAX_LEVEL_ENTRIES;
    entries.truncate(MAX_LEVEL_ENTRIES);
    Ok(FolderListing {
        path: crate::fs_util::path_text(&folder),
        entries,
        truncated,
    })
}

/// Every Markdown-family file below a granted folder, as absolute paths in path order, for Quick
/// Open. At most `MAX_INDEX_FILES`.
pub fn file_index(
    grants: &PathGrants,
    folder: &Path,
    ignore: &[String],
) -> PlatformResult<FileIndex> {
    let folder = grants.check_folder(folder)?;
    let root = grants
        .folder_root_of(&folder)
        .unwrap_or_else(|| folder.clone());
    let skip: Vec<String> = ignore.to_vec();

    let walk = WalkBuilder::new(&folder)
        .standard_filters(false)
        .hidden(true)
        .follow_links(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            entry.depth() == 0
                || !entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| skipped_name(name, &skip))
        })
        .build();

    let mut paths = Vec::new();
    let mut truncated = false;
    for entry in walk.flatten() {
        let Some(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy();
        let listed = if kind.is_file() {
            is_listed_file(&name)
        } else if kind.is_symlink() {
            is_listed_file(&name) && inside_file_target(entry.path(), &root).is_some()
        } else {
            false
        };
        if !listed {
            continue;
        }
        if paths.len() >= MAX_INDEX_FILES {
            truncated = true;
            break;
        }
        paths.push(crate::fs_util::path_text(entry.path()));
    }
    Ok(FileIndex { paths, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::test_support::TempDir;

    fn granted(dir: &TempDir) -> (PathGrants, PathBuf) {
        let grants = PathGrants::default();
        let root = grants.grant_folder(dir.path()).expect("grant");
        (grants, root)
    }

    fn touch(root: &Path, relative: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        std::fs::write(path, b"x").expect("write");
    }

    fn names(listing: &FolderListing) -> Vec<(&str, EntryKind)> {
        listing
            .entries
            .iter()
            .map(|e| (e.name.as_str(), e.kind))
            .collect()
    }

    fn no_ignore() -> Vec<String> {
        Vec::new()
    }

    #[test]
    fn a_level_lists_folders_first_then_markdown_files_in_name_order() {
        let dir = TempDir::new();
        for file in [
            "b.md",
            "A.md",
            "notes.txt",
            "c.Rmd",
            "d.qmd",
            "e.mdx",
            "f.mmd",
        ] {
            touch(dir.path(), file);
        }
        touch(dir.path(), "zeta/in.md");
        touch(dir.path(), "Alpha/in.md");
        let (grants, root) = granted(&dir);

        let listing = list_folder(&grants, &root, &no_ignore()).expect("lists");

        assert_eq!(listing.path, crate::fs_util::path_text(&root));
        assert!(!listing.truncated);
        assert_eq!(
            names(&listing),
            [
                ("Alpha", EntryKind::Folder),
                ("zeta", EntryKind::Folder),
                ("A.md", EntryKind::File),
                ("b.md", EntryKind::File),
                ("c.Rmd", EntryKind::File),
                ("d.qmd", EntryKind::File),
                ("e.mdx", EntryKind::File),
                ("f.mmd", EntryKind::File),
                ("notes.txt", EntryKind::File),
            ]
        );
    }

    #[test]
    fn only_one_level_is_listed_and_entries_carry_sizes_and_times() {
        let dir = TempDir::new();
        std::fs::write(dir.path().join("a.md"), b"12345").expect("write");
        touch(dir.path(), "sub/deep.md");
        let (grants, root) = granted(&dir);

        let listing = list_folder(&grants, &root, &no_ignore()).expect("lists");

        let file = listing
            .entries
            .iter()
            .find(|e| e.name == "a.md")
            .expect("a");
        assert_eq!(file.bytes, Some(5));
        assert!(file.modified_ms.is_some_and(|ms| ms > 0));
        assert_eq!(file.path, crate::fs_util::path_text(&root.join("a.md")));
        let folder = listing
            .entries
            .iter()
            .find(|e| e.name == "sub")
            .expect("sub");
        assert_eq!(folder.bytes, None);
        assert_eq!(
            listing.entries.len(),
            2,
            "deep.md belongs to the next level"
        );
        let sub = list_folder(&grants, &root.join("sub"), &no_ignore()).expect("sub lists");
        assert_eq!(names(&sub), [("deep.md", EntryKind::File)]);
    }

    #[test]
    fn hidden_ignored_and_non_markdown_entries_are_skipped() {
        let dir = TempDir::new();
        for file in [
            "keep.md",
            ".hidden.md",
            "image.png",
            "data.csv",
            "script.R",
            "node_modules/pkg/readme.md",
            ".git/config",
            "venv/readme.md",
            "visible/ok.md",
        ] {
            touch(dir.path(), file);
        }
        let (grants, root) = granted(&dir);
        let ignore = vec!["node_modules".to_owned(), "venv".to_owned()];

        let listing = list_folder(&grants, &root, &ignore).expect("lists");

        assert_eq!(
            names(&listing),
            [("visible", EntryKind::Folder), ("keep.md", EntryKind::File)]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_file_inside_is_listed_and_links_outside_or_to_folders_are_not() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        touch(dir.path(), "real.md");
        touch(dir.path(), "sub/inner.md");
        touch(outside.path(), "secret.md");
        touch(outside.path(), "folder/x.md");
        let base = crate::fs_util::canonicalize(dir.path()).expect("canonical");
        std::os::unix::fs::symlink(base.join("real.md"), base.join("alias.md")).expect("link");
        std::os::unix::fs::symlink(outside.path().join("secret.md"), base.join("leak.md"))
            .expect("link");
        std::os::unix::fs::symlink(outside.path().join("folder"), base.join("leakdir"))
            .expect("link");
        std::os::unix::fs::symlink(base.join("sub"), base.join("subalias")).expect("link");
        std::os::unix::fs::symlink(base.join("nowhere.md"), base.join("broken.md")).expect("link");
        let (grants, root) = granted(&dir);

        let listing = list_folder(&grants, &root, &no_ignore()).expect("lists");

        assert_eq!(
            names(&listing),
            [
                ("sub", EntryKind::Folder),
                ("alias.md", EntryKind::File),
                ("real.md", EntryKind::File)
            ]
        );
    }

    #[test]
    fn a_level_is_capped_at_5000_entries() {
        let dir = TempDir::new();
        for index in 0..(MAX_LEVEL_ENTRIES + 3) {
            std::fs::write(dir.path().join(format!("n{index:05}.md")), b"").expect("write");
        }
        let (grants, root) = granted(&dir);

        let listing = list_folder(&grants, &root, &no_ignore()).expect("lists");

        assert_eq!(listing.entries.len(), MAX_LEVEL_ENTRIES);
        assert!(listing.truncated);
        assert_eq!(
            listing.entries[0].name, "n00000.md",
            "sorted before the cut"
        );
    }

    #[test]
    fn a_level_of_exactly_the_cap_is_not_truncated() {
        let dir = TempDir::new();
        for index in 0..MAX_LEVEL_ENTRIES {
            std::fs::write(dir.path().join(format!("n{index:05}.md")), b"").expect("write");
        }
        let (grants, root) = granted(&dir);

        let listing = list_folder(&grants, &root, &no_ignore()).expect("lists");

        assert_eq!(listing.entries.len(), MAX_LEVEL_ENTRIES);
        assert!(!listing.truncated);
    }

    #[test]
    fn listing_refuses_folders_outside_the_grant_and_files() {
        let dir = TempDir::new();
        let other = TempDir::new();
        touch(dir.path(), "a.md");
        let (grants, root) = granted(&dir);

        assert_eq!(
            list_folder(&grants, other.path(), &no_ignore())
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            list_folder(&grants, &root.join("a.md"), &no_ignore())
                .expect_err("not a folder")
                .code,
            ErrorCode::Io
        );
        assert_eq!(
            list_folder(&grants, &root.join("missing"), &no_ignore())
                .expect_err("missing")
                .code,
            ErrorCode::NotFound
        );
        let sneaky = root
            .join("..")
            .join(other.path().file_name().expect("name"));
        assert_eq!(
            list_folder(&grants, &sneaky, &no_ignore())
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_below_the_root_may_be_listed_and_a_folder_link_is_refused() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        touch(dir.path(), "sub/a.md");
        touch(outside.path(), "x.md");
        let base = crate::fs_util::canonicalize(dir.path()).expect("canonical");
        std::os::unix::fs::symlink(outside.path(), base.join("door")).expect("link");
        let (grants, root) = granted(&dir);

        assert!(list_folder(&grants, &root.join("sub"), &no_ignore()).is_ok());
        assert!(list_folder(&grants, &root.join("door"), &no_ignore()).is_err());
    }

    // ---- the index -----------------------------------------------------------------------

    fn relative(index: &FileIndex, root: &Path) -> Vec<String> {
        index
            .paths
            .iter()
            .map(|p| {
                Path::new(p)
                    .strip_prefix(root)
                    .expect("inside")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
    }

    #[test]
    fn the_index_lists_markdown_files_at_every_depth_in_path_order() {
        let dir = TempDir::new();
        for file in [
            "b.md",
            "a/x.qmd",
            "a/deep/y.Rmd",
            "a/pic.png",
            ".hidden/z.md",
            "node_modules/p/q.md",
            "_site/out.md",
            "keep/.secret.md",
            "z.txt",
        ] {
            touch(dir.path(), file);
        }
        let (grants, root) = granted(&dir);
        let ignore = vec!["node_modules".to_owned(), "_site".to_owned()];

        let index = file_index(&grants, &root, &ignore).expect("indexes");

        assert!(!index.truncated);
        assert_eq!(
            relative(&index, &root),
            ["a/deep/y.Rmd", "a/x.qmd", "b.md", "z.txt"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_index_skips_links_out_of_the_folder_and_folder_links() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        touch(dir.path(), "real.md");
        touch(outside.path(), "secret.md");
        touch(outside.path(), "dir/x.md");
        let base = crate::fs_util::canonicalize(dir.path()).expect("canonical");
        std::os::unix::fs::symlink(outside.path().join("secret.md"), base.join("leak.md"))
            .expect("link");
        std::os::unix::fs::symlink(outside.path().join("dir"), base.join("leakdir")).expect("link");
        std::os::unix::fs::symlink(base.join("real.md"), base.join("alias.md")).expect("link");
        let (grants, root) = granted(&dir);

        let index = file_index(&grants, &root, &no_ignore()).expect("indexes");

        assert_eq!(relative(&index, &root), ["alias.md", "real.md"]);
    }

    #[test]
    fn the_index_is_capped_at_20000_files() {
        let dir = TempDir::new();
        // Two levels keep each folder small.
        for folder in 0..21 {
            let sub = dir.path().join(format!("d{folder:02}"));
            std::fs::create_dir(&sub).expect("mkdir");
            for file in 0..1000 {
                std::fs::write(sub.join(format!("n{file:04}.md")), b"").expect("write");
            }
        }
        let (grants, root) = granted(&dir);

        let index = file_index(&grants, &root, &no_ignore()).expect("indexes");

        assert_eq!(index.paths.len(), MAX_INDEX_FILES);
        assert!(index.truncated);
    }

    #[test]
    fn the_index_of_an_ungranted_folder_is_refused() {
        let dir = TempDir::new();
        let grants = PathGrants::default();

        assert_eq!(
            file_index(&grants, dir.path(), &no_ignore())
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn the_skip_rule_covers_hidden_names_and_the_ignore_list() {
        let ignore = vec!["_freeze".to_owned()];
        assert!(skipped_name(".git", &ignore));
        assert!(skipped_name("_freeze", &ignore));
        assert!(!skipped_name("_freeze2", &ignore));
        assert!(!skipped_name("notes.md", &ignore));
        assert!(is_listed_file("a.Rmd") && is_listed_file("a.TXT"));
        assert!(!is_listed_file("a.png") && !is_listed_file("README"));
    }
}
