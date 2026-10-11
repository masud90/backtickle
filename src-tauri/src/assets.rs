//! Images shown in the preview (Images).
//!
//! The preview asks for the URL of a local image (`resolve_image`). Rust resolves the `src`
//! against the folder of the granted document exactly like a link (see `links.rs`), checks the
//! extension (`png jpg jpeg gif webp svg avif bmp ico tif tiff heic`) and the size (at most
//! 50 MB) of the resolved file, and allows that one file in the asset protocol scope. The
//! scope in `tauri.conf.json` is empty, so no image is reachable before this call and no
//! other file becomes reachable through it.

use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::file_types::{self, MAX_IMAGE_BYTES};
use crate::links;
use crate::vault;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use std::path::{Path, PathBuf};

/// The characters JavaScript's `encodeURIComponent` leaves alone. The asset protocol decodes
/// its path with the same rules, and `convertFileSrc` of the Tauri API encodes this way.
const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Resolves the `src` of an image in the document at `doc` to the canonical path of an image
/// file of at most 50 MB.
pub fn resolve_image(doc: &Path, src: &str) -> PlatformResult<PathBuf> {
    resolve_image_with_limit(doc, src, MAX_IMAGE_BYTES)
}

/// As `resolve_image`, with the size limit given. An image that is not found next to the
/// document may also be named by a path relative to the root of the Obsidian vault that holds
/// the document, as the vault index lists it; it must then be inside that vault.
pub fn resolve_image_with_limit(doc: &Path, src: &str, limit: u64) -> PlatformResult<PathBuf> {
    match links::resolve(doc, src) {
        Ok(canonical) => check_image(canonical, limit),
        Err(error) if error.code == ErrorCode::NotFound => {
            resolve_in_vault(doc, src, limit).unwrap_or(Err(error))
        }
        Err(error) => Err(error),
    }
}

/// The vault-relative reading of `src`: `None` if the document is in no vault or the file is
/// not found there either (the caller then reports the first error).
fn resolve_in_vault(doc: &Path, src: &str, limit: u64) -> Option<PlatformResult<PathBuf>> {
    let root = vault::vault_root(doc)?;
    let canonical = links::resolve_in_folder(&root, src).ok()?;
    // The target must really be inside the vault: `../` and symbolic links cannot leave it.
    if !canonical.starts_with(&root) {
        return Some(Err(PlatformError::new(
            ErrorCode::NotAllowed,
            "Only image files can be shown in the preview.",
        )));
    }
    Some(check_image(canonical, limit))
}

fn check_image(canonical: PathBuf, limit: u64) -> PlatformResult<PathBuf> {
    let metadata = std::fs::metadata(&canonical).map_err(|e| PlatformError::from_read(&e))?;
    // The extension is judged on the resolved path: a link named `x.png` that points to some
    // other kind of file is not an image.
    if !metadata.is_file() || !file_types::is_image_path(&canonical) {
        return Err(PlatformError::new(
            ErrorCode::NotAllowed,
            "Only image files can be shown in the preview.",
        ));
    }
    if metadata.len() > limit {
        return Err(PlatformError::new(
            ErrorCode::TooLarge,
            "This image is too large to show in the preview.",
        ));
    }
    Ok(canonical)
}

/// The bytes of a local image for an export: resolved exactly like
/// `resolve_image`, with `max_bytes` as the limit (`TooLarge` over it).
pub fn read_image_bytes(doc: &Path, src: &str, max_bytes: u64) -> PlatformResult<Vec<u8>> {
    let image = resolve_image_with_limit(doc, src, max_bytes.min(MAX_IMAGE_BYTES))?;
    std::fs::read(&image).map_err(|e| PlatformError::from_read(&e))
}

/// The URL the web view loads an allowed file from: the asset protocol with the whole path as
/// one encoded component, as `convertFileSrc` makes it.
pub fn asset_url(path: &Path) -> String {
    let text = path.to_string_lossy();
    let encoded = utf8_percent_encode(&text, URI_COMPONENT);
    #[cfg(windows)]
    return format!("http://asset.localhost/{encoded}");
    #[cfg(not(windows))]
    format!("asset://localhost/{encoded}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::os::unix::fs::symlink;

    /// A folder with `doc.md` and an image next to it.
    fn workspace() -> (TempDir, PathBuf) {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"![x](pic.png)");
        dir.write("pic.png", b"\x89PNG fake");
        (dir, doc)
    }

    #[test]
    fn r04_a_relative_image_resolves_next_to_the_document() {
        let (dir, doc) = workspace();

        assert_eq!(
            resolve_image(&doc, "pic.png").expect("resolves"),
            dir.path().join("pic.png")
        );
    }

    #[test]
    fn r04_every_image_extension_is_accepted_in_any_letter_case() {
        let (dir, doc) = workspace();
        for extension in file_types::IMAGE_EXTENSIONS {
            for name in [
                format!("a.{extension}"),
                format!("b.{}", extension.to_ascii_uppercase()),
            ] {
                dir.write(&name, b"x");
                assert!(resolve_image(&doc, &name).is_ok(), "{name}");
            }
        }
    }

    #[test]
    fn r04_the_same_resolution_rules_as_links_apply() {
        let (dir, doc) = workspace();
        std::fs::create_dir(dir.path().join("images")).expect("mkdir");
        std::fs::write(dir.path().join("images").join("my pic é.jpg"), b"x").expect("write");
        let expected = dir.path().join("pic.png");

        assert_eq!(
            resolve_image(&doc, "pic.png?raw=true#frag").expect("query"),
            expected
        );
        assert_eq!(
            resolve_image(&doc, "images/../pic.png").expect("up"),
            expected
        );
        assert_eq!(
            resolve_image(&doc, "images/my%20pic%20%C3%A9.jpg").expect("encoded"),
            dir.path().join("images").join("my pic é.jpg")
        );
        assert_eq!(
            resolve_image(&doc, &format!("file://{}", expected.to_string_lossy()))
                .expect("file url"),
            expected
        );
    }

    #[test]
    fn r04_the_fixture_image_resolves() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("links");
        let index = std::fs::canonicalize(root.join("index.md")).expect("fixture exists");

        let image = resolve_image(&index, "images/sample.png").expect("resolves");

        assert!(image.ends_with("images/sample.png"));
    }

    #[test]
    fn r04_a_missing_image_is_not_found() {
        let (_dir, doc) = workspace();

        assert_eq!(
            resolve_image(&doc, "missing.png")
                .expect_err("missing")
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn r04_files_that_are_not_images_are_refused() {
        let (dir, doc) = workspace();
        for name in [
            "note.md",
            "data.json",
            "script.sh",
            "photo.psd",
            "archive.zip",
            "noextension",
        ] {
            dir.write(name, b"x");

            assert_eq!(
                resolve_image(&doc, name).expect_err(name).code,
                ErrorCode::NotAllowed,
                "{name}"
            );
        }
    }

    #[test]
    fn r04_a_folder_named_like_an_image_is_refused() {
        let (dir, doc) = workspace();
        std::fs::create_dir(dir.path().join("folder.png")).expect("mkdir");

        assert_eq!(
            resolve_image(&doc, "folder.png").expect_err("folder").code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn r04_a_link_named_like_an_image_that_points_to_another_kind_of_file_is_refused() {
        let (dir, doc) = workspace();
        symlink("/etc/hosts", dir.path().join("sneaky.png")).expect("symlink");
        symlink(dir.path().join("pic.png"), dir.path().join("alias.gif")).expect("symlink");

        assert_eq!(
            resolve_image(&doc, "sneaky.png")
                .expect_err("not an image")
                .code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            resolve_image(&doc, "alias.gif").expect("the target is an image"),
            dir.path().join("pic.png")
        );
    }

    #[test]
    fn r04_a_climb_out_to_a_system_file_is_refused() {
        let (_dir, doc) = workspace();
        let climb = "../".repeat(40);

        assert_eq!(
            resolve_image(&doc, &format!("{climb}etc/hosts"))
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn r04_remote_and_data_sources_are_not_local_images() {
        let (_dir, doc) = workspace();

        for src in [
            "https://example.org/pic.png",
            "http://example.org/pic.png",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
        ] {
            assert_eq!(
                resolve_image(&doc, src).expect_err(src).code,
                ErrorCode::NotAllowed,
                "{src}"
            );
        }
    }

    #[test]
    fn r04_an_image_over_the_limit_is_too_large() {
        let (dir, doc) = workspace();
        dir.write("big.png", &[0u8; 11]);

        let at_limit = resolve_image_with_limit(&doc, "big.png", 11);
        let over = resolve_image_with_limit(&doc, "big.png", 10);

        assert!(at_limit.is_ok());
        assert_eq!(over.expect_err("too large").code, ErrorCode::TooLarge);
        assert_eq!(MAX_IMAGE_BYTES, 50 * 1024 * 1024);
    }

    #[test]
    fn read_image_bytes_returns_the_file_and_refuses_too_large_and_non_images() {
        let (dir, doc) = workspace();
        dir.write("small.png", &[1u8, 2, 3]);
        dir.write("notes.txt", b"text");

        assert_eq!(
            read_image_bytes(&doc, "small.png", 3).expect("read"),
            vec![1, 2, 3]
        );
        assert_eq!(
            read_image_bytes(&doc, "small.png", 2)
                .expect_err("over")
                .code,
            ErrorCode::TooLarge
        );
        assert_eq!(
            read_image_bytes(&doc, "notes.txt", 10)
                .expect_err("not an image")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn the_asset_url_encodes_the_whole_path_as_one_component() {
        assert_eq!(
            asset_url(Path::new("/Users/alex/My Notes/pic (1).png")),
            "asset://localhost/%2FUsers%2Falex%2FMy%20Notes%2Fpic%20(1).png"
        );
    }

    #[test]
    fn the_asset_url_encodes_non_ascii_and_reserved_characters_like_encode_uri_component() {
        assert_eq!(
            asset_url(Path::new("/a/é 快#?&=+%.png")),
            "asset://localhost/%2Fa%2F%C3%A9%20%E5%BF%AB%23%3F%26%3D%2B%25.png"
        );
        assert_eq!(
            asset_url(Path::new("/a-b_c.d!e~f*g'h.png")),
            "asset://localhost/%2Fa-b_c.d!e~f*g'h.png"
        );
    }

    #[test]
    fn the_asset_url_decodes_back_to_the_path_the_protocol_serves() {
        let path = Path::new("/Users/alex/Notes é/pic #1 (final).png");
        let url = asset_url(path);

        let tail = url.strip_prefix("asset://localhost/").expect("prefix");
        let decoded = percent_encoding::percent_decode_str(tail)
            .decode_utf8()
            .expect("utf8");

        assert_eq!(decoded, path.to_string_lossy());
    }

    // ---- vault-relative images ----------------------------------------------------

    fn vault_fixture() -> PathBuf {
        std::fs::canonicalize(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("tests")
                .join("fixtures")
                .join("flavors")
                .join("obsidian")
                .join("vault"),
        )
        .expect("fixture vault exists")
    }

    #[test]
    fn a_vault_relative_image_resolves_from_a_note_in_a_sub_folder() {
        let vault = vault_fixture();
        let note = vault.join("Notes").join("Note A.md");

        assert_eq!(
            resolve_image(&note, "attachments/diagram.png").expect("resolves"),
            vault.join("attachments").join("diagram.png")
        );
        assert_eq!(
            resolve_image(&vault.join("Home.md"), "attachments/diagram.png").expect("resolves"),
            vault.join("attachments").join("diagram.png")
        );
    }

    #[test]
    fn a_path_next_to_the_note_still_wins_over_the_vault_root() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("sub")).expect("mkdir");
        std::fs::write(dir.path().join("pic.png"), b"root").expect("write");
        std::fs::write(dir.path().join("sub").join("pic.png"), b"near").expect("write");
        let note = dir.write("sub/n.md", b"x");

        assert_eq!(
            resolve_image(&note, "pic.png").expect("resolves"),
            dir.path().join("sub").join("pic.png")
        );
    }

    #[test]
    fn the_vault_reading_keeps_every_other_check() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("sub")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("assets")).expect("mkdir");
        let note = dir.write("sub/n.md", b"x");
        dir.write("assets/big.png", &[0u8; 11]);
        dir.write("assets/note.md", b"x");
        std::fs::create_dir(dir.path().join("assets").join("folder.png")).expect("mkdir");
        symlink("/etc/hosts", dir.path().join("assets").join("sneaky.png")).expect("symlink");

        assert_eq!(
            resolve_image_with_limit(&note, "assets/big.png", 10)
                .expect_err("too large")
                .code,
            ErrorCode::TooLarge
        );
        for name in ["assets/note.md", "assets/folder.png", "assets/sneaky.png"] {
            assert_eq!(
                resolve_image(&note, name).expect_err(name).code,
                ErrorCode::NotAllowed,
                "{name}"
            );
        }
        assert_eq!(
            resolve_image(&note, "assets/missing.png")
                .expect_err("missing")
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn the_vault_reading_cannot_leave_the_vault() {
        let outside = TempDir::new();
        outside.write("secret.png", b"x");
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join(".obsidian")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("sub")).expect("mkdir");
        let note = dir.write("sub/n.md", b"x");
        symlink(outside.path(), dir.path().join("linked")).expect("symlink");

        // Through a link inside the vault.
        let through_link = resolve_image(&note, "linked/secret.png").expect_err("refused");
        // Up and out: relative to the root this reaches the folder above the vault.
        let climb = format!(
            "../{}/secret.png",
            outside.path().file_name().expect("name").to_string_lossy()
        );
        let up = resolve_image(&note, &climb);

        assert_eq!(through_link.code, ErrorCode::NotAllowed);
        assert!(up.is_err());
    }

    #[test]
    fn a_document_outside_a_vault_gets_no_vault_reading() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join("sub")).expect("mkdir");
        std::fs::create_dir_all(dir.path().join("assets")).expect("mkdir");
        dir.write("assets/pic.png", b"x");
        let note = dir.write("sub/n.md", b"x");

        assert_eq!(
            resolve_image(&note, "assets/pic.png")
                .expect_err("no vault")
                .code,
            ErrorCode::NotFound
        );
    }
}
