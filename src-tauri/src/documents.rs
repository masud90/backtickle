//! Reading a document for the editor (Reading).
//!
//! `read_document` turns the bytes of a file into a `DocumentFile`: the text with `\n` line
//! endings and no byte order mark, plus everything a later save needs to write the file back the
//! way it was (encoding, line ending) and everything the shell shows (legacy encoding, lossy,
//! read-only, size, modification time).

use crate::encoding::{self, Encoding};
use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::fs_util::{self, FileStamp};
use crate::line_endings::{self, LineEnding};
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Larger files are refused with `too-large`.
pub const MAX_DOCUMENT_BYTES: u64 = crate::text_file::MAX_TEXT_FILE_BYTES;

/// `DocumentFile` in `src/lib/platform.ts` (camelCase on the wire).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFile {
    /// The canonical path.
    pub path: String,
    /// Line endings normalized to `\n`, byte order mark removed.
    pub text: String,
    /// How the document will be saved.
    pub encoding: Encoding,
    /// Set when the file was decoded from a legacy encoding such as `windows-1252`; saving
    /// converts it to UTF-8.
    pub legacy_encoding: Option<String>,
    /// Undecodable bytes were replaced by U+FFFD.
    pub lossy: bool,
    /// The majority line ending (`lf` for a file without line breaks).
    pub line_ending: LineEnding,
    pub mixed_line_endings: bool,
    /// The file or its folder cannot be written, so a save cannot replace the file.
    pub read_only: bool,
    /// Size of the file on disk.
    pub bytes: u64,
    /// The file's modification time when it was read, in milliseconds since the epoch.
    pub modified_ms: u64,
}

/// A document and the stamp of the file it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadResult {
    pub document: DocumentFile,
    pub stamp: FileStamp,
}

fn too_large_message(limit: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if limit.is_multiple_of(MB) {
        format!(
            "The file is larger than {} MB, which Backtickle does not open.",
            limit / MB
        )
    } else {
        format!("The file is larger than {limit} bytes, which Backtickle does not open.")
    }
}

/// Reads `path` with the standard 50 MB limit.
pub fn read_document(path: &Path) -> PlatformResult<ReadResult> {
    read_document_with_limit(path, MAX_DOCUMENT_BYTES)
}

/// Reads `path`, refusing anything that is not a regular file and files above `limit`.
pub fn read_document_with_limit(path: &Path, limit: u64) -> PlatformResult<ReadResult> {
    // Look before opening: opening a named pipe would wait for a writer.
    let before = std::fs::metadata(path).map_err(|e| PlatformError::from_read(&e))?;
    if !before.is_file() {
        return Err(PlatformError::io("This is not a file."));
    }
    if before.len() > limit {
        return Err(PlatformError::new(
            ErrorCode::TooLarge,
            too_large_message(limit),
        ));
    }

    let file = File::open(path).map_err(|e| PlatformError::from_read(&e))?;
    let metadata = file.metadata().map_err(|e| PlatformError::from_read(&e))?;

    // One byte more than the limit, so a file that grew since the check is caught too.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| PlatformError::from_read(&e))?;
    if bytes.len() as u64 > limit {
        return Err(PlatformError::new(
            ErrorCode::TooLarge,
            too_large_message(limit),
        ));
    }

    let decoded = encoding::decode(&bytes);
    let normalized = line_endings::normalize(&decoded.text);
    let stamp = FileStamp::of(&metadata);

    Ok(ReadResult {
        document: DocumentFile {
            path: crate::fs_util::path_text(path),
            text: normalized.text,
            encoding: decoded.encoding,
            legacy_encoding: decoded.legacy_encoding,
            lossy: decoded.lossy,
            line_ending: normalized.line_ending,
            mixed_line_endings: normalized.mixed,
            read_only: !fs_util::can_replace(path),
            bytes: bytes.len() as u64,
            modified_ms: stamp.modified_ms,
        },
        stamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::collections::BTreeSet;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn read(dir: &TempDir, bytes: &[u8]) -> DocumentFile {
        let path = dir.write("doc.md", bytes);
        read_document(&path).expect("reads").document
    }

    #[test]
    fn utf8_text_is_returned_with_its_size_path_and_time() {
        let dir = TempDir::new();
        let path = dir.write("a.md", "# Titel\n\nhéllo €\n".as_bytes());

        let result = read_document(&path).expect("reads");

        let document = result.document;
        assert_eq!(document.text, "# Titel\n\nhéllo €\n");
        assert_eq!(document.bytes, "# Titel\n\nhéllo €\n".len() as u64);
        assert_eq!(document.path, crate::fs_util::path_text(&path));
        assert_eq!(document.encoding, Encoding::Utf8);
        assert_eq!(document.legacy_encoding, None);
        assert!(!document.lossy && !document.read_only && !document.mixed_line_endings);
        assert_eq!(document.line_ending, LineEnding::Lf);
        assert_eq!(result.stamp.size, document.bytes);
        assert_eq!(result.stamp.modified_ms, document.modified_ms);
        assert!(document.modified_ms > 0);
    }

    #[test]
    fn an_empty_file_is_empty_lf_utf8() {
        let dir = TempDir::new();

        let document = read(&dir, b"");

        assert_eq!(document.text, "");
        assert_eq!(document.bytes, 0);
        assert_eq!(document.line_ending, LineEnding::Lf);
        assert_eq!(document.encoding, Encoding::Utf8);
    }

    #[test]
    fn crlf_is_normalized_and_remembered() {
        let dir = TempDir::new();

        let document = read(&dir, b"a\r\nb\r\n");

        assert_eq!(document.text, "a\nb\n");
        assert_eq!(document.line_ending, LineEnding::Crlf);
        assert!(!document.mixed_line_endings);
        assert_eq!(document.bytes, 6, "the size is the size on disk");
    }

    #[test]
    fn a_mixed_file_reports_the_majority_and_the_mix() {
        let dir = TempDir::new();

        let document = read(&dir, b"1\n2\n3\r\n4\n");

        assert_eq!(document.line_ending, LineEnding::Lf);
        assert!(document.mixed_line_endings);
    }

    #[test]
    fn the_byte_order_mark_is_removed_from_the_text_but_counted_in_the_size() {
        let dir = TempDir::new();

        let document = read(&dir, b"\xEF\xBB\xBF# Heading");

        assert_eq!(document.text, "# Heading");
        assert_eq!(document.encoding, Encoding::Utf8Bom);
        assert_eq!(document.bytes, 12);
    }

    #[test]
    fn a_legacy_file_reports_its_encoding_and_is_saved_as_utf8() {
        let dir = TempDir::new();

        let document = read(&dir, b"caf\xE9 au lait\n");

        assert_eq!(document.text, "café au lait\n");
        assert_eq!(document.encoding, Encoding::Utf8);
        assert_eq!(document.legacy_encoding.as_deref(), Some("windows-1252"));
        assert!(!document.lossy);
    }

    #[test]
    fn undecodable_bytes_set_the_lossy_flag() {
        let dir = TempDir::new();

        let document = read(&dir, b"\xEF\xBB\xBFbad \xFF byte");

        assert!(document.lossy);
        assert!(document.text.contains('\u{fffd}'));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_without_write_permission_is_read_only() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).expect("chmod");

        let document = read_document(&path).expect("reads").document;

        assert!(document.read_only);
        assert_eq!(document.text, "x");
    }

    #[test]
    fn a_file_at_the_limit_is_read_and_one_byte_more_is_refused() {
        let dir = TempDir::new();
        let at_limit = dir.write("at.md", &[b'a'; 10]);
        let over = dir.write("over.md", &[b'a'; 11]);

        assert!(read_document_with_limit(&at_limit, 10).is_ok());
        let error = read_document_with_limit(&over, 10).expect_err("too large");
        assert_eq!(error.code, ErrorCode::TooLarge);
        assert_eq!(
            error.message,
            "The file is larger than 10 bytes, which Backtickle does not open."
        );
    }

    #[test]
    fn the_limit_is_50_megabytes_and_is_named_in_the_message() {
        assert_eq!(MAX_DOCUMENT_BYTES, 50 * 1024 * 1024);
        let dir = TempDir::new();
        let over = dir.write("over.md", &[b'a'; 2 * 1024 * 1024 + 1]);

        let error = read_document_with_limit(&over, 2 * 1024 * 1024).expect_err("too large");

        assert_eq!(error.code, ErrorCode::TooLarge);
        assert_eq!(
            error.message,
            "The file is larger than 2 MB, which Backtickle does not open."
        );
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let dir = TempDir::new();

        let error = read_document(&dir.path().join("nope.md")).expect_err("missing");

        assert_eq!(error.code, ErrorCode::NotFound);
    }

    #[test]
    fn a_folder_is_not_a_document() {
        let dir = TempDir::new();

        let error = read_document(dir.path()).expect_err("folder");

        assert_eq!(error.code, ErrorCode::Io);
        assert_eq!(error.message, "This is not a file.");
    }

    #[cfg(unix)]
    #[test]
    fn a_named_pipe_is_refused_without_opening_it() {
        let dir = TempDir::new();
        let path = dir.path().join("pipe.md");
        let c_path = std::ffi::CString::new(path.to_str().expect("utf8")).expect("c string");
        // SAFETY: the path is a valid C string.
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);

        let error = read_document(&path).expect_err("not a regular file");

        assert_eq!(error.message, "This is not a file.");
    }

    #[test]
    fn a_document_serializes_with_the_names_of_the_frontend_type() {
        let dir = TempDir::new();
        let path = dir.write("a.md", b"x\r\n");

        let json = serde_json::to_value(read_document(&path).expect("reads").document)
            .expect("serializes");

        let object = json.as_object().expect("object");
        let keys: BTreeSet<&str> = object.keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> = [
            "bytes",
            "encoding",
            "lossy",
            "legacyEncoding",
            "lineEnding",
            "mixedLineEndings",
            "modifiedMs",
            "path",
            "readOnly",
            "text",
        ]
        .into_iter()
        .collect();
        assert_eq!(keys, expected);
        assert_eq!(json["encoding"], "utf-8");
        assert_eq!(json["lineEnding"], "crlf");
        assert_eq!(json["legacyEncoding"], serde_json::Value::Null);
        assert_eq!(json["text"], "x\n");
    }
}
