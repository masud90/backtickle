//! Which files Backtickle treats as documents and as images, by extension (case-insensitive).
//!
//! These lists decide what the dialogs offer, what Finder and drag and drop may open, what a
//! link may open as a document and what the asset protocol may serve.

use std::path::Path;

/// The Markdown family: the extensions Backtickle can become the default app for.
pub const MARKDOWN_EXTENSIONS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "mkdn"];

/// Every extension that opens as a document: Markdown, MDX, Quarto, R Markdown, MultiMarkdown
/// or Pandoc, and plain text.
pub const DOCUMENT_EXTENSIONS: [&str; 10] = [
    "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "qmd", "rmd", "mmd", "txt",
];

/// Images that may be shown in the preview, one file at a time.
pub const IMAGE_EXTENSIONS: [&str; 12] = [
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "tif", "tiff", "heic",
];

/// The largest image the asset protocol is given.
pub const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

/// The lower-case extension of the last path component, if it has one.
pub fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
}

fn has_extension_in(path: &Path, list: &[&str]) -> bool {
    extension_lower(path).is_some_and(|extension| list.contains(&extension.as_str()))
}

/// True for the extensions in `DOCUMENT_EXTENSIONS`.
pub fn is_document_path(path: &Path) -> bool {
    has_extension_in(path, &DOCUMENT_EXTENSIONS)
}

/// True for the extensions in `MARKDOWN_EXTENSIONS`.
pub fn is_markdown_path(path: &Path) -> bool {
    has_extension_in(path, &MARKDOWN_EXTENSIONS)
}

/// True for the extensions in `IMAGE_EXTENSIONS`.
pub fn is_image_path(path: &Path) -> bool {
    has_extension_in(path, &IMAGE_EXTENSIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_are_recognized_in_any_letter_case() {
        for name in [
            "a.md",
            "a.MD",
            "a.markdown",
            "a.mdown",
            "a.mkd",
            "a.mkdn",
            "a.mdx",
            "a.qmd",
            "a.Rmd",
            "a.rmd",
            "a.mmd",
            "a.txt",
            "a.TXT",
            "dir.v2/a.Md",
        ] {
            assert!(is_document_path(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn other_files_are_not_documents() {
        for name in [
            "a",
            "a.pdf",
            "a.docx",
            "a.sh",
            "a.app",
            "a.command",
            "a.md.bak",
            ".md",
            "md",
            "a.html",
        ] {
            assert!(!is_document_path(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn the_markdown_family_is_the_five_extensions_of_the_plan() {
        for name in ["a.md", "a.markdown", "a.mdown", "a.mkd", "a.MKDN"] {
            assert!(is_markdown_path(Path::new(name)), "{name}");
        }
        for name in ["a.mdx", "a.qmd", "a.rmd", "a.mmd", "a.txt"] {
            assert!(!is_markdown_path(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn images_are_recognized_by_the_twelve_extensions() {
        for extension in IMAGE_EXTENSIONS {
            assert!(is_image_path(Path::new(&format!("x.{extension}"))));
            assert!(is_image_path(Path::new(&format!(
                "x.{}",
                extension.to_ascii_uppercase()
            ))));
        }
        for name in ["x.pdf", "x.md", "x", "x.png.exe", "x.psd", "x.svgz"] {
            assert!(!is_image_path(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn a_dot_file_without_an_extension_has_no_extension() {
        assert_eq!(extension_lower(Path::new(".md")), None);
        assert_eq!(extension_lower(Path::new("a.MD")).as_deref(), Some("md"));
    }
}
