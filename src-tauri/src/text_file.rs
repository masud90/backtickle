//! Reading a text file for the editor.
//!
//! Spike scope: UTF-8 only. Bytes that are not valid UTF-8 are replaced and a leading byte order
//! mark is dropped. Phase 1 does encodings, line endings and safe saving properly.

use serde::Serialize;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// Larger files are refused.
pub const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;

const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// The answer to `read_text_file`. The field names are the ones `TextFile` has in
/// `src/lib/platform.ts`.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TextFile {
    /// The path that was read.
    pub path: String,
    pub text: String,
    /// Size of the file in bytes.
    pub bytes: u64,
}

/// A message for the user. It never repeats anything from the file or the operating system's
/// own wording.
pub fn describe_io_error(error: &io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "File not found.".to_string(),
        io::ErrorKind::PermissionDenied => {
            "The file cannot be read (permission denied).".to_string()
        }
        _ => "The file could not be read.".to_string(),
    }
}

fn too_large_message(limit: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if limit.is_multiple_of(MB) {
        format!("File is larger than {} MB.", limit / MB)
    } else {
        format!("File is larger than {limit} bytes.")
    }
}

/// Reads `path` as text. Refuses anything that is not a regular file and files above `limit`.
pub fn read_text_file_with_limit(path: &Path, limit: u64) -> Result<TextFile, String> {
    let file = File::open(path).map_err(|e| describe_io_error(&e))?;
    let metadata = file.metadata().map_err(|e| describe_io_error(&e))?;
    if !metadata.is_file() {
        return Err("The chosen item is not a file.".to_string());
    }
    if metadata.len() > limit {
        return Err(too_large_message(limit));
    }

    // One byte more than the limit, so a file that grew since the check is caught too.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| describe_io_error(&e))?;
    if bytes.len() as u64 > limit {
        return Err(too_large_message(limit));
    }

    let size = bytes.len() as u64;
    if bytes.starts_with(&UTF8_BOM) {
        bytes.drain(..UTF8_BOM.len());
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
    };

    Ok(TextFile {
        path: crate::fs_util::path_text(path),
        text,
        bytes: size,
    })
}

/// Reads `path` with the standard 50 MB limit.
pub fn read_text_file(path: &Path) -> Result<TextFile, String> {
    read_text_file_with_limit(path, MAX_TEXT_FILE_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn reads_utf8_text_with_its_size_and_path() {
        let dir = TempDir::new();
        let path = dir.write("a.md", "# Titel\n\nhéllo €\n".as_bytes());

        let file = read_text_file(&path).expect("reads");

        assert_eq!(file.text, "# Titel\n\nhéllo €\n");
        assert_eq!(file.bytes, "# Titel\n\nhéllo €\n".len() as u64);
        assert_eq!(file.path, path.to_string_lossy());
    }

    #[test]
    fn an_empty_file_is_an_empty_text() {
        let dir = TempDir::new();
        let path = dir.write("empty.md", b"");

        let file = read_text_file(&path).expect("reads");

        assert_eq!(file.text, "");
        assert_eq!(file.bytes, 0);
    }

    #[test]
    fn invalid_utf8_is_replaced_not_rejected() {
        let dir = TempDir::new();
        let path = dir.write("latin1.md", b"caf\xe9 au lait");

        let file = read_text_file(&path).expect("reads");

        assert_eq!(file.text, "caf\u{fffd} au lait");
        assert_eq!(file.bytes, 12);
    }

    #[test]
    fn a_leading_byte_order_mark_is_dropped_from_the_text_but_counted_in_the_size() {
        let dir = TempDir::new();
        let path = dir.write("bom.md", b"\xef\xbb\xbf# Heading");

        let file = read_text_file(&path).expect("reads");

        assert_eq!(file.text, "# Heading");
        assert_eq!(file.bytes, 12);
    }

    #[test]
    fn a_file_at_the_limit_is_read_and_one_byte_more_is_refused() {
        let dir = TempDir::new();
        let at_limit = dir.write("at.md", &[b'a'; 10]);
        let over = dir.write("over.md", &[b'a'; 11]);

        assert!(read_text_file_with_limit(&at_limit, 10).is_ok());
        assert_eq!(
            read_text_file_with_limit(&over, 10),
            Err("File is larger than 10 bytes.".to_string())
        );
    }

    #[test]
    fn the_standard_limit_is_50_megabytes_and_is_named_in_the_message() {
        assert_eq!(MAX_TEXT_FILE_BYTES, 50 * 1024 * 1024);
        let dir = TempDir::new();
        let over = dir.write("over.md", &[b'a'; 2 * 1024 * 1024 + 1]);

        let error = read_text_file_with_limit(&over, 2 * 1024 * 1024).expect_err("too large");

        assert_eq!(error, "File is larger than 2 MB.");
    }

    #[test]
    fn a_missing_file_gets_a_plain_message() {
        let dir = TempDir::new();

        let error = read_text_file(&dir.path().join("nope.md")).expect_err("missing");

        assert_eq!(error, "File not found.");
    }

    #[test]
    fn a_folder_is_not_a_file() {
        let dir = TempDir::new();

        let error = read_text_file(dir.path()).expect_err("folder");

        assert_eq!(error, "The chosen item is not a file.");
    }
}
