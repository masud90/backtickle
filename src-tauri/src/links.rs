//! Links from a document to other things.
//!
//! - **External URLs**: only `http`, `https` and `mailto` are ever handed to the system.
//! - **Linked documents and files**: the `href` is resolved against the folder of the granted
//!   document, never trusted as written. A `#fragment` and a `?query` are cut off first, then
//!   the path is percent-decoded, joined to the folder and canonicalized (so `../` and symbolic
//!   links are resolved). The target must exist. To open as a document it must be a regular
//!   file with a Markdown, `mdx`, `qmd`, `rmd`, `mmd` or `txt` extension, judged on the
//!   resolved path. Anything else that exists may only be revealed in Finder. Absolute
//!   `file:` links follow the same rules. Nothing here ever launches a file.
//!
//! The fragment is returned to nobody: the frontend keeps it to scroll to the anchor.
//!
//! On Windows an `href` that names a network or device path itself (`\\server\share`,
//! `//server/share`, `\\?\...`, or a drive-relative `C:x`) is refused before the file system is
//! asked: looking it up would make Windows contact that server, and the app makes no network
//! requests of its own. A relative link in a document that the user opened from a share still
//! works, since it stays on the share the user chose.

use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::file_types;
use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};
use url::Url;

fn not_a_file_link() -> PlatformError {
    PlatformError::new(
        ErrorCode::NotAllowed,
        format!(
            "This link does not point to a file on this {}.",
            crate::os_text::COMPUTER
        ),
    )
}

/// True if a path written in a document may be looked up: on Windows only a plain relative path
/// or a drive path (`C:\x`, `C:/x`); never a network share, a device or a drive-relative path.
/// Everywhere else every path may.
pub fn href_path_is_local(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        match path.components().next() {
            Some(Component::Prefix(prefix)) => {
                matches!(prefix.kind(), Prefix::Disk(_)) && path.has_root()
            }
            _ => true,
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

fn target_not_found() -> PlatformError {
    PlatformError::new(
        ErrorCode::NotFound,
        "The linked file was not found. It may have been moved or deleted.",
    )
}

/// Checks that a web link may be opened by the system and returns it in its normalized form.
/// Only `http`, `https` (with a host) and `mailto` pass.
pub fn external_url(url: &str) -> PlatformResult<Url> {
    let refused = || {
        PlatformError::new(
            ErrorCode::NotAllowed,
            "Only web and email links can be opened from a document.",
        )
    };
    let parsed = Url::parse(url.trim()).map_err(|_| refused())?;
    match parsed.scheme() {
        "http" | "https" if parsed.host().is_some() => Ok(parsed),
        "mailto" => Ok(parsed),
        _ => Err(refused()),
    }
}

/// The scheme of `href` if it starts with one (`https:`, `file:`, `javascript:`).
fn scheme_of(href: &str) -> Option<&str> {
    let end = href.find(':')?;
    let scheme = &href[..end];
    // `C:\notes\a.md` or `C:/notes/a.md` on Windows: a drive letter, not a scheme.
    if cfg!(windows) && scheme.len() == 1 {
        return None;
    }
    let mut characters = scheme.chars();
    let starts_like_a_scheme = characters.next().is_some_and(|c| c.is_ascii_alphabetic());
    (starts_like_a_scheme
        && characters.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then_some(scheme)
}

/// The path an `href` points to, before the file system is consulted. `folder` is where a
/// relative `href` starts.
fn candidate_path(folder: Option<&Path>, href: &str) -> PlatformResult<PathBuf> {
    let href = href.trim();
    if let Some(scheme) = scheme_of(href) {
        if !scheme.eq_ignore_ascii_case("file") {
            return Err(not_a_file_link());
        }
        let url = Url::parse(href).map_err(|_| not_a_file_link())?;
        if !matches!(url.host_str(), None | Some("") | Some("localhost")) {
            return Err(not_a_file_link());
        }
        let path = url.to_file_path().map_err(|()| not_a_file_link())?;
        if !href_path_is_local(&path) {
            return Err(not_a_file_link());
        }
        return Ok(path);
    }

    let end = href.find(['#', '?']).unwrap_or(href.len());
    let raw = &href[..end];
    if raw.is_empty() {
        // "#anchor" or "?query": a link within the page, not to a file.
        return Err(target_not_found());
    }
    let decoded = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| target_not_found())?;
    if decoded.contains('\0') {
        return Err(target_not_found());
    }
    let path = Path::new(decoded.as_ref());
    if !href_path_is_local(path) {
        return Err(not_a_file_link());
    }
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    let folder = folder.ok_or_else(target_not_found)?;
    Ok(folder.join(path))
}

/// Resolves an `href` found in the document at `from` to the canonical path of an existing
/// file or folder. Fails with `not-found` if it does not exist and `not-allowed` if the link is
/// not a path (another scheme, a remote `file:` host).
pub fn resolve(from: &Path, href: &str) -> PlatformResult<PathBuf> {
    resolve_from_folder(from.parent(), href)
}

/// Like `resolve`, with the folder a relative `href` starts from given directly (a vault root
/// instead of the folder of the document).
pub fn resolve_in_folder(folder: &Path, href: &str) -> PlatformResult<PathBuf> {
    resolve_from_folder(Some(folder), href)
}

fn resolve_from_folder(folder: Option<&Path>, href: &str) -> PlatformResult<PathBuf> {
    let candidate = candidate_path(folder, href)?;
    crate::fs_util::canonicalize(&candidate).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => target_not_found(),
        _ => PlatformError::from_read(&error),
    })
}

/// Like `resolve`, and the target must be a document Writedown opens: a regular file with one
/// of the document extensions (judged on the resolved path, so a link named `x.md` that points
/// to something else does not count). Otherwise `not-markdown`.
pub fn resolve_document(from: &Path, href: &str) -> PlatformResult<PathBuf> {
    let canonical = resolve(from, href)?;
    let is_regular_file = std::fs::metadata(&canonical).is_ok_and(|metadata| metadata.is_file());
    if is_regular_file && file_types::is_document_path(&canonical) {
        Ok(canonical)
    } else {
        Err(PlatformError::new(
            ErrorCode::NotMarkdown,
            "This link points to something Writedown does not open as a document.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    #[cfg(unix)]
    use std::os::unix::fs::{PermissionsExt, symlink};

    /// A system file that exists, relative to the root of the drive the tests run on.
    #[cfg(windows)]
    const SYSTEM_FILE: &str = "Windows/System32/drivers/etc/hosts";
    #[cfg(not(windows))]
    const SYSTEM_FILE: &str = "etc/hosts";

    fn system_file() -> PathBuf {
        let root = if cfg!(windows) { "C:/" } else { "/" };
        crate::fs_util::canonicalize(Path::new(root).join(SYSTEM_FILE)).expect("system file")
    }

    fn file_url(path: &Path) -> String {
        Url::from_file_path(path).expect("absolute").to_string()
    }

    /// A folder with `index.md` (the document that holds the links) and a few neighbors.
    fn workspace() -> (TempDir, PathBuf) {
        let dir = TempDir::new();
        let index = dir.write("index.md", b"# Index");
        dir.write("second.md", b"# Second");
        dir.write("my notes.md", b"# Spaced");
        dir.write("café.md", b"# Accent");
        if cfg!(unix) {
            // Windows does not allow `?` in a name.
            dir.write("what?.md", b"# Question");
        }
        dir.write("a#b.md", b"# Hash");
        dir.write("plain.txt", b"text");
        dir.write("report.pdf", b"%PDF-1.4");
        std::fs::create_dir(dir.path().join("sub")).expect("mkdir");
        std::fs::write(dir.path().join("sub").join("deep.md"), b"# Deep").expect("write");
        (dir, index)
    }

    fn name_of(path: &Path) -> String {
        path.file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned()
    }

    // ---- external URLs -------------------------------------------------------------------

    #[test]
    fn r04_web_and_email_links_are_accepted() {
        for url in [
            "http://example.org",
            "https://example.org/path?q=1#frag",
            "HTTPS://EXAMPLE.ORG/",
            "mailto:someone@example.org",
            "mailto:someone@example.org?subject=Hello%20there",
            "  https://example.org/with-spaces-around  ",
            "https://xn--bcher-kva.example/",
        ] {
            assert!(external_url(url).is_ok(), "{url}");
        }
    }

    #[test]
    fn r04_the_accepted_url_is_returned_normalized() {
        assert_eq!(
            external_url("HTTPS://Example.ORG")
                .expect("accepted")
                .as_str(),
            "https://example.org/"
        );
        assert_eq!(
            external_url(" mailto:a@b.org ").expect("accepted").as_str(),
            "mailto:a@b.org"
        );
    }

    #[test]
    fn r04_every_other_scheme_is_refused() {
        for url in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "file:///etc/hosts",
            "data:text/html,<script>alert(1)</script>",
            "ftp://example.org/file",
            "tel:+254700000000",
            "sms:+254700000000",
            "vscode://file/etc/hosts",
            "x-apple.systempreferences:com.apple.preference.security",
            "app://localhost/index.html",
            "tauri://localhost",
            "ssh://example.org",
            "afp://example.org",
            "smb://example.org/share",
            "itms-apps://apps.apple.com",
            "blob:https://example.org/uuid",
        ] {
            let error = external_url(url).expect_err(url);
            assert_eq!(error.code, ErrorCode::NotAllowed, "{url}");
        }
    }

    #[test]
    fn r04_things_that_are_not_urls_are_refused() {
        for url in [
            "",
            "   ",
            "example.org",
            "//example.org",
            "/Applications/Calculator.app",
            "~/Documents/a.md",
            "-a Calculator",
            "--help",
            "http://",
            "http://exa mple.org",
            "\n",
        ] {
            assert_eq!(
                external_url(url).expect_err(url).code,
                ErrorCode::NotAllowed,
                "{url:?}"
            );
        }
    }

    #[test]
    fn a_url_with_a_line_break_cannot_smuggle_a_second_argument() {
        let url = external_url("https://example.org/\n--new-instance").expect("parses");

        assert!(!url.as_str().contains('\n'));
        assert!(url.as_str().starts_with("https://example.org/"));
    }

    // ---- linked documents ----------------------------------------------------------------

    #[test]
    fn r04_a_relative_link_resolves_next_to_the_document() {
        let (dir, index) = workspace();

        let target = resolve_document(&index, "second.md").expect("resolves");

        assert_eq!(target, dir.path().join("second.md"));
    }

    #[test]
    fn r04_a_fragment_and_a_query_are_cut_off() {
        let (dir, index) = workspace();
        let expected = dir.path().join("second.md");

        for href in [
            "second.md#details",
            "second.md?plain=1",
            "second.md?plain=1#details",
            "./second.md#",
            "sub/../second.md#x",
        ] {
            assert_eq!(
                resolve_document(&index, href).expect(href),
                expected,
                "{href}"
            );
        }
    }

    #[test]
    fn r04_percent_encoded_names_are_decoded_after_the_fragment_is_cut() {
        let (dir, index) = workspace();

        assert_eq!(
            resolve_document(&index, "my%20notes.md").expect("space"),
            dir.path().join("my notes.md")
        );
        assert_eq!(
            resolve_document(&index, "caf%C3%A9.md").expect("accent"),
            dir.path().join("café.md")
        );
        if cfg!(unix) {
            assert_eq!(
                resolve_document(&index, "what%3F.md").expect("an encoded question mark is a name"),
                dir.path().join("what?.md")
            );
        }
        assert_eq!(
            resolve_document(&index, "a%23b.md#real-fragment").expect("an encoded hash is a name"),
            dir.path().join("a#b.md")
        );
    }

    #[test]
    fn r04_a_link_into_a_sub_folder_works() {
        let (dir, index) = workspace();

        assert_eq!(
            resolve_document(&index, "sub/deep.md").expect("resolves"),
            dir.path().join("sub").join("deep.md")
        );
    }

    #[test]
    fn r04_a_link_up_and_across_is_resolved_not_trusted() {
        let (dir, _) = workspace();
        let sub_document = dir.path().join("sub").join("deep.md");

        let target = resolve_document(&sub_document, "../second.md").expect("resolves");
        let around = resolve_document(&sub_document, "../sub/../second.md").expect("resolves");

        assert_eq!(target, dir.path().join("second.md"));
        assert_eq!(around, target);
        assert!(
            !target.to_string_lossy().contains(".."),
            "the result is canonical"
        );
    }

    #[test]
    fn r04_a_link_that_climbs_out_to_a_system_file_is_not_a_document() {
        let (_dir, index) = workspace();
        let climb = "../".repeat(40);

        let document = resolve_document(&index, &format!("{climb}{SYSTEM_FILE}"));
        let any = resolve(&index, &format!("{climb}{SYSTEM_FILE}"));

        assert_eq!(
            document.expect_err("not a document").code,
            ErrorCode::NotMarkdown
        );
        assert_eq!(any.expect("exists, so it may be revealed"), system_file());
    }

    #[test]
    fn r04_the_fixture_links_of_the_links_folder_resolve() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("links");
        let index = crate::fs_util::canonicalize(root.join("index.md")).expect("fixture exists");

        let second = resolve_document(&index, "second.md").expect("second");
        let section = resolve_document(&index, "second.md#details").expect("section");
        let parent = resolve_document(&index, "../flavors/plain.md").expect("parent folder");
        let pdf = resolve(&index, "files/report.pdf").expect("pdf exists");
        let image = resolve(&index, "images/sample.png").expect("image exists");

        assert_eq!(name_of(&second), "second.md");
        assert_eq!(second, section);
        assert!(
            parent.ends_with("tests/fixtures/flavors/plain.md"),
            "{parent:?}"
        );
        assert!(pdf.ends_with("files/report.pdf"));
        assert!(image.ends_with("images/sample.png"));
        assert_eq!(
            resolve_document(&index, "files/report.pdf")
                .expect_err("a pdf")
                .code,
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            resolve_document(&index, "#section-1")
                .expect_err("an anchor")
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn r04_every_document_extension_opens_and_other_files_do_not() {
        let (dir, index) = workspace();
        for extension in [
            "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "qmd", "rmd", "Rmd", "mmd", "txt",
            "MD",
        ] {
            dir.write(&format!("doc.{extension}"), b"x");
            assert!(
                resolve_document(&index, &format!("doc.{extension}")).is_ok(),
                "{extension}"
            );
        }
        for name in [
            "report.pdf",
            "script.sh",
            "run.command",
            "image.png",
            "noextension",
        ] {
            dir.write(name, b"x");
            assert_eq!(
                resolve_document(&index, name).expect_err(name).code,
                ErrorCode::NotMarkdown,
                "{name}"
            );
        }
    }

    #[test]
    fn r04_a_missing_target_is_not_found() {
        let (_dir, index) = workspace();

        for href in ["missing.md", "sub/missing.md", "../missing.md#x"] {
            assert_eq!(
                resolve_document(&index, href).expect_err(href).code,
                ErrorCode::NotFound,
                "{href}"
            );
        }
    }

    #[test]
    fn r04_links_that_are_not_to_a_file_are_not_found() {
        let (_dir, index) = workspace();

        for href in [
            "",
            "   ",
            "#anchor",
            "?query",
            "#",
            "%00",
            "a%00b.md",
            "%FF%FE.md",
        ] {
            assert_eq!(
                resolve_document(&index, href).expect_err(href).code,
                ErrorCode::NotFound,
                "{href:?}"
            );
        }
    }

    #[test]
    fn r04_a_tilde_is_not_expanded() {
        let (_dir, index) = workspace();

        assert_eq!(
            resolve_document(&index, "~/second.md")
                .expect_err("no such folder")
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn r04_an_absolute_path_is_followed_by_the_same_rules() {
        let (dir, index) = workspace();
        let absolute = dir.path().join("second.md");

        assert_eq!(
            resolve_document(&index, &absolute.to_string_lossy()).expect("resolves"),
            absolute
        );
        assert_eq!(
            resolve_document(&index, &system_file().to_string_lossy())
                .expect_err("not a document")
                .code,
            ErrorCode::NotMarkdown
        );
    }

    // ---- what is never opened ------------------------------------------------------------

    #[test]
    fn r04_a_folder_is_never_a_document_even_if_it_is_named_like_one() {
        let (dir, index) = workspace();
        std::fs::create_dir(dir.path().join("folder.md")).expect("mkdir");

        let error = resolve_document(&index, "folder.md").expect_err("a folder");

        assert_eq!(error.code, ErrorCode::NotMarkdown);
        assert!(
            resolve(&index, "folder.md").is_ok(),
            "but it can be revealed"
        );
    }

    #[test]
    fn r04_an_application_bundle_is_never_opened() {
        let (dir, index) = workspace();
        let bundle = dir.path().join("Tool.app");
        std::fs::create_dir_all(bundle.join("Contents").join("MacOS")).expect("mkdir");
        std::fs::write(
            bundle.join("Contents").join("MacOS").join("Tool"),
            b"#!/bin/sh\n",
        )
        .expect("write");

        for href in ["Tool.app", "Tool.app/", "Tool.app/Contents/MacOS/Tool"] {
            assert_eq!(
                resolve_document(&index, href).expect_err(href).code,
                ErrorCode::NotMarkdown,
                "{href}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn r04_an_executable_file_is_never_opened() {
        let (dir, index) = workspace();
        for name in ["run.sh", "tool", "launch.command", "program"] {
            let path = dir.write(name, b"#!/bin/sh\necho hi\n");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");

            assert_eq!(
                resolve_document(&index, name).expect_err(name).code,
                ErrorCode::NotMarkdown,
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_markdown_file_with_the_executable_bit_is_still_only_read_as_text() {
        // Files from FAT or exFAT volumes often look executable. Nothing in Writedown runs a
        // file, and the type is judged by the extension, so such a document opens.
        let (dir, index) = workspace();
        let path = dir.write("odd.md", b"# Odd");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("chmod");

        assert!(resolve_document(&index, "odd.md").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn r04_a_link_named_like_a_document_that_points_elsewhere_is_judged_by_its_target() {
        let (dir, index) = workspace();
        symlink("/etc/hosts", dir.path().join("innocent.md")).expect("symlink");
        symlink("/bin/ls", dir.path().join("program.md")).expect("symlink");

        for href in ["innocent.md", "program.md"] {
            assert_eq!(
                resolve_document(&index, href).expect_err(href).code,
                ErrorCode::NotMarkdown,
                "{href}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_link_with_another_name_that_points_to_a_document_opens_it_under_its_real_name() {
        let (dir, index) = workspace();
        symlink(dir.path().join("second.md"), dir.path().join("alias.txt")).expect("symlink");
        symlink(dir.path().join("second.md"), dir.path().join("noext")).expect("symlink");

        let through_alias = resolve_document(&index, "alias.txt").expect("resolves");

        assert_eq!(through_alias, dir.path().join("second.md"));
        assert!(resolve_document(&index, "noext").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_is_not_found() {
        let (dir, index) = workspace();
        symlink(
            dir.path().join("nowhere.md"),
            dir.path().join("dangling.md"),
        )
        .expect("symlink");

        assert_eq!(
            resolve_document(&index, "dangling.md")
                .expect_err("dangling")
                .code,
            ErrorCode::NotFound
        );
    }

    // ---- file: links and other schemes ---------------------------------------------------

    #[test]
    fn r04_absolute_file_links_follow_the_same_rules() {
        let (dir, index) = workspace();
        let second = dir.path().join("second.md");
        let encoded = format!("{}#top", file_url(&dir.path().join("my notes.md")));
        let missing = if cfg!(windows) {
            "file:///C:/does/not/exist.md"
        } else {
            "file:///does/not/exist.md"
        };

        assert_eq!(
            resolve_document(&index, &file_url(&second)).expect("file url"),
            second
        );
        assert_eq!(
            resolve_document(
                &index,
                &file_url(&second).replacen("file://", "file://localhost", 1)
            )
            .expect("localhost"),
            second
        );
        assert_eq!(
            resolve_document(&index, &encoded).expect("encoded"),
            dir.path().join("my notes.md")
        );
        assert_eq!(
            resolve_document(&index, &file_url(&system_file()))
                .expect_err("not a document")
                .code,
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            resolve_document(&index, missing).expect_err("missing").code,
            ErrorCode::NotFound
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_drive_letter_is_not_a_scheme_and_a_share_is_refused() {
        let (dir, index) = workspace();
        let second = dir.path().join("second.md");
        let forward = second.to_string_lossy().replace('\\', "/");

        assert_eq!(resolve_document(&index, &forward).expect("C:/..."), second);
        assert_eq!(
            resolve_document(&index, "\\\\example.org\\share\\a.md")
                .expect_err("a share")
                .code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            resolve_document(&index, "//example.org/share/a.md")
                .expect_err("a share")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn r04_a_file_link_to_another_machine_is_refused() {
        let (_dir, index) = workspace();

        assert_eq!(
            resolve_document(&index, "file://example.org/share/a.md")
                .expect_err("remote")
                .code,
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn r04_links_with_other_schemes_are_not_file_links() {
        let (_dir, index) = workspace();

        for href in [
            "https://example.org/second.md",
            "http://example.org",
            "mailto:a@b.org",
            "javascript:alert(1)",
            "data:text/plain,hi",
            "ftp://example.org/a.md",
            "x-apple.systempreferences:foo",
        ] {
            assert_eq!(
                resolve(&index, href).expect_err(href).code,
                ErrorCode::NotAllowed,
                "{href}"
            );
            assert_eq!(
                resolve_document(&index, href).expect_err(href).code,
                ErrorCode::NotAllowed,
                "{href}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_relative_name_with_a_colon_must_be_written_with_a_dot_slash() {
        let (dir, index) = workspace();
        dir.write("a:b.md", b"x");

        assert!(
            resolve_document(&index, "a:b.md").is_err(),
            "'a' looks like a scheme"
        );
        assert!(resolve_document(&index, "./a:b.md").is_ok());
    }

    // ---- other existing targets ------------------------------------------------------------

    #[test]
    fn r04_other_existing_targets_can_be_found_for_revealing_but_not_opened() {
        let (dir, index) = workspace();

        let pdf = resolve(&index, "report.pdf").expect("exists");
        let folder = resolve(&index, "sub").expect("exists");

        assert_eq!(pdf, dir.path().join("report.pdf"));
        assert_eq!(folder, dir.path().join("sub"));
        assert_eq!(
            resolve_document(&index, "report.pdf")
                .expect_err("not a document")
                .code,
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            resolve(&index, "nothing.pdf").expect_err("missing").code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn a_document_without_a_folder_cannot_resolve_relative_links() {
        assert_eq!(
            resolve(Path::new("/"), "second.md")
                .expect_err("no folder")
                .code,
            ErrorCode::NotFound
        );
    }
}
