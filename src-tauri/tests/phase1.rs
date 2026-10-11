//! Acceptance tests R01 to R08 of the Phase 1 specification, through the public API of the
//! backend, with the fixtures of `tests/fixtures`. Each module is one test id; run one with, for
//! example, `cargo test --test phase1 r03`. Every test writes only inside a temporary folder.

use serde_json::{Value, json};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use writedown_lib::documents::read_document;
use writedown_lib::encoding::Encoding;
use writedown_lib::error::ErrorCode;
use writedown_lib::grants::PathGrants;
use writedown_lib::line_endings::LineEnding;
use writedown_lib::safe_save::{SaveFormat, SaveOptions, Tracked, save};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
}

struct Temp(PathBuf);

impl Temp {
    fn new() -> Self {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let base = std::fs::canonicalize(std::env::temp_dir()).expect("temp dir");
        let path = base.join(format!(
            "writedown-phase1-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).expect("create");
        Temp(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
    fn copy_of(&self, source: &Path, name: &str) -> PathBuf {
        let target = self.0.join(name);
        std::fs::copy(source, &target).expect("copy");
        target
    }
    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.0)
            .expect("list")
            .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn no_check() -> SaveOptions {
    SaveOptions::default()
}

fn expected() -> serde_json::Map<String, Value> {
    let text = std::fs::read_to_string(fixtures().join("encoding").join("expected.json"))
        .expect("expected.json");
    serde_json::from_str::<Value>(&text)
        .expect("json")
        .as_object()
        .expect("object")
        .clone()
}

fn encoding_of(name: &str) -> Encoding {
    serde_json::from_value(json!(name)).expect("known encoding")
}

fn line_ending_of(name: &str) -> LineEnding {
    serde_json::from_value(json!(name)).expect("known line ending")
}

mod r01_encodings_and_line_endings {
    use super::*;

    #[test]
    fn every_fixture_is_read_as_expected_json_says() {
        for (name, want) in expected() {
            let read = read_document(&fixtures().join("encoding").join(&name))
                .unwrap_or_else(|e| panic!("{name}: {e}"))
                .document;

            assert_eq!(
                read.text,
                want["text"].as_str().expect("text"),
                "{name}: text"
            );
            assert_eq!(
                serde_json::to_value(read.encoding).expect("json"),
                want["encoding"],
                "{name}: encoding"
            );
            assert_eq!(
                read.legacy_encoding.as_deref(),
                want["legacyEncoding"].as_str(),
                "{name}: legacy"
            );
            assert_eq!(read.lossy, want["lossy"], "{name}: lossy");
            assert_eq!(
                serde_json::to_value(read.line_ending).expect("json"),
                want["lineEnding"],
                "{name}: line ending"
            );
            assert_eq!(
                read.mixed_line_endings, want["mixedLineEndings"],
                "{name}: mixed"
            );
            assert_eq!(
                read.bytes,
                want["bytes"].as_u64().expect("bytes"),
                "{name}: bytes"
            );
        }
    }

    #[test]
    fn r01_a_consistent_file_round_trips_byte_for_byte() {
        let temp = Temp::new();
        let mut checked = 0;
        for (name, want) in expected() {
            let legacy = !want["legacyEncoding"].is_null();
            let mixed = want["mixedLineEndings"] == true;
            if legacy || mixed {
                continue;
            }
            let original = std::fs::read(fixtures().join("encoding").join(&name)).expect("read");
            let copy = temp.copy_of(&fixtures().join("encoding").join(&name), &name);
            let read = read_document(&copy).expect("reads").document;

            save(
                &copy,
                &read.text,
                SaveFormat {
                    encoding: read.encoding,
                    line_ending: read.line_ending,
                },
                &no_check(),
                None,
            )
            .expect("saves");

            assert_eq!(std::fs::read(&copy).expect("read"), original, "{name}");
            checked += 1;
        }
        assert!(checked >= 8, "only {checked} fixtures were checked");
    }

    #[test]
    fn r01_a_mixed_file_is_saved_with_the_majority_line_ending() {
        let temp = Temp::new();
        let copy = temp.copy_of(&fixtures().join("encoding").join("utf8-mixed.md"), "m.md");
        let read = read_document(&copy).expect("reads").document;
        assert!(read.mixed_line_endings);

        save(
            &copy,
            &read.text,
            SaveFormat {
                encoding: read.encoding,
                line_ending: read.line_ending,
            },
            &no_check(),
            None,
        )
        .expect("saves");

        let bytes = std::fs::read(&copy).expect("read");
        assert!(
            !bytes.contains(&b'\r'),
            "the majority is LF, so no CRLF remains"
        );
        assert_eq!(bytes, read.text.as_bytes());
    }

    #[test]
    fn r01_a_legacy_file_is_saved_as_utf8_with_the_same_text() {
        let temp = Temp::new();
        let copy = temp.copy_of(&fixtures().join("encoding").join("windows-1252.md"), "l.md");
        let read = read_document(&copy).expect("reads").document;
        assert_eq!(read.legacy_encoding.as_deref(), Some("windows-1252"));

        save(
            &copy,
            &read.text,
            SaveFormat {
                encoding: read.encoding,
                line_ending: read.line_ending,
            },
            &no_check(),
            None,
        )
        .expect("saves");

        assert_eq!(
            std::fs::read(&copy).expect("read"),
            "café\nnaïve\n€ 5\n’ text".as_bytes()
        );
        let again = read_document(&copy).expect("reads").document;
        assert!(again.legacy_encoding.is_none(), "now it is plain UTF-8");
    }

    #[test]
    fn r01_converting_the_line_ending_changes_every_break() {
        let temp = Temp::new();
        let copy = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "c.md");
        let read = read_document(&copy).expect("reads").document;

        save(
            &copy,
            &read.text,
            SaveFormat {
                encoding: read.encoding,
                line_ending: line_ending_of("crlf"),
            },
            &no_check(),
            None,
        )
        .expect("saves");

        assert_eq!(
            std::fs::read(&copy).expect("read"),
            b"Line 1\r\nLine 2\r\nLine 3\r\nLine 4\r\nLine 5\r\n"
        );
        assert_eq!(encoding_of("utf-16be"), Encoding::Utf16Be);
    }
}

mod r02_safe_save_guarantees {
    use super::*;

    #[test]
    fn permissions_tags_other_attributes_and_the_link_survive_and_nothing_is_left_behind() {
        let temp = Temp::new();
        let real = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "real.md");
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o640)).expect("chmod");
        let tags = b"bplist00 finder tags".to_vec();
        xattr::set(&real, "com.apple.metadata:_kMDItemUserTags", &tags).expect("tags");
        xattr::set(&real, "user.other", b"kept").expect("xattr");
        let link = temp.path().join("link.md");
        symlink(&real, &link).expect("symlink");
        let created = std::fs::metadata(&real)
            .expect("meta")
            .created()
            .expect("created");

        save(
            &link,
            "new text\n",
            SaveFormat {
                encoding: Encoding::Utf8,
                line_ending: LineEnding::Lf,
            },
            &no_check(),
            None,
        )
        .expect("saves through the link");

        assert!(
            std::fs::symlink_metadata(&link)
                .expect("link")
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read(&real).expect("read"), b"new text\n");
        let meta = std::fs::metadata(&real).expect("meta");
        assert_eq!(meta.permissions().mode() & 0o7777, 0o640);
        assert_eq!(
            xattr::get(&real, "com.apple.metadata:_kMDItemUserTags").expect("get"),
            Some(tags)
        );
        assert_eq!(
            xattr::get(&real, "user.other").expect("get"),
            Some(b"kept".to_vec())
        );
        assert_eq!(
            meta.created().expect("created"),
            created,
            "creation date kept"
        );
        assert_eq!(temp.names(), ["link.md", "real.md"], "no temporary file");
    }
}

mod r03_refusals {
    use super::*;

    fn fmt() -> SaveFormat {
        SaveFormat {
            encoding: Encoding::Utf8,
            line_ending: LineEnding::Lf,
        }
    }

    #[test]
    fn modified_externally_lossy_and_read_only_are_returned() {
        let temp = Temp::new();
        let path = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "a.md");
        let read = read_document(&path).expect("reads");
        let tracked = Tracked {
            stamp: read.stamp,
            lossy: false,
        };
        std::fs::write(&path, "someone else wrote a longer text\n").expect("external");
        let opts = SaveOptions {
            expected_modified_ms: Some(read.document.modified_ms),
            ..SaveOptions::default()
        };
        assert_eq!(
            save(&path, "x", fmt(), &opts, Some(tracked))
                .expect_err("refused")
                .code,
            ErrorCode::ModifiedExternally
        );
        let overwrite = SaveOptions {
            overwrite_external_change: true,
            ..opts
        };
        assert!(save(&path, "x", fmt(), &overwrite, Some(tracked)).is_ok());

        let lossy_tracked = Tracked {
            stamp: read.stamp,
            lossy: true,
        };
        let fresh = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "b.md");
        assert_eq!(
            save(&fresh, "x", fmt(), &no_check(), Some(lossy_tracked))
                .expect_err("lossy")
                .code,
            ErrorCode::Lossy
        );
        let agreed = SaveOptions {
            allow_lossy: true,
            ..no_check()
        };
        assert!(save(&fresh, "x", fmt(), &agreed, Some(lossy_tracked)).is_ok());

        let locked = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "c.md");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o444)).expect("chmod");
        assert_eq!(
            save(&locked, "x", fmt(), &no_check(), None)
                .expect_err("read only")
                .code,
            ErrorCode::ReadOnly
        );
        assert!(read_document(&locked).expect("reads").document.read_only);
    }

    #[test]
    fn a_lossy_file_is_flagged_on_read_and_too_large_is_refused() {
        let temp = Temp::new();
        let lossy = temp.path().join("lossy.md");
        std::fs::write(&lossy, b"\xEF\xBB\xBFbad \xFF byte").expect("write");
        assert!(read_document(&lossy).expect("reads").document.lossy);

        let big = temp.path().join("big.md");
        let file = std::fs::File::create(&big).expect("create");
        file.set_len(50 * 1024 * 1024 + 1).expect("sparse file");
        assert_eq!(
            read_document(&big).expect_err("too large").code,
            ErrorCode::TooLarge
        );
    }

    #[test]
    fn not_allowed_is_returned_for_a_path_that_was_never_granted() {
        let grants = PathGrants::default();
        let temp = Temp::new();
        let path = temp.copy_of(&fixtures().join("encoding").join("utf8-lf.md"), "a.md");

        assert_eq!(
            grants.check_document(&path).expect_err("refused").code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            grants.check_for_save(&path).expect_err("refused").code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            grants
                .check_document(Path::new("/etc/hosts"))
                .expect_err("refused")
                .code,
            ErrorCode::NotAllowed
        );
    }
}

mod r04_grants_links_images {
    use super::*;
    use writedown_lib::{assets, links};

    fn index() -> PathBuf {
        std::fs::canonicalize(fixtures().join("links").join("index.md")).expect("fixture")
    }

    #[test]
    fn linked_documents_follow_the_rules_and_dot_dot_is_resolved() {
        let index = index();

        assert!(links::resolve_document(&index, "second.md#details").is_ok());
        let parent = links::resolve_document(&index, "../flavors/plain.md").expect("parent");
        assert!(parent.ends_with("tests/fixtures/flavors/plain.md"));
        let escape = format!("{}etc/hosts", "../".repeat(30));
        assert_eq!(
            links::resolve_document(&index, &escape)
                .expect_err("not a document")
                .code,
            ErrorCode::NotMarkdown
        );
        assert_eq!(
            links::resolve_document(&index, "files/report.pdf")
                .expect_err("pdf")
                .code,
            ErrorCode::NotMarkdown
        );
        assert!(
            links::resolve(&index, "files/report.pdf").is_ok(),
            "may be revealed"
        );
    }

    #[test]
    fn executables_and_bundles_are_never_opened() {
        let temp = Temp::new();
        let doc = temp.path().join("doc.md");
        std::fs::write(&doc, "x").expect("write");
        let script = temp.path().join("run.sh");
        std::fs::write(&script, "#!/bin/sh\n").expect("write");
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        std::fs::create_dir_all(temp.path().join("Tool.app").join("Contents")).expect("mkdir");

        for href in ["run.sh", "Tool.app", "Tool.app/"] {
            assert_eq!(
                links::resolve_document(&doc, href).expect_err(href).code,
                ErrorCode::NotMarkdown,
                "{href}"
            );
        }
    }

    #[test]
    fn images_are_resolved_by_type_and_size_only() {
        let index = index();

        let image = assets::resolve_image(&index, "images/sample.png").expect("image");
        assert!(assets::asset_url(&image).starts_with("asset://localhost/%2F"));
        assert_eq!(
            assets::resolve_image(&index, "second.md")
                .expect_err("not an image")
                .code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            assets::resolve_image(&index, "https://example.org/a.png")
                .expect_err("remote")
                .code,
            ErrorCode::NotAllowed
        );
        assert_eq!(
            assets::resolve_image_with_limit(&index, "images/sample.png", 10)
                .expect_err("too large")
                .code,
            ErrorCode::TooLarge
        );
    }

    #[test]
    fn only_web_and_email_urls_are_opened() {
        for url in [
            "http://example.org",
            "https://example.org/a?b#c",
            "mailto:a@b.org",
        ] {
            assert!(links::external_url(url).is_ok(), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///etc/hosts",
            "data:text/html,x",
            "ftp://a.org",
            "/Applications/Calculator.app",
        ] {
            assert!(links::external_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn recents_only_grant_what_is_in_the_list() {
        use writedown_lib::recents::Recents;
        let temp = Temp::new();
        let mut recents = Recents::load(temp.path().join("recents.json"));
        recents.touch("/in/the/list.md", 1, 20);

        assert!(recents.contains("/in/the/list.md"));
        assert!(!recents.contains("/etc/hosts"));
    }
}

mod r05_recents_and_doc_state {
    use super::*;
    use writedown_lib::doc_state::{DocStates, MAX_ENTRIES};
    use writedown_lib::recents::{self, Recents};

    #[test]
    fn order_dedup_cap_missing_files_and_corrupt_store() {
        let temp = Temp::new();
        let file = temp.path().join("recents.json");
        let real = temp.copy_of(&fixtures().join("links").join("second.md"), "real.md");
        let mut list = Recents::load(file.clone());
        list.touch("/gone/old.md", 1, 3);
        list.touch(&real.to_string_lossy(), 2, 3);
        list.touch("/b.md", 3, 3);
        list.touch("/gone/old.md", 4, 3);
        list.touch("/c.md", 5, 3);
        list.save().expect("saves");

        let reloaded = Recents::load(file.clone());
        let paths: Vec<&str> = reloaded.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            ["/c.md", "/gone/old.md", "/b.md"],
            "newest first, no duplicate, capped at 3"
        );

        let described = recents::describe(reloaded.entries(), Some(temp.path()));
        assert!(
            described.iter().all(|e| !e.exists),
            "missing files are kept and flagged"
        );
        let with_real = recents::describe(
            &[recents::StoredRecent {
                path: real.to_string_lossy().into_owned(),
                opened_at_ms: 1,
            }],
            Some(temp.path()),
        );
        assert!(with_real[0].exists && with_real[0].folder == "~" && with_real[0].bytes.is_some());

        std::fs::write(&file, "{ broken").expect("corrupt");
        assert!(Recents::load(file).entries().is_empty());
    }

    #[test]
    fn doc_state_keeps_500_entries_least_recently_used_dropped() {
        let temp = Temp::new();
        let mut states = DocStates::load(temp.path().join("doc-state.json"));
        for i in 0..MAX_ENTRIES + 5 {
            states.set(&format!("/{i}.md"), &json!({ "flavor": "gfm" }));
        }
        assert_eq!(states.len(), 500);
        assert_eq!(
            states.get("/0.md").0.flavor,
            None,
            "the oldest were dropped"
        );
        assert_eq!(states.get("/504.md").0.flavor.as_deref(), Some("gfm"));
        states.save().expect("saves");
        std::fs::write(temp.path().join("doc-state.json"), "nope").expect("corrupt");
        assert!(DocStates::load(temp.path().join("doc-state.json")).is_empty());
    }
}

mod r06_settings {
    use super::*;
    use writedown_lib::settings::{Settings, SettingsStore};

    #[test]
    fn defaults_clamping_wrong_types_unknown_keys_and_version() {
        let temp = Temp::new();
        let file = temp.path().join("settings.json");
        std::fs::write(
            &file,
            r#"{"version": 7, "extra": {"keep": true}, "recentLimit": 5000, "readingWpm": "fast",
                "editor": {"fontSize": 2, "mystery": 1}, "view": 3}"#,
        )
        .expect("write");
        let mut store = SettingsStore::load(file.clone());

        let current = store.get();
        assert_eq!(current.version, 1);
        assert_eq!(current.recent_limit, 100);
        assert_eq!(current.reading_wpm, 238);
        assert_eq!(current.editor.font_size, 9);
        assert_eq!(current.view, Settings::default().view);

        store.update(&json!({ "appearance": "dark" }));
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(&file).expect("read")).expect("json");
        assert_eq!(written["extra"], json!({ "keep": true }));
        assert_eq!(written["editor"]["mystery"], 1);
        assert_eq!(written["version"], 1);
        assert_eq!(written["appearance"], "dark");
        assert_eq!(
            *SettingsStore::load(temp.path().join("none.json")).get(),
            Settings::default()
        );
    }
}

mod r07_location_and_vault {
    use super::*;
    use writedown_lib::context::{LocationKind, detect_location, in_obsidian_vault};

    #[test]
    fn vault_and_cloud_folders_are_detected() {
        let vault_note =
            std::fs::canonicalize(fixtures().join("flavors/vault/notes/idea.md")).expect("fixture");
        let plain = std::fs::canonicalize(fixtures().join("flavors/plain.md")).expect("fixture");
        assert!(in_obsidian_vault(&vault_note));
        assert!(!in_obsidian_vault(&plain));

        let home = Path::new("/Users/me");
        let kind = |p: &str| detect_location(Path::new(p), Some(home));
        assert_eq!(
            kind("/Users/me/Library/Mobile Documents/com~apple~CloudDocs/a.md"),
            LocationKind::Icloud
        );
        assert_eq!(
            kind("/Users/me/Library/CloudStorage/OneDrive-Work/a.md"),
            LocationKind::Onedrive
        );
        assert_eq!(
            kind("/Users/me/Library/CloudStorage/Dropbox/a.md"),
            LocationKind::Dropbox
        );
        assert_eq!(kind("/Users/me/Dropbox/a.md"), LocationKind::Dropbox);
        assert_eq!(
            kind("/Users/me/Library/CloudStorage/GoogleDrive-me@x.org/a.md"),
            LocationKind::GoogleDrive
        );
        assert_eq!(kind("/Users/me/Documents/a.md"), LocationKind::Local);
    }
}

mod r08_open_events {
    use super::*;
    use writedown_lib::open_files::{accept_paths, urls_to_paths};
    use writedown_lib::pending::{Pages, Routed};

    #[test]
    fn only_documents_are_accepted_and_granted_and_the_rest_is_ignored() {
        let temp = Temp::new();
        let md = temp.copy_of(&fixtures().join("links").join("second.md"), "a.md");
        let png = temp.copy_of(
            &fixtures().join("links").join("images").join("sample.png"),
            "p.png",
        );
        let grants = PathGrants::default();

        let accepted = accept_paths(
            &grants,
            &[
                png.clone(),
                md.clone(),
                md.clone(),
                temp.path().to_path_buf(),
            ],
        );

        assert_eq!(accepted, [md.to_string_lossy()]);
        assert!(grants.is_granted(&md));
        assert!(!grants.is_granted(&png));
        let url = url::Url::from_file_path(&md).expect("url");
        assert_eq!(
            urls_to_paths(&[
                url,
                url::Url::parse("https://example.org/a.md").expect("url")
            ]),
            [md]
        );
    }

    #[test]
    fn files_opened_before_the_page_is_ready_are_queued_for_take_pending_open_files() {
        let pages = Pages::default();

        assert_eq!(
            pages.route_files("main", vec!["/a.md".into()]),
            Routed::Queued
        );
        assert_eq!(pages.take_files("main"), ["/a.md"]);
        assert_eq!(
            pages.route_files("main", vec!["/b.md".into()]),
            Routed::Deliver(vec!["/b.md".into()])
        );
    }
}
