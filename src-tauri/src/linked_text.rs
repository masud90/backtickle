//! Text files a document refers to: a bibliography, an included file, an embedded
//! note, and the Quarto project file.
//!
//! `read_linked_text` resolves the `href` like `open_linked_document` (relative to the granted
//! document, percent-decoded, `../` and symbolic links resolved, the target must exist). The
//! extension and the size limit depend on the purpose, and the extension is judged on the
//! resolved path, so a link named `x.md` that points to something else does not count. The
//! text is decoded like `read_document`. Nothing here ever launches a file.

use crate::documents;
use crate::error::{ErrorCode, PlatformError, PlatformResult};
use crate::file_types;
use crate::links;
use crate::vault;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MAX_BIBLIOGRAPHY_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_INCLUDE_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_EMBED_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_QUARTO_PROJECT_BYTES: u64 = 1024 * 1024;
/// How many folders `quarto_project` looks in: the document's own and the ones above it.
pub const QUARTO_LEVELS: usize = 8;

const BIBLIOGRAPHY_EXTENSIONS: [&str; 5] = ["bib", "bibtex", "json", "yaml", "yml"];

/// Why a text is wanted; decides what may be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Bibliography,
    Include,
    Embed,
}

impl Purpose {
    pub fn name(self) -> &'static str {
        match self {
            Purpose::Bibliography => "bibliography",
            Purpose::Include => "include",
            Purpose::Embed => "embed",
        }
    }

    fn limit(self) -> u64 {
        match self {
            Purpose::Bibliography => MAX_BIBLIOGRAPHY_BYTES,
            Purpose::Include => MAX_INCLUDE_BYTES,
            Purpose::Embed => MAX_EMBED_BYTES,
        }
    }

    fn allows(self, path: &Path) -> bool {
        match self {
            Purpose::Bibliography => file_types::extension_lower(path)
                .is_some_and(|extension| BIBLIOGRAPHY_EXTENSIONS.contains(&extension.as_str())),
            Purpose::Include => file_types::is_document_path(path),
            Purpose::Embed => file_types::is_markdown_path(path),
        }
    }
}

/// `{ path, text }` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinkedText {
    /// The canonical path that was read.
    pub path: String,
    /// Decoded, line endings normalized to `\n`, byte order mark removed.
    pub text: String,
}

fn wrong_kind(purpose: Purpose) -> PlatformError {
    match purpose {
        Purpose::Bibliography => PlatformError::new(
            ErrorCode::NotAllowed,
            "A bibliography must be a .bib, .bibtex, .json, .yaml or .yml file.",
        ),
        Purpose::Include | Purpose::Embed => PlatformError::new(
            ErrorCode::NotMarkdown,
            "This link points to something Backtickle does not read as a document.",
        ),
    }
}

fn read(path: &Path, limit: u64) -> PlatformResult<LinkedText> {
    let read = documents::read_document_with_limit(path, limit)?;
    Ok(LinkedText {
        path: read.document.path,
        text: read.document.text,
    })
}

/// Reads the file `href` points to, from the document at `from` (canonical, granted).
pub fn read_linked_text(from: &Path, href: &str, purpose: Purpose) -> PlatformResult<LinkedText> {
    let target = links::resolve(from, href)?;
    check_target(from, &target, purpose)?;
    read(&target, purpose.limit())
}

fn check_target(from: &Path, target: &Path, purpose: Purpose) -> PlatformResult<()> {
    let is_regular_file = std::fs::metadata(target).is_ok_and(|metadata| metadata.is_file());
    if !is_regular_file || !purpose.allows(target) {
        return Err(wrong_kind(purpose));
    }
    if purpose == Purpose::Embed {
        let inside = vault::vault_root(from).is_some_and(|root| target.starts_with(root));
        if !inside {
            return Err(PlatformError::new(
                ErrorCode::NotAllowed,
                "A note can only be embedded from inside its own vault.",
            ));
        }
    }
    Ok(())
}

/// The nearest `_quarto.yml` in the folder of `doc` or above: at most `QUARTO_LEVELS` folders,
/// never the home folder or anything above it. `None` if there is none.
pub fn quarto_project(doc: &Path, home: Option<&Path>) -> PlatformResult<Option<LinkedText>> {
    for folder in doc.ancestors().skip(1).take(QUARTO_LEVELS) {
        if home.is_some_and(|home| folder == home) {
            break;
        }
        let candidate: PathBuf = folder.join("_quarto.yml");
        // symlink_metadata would see links; metadata follows them, and a project file that is
        // a link to a regular file is fine. Anything else is not a project file.
        if !std::fs::metadata(&candidate).is_ok_and(|metadata| metadata.is_file()) {
            continue;
        }
        let canonical = crate::fs_util::canonicalize(&candidate)
            .map_err(|error| PlatformError::from_read(&error))?;
        return read(&canonical, MAX_QUARTO_PROJECT_BYTES).map(Some);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    #[cfg(unix)]
    use std::os::unix::fs::{PermissionsExt, symlink};

    fn fixtures() -> PathBuf {
        crate::fs_util::canonicalize(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("tests")
                .join("fixtures")
                .join("flavors"),
        )
        .expect("fixtures exist")
    }

    fn code(result: PlatformResult<LinkedText>) -> ErrorCode {
        result.expect_err("refused").code
    }

    fn workspace() -> (TempDir, PathBuf) {
        let dir = TempDir::new();
        let doc = dir.write("doc.md", b"# Doc");
        (dir, doc)
    }

    // ---- bibliography ---------------------------------------------------------------------

    #[test]
    fn a_bibliography_is_read_in_every_allowed_format() {
        let doc = fixtures().join("pandoc").join("citations.md");
        for name in ["refs.bib", "refs.json", "refs.yaml"] {
            let read = read_linked_text(&doc, name, Purpose::Bibliography).expect(name);
            assert!(read.path.ends_with(name));
            assert!(!read.text.is_empty(), "{name}");
        }
        let (dir, doc) = workspace();
        for name in ["a.bibtex", "b.yml", "C.BIB"] {
            dir.write(name, b"x");
            assert!(read_linked_text(&doc, name, Purpose::Bibliography).is_ok());
        }
    }

    #[test]
    fn a_bibliography_with_another_extension_is_refused() {
        let (dir, doc) = workspace();
        for name in ["a.md", "a.txt", "a.sh", "a.bib.bak", "noext", "a.csl"] {
            dir.write(name, b"x");
            assert_eq!(
                code(read_linked_text(&doc, name, Purpose::Bibliography)),
                ErrorCode::NotAllowed,
                "{name}"
            );
        }
    }

    #[test]
    fn the_bibliography_limit_is_ten_megabytes() {
        let (dir, doc) = workspace();
        dir.write("fits.bib", &vec![b'a'; MAX_BIBLIOGRAPHY_BYTES as usize]);
        dir.write("big.bib", &vec![b'a'; MAX_BIBLIOGRAPHY_BYTES as usize + 1]);

        assert!(read_linked_text(&doc, "fits.bib", Purpose::Bibliography).is_ok());
        assert_eq!(
            code(read_linked_text(&doc, "big.bib", Purpose::Bibliography)),
            ErrorCode::TooLarge
        );
    }

    // ---- include --------------------------------------------------------------------------

    #[test]
    fn an_include_reads_the_quarto_fixture_files() {
        let doc = fixtures().join("quarto").join("chunks.qmd");

        let read = read_linked_text(&doc, "_part-a.qmd", Purpose::Include).expect("reads");

        assert!(read.path.ends_with("_part-a.qmd"));
        assert!(!read.text.contains('\r'));
    }

    #[test]
    fn an_include_accepts_the_document_extensions_only() {
        let (dir, doc) = workspace();
        for name in [
            "a.md",
            "a.markdown",
            "a.mdown",
            "a.mkd",
            "a.mkdn",
            "a.qmd",
            "a.Rmd",
            "a.mdx",
            "a.mmd",
            "a.txt",
        ] {
            dir.write(name, b"x");
            assert!(
                read_linked_text(&doc, name, Purpose::Include).is_ok(),
                "{name}"
            );
        }
        for name in ["a.bib", "a.png", "a.sh", "a.pdf", "noext"] {
            dir.write(name, b"x");
            assert_eq!(
                code(read_linked_text(&doc, name, Purpose::Include)),
                ErrorCode::NotMarkdown,
                "{name}"
            );
        }
    }

    #[test]
    fn an_include_and_an_embed_are_limited_to_five_megabytes() {
        let (dir, doc) = workspace();
        dir.write("fits.md", &vec![b'a'; MAX_INCLUDE_BYTES as usize]);
        dir.write("big.md", &vec![b'a'; MAX_INCLUDE_BYTES as usize + 1]);

        assert!(read_linked_text(&doc, "fits.md", Purpose::Include).is_ok());
        assert_eq!(
            code(read_linked_text(&doc, "big.md", Purpose::Include)),
            ErrorCode::TooLarge
        );
        assert_eq!(MAX_EMBED_BYTES, 5 * 1024 * 1024);
    }

    #[test]
    fn a_missing_target_is_not_found_and_other_schemes_are_not_allowed() {
        let (_dir, doc) = workspace();

        for purpose in [Purpose::Bibliography, Purpose::Include, Purpose::Embed] {
            assert_eq!(
                code(read_linked_text(&doc, "missing.bib", purpose)),
                ErrorCode::NotFound
            );
            assert_eq!(
                code(read_linked_text(&doc, "https://example.org/a.bib", purpose)),
                ErrorCode::NotAllowed
            );
            assert_eq!(
                code(read_linked_text(&doc, "#anchor", purpose)),
                ErrorCode::NotFound
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_extension_is_judged_on_the_resolved_target() {
        let (dir, doc) = workspace();
        symlink("/bin/ls", dir.path().join("sneaky.md")).expect("symlink");
        symlink("/etc/hosts", dir.path().join("hosts.bib")).expect("symlink");
        dir.write("real.sh", b"echo");
        symlink(dir.path().join("real.sh"), dir.path().join("alias.qmd")).expect("symlink");
        let mut permissions = std::fs::metadata(dir.path().join("real.sh"))
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(dir.path().join("real.sh"), permissions).expect("chmod");

        assert_eq!(
            code(read_linked_text(&doc, "sneaky.md", Purpose::Include)),
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            code(read_linked_text(&doc, "hosts.bib", Purpose::Bibliography)),
            ErrorCode::NotAllowed
        );
        assert_eq!(
            code(read_linked_text(&doc, "alias.qmd", Purpose::Include)),
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            code(read_linked_text(&doc, "real.sh", Purpose::Include)),
            ErrorCode::NotMarkdown
        );
    }

    #[test]
    fn a_bundle_or_folder_named_like_a_text_file_is_refused() {
        let (dir, doc) = workspace();
        std::fs::create_dir(dir.path().join("Thing.md")).expect("mkdir");
        std::fs::create_dir(dir.path().join("Some.app")).expect("mkdir");
        std::fs::create_dir(dir.path().join("refs.bib")).expect("mkdir");

        assert_eq!(
            code(read_linked_text(&doc, "Thing.md", Purpose::Include)),
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            code(read_linked_text(&doc, "Some.app", Purpose::Include)),
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            code(read_linked_text(&doc, "refs.bib", Purpose::Bibliography)),
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn a_legacy_encoded_file_is_decoded_and_line_endings_are_normalized() {
        let (dir, doc) = workspace();
        dir.write("a.bib", b"caf\xe9\r\nx\r\n");
        dir.write("b.md", b"\xef\xbb\xbfone\r\ntwo");

        let legacy = read_linked_text(&doc, "a.bib", Purpose::Bibliography).expect("reads");
        let bom = read_linked_text(&doc, "b.md", Purpose::Include).expect("reads");

        assert_eq!(legacy.text, "café\nx\n");
        assert_eq!(bom.text, "one\ntwo");
    }

    #[test]
    fn the_target_may_sit_above_the_document_for_a_bibliography() {
        // The Quarto project fixture points at ../../pandoc/refs.bib.
        let doc = fixtures()
            .join("quarto")
            .join("project")
            .join("chapter.qmd");

        let read =
            read_linked_text(&doc, "../../pandoc/refs.bib", Purpose::Bibliography).expect("reads");

        assert!(read.path.ends_with("pandoc/refs.bib"));
    }

    // ---- embed ----------------------------------------------------------------------------

    #[test]
    fn an_embed_reads_a_note_inside_the_vault() {
        let vault = fixtures().join("obsidian").join("vault");
        let doc = vault.join("Home.md");

        let read = read_linked_text(&doc, "Notes/Note%20A.md", Purpose::Embed).expect("reads");

        assert!(read.path.ends_with("Notes/Note A.md"));
        let up = read_linked_text(
            &vault.join("Notes").join("Note A.md"),
            "../Home.md",
            Purpose::Embed,
        );
        assert!(up.is_ok());
    }

    #[test]
    fn an_embed_may_not_climb_out_of_the_vault() {
        let vault = fixtures().join("obsidian").join("vault");
        let doc = vault.join("Home.md");

        assert_eq!(
            code(read_linked_text(&doc, "../outside.md", Purpose::Embed)),
            ErrorCode::NotAllowed
        );
        assert_eq!(
            code(read_linked_text(
                &vault.join("Notes").join("Note A.md"),
                "../../outside.md",
                Purpose::Embed
            )),
            ErrorCode::NotAllowed
        );
        // The same file is fine as an include: only embeds are held to the vault.
        assert!(read_linked_text(&doc, "../outside.md", Purpose::Include).is_ok());
    }

    #[test]
    fn an_embed_from_a_document_outside_any_vault_is_refused() {
        let (dir, doc) = workspace();
        dir.write("other.md", b"x");

        assert_eq!(
            code(read_linked_text(&doc, "other.md", Purpose::Embed)),
            ErrorCode::NotAllowed
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_embed_through_a_link_that_leaves_the_vault_is_refused() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        std::fs::create_dir(dir.path().join(".obsidian")).expect("mkdir");
        let doc = dir.write("home.md", b"x");
        outside.write("secret.md", b"s");
        symlink(outside.path().join("secret.md"), dir.path().join("link.md")).expect("symlink");

        assert_eq!(
            code(read_linked_text(&doc, "link.md", Purpose::Embed)),
            ErrorCode::NotAllowed
        );
    }

    #[test]
    fn an_embed_accepts_the_markdown_family_only() {
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join(".obsidian")).expect("mkdir");
        let doc = dir.write("home.md", b"x");
        dir.write("a.qmd", b"x");
        dir.write("a.txt", b"x");
        dir.write("a.mkdn", b"x");

        assert!(read_linked_text(&doc, "a.mkdn", Purpose::Embed).is_ok());
        assert_eq!(
            code(read_linked_text(&doc, "a.qmd", Purpose::Embed)),
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            code(read_linked_text(&doc, "a.txt", Purpose::Embed)),
            ErrorCode::NotMarkdown
        );
    }

    // ---- Quarto project -------------------------------------------------------------------

    #[test]
    fn the_quarto_project_fixture_is_found_from_a_chapter() {
        let doc = fixtures()
            .join("quarto")
            .join("project")
            .join("chapter.qmd");

        let project = quarto_project(&doc, None).expect("ok").expect("found");

        assert!(project.path.ends_with("project/_quarto.yml"));
        assert!(project.text.contains("number-sections"));
    }

    #[test]
    fn a_document_without_a_project_gets_none() {
        let (_dir, doc) = workspace();

        assert_eq!(quarto_project(&doc, None).expect("ok"), None);
    }

    #[test]
    fn the_nearest_project_file_wins() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join("a/b")).expect("mkdir");
        dir.write("_quarto.yml", b"outer: 1");
        dir.write("a/_quarto.yml", b"inner: 1");
        let doc = dir.write("a/b/d.qmd", b"x");

        let project = quarto_project(&doc, None).expect("ok").expect("found");

        assert_eq!(project.text, "inner: 1");
    }

    #[test]
    fn the_search_looks_in_eight_folders_and_no_further() {
        let dir = TempDir::new();
        let chain: Vec<String> = (0..9).map(|level| format!("l{level}")).collect();
        let deepest = chain
            .iter()
            .fold(dir.path().to_path_buf(), |p, n| p.join(n));
        std::fs::create_dir_all(&deepest).expect("mkdir");
        let doc = deepest.join("d.qmd");
        std::fs::write(&doc, b"x").expect("write");

        // l8 holds the document; l8 down to l1 are the eight folders looked in. l0 is the ninth.
        std::fs::write(dir.path().join("l0/_quarto.yml"), b"ninth: 1").expect("write");
        assert_eq!(quarto_project(&doc, None).expect("ok"), None);

        std::fs::write(dir.path().join("l0/l1/_quarto.yml"), b"eighth: 1").expect("write");
        assert_eq!(
            quarto_project(&doc, None).expect("ok").expect("found").text,
            "eighth: 1"
        );
    }

    #[test]
    fn the_search_stops_before_the_home_folder() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join("home/docs")).expect("mkdir");
        dir.write("home/_quarto.yml", b"home: 1");
        let doc = dir.write("home/docs/d.qmd", b"x");
        let home = dir.path().join("home");

        assert_eq!(quarto_project(&doc, Some(&home)).expect("ok"), None);
        assert!(quarto_project(&doc, None).expect("ok").is_some());
    }

    #[test]
    fn a_project_file_over_one_megabyte_is_too_large_and_a_folder_is_skipped() {
        let dir = TempDir::new();
        std::fs::create_dir_all(dir.path().join("a/_quarto.yml")).expect("a folder");
        dir.write(
            "_quarto.yml",
            &vec![b'a'; MAX_QUARTO_PROJECT_BYTES as usize + 1],
        );
        let doc = dir.write("a/d.qmd", b"x");

        let error = quarto_project(&doc, None).expect_err("too large");

        assert_eq!(error.code, ErrorCode::TooLarge);
        dir.write(
            "_quarto.yml",
            &vec![b'a'; MAX_QUARTO_PROJECT_BYTES as usize],
        );
        assert!(quarto_project(&doc, None).expect("ok").is_some());
    }
}
