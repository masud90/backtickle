//! The path allowlist.
//!
//! The web view can ask Rust to read or save a file, but only a file the user gave to Writedown
//! in this session. Grants come from Rust code only:
//!
//! - the open and save dialogs (which Rust shows itself) and the `--open` argument;
//! - Finder and Dock open events, and files dropped on the window (`open_files.rs`);
//! - Open Recent and the recents list (`recents.rs`);
//! - links to other documents from a document that is already granted (`links.rs`).
//!
//! - folders the user chose in the folder dialog (Phase 3, `folder_dialog`) and the folder and
//!   files of the restored session: everything below such a folder may be read, saved and
//!   changed by the file operations (`file_ops.rs`), and nothing outside it.
//!
//! There is no command that adds a path on the web view's say-so, so even a compromised page
//! cannot read an arbitrary path.
//!
//! Paths are stored in canonical form (symbolic links and `..` resolved).

use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::text_file::describe_io_error;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// The answer for any path that is not on the list.
pub const NOT_CHOSEN: &str = "This file was not chosen in the open dialog.";

fn changed_since_granted() -> PlatformError {
    PlatformError::new(
        ErrorCode::NotAllowed,
        "The file changed since it was opened. Open it again with File > Open.",
    )
}

#[derive(Default)]
pub struct PathGrants {
    allowed: Mutex<HashSet<PathBuf>>,
    /// Files read through a link, an include or an embed (`linked_text.rs`). They may be the
    /// starting point of further linked reads and nothing else: no save, no recents.
    read_only: Mutex<HashSet<PathBuf>>,
    /// Folders (canonical): everything below them is allowed for reading and file operations.
    folders: Mutex<HashSet<PathBuf>>,
}

/// True for a path without `.` and `..` components, which could walk out of a granted folder
/// while still starting with it.
fn has_no_dot_components(path: &Path) -> bool {
    path.is_absolute()
        && path.components().all(|part| {
            !matches!(
                part,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
}

impl PathGrants {
    /// Allows reading one file for the rest of this session. Returns its canonical path, which
    /// is the only spelling `check` accepts afterwards.
    pub fn grant(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path).map_err(|e| describe_io_error(&e))?;
        if !canonical.is_file() {
            return Err("The chosen item is not a file.".to_string());
        }
        self.lock().insert(canonical.clone());
        Ok(canonical)
    }

    /// Returns the path if it may be read.
    ///
    /// The list is consulted before the file system is touched, so a refused path reveals
    /// nothing about whether it exists. An allowed path must also still resolve to itself:
    /// if it was replaced by a link to somewhere else since it was chosen, it is refused.
    pub fn check(&self, path: &Path) -> Result<PathBuf, String> {
        if !self.lock().contains(path) {
            return Err(NOT_CHOSEN.to_string());
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            Ok(_) => Err("The file changed since it was chosen. Choose it again.".to_string()),
            Err(error) => Err(describe_io_error(&error)),
        }
    }

    /// Allows a file that may not exist yet: the answer of the save dialog. The folder must exist;
    /// the returned path is its canonical form plus the file name.
    pub fn grant_new(&self, path: &Path) -> PlatformResult<PathBuf> {
        let target = self.resolve_new(path)?;
        self.lock().insert(target.clone());
        Ok(target)
    }

    /// The canonical spelling of a path the user chose in a save dialog (the file may not exist
    /// yet), without granting it. `grant_new` is this plus the grant.
    pub fn resolve_new(&self, path: &Path) -> PlatformResult<PathBuf> {
        let target = match std::fs::canonicalize(path) {
            Ok(existing) => {
                if !existing.is_file() {
                    return Err(PlatformError::io("The chosen item is not a file."));
                }
                existing
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
                    return Err(PlatformError::io("The chosen item is not a file name."));
                };
                let folder =
                    std::fs::canonicalize(folder).map_err(|e| PlatformError::from_write(&e))?;
                folder.join(name)
            }
            Err(error) => return Err(PlatformError::from_read(&error)),
        };
        Ok(target)
    }

    /// Allows a file that the caller has already resolved (canonical, existing, a regular file):
    /// a document reached through a link from a granted document.
    pub fn grant_resolved(&self, canonical: &Path) {
        self.lock().insert(canonical.to_path_buf());
    }

    /// Allows a file that the caller has already resolved to be the starting point of further
    /// `read_linked_text` calls (nested includes). It does not allow anything else.
    pub fn grant_read_only(&self, canonical: &Path) {
        self.read_only
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(canonical.to_path_buf());
    }

    /// Like `check_document`, and a read-only grant counts too. Used only by the commands that
    /// read linked text.
    pub fn check_readable(&self, path: &Path) -> PlatformResult<PathBuf> {
        let read_only = self
            .read_only
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(path);
        if !read_only {
            return self.check_document(path);
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            Ok(_) => Err(changed_since_granted()),
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }

    /// True if the path (exactly this spelling) was granted.
    pub fn is_granted(&self, path: &Path) -> bool {
        self.lock().contains(path)
    }

    /// Like `check`, with the error the Phase 1 commands return. The list is consulted before
    /// the file system is touched, so a refused path reveals nothing about whether it exists.
    pub fn check_document(&self, path: &Path) -> PlatformResult<PathBuf> {
        let exact = self.is_granted(path);
        let root = if exact {
            None
        } else {
            self.folder_root_of(path)
        };
        if !exact && root.is_none() {
            return Err(PlatformError::not_allowed());
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            // A link below a granted folder is fine as long as it stays inside that folder.
            Ok(canonical)
                if root
                    .as_ref()
                    .is_some_and(|root| canonical.starts_with(root)) =>
            {
                Ok(canonical)
            }
            Ok(_) => Err(changed_since_granted()),
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }

    /// The check for a save: the path must have been granted. A file that does not exist yet
    /// (a new document saved for the first time) is fine as long as its folder is still the
    /// folder that was granted and the name has not been taken by a link.
    pub fn check_for_save(&self, path: &Path) -> PlatformResult<PathBuf> {
        if !self.is_permitted(path) {
            return Err(PlatformError::not_allowed());
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            Ok(_) => Err(changed_since_granted()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let folder_unchanged = path
                    .parent()
                    .and_then(|folder| std::fs::canonicalize(folder).ok().map(|c| c == folder))
                    .unwrap_or(false);
                // symlink_metadata also sees a link that points nowhere.
                if folder_unchanged && std::fs::symlink_metadata(path).is_err() {
                    Ok(path.to_path_buf())
                } else {
                    Err(changed_since_granted())
                }
            }
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }

    // ---- folders (Phase 3) ---------------------------------------------------------------

    /// Allows a folder the user chose and everything below it. Returns its canonical path.
    pub fn grant_folder(&self, path: &Path) -> PlatformResult<PathBuf> {
        let canonical = std::fs::canonicalize(path).map_err(|e| PlatformError::from_read(&e))?;
        if !canonical.is_dir() {
            return Err(PlatformError::io("The chosen item is not a folder."));
        }
        self.grant_folder_resolved(&canonical);
        Ok(canonical)
    }

    /// Allows a folder that the caller has already resolved (canonical, existing).
    pub fn grant_folder_resolved(&self, canonical: &Path) {
        self.folders_lock().insert(canonical.to_path_buf());
    }

    /// The granted folder that holds `path` (or is `path`), by the spelling of `path` alone: the
    /// file system is not touched. The innermost one if there are several.
    pub fn folder_root_of(&self, path: &Path) -> Option<PathBuf> {
        if !has_no_dot_components(path) {
            return None;
        }
        self.folders_lock()
            .iter()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.as_os_str().len())
            .cloned()
    }

    /// True if `path` is itself a granted folder.
    pub fn is_folder_root(&self, path: &Path) -> bool {
        self.folders_lock().contains(path)
    }

    /// True if the path was granted exactly, or lies below a granted folder.
    pub fn is_permitted(&self, path: &Path) -> bool {
        self.is_granted(path) || self.folder_root_of(path).is_some()
    }

    /// A granted folder (or a folder below one) for listing and for creating things in it. The
    /// path must be spelled canonically: a link in the way is refused.
    pub fn check_folder(&self, path: &Path) -> PlatformResult<PathBuf> {
        if self.folder_root_of(path).is_none() {
            return Err(PlatformError::not_allowed());
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => {
                if canonical.is_dir() {
                    Ok(canonical)
                } else {
                    Err(PlatformError::io("This item is not a folder."))
                }
            }
            Ok(_) => Err(changed_since_granted()),
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }

    /// An existing file or folder that a file operation may change: granted exactly or below a
    /// granted folder, spelled canonically and not a link (an operation never acts through one).
    pub fn check_item(&self, path: &Path) -> PlatformResult<PathBuf> {
        if !self.is_permitted(path) {
            return Err(PlatformError::not_allowed());
        }
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(PlatformError::new(
                    ErrorCode::NotAllowed,
                    "A link cannot be changed from here.",
                ));
            }
            Ok(_) => {}
            Err(error) => return Err(PlatformError::from_read(&error)),
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            Ok(_) => Err(changed_since_granted()),
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }

    /// A rename or move: every grant at or below `from` follows to `to`.
    pub fn moved(&self, from: &Path, to: &Path) {
        let remap = |set: &mut HashSet<PathBuf>| {
            let moved: Vec<PathBuf> = set
                .iter()
                .filter(|granted| granted.starts_with(from))
                .cloned()
                .collect();
            for old in moved {
                set.remove(&old);
                if let Ok(rest) = old.strip_prefix(from) {
                    set.insert(to.join(rest));
                }
            }
        };
        remap(&mut self.lock());
        remap(&mut self.folders_lock());
        remap(
            &mut self
                .read_only
                .lock()
                .unwrap_or_else(PoisonError::into_inner),
        );
    }

    /// Takes back the grants at or below `path` (the item was moved to the Trash).
    pub fn forget(&self, path: &Path) {
        self.lock().retain(|granted| !granted.starts_with(path));
        self.folders_lock()
            .retain(|granted| !granted.starts_with(path));
        self.read_only
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|granted| !granted.starts_with(path));
    }

    fn folders_lock(&self) -> std::sync::MutexGuard<'_, HashSet<PathBuf>> {
        self.folders.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<PathBuf>> {
        self.allowed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn a_granted_file_can_be_checked_by_the_path_that_grant_returned() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        let grants = PathGrants::default();

        let canonical = grants.grant(&path).expect("grants");

        assert_eq!(grants.check(&canonical), Ok(canonical.clone()));
    }

    #[test]
    fn a_path_that_was_never_granted_is_refused() {
        let dir = TempDir::new();
        let granted = dir.write("granted.md", b"x");
        let other = dir.write("other.md", b"y");
        let grants = PathGrants::default();
        grants.grant(&granted).expect("grants");

        assert_eq!(grants.check(&other), Err(NOT_CHOSEN.to_string()));
        assert_eq!(
            grants.check(Path::new("/etc/hosts")),
            Err(NOT_CHOSEN.to_string())
        );
    }

    #[test]
    fn nothing_is_allowed_before_something_is_granted() {
        assert_eq!(
            PathGrants::default().check(Path::new("/etc/passwd")),
            Err(NOT_CHOSEN.to_string())
        );
    }

    #[test]
    fn a_refused_path_gives_the_same_answer_whether_or_not_it_exists() {
        let grants = PathGrants::default();

        let existing = grants.check(Path::new("/etc/hosts"));
        let missing = grants.check(Path::new("/definitely/not/here.md"));

        assert_eq!(existing, missing);
    }

    #[test]
    fn another_spelling_of_a_granted_path_is_refused() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        let grants = PathGrants::default();
        let canonical = grants.grant(&path).expect("grants");

        // The same file reached through "..": not what was granted.
        let detour = canonical
            .parent()
            .expect("parent")
            .join("..")
            .join(
                canonical
                    .parent()
                    .expect("parent")
                    .file_name()
                    .expect("name"),
            )
            .join("a.md");

        assert_eq!(grants.check(&detour), Err(NOT_CHOSEN.to_string()));
    }

    #[test]
    fn granting_follows_links_so_only_the_real_file_is_listed() {
        let dir = TempDir::new();
        let real = dir.write("real.md", b"x");
        let link = dir.path().join("link.md");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        let grants = PathGrants::default();

        let canonical = grants.grant(&link).expect("grants");

        assert_eq!(canonical, std::fs::canonicalize(&real).expect("canonical"));
        assert_eq!(grants.check(&link), Err(NOT_CHOSEN.to_string()));
        assert!(grants.check(&canonical).is_ok());
    }

    #[test]
    fn a_granted_file_that_becomes_a_link_elsewhere_is_refused() {
        let dir = TempDir::new();
        let path = dir.write("doc.md", b"mine");
        let secret = dir.write("secret.md", b"not mine");
        let grants = PathGrants::default();
        let canonical = grants.grant(&path).expect("grants");

        // The file is swapped for a link to another file after it was chosen.
        std::fs::remove_file(&canonical).expect("remove");
        std::os::unix::fs::symlink(&secret, &canonical).expect("symlink");

        let error = grants.check(&canonical).expect_err("refused");
        assert!(error.contains("changed"), "{error}");
    }

    #[test]
    fn a_granted_file_that_was_deleted_reports_not_found() {
        let dir = TempDir::new();
        let path = dir.write("doc.md", b"x");
        let grants = PathGrants::default();
        let canonical = grants.grant(&path).expect("grants");

        std::fs::remove_file(&canonical).expect("remove");

        assert_eq!(grants.check(&canonical), Err("File not found.".to_string()));
    }

    #[test]
    fn folders_and_missing_paths_cannot_be_granted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();

        assert_eq!(
            grants.grant(dir.path()),
            Err("The chosen item is not a file.".to_string())
        );
        assert_eq!(
            grants.grant(&dir.path().join("missing.md")),
            Err("File not found.".to_string())
        );
        assert_eq!(grants.check(dir.path()), Err(NOT_CHOSEN.to_string()));
    }

    // ---- Phase 1: save dialog, linked documents and the platform error type ----------------

    #[test]
    fn a_new_file_can_be_granted_when_its_folder_exists() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        let wanted = dir.path().join("new.md");

        let granted = grants.grant_new(&wanted).expect("grants");

        assert_eq!(granted, wanted);
        assert!(grants.is_granted(&granted));
        assert!(!wanted.exists(), "granting creates nothing");
    }

    #[test]
    fn a_new_file_in_a_folder_reached_through_a_link_is_granted_by_its_canonical_path() {
        let dir = TempDir::new();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).expect("mkdir");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        let grants = PathGrants::default();

        let granted = grants.grant_new(&link.join("new.md")).expect("grants");

        assert_eq!(
            granted,
            std::fs::canonicalize(&real)
                .expect("canonical")
                .join("new.md")
        );
        assert!(
            !grants.is_granted(&link.join("new.md")),
            "only the canonical spelling"
        );
    }

    #[test]
    fn a_new_file_in_a_missing_folder_cannot_be_granted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();

        let error = grants
            .grant_new(&dir.path().join("nope").join("new.md"))
            .expect_err("refused");

        assert_eq!(error.code, ErrorCode::NotFound);
    }

    #[test]
    fn granting_a_new_path_that_is_an_existing_file_works_and_a_folder_is_refused() {
        let dir = TempDir::new();
        let existing = dir.write("there.md", b"x");
        let grants = PathGrants::default();

        assert_eq!(grants.grant_new(&existing).expect("grants"), existing);
        assert!(grants.grant_new(dir.path()).is_err());
    }

    #[test]
    fn check_document_follows_the_same_rules_as_check_with_platform_errors() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        let other = dir.write("b.md", b"y");
        let grants = PathGrants::default();
        let canonical = grants.grant(&path).expect("grants");

        assert_eq!(grants.check_document(&canonical), Ok(canonical.clone()));
        assert_eq!(
            grants.check_document(&other).expect_err("refused").code,
            ErrorCode::NotAllowed
        );
        std::fs::remove_file(&canonical).expect("remove");
        assert_eq!(
            grants.check_document(&canonical).expect_err("gone").code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn check_document_refuses_a_granted_file_that_became_a_link_elsewhere() {
        let dir = TempDir::new();
        let path = dir.write("doc.md", b"mine");
        let secret = dir.write("secret.md", b"not mine");
        let grants = PathGrants::default();
        let canonical = grants.grant(&path).expect("grants");
        std::fs::remove_file(&canonical).expect("remove");
        std::os::unix::fs::symlink(&secret, &canonical).expect("symlink");

        let error = grants.check_document(&canonical).expect_err("refused");

        assert_eq!(error.code, ErrorCode::NotAllowed);
    }

    #[test]
    fn check_for_save_accepts_a_granted_new_file_and_an_existing_one() {
        let dir = TempDir::new();
        let existing = dir.write("a.md", b"x");
        let grants = PathGrants::default();
        let existing = grants.grant(&existing).expect("grants");
        let new = grants
            .grant_new(&dir.path().join("new.md"))
            .expect("grants");

        assert_eq!(grants.check_for_save(&existing), Ok(existing.clone()));
        assert_eq!(grants.check_for_save(&new), Ok(new.clone()));
    }

    #[test]
    fn check_for_save_refuses_a_path_that_was_never_granted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        let wanted = dir.path().join("new.md");

        assert_eq!(
            grants.check_for_save(&wanted).expect_err("refused").code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            grants
                .check_for_save(Path::new("/etc/hosts"))
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn check_for_save_refuses_a_new_file_whose_name_became_a_link() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        let target = dir.write("elsewhere.md", b"precious");
        let new = grants
            .grant_new(&dir.path().join("new.md"))
            .expect("grants");
        // Between the dialog and the save, the name was taken by a link to another file.
        std::os::unix::fs::symlink(&target, &new).expect("symlink");

        let error = grants.check_for_save(&new).expect_err("refused");

        assert_eq!(error.code, ErrorCode::NotAllowed);
    }

    #[test]
    fn a_resolved_link_target_can_be_granted() {
        let dir = TempDir::new();
        let target = dir.write("linked.md", b"x");
        let canonical = std::fs::canonicalize(&target).expect("canonical");
        let grants = PathGrants::default();

        assert!(!grants.is_granted(&canonical));
        grants.grant_resolved(&canonical);

        assert!(grants.is_granted(&canonical));
        assert!(grants.check_document(&canonical).is_ok());
    }

    #[test]
    fn grants_can_be_added_from_several_threads() {
        let dir = TempDir::new();
        let grants = std::sync::Arc::new(PathGrants::default());
        let paths: Vec<PathBuf> = (0..8)
            .map(|i| dir.write(&format!("{i}.md"), b"x"))
            .collect();

        std::thread::scope(|scope| {
            for path in &paths {
                let grants = grants.clone();
                scope.spawn(move || grants.grant(path).expect("grants"));
            }
        });

        for path in &paths {
            let canonical = std::fs::canonicalize(path).expect("canonical");
            assert!(grants.check(&canonical).is_ok());
        }
    }

    #[test]
    fn a_read_only_grant_starts_linked_reads_and_nothing_else() {
        let dir = TempDir::new();
        let path = std::fs::canonicalize(dir.write("inc.md", b"x")).expect("canonical");
        let grants = PathGrants::default();

        assert!(grants.check_readable(&path).is_err());
        grants.grant_read_only(&path);

        assert_eq!(grants.check_readable(&path), Ok(path.clone()));
        assert!(grants.check_document(&path).is_err());
        assert!(grants.check_for_save(&path).is_err());
        assert!(!grants.is_granted(&path));
    }
}
