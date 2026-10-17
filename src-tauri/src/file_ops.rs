//! File operations of the Files sidebar and the document title menu:
//! create a file or folder, rename, move, duplicate, move to the Trash.
//!
//! Rules every operation follows:
//! - the paths are checked against the grants (`grants.rs`): an item must be granted exactly or
//!   lie below a granted folder, spelled canonically, and not be a link; a refused path reveals
//!   nothing about whether it exists;
//! - names are checked before anything is touched (`clean_name`);
//! - nothing is ever overwritten: a name that exists is refused, and the file system itself
//!   refuses a race (`create_new`, `RENAME_EXCL`);
//! - nothing is ever deleted: the only way an item disappears is the macOS Trash (`Trasher`).
//!   No function that deletes files appears in this module (a source scan in
//!   `tests/config.rs` checks that).
//!
//! Every function returns the canonical path of the result. Keeping recents, document state and
//! the grants pointing at the new path of a rename or a move is done by the caller (`bridge.rs`
//! and `grants.rs`).

use crate::error::{ErrorCode, PlatformError, PlatformResult, os_code};
use crate::grants::PathGrants;
use crate::watcher::OwnWrites;
use std::io;
use std::path::{Path, PathBuf};

/// The longest name macOS allows for one path component, in bytes.
const MAX_NAME_BYTES: usize = 255;
/// How many "copy N" names `duplicate` tries before it gives up.
const MAX_COPY_NUMBER: u32 = 1000;

/// Moves an item to the Trash. A seam: the real one is the system Trash, the tests use a folder.
pub trait Trasher: Send + Sync {
    fn trash(&self, path: &Path) -> io::Result<()>;
}

/// The macOS Trash through `NSFileManager` (no helper process, no Apple Events permission).
pub struct SystemTrash;

impl Trasher for SystemTrash {
    fn trash(&self, path: &Path) -> io::Result<()> {
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            let mut context = trash::TrashContext::default();
            context.set_delete_method(DeleteMethod::NsFileManager);
            context.delete(path).map_err(io::Error::other)
        }
        #[cfg(not(target_os = "macos"))]
        {
            trash::delete(path).map_err(io::Error::other)
        }
    }
}

/// The name as it will be used, or an `invalid-name` error: not empty, no `/` or `:` (macOS
/// shows a slash as a colon), no control characters, no leading dot (which also rules out `.`
/// and `..`), at most 255 bytes. White space around the name is dropped. On Windows the
/// characters `\ * ? " < > |`, a trailing dot and the device names (`CON`, `NUL`, `COM1`, ...)
/// are refused as well, as File Explorer refuses them.
pub fn clean_name(name: &str) -> PlatformResult<String> {
    let trimmed = name.trim();
    let bad = trimmed.is_empty()
        || trimmed.starts_with('.')
        || trimmed.len() > MAX_NAME_BYTES
        || trimmed
            .chars()
            .any(|c| c == '/' || c == ':' || c.is_control())
        || (cfg!(windows) && !windows_name_ok(trimmed));
    if bad {
        Err(PlatformError::invalid_name())
    } else {
        Ok(trimmed.to_owned())
    }
}

/// The extra rules of Windows names (see `clean_name`). Plain string checks, so they are tested
/// on every system.
pub fn windows_name_ok(name: &str) -> bool {
    const DEVICES: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    !name.ends_with('.')
        && !name
            .chars()
            .any(|c| matches!(c, '\\' | '*' | '?' | '"' | '<' | '>' | '|'))
        && !DEVICES
            .iter()
            .any(|device| stem.eq_ignore_ascii_case(device))
}

fn cannot_change() -> PlatformError {
    PlatformError::new(
        ErrorCode::ReadOnly,
        format!(
            "Writedown cannot change this location. Check its permissions in {}.",
            crate::os_text::FILE_MANAGER
        ),
    )
}

/// An I/O error of an operation as a platform error.
fn failed(error: &io::Error) -> PlatformError {
    match error.kind() {
        io::ErrorKind::AlreadyExists => PlatformError::exists(),
        io::ErrorKind::NotFound => PlatformError::not_found(),
        io::ErrorKind::PermissionDenied => cannot_change(),
        _ => match error.raw_os_error() {
            Some(code) if os_code::NAME_TOO_LONG.contains(&code) => PlatformError::invalid_name(),
            Some(code) if os_code::READ_ONLY.contains(&code) => cannot_change(),
            Some(code) if os_code::OTHER_VOLUME.contains(&code) => PlatformError::io(
                "This folder is on another disk. Writedown moves items within one disk only.",
            ),
            Some(code) if os_code::DISK_FULL.contains(&code) => {
                PlatformError::io("The disk is full.")
            }
            _ => PlatformError::io("The operation could not be completed."),
        },
    }
}

fn canonical(path: &Path) -> PlatformResult<PathBuf> {
    crate::fs_util::canonicalize(path).map_err(|e| PlatformError::from_read(&e))
}

/// Renames without replacing an existing item, atomically: the kernel refuses if `to` exists.
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let from = CString::new(from.as_os_str().as_bytes())
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        let to = CString::new(to.as_os_str().as_bytes())
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
        // SAFETY: both pointers are valid NUL-terminated strings that live through the call;
        // `renamex_np` only reads them.
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    // Without MOVEFILE_REPLACE_EXISTING, Windows refuses when `to` exists (ERROR_ALREADY_EXISTS
    // or ERROR_FILE_EXISTS, which std reads as `AlreadyExists`).
    #[cfg(windows)]
    {
        use ::windows::Win32::Storage::FileSystem::{MOVE_FILE_FLAGS, MoveFileExW};
        use ::windows::core::HSTRING;
        // SAFETY: both arguments are NUL-terminated wide strings that live through the call.
        unsafe { MoveFileExW(&HSTRING::from(from), &HSTRING::from(to), MOVE_FILE_FLAGS(0)) }
            .map_err(|error| io::Error::from_raw_os_error(error.code().0 & 0xFFFF))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        if to.symlink_metadata().is_ok() {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        std::fs::rename(from, to)
    }
}

/// True if both paths are the same file or folder (same device and inode).
#[cfg(unix)]
fn same_item(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
        (Ok(left), Ok(right)) => left.dev() == right.dev() && left.ino() == right.ino(),
        _ => false,
    }
}

/// True if both paths are the same file or folder. Windows names ignore letter case, and the
/// canonical path is spelled as the item is on disk, so two spellings of one item compare equal.
#[cfg(windows)]
fn same_item(a: &Path, b: &Path) -> bool {
    match (
        crate::fs_util::canonicalize(a),
        crate::fs_util::canonicalize(b),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn file_name_of(path: &Path) -> PlatformResult<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(PlatformError::invalid_name)
}

/// Creates an empty file named `name` in a granted folder. An existing name is refused.
pub fn create_file(grants: &PathGrants, folder: &Path, name: &str) -> PlatformResult<PathBuf> {
    let folder = grants.check_folder(folder)?;
    let name = clean_name(name)?;
    let target = folder.join(&name);
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| failed(&e))?;
    let created = canonical(&target)?;
    OwnWrites::global().wrote(&created);
    Ok(created)
}

/// Creates a folder named `name` in a granted folder. An existing name is refused.
pub fn create_folder(grants: &PathGrants, folder: &Path, name: &str) -> PlatformResult<PathBuf> {
    let folder = grants.check_folder(folder)?;
    let name = clean_name(name)?;
    let target = folder.join(&name);
    std::fs::create_dir(&target).map_err(|e| failed(&e))?;
    let created = canonical(&target)?;
    OwnWrites::global().wrote(&created);
    Ok(created)
}

/// Renames an item within its folder. The same name is no change; a name that exists is refused,
/// except when it differs only in letter case and is the same item (macOS file systems ignore
/// case, so `a.md` to `A.md` must work).
pub fn rename_path(grants: &PathGrants, path: &Path, new_name: &str) -> PlatformResult<PathBuf> {
    let source = grants.check_item(path)?;
    let name = clean_name(new_name)?;
    let Some(parent) = source.parent() else {
        return Err(PlatformError::invalid_name());
    };
    let target = parent.join(&name);
    if target == source {
        return Ok(source);
    }
    let result = if same_item(&source, &target) {
        std::fs::rename(&source, &target)
    } else {
        rename_no_replace(&source, &target)
    };
    result.map_err(|e| failed(&e))?;
    grants.moved(&source, &target);
    OwnWrites::global().moved(&source, &target);
    canonical(&target)
}

/// Moves an item into another granted folder. An existing name in the target is refused, and a
/// folder cannot be moved into itself.
pub fn move_path(grants: &PathGrants, path: &Path, to_folder: &Path) -> PlatformResult<PathBuf> {
    let source = grants.check_item(path)?;
    let folder = grants.check_folder(to_folder)?;
    if folder.starts_with(&source) {
        return Err(PlatformError::io("A folder cannot be moved into itself."));
    }
    let target = folder.join(file_name_of(&source)?);
    if target == source {
        return Err(PlatformError::exists());
    }
    rename_no_replace(&source, &target).map_err(|e| failed(&e))?;
    grants.moved(&source, &target);
    OwnWrites::global().moved(&source, &target);
    canonical(&target)
}

/// The stem and extension of a file name; the extension includes the dot. A leading dot is part
/// of the stem.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 && dot + 1 < name.len() => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    }
}

/// `"a copy"` and `"a copy 3"` give `"a"`: duplicating a copy starts again from the original.
fn strip_copy_suffix(stem: &str) -> &str {
    if let Some(base) = stem.strip_suffix(" copy") {
        return base;
    }
    if let Some((base, number)) = stem.rsplit_once(" copy ")
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
    {
        return base;
    }
    stem
}

/// The name of the `number`th copy: `a copy.md`, `a copy 2.md`, ...
pub fn copy_name(name: &str, number: u32) -> String {
    let (stem, extension) = split_name(name);
    let base = strip_copy_suffix(stem);
    if number <= 1 {
        format!("{base} copy{extension}")
    } else {
        format!("{base} copy {number}{extension}")
    }
}

/// Copies a file next to itself under the first free "copy" name. Folders are not duplicated.
pub fn duplicate_path(grants: &PathGrants, path: &Path) -> PlatformResult<PathBuf> {
    let source = grants.check_item(path)?;
    let metadata = std::fs::metadata(&source).map_err(|e| PlatformError::from_read(&e))?;
    if !metadata.is_file() {
        return Err(PlatformError::io("Only files can be duplicated."));
    }
    let Some(parent) = source.parent() else {
        return Err(PlatformError::invalid_name());
    };
    let name = file_name_of(&source)?;
    for number in 1..=MAX_COPY_NUMBER {
        let target = parent.join(copy_name(&name, number));
        let created = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target);
        let mut copy = match created {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(failed(&error)),
        };
        let copied = std::fs::File::open(&source).and_then(|mut original| {
            io::copy(&mut original, &mut copy)?;
            // The copy keeps the permissions of the original.
            copy.set_permissions(metadata.permissions())
        });
        if let Err(error) = copied {
            // The incomplete copy stays: nothing here deletes. It is reported as an error.
            drop(copy);
            return Err(failed(&error));
        }
        let copy = canonical(&target)?;
        OwnWrites::global().wrote(&copy);
        return Ok(copy);
    }
    Err(PlatformError::io("Too many copies of this file exist."))
}

/// Moves a file or folder to the Trash. The open folder itself is refused. The grants at or
/// below the path are taken back.
pub fn trash_path(grants: &PathGrants, path: &Path, trasher: &dyn Trasher) -> PlatformResult<()> {
    let source = grants.check_item(path)?;
    if grants.is_folder_root(&source) {
        return Err(PlatformError::io(format!(
            "The open folder cannot be moved to the {} from here. Close it first or use {}.",
            crate::os_text::TRASH,
            crate::os_text::FILE_MANAGER
        )));
    }
    trasher.trash(&source).map_err(|_| {
        PlatformError::io(format!(
            "The item could not be moved to the {}. It is still where it was.",
            crate::os_text::TRASH
        ))
    })?;
    grants.forget(&source);
    OwnWrites::global().removed(&source);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::sync::Mutex;

    /// A Trash that is a folder in the temporary directory, so no test touches the real one.
    struct FolderTrash {
        folder: PathBuf,
        trashed: Mutex<Vec<PathBuf>>,
    }

    impl FolderTrash {
        fn new(dir: &TempDir) -> Self {
            let folder = dir.path().join("fake-trash");
            std::fs::create_dir_all(&folder).expect("trash folder");
            FolderTrash {
                folder,
                trashed: Mutex::new(Vec::new()),
            }
        }
    }

    impl Trasher for FolderTrash {
        fn trash(&self, path: &Path) -> io::Result<()> {
            let name = path.file_name().expect("name");
            std::fs::rename(path, self.folder.join(name))?;
            self.trashed.lock().expect("lock").push(path.to_path_buf());
            Ok(())
        }
    }

    #[cfg_attr(not(unix), allow(dead_code))]
    struct FailingTrash;

    impl Trasher for FailingTrash {
        fn trash(&self, _path: &Path) -> io::Result<()> {
            Err(io::Error::other("no"))
        }
    }

    /// A temporary folder with a granted `root` folder inside it. The outer folder also holds
    /// things outside the grant.
    struct Setup {
        outer: TempDir,
        root: PathBuf,
        grants: PathGrants,
    }

    fn setup() -> Setup {
        let outer = TempDir::new();
        let root = outer.path().join("root");
        std::fs::create_dir(&root).expect("root");
        let grants = PathGrants::default();
        let root = grants.grant_folder(&root).expect("grant");
        Setup {
            outer,
            root,
            grants,
        }
    }

    fn code<T: std::fmt::Debug>(result: PlatformResult<T>) -> ErrorCode {
        result.expect_err("refused").code
    }

    // ---- names -----------------------------------------------------------------------------

    #[test]
    fn a_name_is_trimmed_and_checked() {
        assert_eq!(clean_name("  Notes.md "), Ok("Notes.md".to_owned()));
        for bad in [
            "",
            "   ",
            ".",
            "..",
            ".hidden",
            "a/b",
            "a:b",
            "tab\there",
            "nul\0",
            "\n",
        ] {
            assert_eq!(code(clean_name(bad)), ErrorCode::InvalidName, "{bad:?}");
        }
        assert!(clean_name(&"a".repeat(255)).is_ok());
        assert_eq!(code(clean_name(&"a".repeat(256))), ErrorCode::InvalidName);
    }

    #[test]
    fn copy_names_follow_finder() {
        assert_eq!(copy_name("a.md", 1), "a copy.md");
        assert_eq!(copy_name("a.md", 2), "a copy 2.md");
        assert_eq!(copy_name("a.md", 10), "a copy 10.md");
        assert_eq!(copy_name("a", 1), "a copy");
        assert_eq!(copy_name("a.b.md", 2), "a.b copy 2.md");
        assert_eq!(copy_name("a copy.md", 1), "a copy.md");
        assert_eq!(copy_name("a copy.md", 2), "a copy 2.md");
        assert_eq!(copy_name("a copy 3.md", 1), "a copy.md");
        assert_eq!(copy_name("Rmd copy.Rmd", 2), "Rmd copy 2.Rmd");
        assert_eq!(copy_name("trailing.", 1), "trailing. copy");
    }

    // ---- create ----------------------------------------------------------------------------

    #[test]
    fn create_file_makes_an_empty_file_and_refuses_an_existing_name() {
        let s = setup();

        let path = create_file(&s.grants, &s.root, "Untitled.md").expect("created");

        assert_eq!(path, s.root.join("Untitled.md"));
        assert_eq!(std::fs::read(&path).expect("read"), b"");
        assert_eq!(
            code(create_file(&s.grants, &s.root, "Untitled.md")),
            ErrorCode::Exists
        );
        // The existing file is untouched.
        std::fs::write(&path, b"mine").expect("write");
        assert!(create_file(&s.grants, &s.root, "Untitled.md").is_err());
        assert_eq!(std::fs::read(&path).expect("read"), b"mine");
    }

    #[test]
    fn create_refuses_bad_names_and_folders_outside_the_grant() {
        let s = setup();
        let elsewhere = s.outer.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("mkdir");

        for bad in ["", "a/b.md", "a:b.md", ".hidden.md"] {
            assert_eq!(
                code(create_file(&s.grants, &s.root, bad)),
                ErrorCode::InvalidName,
                "{bad:?}"
            );
            assert_eq!(
                code(create_folder(&s.grants, &s.root, bad)),
                ErrorCode::InvalidName,
                "{bad:?}"
            );
        }
        assert_eq!(
            code(create_file(&s.grants, &elsewhere, "a.md")),
            ErrorCode::NotAllowed
        );
        assert!(!elsewhere.join("a.md").exists());
        // A path that walks out of the folder is not below it.
        let sneaky = s.root.join("..").join("elsewhere");
        assert_eq!(
            code(create_file(&s.grants, &sneaky, "a.md")),
            ErrorCode::NotAllowed
        );
        assert!(!elsewhere.join("a.md").exists());
    }

    #[test]
    fn create_folder_makes_a_folder_and_works_below_the_root() {
        let s = setup();

        let made = create_folder(&s.grants, &s.root, "Chapters").expect("created");
        let nested = create_file(&s.grants, &made, "one.md").expect("nested");

        assert!(made.is_dir());
        assert_eq!(nested, made.join("one.md"));
        assert_eq!(
            code(create_folder(&s.grants, &s.root, "Chapters")),
            ErrorCode::Exists
        );
        // The file systems of macOS and Windows ignore case, so this name exists too there. Linux
        // file systems tell the two names apart.
        if cfg!(any(target_os = "macos", windows)) {
            assert_eq!(
                code(create_folder(&s.grants, &s.root, "chapters")),
                ErrorCode::Exists
            );
        }
    }

    #[test]
    fn create_refuses_a_file_in_place_of_a_folder() {
        let s = setup();
        let file = create_file(&s.grants, &s.root, "a.md").expect("created");

        assert_eq!(code(create_file(&s.grants, &file, "b.md")), ErrorCode::Io);
    }

    // ---- rename ----------------------------------------------------------------------------

    #[test]
    fn rename_changes_the_name_in_the_same_folder() {
        let s = setup();
        let old = create_file(&s.grants, &s.root, "old.md").expect("created");
        std::fs::write(&old, b"text").expect("write");

        let renamed = rename_path(&s.grants, &old, "new.md").expect("renamed");

        assert_eq!(renamed, s.root.join("new.md"));
        assert!(!old.exists());
        assert_eq!(std::fs::read(&renamed).expect("read"), b"text");
    }

    #[test]
    fn rename_refuses_existing_names_and_bad_names_and_leaves_both_files() {
        let s = setup();
        let a = create_file(&s.grants, &s.root, "a.md").expect("a");
        let b = create_file(&s.grants, &s.root, "b.md").expect("b");
        std::fs::write(&a, b"A").expect("write");
        std::fs::write(&b, b"B").expect("write");

        assert_eq!(code(rename_path(&s.grants, &a, "b.md")), ErrorCode::Exists);
        for bad in ["a/b.md", "a:b.md", ".a.md", ""] {
            assert_eq!(
                code(rename_path(&s.grants, &a, bad)),
                ErrorCode::InvalidName,
                "{bad:?}"
            );
        }

        assert_eq!(std::fs::read(&a).expect("read"), b"A");
        assert_eq!(std::fs::read(&b).expect("read"), b"B");
    }

    #[test]
    fn renaming_to_the_same_name_changes_nothing() {
        let s = setup();
        let a = create_file(&s.grants, &s.root, "a.md").expect("a");

        assert_eq!(rename_path(&s.grants, &a, "a.md"), Ok(a.clone()));
        assert!(a.exists());
    }

    #[test]
    fn a_rename_that_only_changes_the_letter_case_works() {
        let s = setup();
        let a = create_file(&s.grants, &s.root, "note.md").expect("a");

        let renamed = rename_path(&s.grants, &a, "Note.md").expect("renamed");

        assert_eq!(
            renamed.file_name().and_then(|n| n.to_str()),
            Some("Note.md")
        );
        let names: Vec<String> = std::fs::read_dir(&s.root)
            .expect("read")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["Note.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn rename_refuses_paths_outside_the_grant_and_links() {
        let s = setup();
        let outside = s.outer.path().join("outside.md");
        std::fs::write(&outside, b"x").expect("write");
        let inside = create_file(&s.grants, &s.root, "in.md").expect("in");
        let link = s.root.join("link.md");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");

        assert_eq!(
            code(rename_path(&s.grants, &outside, "moved.md")),
            ErrorCode::NotAllowed
        );
        assert_eq!(
            code(rename_path(&s.grants, &link, "moved.md")),
            ErrorCode::NotAllowed
        );
        assert!(outside.exists() && link.exists() && inside.exists());
        // A missing file below the folder is reported as missing.
        assert_eq!(
            code(rename_path(&s.grants, &s.root.join("gone.md"), "x.md")),
            ErrorCode::NotFound
        );
    }

    #[test]
    fn a_rename_moves_the_grants_with_the_item() {
        let outer = TempDir::new();
        let grants = PathGrants::default();
        let file = grants
            .grant(&outer.write("doc.md", b"x"))
            .expect("grant file");

        let renamed = rename_path(&grants, &file, "renamed.md").expect("renamed");

        assert!(grants.is_granted(&renamed));
        assert!(!grants.is_granted(&file));
        assert!(grants.check_document(&renamed).is_ok());
    }

    #[test]
    fn renaming_a_folder_moves_the_grants_below_it() {
        let s = setup();
        let sub = create_folder(&s.grants, &s.root, "sub").expect("sub");
        let inner = create_file(&s.grants, &sub, "a.md").expect("inner");
        s.grants.grant_resolved(&inner);

        let renamed = rename_path(&s.grants, &sub, "renamed").expect("renamed");

        assert!(s.grants.is_granted(&renamed.join("a.md")));
        assert!(!s.grants.is_granted(&inner));
        assert!(renamed.join("a.md").exists());
    }

    // ---- move ------------------------------------------------------------------------------

    #[test]
    fn move_puts_the_item_in_another_granted_folder() {
        let s = setup();
        let target = create_folder(&s.grants, &s.root, "target").expect("target");
        let file = create_file(&s.grants, &s.root, "a.md").expect("a");

        let moved = move_path(&s.grants, &file, &target).expect("moved");

        assert_eq!(moved, target.join("a.md"));
        assert!(!file.exists() && moved.exists());
    }

    #[test]
    fn move_refuses_an_existing_name_a_folder_outside_the_grant_and_itself() {
        let s = setup();
        let target = create_folder(&s.grants, &s.root, "target").expect("target");
        let file = create_file(&s.grants, &s.root, "a.md").expect("a");
        let clash = create_file(&s.grants, &target, "a.md").expect("clash");
        std::fs::write(&clash, b"keep").expect("write");
        let outside = s.outer.path().join("outside");
        std::fs::create_dir(&outside).expect("mkdir");

        assert_eq!(
            code(move_path(&s.grants, &file, &target)),
            ErrorCode::Exists
        );
        assert_eq!(std::fs::read(&clash).expect("read"), b"keep");
        assert!(file.exists());
        assert_eq!(
            code(move_path(&s.grants, &file, &outside)),
            ErrorCode::NotAllowed
        );
        assert!(file.exists());
        // The same folder: the name exists (it is the file itself).
        assert_eq!(
            code(move_path(&s.grants, &file, &s.root)),
            ErrorCode::Exists
        );
        // A folder into itself or below itself.
        let below = create_folder(&s.grants, &target, "deeper").expect("deeper");
        assert!(move_path(&s.grants, &target, &target).is_err());
        assert!(move_path(&s.grants, &target, &below).is_err());
        assert!(target.exists() && below.exists());
    }

    #[test]
    fn a_folder_chosen_in_the_move_dialog_can_receive_a_granted_document() {
        let outer = TempDir::new();
        let grants = PathGrants::default();
        let doc = grants.grant(&outer.write("doc.md", b"x")).expect("grant");
        let target = outer.path().join("target");
        std::fs::create_dir(&target).expect("mkdir");
        let target = grants.grant_folder(&target).expect("grant folder");

        let moved = move_path(&grants, &doc, &target).expect("moved");

        assert_eq!(moved, target.join("doc.md"));
        assert!(grants.is_granted(&moved), "the grant followed the file");
        assert!(!grants.is_granted(&doc));
    }

    // ---- duplicate -------------------------------------------------------------------------

    #[test]
    fn duplicate_makes_the_first_free_copy_name() {
        let s = setup();
        let a = create_file(&s.grants, &s.root, "a.md").expect("a");
        std::fs::write(&a, b"content").expect("write");

        let first = duplicate_path(&s.grants, &a).expect("first");
        let second = duplicate_path(&s.grants, &a).expect("second");
        let third = duplicate_path(&s.grants, &first).expect("copy of a copy");

        assert_eq!(first, s.root.join("a copy.md"));
        assert_eq!(second, s.root.join("a copy 2.md"));
        assert_eq!(third, s.root.join("a copy 3.md"));
        for copy in [&first, &second, &third] {
            assert_eq!(std::fs::read(copy).expect("read"), b"content");
        }
    }

    #[cfg(unix)]
    #[test]
    fn duplicate_keeps_the_permissions_and_refuses_folders() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        let s = setup();
        let a = create_file(&s.grants, &s.root, "a.md").expect("a");
        std::fs::set_permissions(&a, std::fs::Permissions::from_mode(0o600)).expect("chmod");
        let folder = create_folder(&s.grants, &s.root, "dir").expect("dir");

        let copy = duplicate_path(&s.grants, &a).expect("copy");

        let mode = std::fs::metadata(&copy).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(code(duplicate_path(&s.grants, &folder)), ErrorCode::Io);
        assert_eq!(
            code(duplicate_path(&s.grants, &s.outer.path().join("x.md"))),
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn duplicate_of_a_document_granted_by_the_open_dialog_works_beside_it() {
        let outer = TempDir::new();
        let grants = PathGrants::default();
        let doc = grants.grant(&outer.write("doc.md", b"x")).expect("grant");

        let copy = duplicate_path(&grants, &doc).expect("copy");

        assert_eq!(copy, outer.path().join("doc copy.md"));
    }

    // ---- trash -----------------------------------------------------------------------------

    #[test]
    fn trash_moves_the_item_with_the_seam_and_takes_back_its_grants() {
        let s = setup();
        let trash = FolderTrash::new(&s.outer);
        let file = create_file(&s.grants, &s.root, "gone.md").expect("file");
        s.grants.grant_resolved(&file);

        trash_path(&s.grants, &file, &trash).expect("trashed");

        assert!(!file.exists());
        assert!(trash.folder.join("gone.md").exists());
        assert_eq!(*trash.trashed.lock().expect("lock"), vec![file.clone()]);
        assert!(!s.grants.is_granted(&file));
    }

    #[cfg(unix)]
    #[test]
    fn trash_refuses_outside_paths_links_the_open_folder_and_failures_keep_the_item() {
        let s = setup();
        let trash = FolderTrash::new(&s.outer);
        let outside = s.outer.path().join("outside.md");
        std::fs::write(&outside, b"x").expect("write");
        let inside = create_file(&s.grants, &s.root, "in.md").expect("in");
        let link = s.root.join("l.md");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");

        assert_eq!(
            code(trash_path(&s.grants, &outside, &trash)),
            ErrorCode::NotAllowed
        );
        assert_eq!(
            code(trash_path(&s.grants, &link, &trash)),
            ErrorCode::NotAllowed
        );
        assert_eq!(code(trash_path(&s.grants, &s.root, &trash)), ErrorCode::Io);
        assert!(trash_path(&s.grants, &inside, &FailingTrash).is_err());

        assert!(outside.exists() && link.exists() && inside.exists() && s.root.exists());
        assert!(
            trash.trashed.lock().expect("lock").is_empty(),
            "nothing was trashed"
        );
        assert!(s.grants.is_permitted(&inside), "a failure keeps the grant");
    }

    #[test]
    fn no_operation_deletes_anything() {
        // Every failing or refused operation above leaves the files; this one checks that a
        // clean run of the whole set only ever moves or adds items.
        let s = setup();
        let a = create_file(&s.grants, &s.root, "a.md").expect("a");
        std::fs::write(&a, b"keep me").expect("write");
        let copy = duplicate_path(&s.grants, &a).expect("copy");
        let renamed = rename_path(&s.grants, &copy, "b.md").expect("renamed");
        let folder = create_folder(&s.grants, &s.root, "f").expect("folder");
        let moved = move_path(&s.grants, &renamed, &folder).expect("moved");

        assert_eq!(std::fs::read(&a).expect("read"), b"keep me");
        assert_eq!(std::fs::read(&moved).expect("read"), b"keep me");
    }
}
