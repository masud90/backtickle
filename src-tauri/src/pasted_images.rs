//! Images pasted or dropped into the editor.
//!
//! A pasted image (a screenshot, an image copied in another app) arrives as bytes. Rust checks
//! that they are a PNG, JPEG, GIF or WebP image by their first bytes, makes up a free name and
//! writes them into the `assets` folder next to the document, creating that folder if needed.
//!
//! A dropped image arrives as a path from the window's drop event (`lifecycle.rs`), never from
//! the page: the drop remembers it in `DroppedImages`, and only a remembered path may be
//! imported. An image that is already in the document's folder (or below it) is linked where it
//! is; any other is copied into `assets`.
//!
//! Either way the answer is the `src` to put in the Markdown, relative to the document and
//! percent-encoded where Markdown needs it. The page never names the file that is written.

use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::file_types::{self, MAX_IMAGE_BYTES};
use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// The event that tells a window which images were dropped on it and where.
pub const DROP_IMAGES_EVENT: &str = "drop-images";

/// The folder next to the document that receives pasted and copied images.
pub const IMAGE_FOLDER: &str = "assets";

/// How many numbered names (`name-2`, `name-3`, ...) are tried before giving up.
const MAX_NAME_TRIES: u32 = 1000;

/// The images dropped on a window in this session: the only paths `import_image` accepts.
#[derive(Default)]
pub struct DroppedImages {
    paths: Mutex<HashSet<PathBuf>>,
}

impl DroppedImages {
    /// Remembers the image files among `paths` (canonical) and returns them; other paths are
    /// left out.
    pub fn accept(&self, paths: &[PathBuf]) -> Vec<PathBuf> {
        let mut accepted = Vec::new();
        let mut set = self.paths.lock().unwrap_or_else(PoisonError::into_inner);
        for path in paths {
            let Ok(canonical) = std::fs::canonicalize(path) else {
                continue;
            };
            if !canonical.is_file() || !file_types::is_image_path(&canonical) {
                continue;
            }
            set.insert(canonical.clone());
            if !accepted.contains(&canonical) {
                accepted.push(canonical);
            }
        }
        accepted
    }

    /// The canonical path if it was dropped in this session.
    pub fn check(&self, path: &Path) -> PlatformResult<PathBuf> {
        let set = self.paths.lock().unwrap_or_else(PoisonError::into_inner);
        if !set.contains(path) {
            return Err(PlatformError::not_allowed());
        }
        drop(set);
        match std::fs::canonicalize(path) {
            Ok(canonical) if canonical == path => Ok(canonical),
            Ok(_) => Err(PlatformError::not_allowed()),
            Err(error) => Err(PlatformError::from_read(&error)),
        }
    }
}

/// The image format of `bytes`, as a file extension, judged by the first bytes.
pub fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn not_an_image() -> PlatformError {
    PlatformError::new(
        ErrorCode::NotAllowed,
        "Only PNG, JPEG, GIF and WebP images can be pasted.",
    )
}

fn too_large() -> PlatformError {
    PlatformError::new(ErrorCode::TooLarge, "This image is larger than 50 MB.")
}

/// The folder of the document (canonical).
fn document_folder(doc: &Path) -> PlatformResult<PathBuf> {
    doc.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| PlatformError::io("The document has no folder."))
}

/// The `assets` folder next to the document, created if it is missing.
fn image_folder(doc: &Path) -> PlatformResult<PathBuf> {
    let folder = document_folder(doc)?.join(IMAGE_FOLDER);
    match std::fs::create_dir(&folder) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(PlatformError::from_write(&error)),
    }
    if !folder.is_dir() {
        return Err(PlatformError::io(
            "There is a file named \u{201c}assets\u{201d} next to the document, so the image has nowhere to go.",
        ));
    }
    Ok(folder)
}

/// Keeps letters, digits, `-`, `_` and `.` of a file stem; anything else becomes `-`. Never
/// empty and never starts with a dot.
pub fn clean_stem(stem: &str) -> String {
    let mut cleaned = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_alphanumeric() || matches!(character, '-' | '_' | '.') {
            cleaned.push(character);
        } else if !cleaned.ends_with('-') {
            cleaned.push('-');
        }
    }
    let trimmed = cleaned.trim_matches(|c| c == '-' || c == '.');
    let short: String = trimmed.chars().take(80).collect();
    if short.is_empty() {
        "image".to_owned()
    } else {
        short
    }
}

/// Creates `stem.ext` in `folder`, or `stem-2.ext`, `stem-3.ext`, ... if the name is taken.
/// Nothing that exists is ever replaced.
fn create_free(folder: &Path, stem: &str, extension: &str) -> PlatformResult<(File, PathBuf)> {
    for number in 1..=MAX_NAME_TRIES {
        let name = if number == 1 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{number}.{extension}")
        };
        let path = folder.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(PlatformError::from_write(&error)),
        }
    }
    Err(PlatformError::io("There is no free name for the image."))
}

fn write_all(mut file: File, path: &Path, bytes: &[u8]) -> PlatformResult<()> {
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(error) = result {
        let _ = std::fs::remove_file(path);
        return Err(PlatformError::from_write(&error));
    }
    Ok(())
}

/// Writes pasted image bytes into the document's `assets` folder under a name made from `stem`
/// and returns the Markdown `src`.
pub fn save_pasted(doc: &Path, bytes: &[u8], stem: &str) -> PlatformResult<String> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    let extension = sniff_extension(bytes).ok_or_else(not_an_image)?;
    let folder = image_folder(doc)?;
    let (file, path) = create_free(&folder, &clean_stem(stem), extension)?;
    write_all(file, &path, bytes)?;
    markdown_src(doc, &path)
}

/// Links a dropped image: one inside the document's folder is linked where it is, any other is
/// copied into `assets` (under its own name, numbered if taken). Returns the Markdown `src`.
pub fn import_dropped(doc: &Path, source: &Path) -> PlatformResult<String> {
    let folder = document_folder(doc)?;
    if source.starts_with(&folder) {
        return markdown_src(doc, source);
    }
    let metadata = std::fs::metadata(source).map_err(|e| PlatformError::from_read(&e))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err(too_large());
    }
    let extension = file_types::extension_lower(source).ok_or_else(not_an_image)?;
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = std::fs::read(source).map_err(|e| PlatformError::from_read(&e))?;
    let target_folder = image_folder(doc)?;
    let (file, path) = create_free(&target_folder, &clean_stem(&stem), &extension)?;
    write_all(file, &path, &bytes)?;
    markdown_src(doc, &path)
}

/// The path of `image` relative to the document's folder, with `/` between the parts and the
/// characters that would end or confuse a Markdown link destination percent-encoded.
pub fn markdown_src(doc: &Path, image: &Path) -> PlatformResult<String> {
    let folder = document_folder(doc)?;
    let relative = image
        .strip_prefix(&folder)
        .map_err(|_| PlatformError::io("The image is not in the document's folder."))?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(encode_part(&part.to_string_lossy())),
            _ => {
                return Err(PlatformError::io(
                    "The image is not in the document's folder.",
                ));
            }
        }
    }
    Ok(parts.join("/"))
}

fn encode_part(part: &str) -> String {
    let mut encoded = String::with_capacity(part.len());
    for character in part.chars() {
        match character {
            ' ' | '(' | ')' | '<' | '>' | '[' | ']' | '#' | '?' | '%' | '\\' | '"' | '\'' => {
                for byte in character.to_string().bytes() {
                    encoded.push_str(&format!("%{byte:02X}"));
                }
            }
            _ => encoded.push(character),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn the_format_is_judged_by_the_first_bytes() {
        assert_eq!(sniff_extension(PNG), Some("png"));
        assert_eq!(sniff_extension(b"\xff\xd8\xff\xe0rest"), Some("jpg"));
        assert_eq!(sniff_extension(b"GIF89a..."), Some("gif"));
        assert_eq!(sniff_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_extension(b"<svg xmlns="), None);
        assert_eq!(sniff_extension(b""), None);
    }

    #[test]
    fn a_pasted_image_goes_into_assets_under_a_free_name() {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"# Doc");

        let first = save_pasted(&doc, PNG, "image-20261016-183000").expect("saves");
        let second = save_pasted(&doc, PNG, "image-20261016-183000").expect("saves");

        assert_eq!(first, "assets/image-20261016-183000.png");
        assert_eq!(second, "assets/image-20261016-183000-2.png");
        assert_eq!(
            std::fs::read(dir.path().join("assets/image-20261016-183000.png")).expect("written"),
            PNG
        );
    }

    #[test]
    fn bytes_that_are_not_an_image_are_refused_and_nothing_is_written() {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"# Doc");

        let error = save_pasted(&doc, b"<script>alert(1)</script>", "x").unwrap_err();

        assert_eq!(error.code, ErrorCode::NotAllowed);
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn a_file_named_assets_is_not_replaced() {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"# Doc");
        dir.write("assets", b"keep me");

        assert!(save_pasted(&doc, PNG, "x").is_err());
        assert_eq!(
            std::fs::read(dir.path().join("assets")).expect("kept"),
            b"keep me"
        );
    }

    #[test]
    fn the_stem_cannot_leave_the_folder_or_hide_the_file() {
        assert_eq!(clean_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(clean_stem(".hidden"), "hidden");
        assert_eq!(
            clean_stem("Screen Shot 2026-10-16 at 18.30.00"),
            "Screen-Shot-2026-10-16-at-18.30.00"
        );
        assert_eq!(clean_stem("///"), "image");
        assert_eq!(clean_stem("Fotoğraf"), "Fotoğraf");
    }

    #[test]
    fn a_dropped_image_inside_the_folder_is_linked_where_it_is() {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"# Doc");
        std::fs::create_dir(dir.path().join("pics")).expect("folder");
        let image = dir.write("pics/my photo (1).png", PNG);

        assert_eq!(
            import_dropped(&doc, &image).expect("links"),
            "pics/my%20photo%20%281%29.png"
        );
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn a_dropped_image_from_elsewhere_is_copied_into_assets() {
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join("notes")).expect("folder");
        let doc = dir.write("notes/doc.md", b"# Doc");
        let image = dir.write("Shot 1.png", PNG);

        let src = import_dropped(&doc, &image).expect("copies");

        assert_eq!(src, "assets/Shot-1.png");
        assert_eq!(
            std::fs::read(dir.path().join("notes/assets/Shot-1.png")).expect("copied"),
            PNG
        );
        assert!(image.exists(), "the original stays");
    }

    #[test]
    fn only_dropped_images_are_remembered() {
        let dir = TempDir::new();
        let image = dir.write("a.png", PNG);
        let text = dir.write("b.md", b"# B");
        let dropped = DroppedImages::default();

        let accepted = dropped.accept(&[image.clone(), text.clone()]);

        assert_eq!(accepted, vec![image.clone()]);
        assert_eq!(dropped.check(&image), Ok(image));
        assert!(dropped.check(&text).is_err());
    }
}
