//! Safe save (Saving).
//!
//! A save never leaves a half-written file and never silently overwrites someone else's work:
//!
//! 1. The target is resolved. A symlink is followed: the write goes to the link's target and the
//!    link stays a link.
//! 2. Refusals, in this order: `read-only` (the file or its folder cannot be written),
//!    `modified-externally` (the file's modification time or size differs from what was read,
//!    unless the user agreed to overwrite), `lossy` (the document was read with replaced
//!    bytes, unless the user agreed).
//! 3. The text gets the chosen line ending and encoding and is written to a hidden temporary
//!    file in the same folder. Permissions, extended attributes (Finder tags included), the
//!    creation date and the hidden flag are copied from the original, then the file is flushed.
//! 4. The temporary file is renamed over the original (atomic on one volume) and the folder is
//!    flushed. If anything fails before the rename, the temporary file is removed and the
//!    original is untouched.

use crate::encoding::{self, Encoding};
use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::fs_util::{self, FileStamp};
use crate::line_endings::{self, LineEnding};
use serde::{Deserialize, Deserializer, Serialize};
#[cfg(unix)]
use std::fs::Permissions;
use std::fs::{File, Metadata, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use xattr::FileExt as _;

/// `SaveFormat` in `src/lib/platform.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFormat {
    pub encoding: Encoding,
    pub line_ending: LineEnding,
}

/// `SaveOptions` in `src/lib/platform.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    /// `null` for a new file; otherwise the modification time the document was read with.
    #[serde(default, deserialize_with = "millis_or_null")]
    pub expected_modified_ms: Option<u64>,
    /// The user agreed to overwrite a file that changed on disk.
    #[serde(default)]
    pub overwrite_external_change: bool,
    /// The user agreed to save a document that was read with replaced bytes.
    #[serde(default)]
    pub allow_lossy: bool,
}

/// A JavaScript number (it may carry a fraction) or null.
fn millis_or_null<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<u64>, D::Error> {
    Ok(Option::<f64>::deserialize(deserializer)?.map(|value| value.max(0.0).round() as u64))
}

/// `SaveResult` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    /// The canonical path that was written.
    pub path: String,
    pub bytes: u64,
    pub modified_ms: u64,
}

/// What the app remembers about a file it read or saved (see `tracked.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tracked {
    pub stamp: FileStamp,
    /// The document was read with undecodable bytes replaced.
    pub lossy: bool,
}

/// A finished save: the answer for the frontend and the stamp of the new file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub result: SaveResult,
    pub stamp: FileStamp,
}

/// Saves `text` to `path`. `tracked` is what the app knows about the file from reading it.
pub fn save(
    path: &Path,
    text: &str,
    format: SaveFormat,
    options: &SaveOptions,
    tracked: Option<Tracked>,
) -> PlatformResult<Saved> {
    let target = resolve_target(path)?;
    let existing = match std::fs::metadata(&target) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(PlatformError::from_write(&error)),
    };
    if existing
        .as_ref()
        .is_some_and(|metadata| !metadata.is_file())
    {
        return Err(PlatformError::io("This is not a file."));
    }

    // 1. Can it be written at all?
    let writable = match &existing {
        Some(_) => fs_util::can_replace(&target),
        None => fs_util::can_create_in_folder_of(&target),
    };
    if !writable {
        return Err(read_only_error());
    }
    // 2. Did someone else change it?
    if !options.overwrite_external_change {
        check_unchanged(
            existing.as_ref(),
            options.expected_modified_ms,
            tracked.map(|tracked| tracked.stamp),
        )?;
    }
    // 3. Would bytes be lost?
    if tracked.is_some_and(|tracked| tracked.lossy) && !options.allow_lossy {
        return Err(PlatformError::new(
            ErrorCode::Lossy,
            "Some characters of this file could not be read and were replaced. \
             Saving would make that permanent.",
        ));
    }

    let ending_applied = line_endings::apply(text, format.line_ending);
    let bytes = encoding::encode(&ending_applied, format.encoding);

    write_replacing(&target, &bytes, existing.as_ref())?;

    let metadata = std::fs::metadata(&target).map_err(|e| PlatformError::from_write(&e))?;
    let stamp = FileStamp::of(&metadata);
    // The watcher must not report this write as a change made by someone else.
    crate::watcher::OwnWrites::global().wrote(&target);
    Ok(Saved {
        result: SaveResult {
            path: fs_util::path_text(&target),
            bytes: metadata.len(),
            modified_ms: stamp.modified_ms,
        },
        stamp,
    })
}

fn read_only_error() -> PlatformError {
    PlatformError::new(
        ErrorCode::ReadOnly,
        "This file or its folder is read-only. Use Save As to save a copy elsewhere.",
    )
}

/// The file to write: for an existing path the canonical path (a symlink is followed), for a new
/// file the canonical folder plus the file name.
fn resolve_target(path: &Path) -> PlatformResult<PathBuf> {
    match crate::fs_util::canonicalize(path) {
        Ok(real) => return Ok(real),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(PlatformError::from_write(&error)),
    }
    // Not found: either a new file or a link that points nowhere.
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(PlatformError::new(
            ErrorCode::NotFound,
            "This link points to a file that does not exist.",
        ));
    }
    let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(PlatformError::io("This is not a file name."));
    };
    let folder = crate::fs_util::canonicalize(folder).map_err(|e| PlatformError::from_write(&e))?;
    Ok(folder.join(name))
}

/// The modification-time and size check.
///
/// With an expected time, the file must still have it, and the size must still be the one that
/// was read. Without one (a new file) the check only applies if the app has read or saved this
/// path before: then the file must still be what the app last saw.
fn check_unchanged(
    existing: Option<&Metadata>,
    expected_ms: Option<u64>,
    recorded: Option<FileStamp>,
) -> PlatformResult<()> {
    let changed = || {
        PlatformError::new(
            ErrorCode::ModifiedExternally,
            "The file changed on disk since you opened it.",
        )
    };
    let Some(metadata) = existing else {
        return match expected_ms {
            Some(_) => Err(PlatformError::new(
                ErrorCode::ModifiedExternally,
                "The file was moved or deleted since you opened it.",
            )),
            None => Ok(()),
        };
    };
    let now = FileStamp::of(metadata);
    let time_changed = match expected_ms {
        Some(expected) => expected != now.modified_ms,
        None => recorded.is_some_and(|stamp| stamp.modified_ms != now.modified_ms),
    };
    let size_changed = recorded.is_some_and(|stamp| stamp.size != now.size);
    if time_changed || size_changed {
        Err(changed())
    } else {
        Ok(())
    }
}

/// Removes the temporary file unless it was renamed into place.
struct TempFile {
    path: PathBuf,
    armed: bool,
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// The points of a save where the tests make it fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    AfterCreate,
    AfterWrite,
    AfterMetadata,
    BeforeRename,
}

#[cfg(test)]
thread_local! {
    static FAIL_AT: std::cell::Cell<Option<Step>> = const { std::cell::Cell::new(None) };
}

/// Fails with an injected error when a test asked for this step to fail. Does nothing in the app.
#[cfg(test)]
fn checkpoint(step: Step) -> io::Result<()> {
    if FAIL_AT.with(std::cell::Cell::get) == Some(step) {
        return Err(io::Error::other("injected failure"));
    }
    Ok(())
}

#[cfg(not(test))]
#[inline]
fn checkpoint(_step: Step) -> io::Result<()> {
    Ok(())
}

/// Steps 3 and 4: temporary file, metadata, flush, rename, flush the folder.
fn write_replacing(target: &Path, bytes: &[u8], original: Option<&Metadata>) -> PlatformResult<()> {
    let folder = target
        .parent()
        .ok_or_else(|| PlatformError::io("This is not a file name."))?;
    let (mut file, mut temp) = create_temp(target)?;
    let outcome = (|| -> io::Result<()> {
        checkpoint(Step::AfterCreate)?;
        // Keep the content private until the final permissions are set.
        #[cfg(unix)]
        let default_mode = file.metadata()?.permissions().mode() & 0o7777;
        #[cfg(unix)]
        file.set_permissions(Permissions::from_mode(0o600))?;
        file.write_all(bytes)?;
        checkpoint(Step::AfterWrite)?;
        // Best effort: a volume that cannot take a mode, an attribute or a date must not make
        // the save impossible. On the volumes a Mac normally uses all of these succeed. (Windows
        // has no mode; a new file gets the folder's permissions, as File Explorer's copies do.)
        #[cfg(unix)]
        {
            let mode = match original {
                Some(metadata) => metadata.permissions().mode() & 0o7777,
                None => default_mode,
            };
            let _ = file.set_permissions(Permissions::from_mode(mode));
        }
        if let Some(metadata) = original {
            copy_metadata(&file, target, metadata);
        }
        checkpoint(Step::AfterMetadata)?;
        fs_util::fsync_file(&file)?;
        Ok(())
    })();
    drop(file);
    outcome.map_err(|e| PlatformError::from_write(&e))?;

    checkpoint(Step::BeforeRename).map_err(|e| PlatformError::from_write(&e))?;
    std::fs::rename(&temp.path, target).map_err(|e| PlatformError::from_write(&e))?;
    temp.armed = false;
    fs_util::fsync_folder(folder);
    Ok(())
}

/// Creates the hidden temporary file next to `target`, which must not exist yet.
fn create_temp(target: &Path) -> PlatformResult<(File, TempFile)> {
    let mut last_error = None;
    for _ in 0..16 {
        let path = fs_util::temp_sibling(target);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o666); // the umask makes it 0644 as usual; it is made private right away
        match options.open(&path) {
            Ok(file) => return Ok((file, TempFile { path, armed: true })),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => last_error = Some(error),
            Err(error) => return Err(PlatformError::from_write(&error)),
        }
    }
    Err(PlatformError::from_write(
        &last_error.unwrap_or_else(|| io::Error::other("no temporary name")),
    ))
}

/// Attributes that describe how the system stores a file, not what the user attached to it.
/// Copying them to a file with different contents would corrupt it.
#[cfg(unix)]
const SKIPPED_ATTRIBUTES: [&str; 1] = ["com.apple.decmpfs"];

/// Copies extended attributes (Finder tags, colors, comments), the creation date and the hidden
/// flag from the original to the temporary file. Failures are ignored. On Windows: the creation
/// date and the hidden attribute.
fn copy_metadata(temp: &File, original_path: &Path, original: &Metadata) {
    #[cfg(unix)]
    if let Ok(names) = xattr::list(original_path) {
        for name in names {
            if SKIPPED_ATTRIBUTES.iter().any(|skipped| name == *skipped) {
                continue;
            }
            if let Ok(Some(value)) = xattr::get(original_path, &name) {
                let _ = temp.set_xattr(&name, &value);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(created) = original.created() {
            let _ = macos::set_creation_time(temp, created);
        }
        macos::copy_hidden_flag(temp, original);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::{FileTimesExt, MetadataExt};
        if let Ok(created) = original.created() {
            let _ = temp.set_times(std::fs::FileTimes::new().set_created(created));
        }
        // FILE_ATTRIBUTE_HIDDEN
        if original.file_attributes() & 0x2 != 0 {
            windows_hide(temp);
        }
        let _ = original_path;
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = original;
}

/// Sets the hidden attribute of an open file (best effort).
#[cfg(windows)]
fn windows_hide(file: &File) {
    use ::windows::Win32::Foundation::HANDLE;
    use ::windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_HIDDEN, FILE_BASIC_INFO, FileBasicInfo, GetFileInformationByHandleEx,
        SetFileInformationByHandle,
    };
    use std::os::windows::io::AsRawHandle;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = FILE_BASIC_INFO::default();
    let size = std::mem::size_of::<FILE_BASIC_INFO>() as u32;
    // SAFETY: the handle is the open file's; `info` is a FILE_BASIC_INFO of the size passed.
    unsafe {
        if GetFileInformationByHandleEx(handle, FileBasicInfo, (&raw mut info).cast(), size).is_ok()
        {
            info.FileAttributes |= FILE_ATTRIBUTE_HIDDEN.0;
            let _ =
                SetFileInformationByHandle(handle, FileBasicInfo, (&raw const info).cast(), size);
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::fs::{File, Metadata};
    use std::io;
    use std::os::fd::AsRawFd;
    use std::os::macos::fs::MetadataExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// The Finder's "hidden" flag (`chflags hidden`).
    const UF_HIDDEN: u32 = 0x0000_8000;

    /// Sets the creation (birth) date of an open file.
    pub fn set_creation_time(file: &File, created: SystemTime) -> io::Result<()> {
        let since_epoch = created
            .duration_since(UNIX_EPOCH)
            .map_err(|_| io::Error::other("creation date before 1970"))?;
        let mut stamp = libc::timespec {
            tv_sec: since_epoch.as_secs() as libc::time_t,
            tv_nsec: since_epoch.subsec_nanos() as _,
        };
        // SAFETY: `list` and `stamp` are valid for the duration of the call, the buffer size is
        // the size of the one `timespec` that ATTR_CMN_CRTIME takes, and the descriptor is open.
        let result = unsafe {
            let mut list: libc::attrlist = std::mem::zeroed();
            list.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
            list.commonattr = libc::ATTR_CMN_CRTIME;
            libc::fsetattrlist(
                file.as_raw_fd(),
                (&mut list as *mut libc::attrlist).cast(),
                (&mut stamp as *mut libc::timespec).cast(),
                std::mem::size_of::<libc::timespec>(),
                0,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    /// Copies only the hidden flag: other flags (compression, immutability) describe storage
    /// and must not be carried over to a new file.
    pub fn copy_hidden_flag(file: &File, original: &Metadata) {
        if original.st_flags() & UF_HIDDEN != 0 {
            // SAFETY: the descriptor is open; the flag value is a plain integer.
            let _ = unsafe { libc::fchflags(file.as_raw_fd(), UF_HIDDEN) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents;
    use crate::test_support::TempDir;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    #[cfg(target_os = "macos")]
    use std::time::UNIX_EPOCH;

    const LF_UTF8: SaveFormat = SaveFormat {
        encoding: Encoding::Utf8,
        line_ending: LineEnding::Lf,
    };

    fn options(expected: Option<u64>) -> SaveOptions {
        SaveOptions {
            expected_modified_ms: expected,
            ..SaveOptions::default()
        }
    }

    fn save_plain(path: &Path, text: &str) -> PlatformResult<Saved> {
        save(path, text, LF_UTF8, &options(None), None)
    }

    fn files_in(dir: &TempDir) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .expect("list")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        std::fs::metadata(path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o7777
    }

    fn tracked_from(path: &Path) -> Tracked {
        let read = documents::read_document(path).expect("reads");
        Tracked {
            stamp: read.stamp,
            lossy: read.document.lossy,
        }
    }

    // ---- bytes written ----------------------------------------------------------------

    #[test]
    fn every_encoding_and_line_ending_is_written_exactly() {
        let dir = TempDir::new();
        let cases: [(Encoding, LineEnding, &[u8]); 8] = [
            (Encoding::Utf8, LineEnding::Lf, b"a\xC3\xA9\nb\n"),
            (Encoding::Utf8, LineEnding::Crlf, b"a\xC3\xA9\r\nb\r\n"),
            (
                Encoding::Utf8Bom,
                LineEnding::Lf,
                b"\xEF\xBB\xBFa\xC3\xA9\nb\n",
            ),
            (
                Encoding::Utf8Bom,
                LineEnding::Crlf,
                b"\xEF\xBB\xBFa\xC3\xA9\r\nb\r\n",
            ),
            (
                Encoding::Utf16Le,
                LineEnding::Lf,
                b"\xFF\xFEa\x00\xE9\x00\n\x00b\x00\n\x00",
            ),
            (
                Encoding::Utf16Le,
                LineEnding::Crlf,
                b"\xFF\xFEa\x00\xE9\x00\r\x00\n\x00b\x00\r\x00\n\x00",
            ),
            (
                Encoding::Utf16Be,
                LineEnding::Lf,
                b"\xFE\xFF\x00a\x00\xE9\x00\n\x00b\x00\n",
            ),
            (
                Encoding::Utf16Be,
                LineEnding::Crlf,
                b"\xFE\xFF\x00a\x00\xE9\x00\r\x00\n\x00b\x00\r\x00\n",
            ),
        ];
        for (index, (encoding, line_ending, expected)) in cases.iter().enumerate() {
            let path = dir.path().join(format!("{index}.md"));
            let format = SaveFormat {
                encoding: *encoding,
                line_ending: *line_ending,
            };

            let saved = save(&path, "aé\nb\n", format, &options(None), None).expect("saves");

            assert_eq!(
                std::fs::read(&path).expect("read"),
                *expected,
                "{encoding:?} {line_ending:?}"
            );
            assert_eq!(saved.result.bytes, expected.len() as u64);
        }
    }

    #[test]
    fn the_result_has_the_canonical_path_size_and_modification_time() {
        let dir = TempDir::new();
        let path = dir.path().join("a.md");

        let saved = save_plain(&path, "hello\n").expect("saves");

        let metadata = std::fs::metadata(&path).expect("metadata");
        assert_eq!(saved.result.path, crate::fs_util::path_text(&path));
        assert_eq!(saved.result.bytes, 6);
        assert_eq!(saved.result.modified_ms, fs_util::modified_ms(&metadata));
        assert_eq!(saved.stamp, FileStamp::of(&metadata));
    }

    #[cfg(unix)]
    #[test]
    fn a_new_file_is_created_with_the_usual_permissions_and_no_temporary_file_remains() {
        let dir = TempDir::new();
        let path = dir.path().join("new.md");

        save_plain(&path, "x").expect("saves");

        assert_eq!(files_in(&dir), ["new.md"]);
        assert_eq!(
            mode_of(&path) & 0o600,
            0o600,
            "owner can read and write: {:o}",
            mode_of(&path)
        );
        assert_eq!(mode_of(&path) & 0o002, 0, "not writable by everyone");
    }

    #[cfg(unix)]
    #[test]
    fn an_existing_file_is_replaced_and_keeps_its_permissions() {
        let dir = TempDir::new();
        for mode in [0o600, 0o640, 0o644, 0o664, 0o755] {
            let path = dir.write(&format!("m{mode:o}.md"), b"old");
            std::fs::set_permissions(&path, Permissions::from_mode(mode)).expect("chmod");

            save(&path, "new", LF_UTF8, &options(None), None).expect("saves");

            assert_eq!(std::fs::read(&path).expect("read"), b"new");
            assert_eq!(mode_of(&path), mode, "mode {mode:o}");
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    #[test]
    fn extended_attributes_including_file_manager_tags_are_kept() {
        let dir = TempDir::new();
        let path = dir.write("tagged.md", b"old");
        // KDE's Dolphin keeps tags here; other tools use the `user.` namespace too. A file system
        // without user attributes has nothing to keep.
        if xattr::set(&path, "user.xdg.tags", b"red,work").is_err() {
            return;
        }
        xattr::set(&path, "user.backtickle-test", b"kept").expect("set custom");

        save(&path, "new", LF_UTF8, &options(None), None).expect("saves");

        assert_eq!(std::fs::read(&path).expect("read"), b"new");
        assert_eq!(
            xattr::get(&path, "user.xdg.tags").expect("get"),
            Some(b"red,work".to_vec())
        );
        assert_eq!(
            xattr::get(&path, "user.backtickle-test").expect("get"),
            Some(b"kept".to_vec())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn extended_attributes_including_finder_tags_are_kept() {
        let dir = TempDir::new();
        let path = dir.write("tagged.md", b"old");
        let tags = b"bplist00\xA1\x01_\x10\nRed\n6".to_vec();
        // An all-zero FinderInfo counts as "no attribute" to the system, so give it a color label.
        let mut finder_info = [0u8; 32];
        finder_info[9] = 0x0C;
        xattr::set(&path, "com.apple.metadata:_kMDItemUserTags", &tags).expect("set tags");
        xattr::set(&path, "com.apple.FinderInfo", &finder_info).expect("set finder info");
        xattr::set(&path, "user.backtickle-test", b"kept").expect("set custom");

        save(&path, "new", LF_UTF8, &options(None), None).expect("saves");

        assert_eq!(std::fs::read(&path).expect("read"), b"new");
        assert_eq!(
            xattr::get(&path, "com.apple.metadata:_kMDItemUserTags").expect("get"),
            Some(tags)
        );
        assert_eq!(
            xattr::get(&path, "com.apple.FinderInfo").expect("get"),
            Some(finder_info.to_vec())
        );
        assert_eq!(
            xattr::get(&path, "user.backtickle-test").expect("get"),
            Some(b"kept".to_vec())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_creation_date_is_kept() {
        let dir = TempDir::new();
        let path = dir.write("old.md", b"old");
        // 2001-01-01 12:00:00.123456789 UTC
        let created = UNIX_EPOCH + std::time::Duration::new(978_350_400, 123_456_789);
        {
            let file = OpenOptions::new().write(true).open(&path).expect("open");
            macos::set_creation_time(&file, created).expect("sets the creation date");
        }
        assert_eq!(
            std::fs::metadata(&path)
                .expect("metadata")
                .created()
                .expect("created"),
            created
        );

        save(&path, "new", LF_UTF8, &options(None), None).expect("saves");

        assert_eq!(
            std::fs::metadata(&path)
                .expect("metadata")
                .created()
                .expect("created"),
            created,
            "the new file has the original's creation date"
        );
        assert!(
            fs_util::modified_ms(&std::fs::metadata(&path).expect("metadata")) > 1_000_000_000_000,
            "but the modification time is the time of the save"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_hidden_flag_is_kept_and_other_flags_are_not_copied() {
        use std::os::macos::fs::MetadataExt;
        let dir = TempDir::new();
        let path = dir.write("hidden.md", b"old");
        let c_path = std::ffi::CString::new(path.to_str().expect("utf8")).expect("c string");
        // SAFETY: valid C string; the flag is a plain integer.
        assert_eq!(unsafe { libc::chflags(c_path.as_ptr(), 0x8000) }, 0);

        save(&path, "new", LF_UTF8, &options(None), None).expect("saves");

        let flags = std::fs::metadata(&path).expect("metadata").st_flags();
        assert_eq!(flags & 0x8000, 0x8000, "hidden is kept");
        assert_eq!(flags & 0x20, 0, "UF_COMPRESSED is never copied");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_written_through_and_stays_a_symlink() {
        let dir = TempDir::new();
        let real = dir.write("real.md", b"old");
        let link = dir.path().join("link.md");
        symlink(&real, &link).expect("symlink");

        let saved = save(&link, "through the link", LF_UTF8, &options(None), None).expect("saves");

        assert!(
            std::fs::symlink_metadata(&link)
                .expect("link")
                .file_type()
                .is_symlink(),
            "the link is still a link"
        );
        assert_eq!(std::fs::read(&real).expect("read"), b"through the link");
        assert_eq!(std::fs::read(&link).expect("read"), b"through the link");
        assert_eq!(
            saved.result.path,
            real.to_string_lossy(),
            "the target is what was written"
        );
        assert_eq!(files_in(&dir), ["link.md", "real.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_file_in_another_folder_gets_its_temporary_file_there() {
        let dir = TempDir::new();
        let other = dir.path().join("other");
        std::fs::create_dir(&other).expect("mkdir");
        let real = other.join("real.md");
        std::fs::write(&real, b"old").expect("write");
        let link = dir.path().join("link.md");
        symlink(&real, &link).expect("symlink");

        save(&link, "new", LF_UTF8, &options(None), None).expect("saves");

        assert_eq!(std::fs::read(&real).expect("read"), b"new");
        assert_eq!(files_in(&dir), ["link.md", "other"]);
        let inner: Vec<_> = std::fs::read_dir(&other)
            .expect("list")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(inner.len(), 1, "{inner:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_symlink_is_refused() {
        let dir = TempDir::new();
        let link = dir.path().join("dangling.md");
        symlink(dir.path().join("missing.md"), &link).expect("symlink");

        let error = save_plain(&link, "x").expect_err("refused");

        assert_eq!(error.code, ErrorCode::NotFound);
        assert_eq!(files_in(&dir), ["dangling.md"]);
    }

    #[test]
    fn saving_over_a_folder_or_into_a_missing_folder_fails_cleanly() {
        let dir = TempDir::new();
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).expect("mkdir");

        let over_folder = save_plain(&folder, "x").expect_err("a folder");
        let missing = save_plain(&dir.path().join("nope").join("a.md"), "x").expect_err("missing");

        assert_eq!(over_folder.message, "This is not a file.");
        assert_eq!(missing.code, ErrorCode::NotFound);
        assert_eq!(files_in(&dir), ["folder"]);
    }

    // ---- refusals ---------------------------------------------------------------------

    #[test]
    fn a_file_that_changed_since_it_was_read_is_refused_unless_overwriting_is_agreed() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"read this");
        let tracked = tracked_from(&path);
        let expected = Some(tracked.stamp.modified_ms);
        // Someone else writes a longer file: the size differs.
        std::fs::write(&path, b"someone else wrote this").expect("external write");

        let refused = save(&path, "mine", LF_UTF8, &options(expected), Some(tracked));
        let overwritten = save(
            &path,
            "mine",
            LF_UTF8,
            &SaveOptions {
                expected_modified_ms: expected,
                overwrite_external_change: true,
                allow_lossy: false,
            },
            Some(tracked),
        );

        assert_eq!(
            refused.expect_err("refused").code,
            ErrorCode::ModifiedExternally
        );
        assert!(overwritten.is_ok());
        assert_eq!(std::fs::read(&path).expect("read"), b"mine");
    }

    #[test]
    fn a_different_modification_time_alone_is_enough_to_refuse() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"same size");
        let modified = fs_util::modified_ms(&std::fs::metadata(&path).expect("metadata"));

        let error = save(
            &path,
            "x",
            LF_UTF8,
            &options(Some(modified.saturating_sub(5000))),
            None,
        )
        .expect_err("refused");

        assert_eq!(error.code, ErrorCode::ModifiedExternally);
        assert_eq!(std::fs::read(&path).expect("read"), b"same size");
    }

    #[test]
    fn a_different_size_alone_is_enough_to_refuse_when_the_read_is_remembered() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"12345");
        let metadata = std::fs::metadata(&path).expect("metadata");
        let modified = fs_util::modified_ms(&metadata);
        // The remembered read says 3 bytes; the file has 5. The time is unchanged.
        let tracked = Tracked {
            stamp: FileStamp {
                modified_ms: modified,
                size: 3,
            },
            lossy: false,
        };

        let error = save(&path, "x", LF_UTF8, &options(Some(modified)), Some(tracked))
            .expect_err("refused");

        assert_eq!(error.code, ErrorCode::ModifiedExternally);
    }

    #[test]
    fn a_file_that_is_unchanged_saves() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"read this");
        let tracked = tracked_from(&path);

        let saved = save(
            &path,
            "edited",
            LF_UTF8,
            &options(Some(tracked.stamp.modified_ms)),
            Some(tracked),
        );

        assert!(saved.is_ok());
        assert_eq!(std::fs::read(&path).expect("read"), b"edited");
    }

    #[test]
    fn a_second_save_with_the_stamp_of_the_first_works() {
        let dir = TempDir::new();
        let path = dir.path().join("a.md");
        let first = save_plain(&path, "one").expect("saves");
        let tracked = Tracked {
            stamp: first.stamp,
            lossy: false,
        };

        let second = save(
            &path,
            "two",
            LF_UTF8,
            &options(Some(first.result.modified_ms)),
            Some(tracked),
        );

        assert!(second.is_ok());
        assert_eq!(std::fs::read(&path).expect("read"), b"two");
    }

    #[test]
    fn a_file_that_was_deleted_or_moved_is_refused_when_a_time_was_expected() {
        let dir = TempDir::new();
        let path = dir.path().join("gone.md");

        let error = save(&path, "x", LF_UTF8, &options(Some(1_700_000_000_000)), None)
            .expect_err("refused");

        assert_eq!(error.code, ErrorCode::ModifiedExternally);
        assert!(error.message.contains("moved or deleted"));
        assert!(files_in(&dir).is_empty());
        let overwrite = SaveOptions {
            expected_modified_ms: Some(1_700_000_000_000),
            overwrite_external_change: true,
            allow_lossy: false,
        };
        assert!(save(&path, "x", LF_UTF8, &overwrite, None).is_ok());
        assert_eq!(std::fs::read(&path).expect("read"), b"x");
    }

    #[test]
    fn without_an_expected_time_a_remembered_file_must_still_match_what_was_seen() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"seen");
        let tracked = tracked_from(&path);
        std::fs::write(&path, b"changed afterwards").expect("external write");

        let error = save(&path, "x", LF_UTF8, &options(None), Some(tracked)).expect_err("refused");

        assert_eq!(error.code, ErrorCode::ModifiedExternally);
    }

    #[test]
    fn a_new_file_over_an_unknown_existing_file_is_written_without_a_check() {
        // Save As onto a file the user picked in the save sheet, which already asked to replace.
        let dir = TempDir::new();
        let path = dir.write("picked.md", b"old");

        let saved = save(&path, "new", LF_UTF8, &options(None), None);

        assert!(saved.is_ok());
        assert_eq!(std::fs::read(&path).expect("read"), b"new");
    }

    #[test]
    fn a_lossy_document_is_refused_unless_the_user_agreed() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"\xEF\xBB\xBFbad \xFF byte");
        let tracked = tracked_from(&path);
        assert!(tracked.lossy);
        let expected = Some(tracked.stamp.modified_ms);

        let refused = save(&path, "x", LF_UTF8, &options(expected), Some(tracked));
        let agreed = save(
            &path,
            "x",
            LF_UTF8,
            &SaveOptions {
                expected_modified_ms: expected,
                overwrite_external_change: false,
                allow_lossy: true,
            },
            Some(tracked),
        );

        assert_eq!(refused.expect_err("refused").code, ErrorCode::Lossy);
        assert!(agreed.is_ok());
    }

    #[test]
    fn a_document_that_was_not_read_lossily_is_not_refused() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"fine");
        let tracked = tracked_from(&path);

        assert!(!tracked.lossy);
        assert!(
            save(
                &path,
                "x",
                LF_UTF8,
                &options(Some(tracked.stamp.modified_ms)),
                Some(tracked)
            )
            .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_file_is_refused_and_left_alone() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"protected");
        std::fs::set_permissions(&path, Permissions::from_mode(0o444)).expect("chmod");

        let error = save_plain(&path, "x").expect_err("refused");

        assert_eq!(error.code, ErrorCode::ReadOnly);
        assert_eq!(std::fs::read(&path).expect("read"), b"protected");
        assert_eq!(mode_of(&path), 0o444);
        assert_eq!(files_in(&dir), ["a.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_file_in_a_read_only_folder_is_refused() {
        let dir = TempDir::new();
        let folder = dir.path().join("locked");
        std::fs::create_dir(&folder).expect("mkdir");
        let path = folder.join("a.md");
        std::fs::write(&path, b"x").expect("write");
        std::fs::set_permissions(&folder, Permissions::from_mode(0o555)).expect("chmod");

        let existing = save_plain(&path, "y");
        let new_file = save_plain(&folder.join("new.md"), "y");
        std::fs::set_permissions(&folder, Permissions::from_mode(0o755)).expect("chmod");

        assert_eq!(existing.expect_err("refused").code, ErrorCode::ReadOnly);
        assert_eq!(new_file.expect_err("refused").code, ErrorCode::ReadOnly);
        assert_eq!(std::fs::read(&path).expect("read"), b"x");
    }

    #[cfg(unix)]
    #[test]
    fn read_only_wins_over_the_other_refusals() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        std::fs::set_permissions(&path, Permissions::from_mode(0o444)).expect("chmod");
        let tracked = Tracked {
            stamp: FileStamp {
                modified_ms: 1,
                size: 1,
            },
            lossy: true,
        };

        let error =
            save(&path, "y", LF_UTF8, &options(Some(1)), Some(tracked)).expect_err("refused");

        assert_eq!(error.code, ErrorCode::ReadOnly);
    }

    // ---- failures leave nothing behind --------------------------------------------------

    #[test]
    fn r02_no_temporary_file_is_left_when_a_step_fails_and_the_original_is_untouched() {
        for step in [
            Step::AfterCreate,
            Step::AfterWrite,
            Step::AfterMetadata,
            Step::BeforeRename,
        ] {
            let dir = TempDir::new();
            let path = dir.write("a.md", b"original");
            FAIL_AT.with(|fail_at| fail_at.set(Some(step)));

            let result = save(&path, "replacement", LF_UTF8, &options(None), None);

            FAIL_AT.with(|fail_at| fail_at.set(None));
            assert!(result.is_err(), "{step:?} fails the save");
            assert_eq!(std::fs::read(&path).expect("read"), b"original", "{step:?}");
            assert_eq!(files_in(&dir), ["a.md"], "{step:?} left a temporary file");
        }
    }

    #[test]
    fn r02_a_failed_save_of_a_new_file_creates_nothing() {
        let dir = TempDir::new();
        let path = dir.path().join("new.md");
        FAIL_AT.with(|fail_at| fail_at.set(Some(Step::BeforeRename)));

        let result = save_plain(&path, "x");

        FAIL_AT.with(|fail_at| fail_at.set(None));
        assert!(result.is_err());
        assert!(files_in(&dir).is_empty());
    }

    #[test]
    fn r02_refusals_leave_no_temporary_file_either() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        let tracked = tracked_from(&path);
        std::fs::write(&path, b"changed").expect("external write");

        let _ = save(
            &path,
            "y",
            LF_UTF8,
            &options(Some(tracked.stamp.modified_ms)),
            Some(tracked),
        );

        assert_eq!(files_in(&dir), ["a.md"]);
    }

    #[test]
    fn consecutive_saves_never_collide_on_the_temporary_name() {
        let dir = TempDir::new();
        let path = dir.path().join("a.md");

        for round in 0..20 {
            save_plain(&path, &format!("round {round}")).expect("saves");
        }

        assert_eq!(std::fs::read(&path).expect("read"), b"round 19");
        assert_eq!(files_in(&dir), ["a.md"]);
    }

    // ---- round trips through the reader ---------------------------------------------------

    #[test]
    fn a_document_read_and_saved_unchanged_is_byte_identical() {
        let dir = TempDir::new();
        let samples: [(&str, &[u8]); 6] = [
            ("lf", b"a\nb\n"),
            ("crlf", b"a\r\nb\r\n"),
            ("bom", b"\xEF\xBB\xBFa\nb\n"),
            ("le", b"\xFF\xFEa\x00\n\x00"),
            ("be", b"\xFE\xFF\x00a\x00\n"),
            ("no-final-newline", b"a\nb"),
        ];
        for (name, bytes) in samples {
            let path = dir.write(&format!("{name}.md"), bytes);
            let read = documents::read_document(&path).expect("reads").document;
            let format = SaveFormat {
                encoding: read.encoding,
                line_ending: read.line_ending,
            };

            save(
                &path,
                &read.text,
                format,
                &options(Some(read.modified_ms)),
                None,
            )
            .expect("saves");

            assert_eq!(std::fs::read(&path).expect("read"), bytes, "{name}");
        }
    }

    #[test]
    fn save_options_accept_the_json_the_frontend_sends() {
        let full: SaveOptions = serde_json::from_str(
            r#"{"expectedModifiedMs": 1700000000123, "overwriteExternalChange": true, "allowLossy": true}"#,
        )
        .expect("parses");
        let minimal: SaveOptions =
            serde_json::from_str(r#"{"expectedModifiedMs": null}"#).expect("parses");
        let fraction: SaveOptions =
            serde_json::from_str(r#"{"expectedModifiedMs": 1700000000123.4}"#).expect("parses");
        let empty: SaveOptions = serde_json::from_str("{}").expect("parses");

        assert_eq!(full.expected_modified_ms, Some(1_700_000_000_123));
        assert!(full.overwrite_external_change && full.allow_lossy);
        assert_eq!(minimal, SaveOptions::default());
        assert_eq!(fraction.expected_modified_ms, Some(1_700_000_000_123));
        assert_eq!(empty, SaveOptions::default());
    }

    #[test]
    fn save_formats_parse_and_unknown_encodings_are_rejected() {
        let format: SaveFormat =
            serde_json::from_str(r#"{"encoding": "utf-16le", "lineEnding": "crlf"}"#)
                .expect("parses");
        assert_eq!(format.encoding, Encoding::Utf16Le);
        assert_eq!(format.line_ending, LineEnding::Crlf);

        assert!(
            serde_json::from_str::<SaveFormat>(r#"{"encoding": "latin1", "lineEnding": "lf"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<SaveFormat>(r#"{"encoding": "utf-8"}"#).is_err());
    }

    #[test]
    fn the_result_serializes_with_the_names_of_the_frontend_type() {
        let result = SaveResult {
            path: "/a.md".into(),
            bytes: 3,
            modified_ms: 7,
        };

        assert_eq!(
            serde_json::to_value(result).expect("serializes"),
            serde_json::json!({ "path": "/a.md", "bytes": 3, "modifiedMs": 7 })
        );
    }

    #[test]
    fn saving_text_that_is_empty_writes_an_empty_file_or_just_the_byte_order_mark() {
        let dir = TempDir::new();
        let plain = dir.path().join("plain.md");
        let bom = dir.path().join("bom.md");

        save_plain(&plain, "").expect("saves");
        save(
            &bom,
            "",
            SaveFormat {
                encoding: Encoding::Utf8Bom,
                line_ending: LineEnding::Lf,
            },
            &options(None),
            None,
        )
        .expect("saves");

        assert_eq!(std::fs::read(&plain).expect("read"), b"");
        assert_eq!(std::fs::read(&bom).expect("read"), b"\xEF\xBB\xBF");
    }
}
