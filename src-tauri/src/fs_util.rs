//! Small file system helpers shared by the document code and the JSON stores.

use std::fs::{File, Metadata};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// What a file looked like when it was read or written: modification time and size. A file
/// that differs from its stamp was changed by someone else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    pub modified_ms: u64,
    pub size: u64,
}

impl FileStamp {
    pub fn of(metadata: &Metadata) -> Self {
        FileStamp {
            modified_ms: modified_ms(metadata),
            size: metadata.len(),
        }
    }
}

/// Milliseconds since the epoch of the last modification (0 if the clock is before 1970).
pub fn modified_ms(metadata: &Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .map(system_time_ms)
        .unwrap_or_default()
}

pub fn system_time_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Milliseconds since the epoch, now.
pub fn now_ms() -> u64 {
    system_time_ms(SystemTime::now())
}

#[cfg(unix)]
fn access(path: &Path, mode: libc::c_int) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    match CString::new(path.as_os_str().as_bytes()) {
        // SAFETY: `c_path` is a valid NUL-terminated string that outlives the call.
        Ok(c_path) => unsafe { libc::access(c_path.as_ptr(), mode) == 0 },
        Err(_) => false,
    }
}

/// True if the current user may write to `path` (mode bits, ACLs, read-only volumes and the
/// locked flag are all taken into account by the system).
#[cfg(unix)]
pub fn is_writable(path: &Path) -> bool {
    access(path, libc::W_OK)
}

/// True if a safe save can replace the file at `path`: the file itself can be written (so a
/// read-only file is not silently replaced) and its folder can take a temporary file.
#[cfg(unix)]
pub fn can_replace(path: &Path) -> bool {
    let Some(folder) = path.parent() else {
        return false;
    };
    is_writable(path) && access(folder, libc::W_OK | libc::X_OK)
}

/// True if a new file can be created in the folder of `path`.
#[cfg(unix)]
pub fn can_create_in_folder_of(path: &Path) -> bool {
    path.parent()
        .is_some_and(|folder| access(folder, libc::W_OK | libc::X_OK))
}

/// Windows has no `access`: a file is writable when it exists and has no read-only attribute (a
/// folder's read-only attribute means nothing to Windows, so a folder only has to exist). ACLs
/// that forbid writing show up as an error when the save is made.
#[cfg(windows)]
pub fn is_writable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.is_dir() || !meta.permissions().readonly())
}

#[cfg(windows)]
pub fn can_replace(path: &Path) -> bool {
    path.parent().is_some_and(Path::is_dir) && is_writable(path)
}

#[cfg(windows)]
pub fn can_create_in_folder_of(path: &Path) -> bool {
    path.parent().is_some_and(Path::is_dir)
}

/// A path as the page sees it. On Windows the separators become `/` and the `\\?\` prefix that
/// `canonicalize` adds is dropped (`C:/Users/me/a.md`, `//server/share/a.md`), so the page can
/// keep treating `/` as the only separator; Windows accepts that form back everywhere. On macOS
/// it is the path unchanged.
pub fn path_text(path: &Path) -> String {
    #[cfg(windows)]
    let text = dunce::simplified(path).to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let text = path.to_string_lossy().into_owned();
    text
}

/// `std::fs::canonicalize`, without the `\\?\` prefix on Windows (when the path can be written
/// without it), so canonical paths compare equal to the ones dialogs and the page hand over.
pub fn canonicalize(path: impl AsRef<Path>) -> io::Result<PathBuf> {
    dunce::canonicalize(path)
}

/// Flushes a file to disk. Volumes that cannot flush (some network shares answer "not
/// supported") are not an error: the data was written, it just cannot be forced to the platter.
pub fn fsync_file(file: &File) -> io::Result<()> {
    match file.sync_all() {
        Ok(()) => Ok(()),
        Err(error) if is_flush_unsupported(&error) => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn is_flush_unsupported(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code)
            if code == libc::ENOTSUP
                || code == libc::ENOTTY
                || code == libc::EINVAL
                || code == libc::ENOSYS
    )
}

/// ERROR_INVALID_FUNCTION, ERROR_NOT_SUPPORTED, ERROR_INVALID_PARAMETER.
#[cfg(windows)]
fn is_flush_unsupported(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(1 | 50 | 87))
}

/// Flushes the folder entry after a rename. Best effort: the rename already happened.
pub fn fsync_folder(folder: &Path) {
    if let Ok(handle) = File::open(folder) {
        let _ = handle.sync_all();
    }
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A hidden temporary name next to `target`, unique within this process.
pub fn temp_sibling(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_owned());
    let unique = format!(
        ".{name}.{}-{}.backtickle-tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    target.with_file_name(unique)
}

/// Removes a temporary file an operation left behind (nothing happens if there is none).
pub fn discard_temp(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Removes an empty temporary folder an operation created (nothing happens if it is gone or not empty).
pub fn discard_temp_dir(path: &Path) {
    let _ = std::fs::remove_dir(path);
}

/// Writes a small file atomically: a temporary file in the same folder, then a rename over the
/// target. Used for the settings and the other JSON stores. It does not flush to disk (a power
/// cut loses at most the last change), which keeps frequent writes cheap.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(folder) = target.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let temp = temp_sibling(target);
    let result = std::fs::write(&temp, bytes).and_then(|()| std::fs::rename(&temp, target));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn a_fresh_file_is_writable_and_replaceable() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");

        assert!(is_writable(&path));
        assert!(can_replace(&path));
        assert!(can_create_in_folder_of(&path));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_without_write_permission_is_not_writable_or_replaceable() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).expect("chmod");

        assert!(!is_writable(&path));
        assert!(!can_replace(&path), "a read-only file must not be replaced");
        assert!(
            can_create_in_folder_of(&path),
            "its folder is still writable"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_in_a_read_only_folder_cannot_be_replaced() {
        let dir = TempDir::new();
        let folder = dir.path().join("locked");
        std::fs::create_dir(&folder).expect("mkdir");
        let path = folder.join("a.md");
        std::fs::write(&path, b"x").expect("write");
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o555)).expect("chmod");

        let writable = is_writable(&path);
        let replaceable = can_replace(&path);
        let creatable = can_create_in_folder_of(&path);
        // Let the temp folder be removed again.
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).expect("chmod");

        assert!(writable, "the file itself is writable");
        assert!(!replaceable);
        assert!(!creatable);
    }

    #[test]
    fn a_missing_path_is_not_writable_and_a_path_with_a_nul_is_refused() {
        let dir = TempDir::new();

        assert!(!is_writable(&dir.path().join("missing.md")));
        assert!(!is_writable(Path::new("bad\0path")));
        assert!(!can_replace(Path::new("/")));
    }

    #[test]
    fn the_modification_time_is_in_milliseconds_and_the_stamp_has_the_size() {
        let dir = TempDir::new();
        let before = now_ms();
        let path = dir.write("a.md", b"hello");
        let after = now_ms();

        let stamp = FileStamp::of(&std::fs::metadata(&path).expect("metadata"));

        assert_eq!(stamp.size, 5);
        assert!(stamp.modified_ms + 2000 >= before && stamp.modified_ms <= after + 2000);
    }

    #[test]
    fn temp_siblings_are_hidden_unique_and_next_to_the_target() {
        let target = Path::new("/some/folder/note.md");

        let first = temp_sibling(target);
        let second = temp_sibling(target);

        assert_ne!(first, second);
        assert_eq!(first.parent(), target.parent());
        let name = first
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        assert!(name.starts_with(".note.md."), "{name}");
        assert!(name.ends_with(".backtickle-tmp"), "{name}");
    }

    #[test]
    fn write_atomic_creates_the_folder_and_replaces_the_file_without_leftovers() {
        let dir = TempDir::new();
        let target = dir.path().join("deep").join("store.json");

        write_atomic(&target, b"first").expect("writes");
        write_atomic(&target, b"second").expect("replaces");

        assert_eq!(std::fs::read(&target).expect("read"), b"second");
        let names: Vec<_> = std::fs::read_dir(target.parent().expect("parent"))
            .expect("list")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
    }

    #[test]
    fn write_atomic_leaves_nothing_behind_when_it_fails() {
        let dir = TempDir::new();
        // The target is a folder, so the final rename fails.
        let target = dir.path().join("folder");
        std::fs::create_dir(&target).expect("mkdir");

        assert!(write_atomic(&target, b"data").is_err());

        let names: Vec<_> = std::fs::read_dir(dir.path())
            .expect("list")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(names.len(), 1, "only the folder remains: {names:?}");
    }

    #[test]
    fn fsync_works_on_files_and_folders_here() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        // Windows flushes only a handle opened for writing; every caller writes first.
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open");

        assert!(fsync_file(&file).is_ok());
        fsync_folder(dir.path());
        fsync_folder(&dir.path().join("missing"));
    }
}
