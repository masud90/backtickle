//! The one error type of the Phase 1 commands.
//!
//! It serializes to `{ "code": "not-found", "message": "..." }`, which is `PlatformError` in
//! `src/lib/platform.ts`. A rejected command therefore always carries a code the frontend can
//! branch on and a plain sentence it can show. The messages never repeat file contents or the
//! operating system's own wording.

use serde::Serialize;
use std::fmt;
use std::io;

/// The system error numbers (`io::Error::raw_os_error`) the messages tell apart: errno values on
/// macOS, Win32 error codes on Windows.
pub mod os_code {
    #[cfg(unix)]
    pub const READ_ONLY: &[i32] = &[libc::EROFS, libc::EPERM, libc::EACCES];
    #[cfg(unix)]
    pub const DISK_FULL: &[i32] = &[libc::ENOSPC, libc::EDQUOT];
    #[cfg(unix)]
    pub const NAME_TOO_LONG: &[i32] = &[libc::ENAMETOOLONG];
    #[cfg(unix)]
    pub const OTHER_VOLUME: &[i32] = &[libc::EXDEV];

    // ERROR_ACCESS_DENIED, ERROR_WRITE_PROTECT.
    #[cfg(windows)]
    pub const READ_ONLY: &[i32] = &[5, 19];
    // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL, ERROR_DISK_QUOTA_EXCEEDED.
    #[cfg(windows)]
    pub const DISK_FULL: &[i32] = &[39, 112, 1295];
    // ERROR_FILENAME_EXCED_RANGE, ERROR_INVALID_NAME.
    #[cfg(windows)]
    pub const NAME_TOO_LONG: &[i32] = &[206, 123];
    // ERROR_NOT_SAME_DEVICE.
    #[cfg(windows)]
    pub const OTHER_VOLUME: &[i32] = &[17];
}

/// The codes of `PlatformErrorCode` in `src/lib/platform.ts` (kebab-case on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    /// The path is not one the user gave to Writedown (see `grants.rs`).
    NotAllowed,
    NotFound,
    TooLarge,
    /// The file or its folder cannot be written.
    ReadOnly,
    /// The file changed on disk since it was read.
    ModifiedExternally,
    /// The document was read with undecodable bytes replaced.
    Lossy,
    /// A link target that is not a Markdown or text document.
    NotMarkdown,
    Cancelled,
    Io,
    /// A file operation found an item with that name already (Phase 3).
    Exists,
    /// A name that cannot be used for a file or folder (Phase 3).
    InvalidName,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlatformError {
    pub code: ErrorCode,
    pub message: String,
}

pub type PlatformResult<T> = Result<T, PlatformError>;

impl PlatformError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        PlatformError {
            code,
            message: message.into(),
        }
    }

    pub fn not_allowed() -> Self {
        Self::new(
            ErrorCode::NotAllowed,
            "Writedown has not been given access to this file. Open it with File > Open.",
        )
    }

    pub fn not_found() -> Self {
        Self::new(
            ErrorCode::NotFound,
            "The file was not found. It may have been moved or deleted.",
        )
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }

    pub fn exists() -> Self {
        Self::new(
            ErrorCode::Exists,
            "An item with that name already exists in this folder.",
        )
    }

    pub fn invalid_name() -> Self {
        Self::new(
            ErrorCode::InvalidName,
            "That name cannot be used. A name cannot be empty, contain / or :, or start with a dot.",
        )
    }

    /// Maps an error from reading. `PermissionDenied` is `io` here: the user is not asking to
    /// write, so "read-only" would be the wrong advice.
    pub fn from_read(error: &io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::not_found(),
            io::ErrorKind::PermissionDenied => Self::io(format!(
                "The file cannot be read because {} denied access to it.",
                crate::os_text::OS
            )),
            _ => Self::io("The file could not be read."),
        }
    }

    /// Maps an error from writing.
    pub fn from_write(error: &io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::new(
                ErrorCode::NotFound,
                "The folder of this file was not found. It may have been moved or deleted.",
            ),
            io::ErrorKind::PermissionDenied => Self::read_only_folder(),
            _ => match error.raw_os_error() {
                Some(code) if os_code::READ_ONLY.contains(&code) => Self::read_only_folder(),
                Some(code) if os_code::DISK_FULL.contains(&code) => {
                    Self::io("The disk is full, so the file could not be saved.")
                }
                _ => Self::io("The file could not be saved."),
            },
        }
    }

    fn read_only_folder() -> Self {
        Self::new(
            ErrorCode::ReadOnly,
            "Writedown cannot write to this location. Use Save As to save a copy elsewhere.",
        )
    }
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PlatformError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_serialize_in_kebab_case_like_the_frontend_type() {
        let all = [
            (ErrorCode::NotAllowed, "not-allowed"),
            (ErrorCode::NotFound, "not-found"),
            (ErrorCode::TooLarge, "too-large"),
            (ErrorCode::ReadOnly, "read-only"),
            (ErrorCode::ModifiedExternally, "modified-externally"),
            (ErrorCode::Lossy, "lossy"),
            (ErrorCode::NotMarkdown, "not-markdown"),
            (ErrorCode::Cancelled, "cancelled"),
            (ErrorCode::Io, "io"),
            (ErrorCode::Exists, "exists"),
            (ErrorCode::InvalidName, "invalid-name"),
        ];
        for (code, text) in all {
            assert_eq!(
                serde_json::to_value(code).expect("serializes"),
                serde_json::json!(text)
            );
        }
    }

    #[test]
    fn an_error_serializes_to_code_and_message() {
        let error = PlatformError::new(ErrorCode::TooLarge, "Too big.");

        assert_eq!(
            serde_json::to_value(&error).expect("serializes"),
            serde_json::json!({ "code": "too-large", "message": "Too big." })
        );
        assert_eq!(error.to_string(), "Too big.");
    }

    #[test]
    fn read_errors_map_to_not_found_or_io() {
        let missing = PlatformError::from_read(&io::Error::from(io::ErrorKind::NotFound));
        let denied = PlatformError::from_read(&io::Error::from(io::ErrorKind::PermissionDenied));
        let other = PlatformError::from_read(&io::Error::other("boom"));

        assert_eq!(missing.code, ErrorCode::NotFound);
        assert_eq!(denied.code, ErrorCode::Io);
        assert!(denied.message.contains("denied"));
        assert_eq!(other.code, ErrorCode::Io);
        // The message never repeats the operating system's text.
        assert!(!other.message.contains("boom"));
    }

    #[test]
    fn write_errors_map_to_read_only_for_permission_problems() {
        let denied = PlatformError::from_write(&io::Error::from(io::ErrorKind::PermissionDenied));
        let read_only_volume =
            PlatformError::from_write(&io::Error::from_raw_os_error(libc::EROFS));
        let full = PlatformError::from_write(&io::Error::from_raw_os_error(libc::ENOSPC));
        let other = PlatformError::from_write(&io::Error::other("boom"));

        assert_eq!(denied.code, ErrorCode::ReadOnly);
        assert_eq!(read_only_volume.code, ErrorCode::ReadOnly);
        assert_eq!(full.code, ErrorCode::Io);
        assert!(full.message.contains("full"));
        assert_eq!(other.code, ErrorCode::Io);
    }

    #[test]
    fn messages_are_plain_sentences_without_dashes() {
        for error in [
            PlatformError::not_allowed(),
            PlatformError::not_found(),
            PlatformError::exists(),
            PlatformError::invalid_name(),
            PlatformError::from_read(&io::Error::other("x")),
            PlatformError::from_write(&io::Error::other("x")),
        ] {
            assert!(error.message.ends_with('.'), "{}", error.message);
            assert!(!error.message.contains('\u{2014}') && !error.message.contains('\u{2013}'));
        }
    }
}
