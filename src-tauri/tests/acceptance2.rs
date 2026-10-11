//! Phase 2 acceptance B31 (backend part), through the public API: `read_linked_text` refuses wrong
//! extensions, oversized, missing and executable files and, for embeds, anything outside the
//! vault; `vault_index` skips hidden folders and stops at 20,000 entries. (That no command starts
//! a process is `b31_no_rust_code_starts_a_process...` in `tests/config.rs`.) Every test writes
//! only inside its own temporary folder.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use writedown_lib::linked_text::{Purpose, read_linked_text};
use writedown_lib::vault::{MAX_INDEX_ENTRIES, vault_index};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("wd-acc2-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn b31_wrong_extensions_are_refused_for_every_purpose() {
    let dir = temp();
    let doc = dir.join("doc.md");
    write(&doc, "# d\n");
    for name in [
        "refs.txt",
        "refs.md",
        "tool.sh",
        "app.exe",
        "refs.bib.html",
        "noext",
    ] {
        write(&dir.join(name), "x");
    }
    for name in [
        "refs.txt",
        "refs.md",
        "tool.sh",
        "app.exe",
        "refs.bib.html",
        "noext",
    ] {
        assert!(
            read_linked_text(&doc, name, Purpose::Bibliography).is_err(),
            "bibliography {name}"
        );
    }
    for name in ["refs.bib", "tool.sh", "app.exe", "noext"] {
        write(&dir.join(name), "x");
        assert!(
            read_linked_text(&doc, name, Purpose::Include).is_err(),
            "include {name}"
        );
        assert!(
            read_linked_text(&doc, name, Purpose::Embed).is_err(),
            "embed {name}"
        );
    }
    // The allowed ones are read.
    write(&dir.join("ok.bib"), "@book{a,}");
    assert!(read_linked_text(&doc, "ok.bib", Purpose::Bibliography).is_ok());
    write(&dir.join("ok.qmd"), "# q");
    assert!(read_linked_text(&doc, "ok.qmd", Purpose::Include).is_ok());
}

#[test]
fn b31_an_executable_file_is_not_read_whatever_its_name_says_about_content() {
    let dir = temp();
    let doc = dir.join("doc.md");
    write(&doc, "# d\n");
    let script = dir.join("run");
    write(&script, "#!/bin/sh\necho hi\n");
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    for purpose in [Purpose::Bibliography, Purpose::Include, Purpose::Embed] {
        assert!(read_linked_text(&doc, "run", purpose).is_err());
    }
    // Even with an allowed extension the file is only ever read as text, never run.
    let named = dir.join("tool.bib");
    write(&named, "#!/bin/sh\necho hi\n");
    fs::set_permissions(&named, fs::Permissions::from_mode(0o755)).unwrap();
    let read = read_linked_text(&doc, "tool.bib", Purpose::Bibliography).unwrap();
    assert!(read.text.starts_with("#!/bin/sh"));
}

#[test]
fn b31_oversized_and_missing_files_are_refused() {
    let dir = temp();
    let doc = dir.join("doc.md");
    write(&doc, "# d\n");
    let big = "a".repeat(10 * 1024 * 1024 + 1);
    write(&dir.join("big.bib"), &big);
    assert!(read_linked_text(&doc, "big.bib", Purpose::Bibliography).is_err());
    write(&dir.join("fine.bib"), &"a".repeat(1024 * 1024));
    assert!(read_linked_text(&doc, "fine.bib", Purpose::Bibliography).is_ok());
    let five = "a".repeat(5 * 1024 * 1024 + 1);
    write(&dir.join("big.qmd"), &five);
    assert!(read_linked_text(&doc, "big.qmd", Purpose::Include).is_err());
    assert!(read_linked_text(&doc, "missing.bib", Purpose::Bibliography).is_err());
    assert!(read_linked_text(&doc, "missing.qmd", Purpose::Include).is_err());
    assert!(read_linked_text(&doc, "sub/", Purpose::Include).is_err());
}

#[test]
fn b31_embeds_stay_inside_the_vault() {
    let dir = temp();
    let vault = dir.join("vault");
    fs::create_dir_all(vault.join(".obsidian")).unwrap();
    let note = vault.join("Home.md");
    write(&note, "# home\n");
    write(&vault.join("sub/Inner.md"), "# inner\n");
    write(&dir.join("outside.md"), "# outside\n");
    assert!(read_linked_text(&note, "sub/Inner.md", Purpose::Embed).is_ok());
    assert!(read_linked_text(&note, "../outside.md", Purpose::Embed).is_err());
    let outside_doc = dir.join("loose.md");
    write(&outside_doc, "# loose\n");
    assert!(read_linked_text(&outside_doc, "outside.md", Purpose::Embed).is_err());
    // A link inside the vault that points out of it is refused too.
    std::os::unix::fs::symlink(dir.join("outside.md"), vault.join("Link.md")).unwrap();
    assert!(read_linked_text(&note, "Link.md", Purpose::Embed).is_err());
}

#[test]
fn b31_the_vault_index_skips_hidden_folders_and_caps_at_twenty_thousand() {
    let dir = temp();
    let vault = dir.join("v");
    fs::create_dir_all(vault.join(".obsidian")).unwrap();
    write(&vault.join("Home.md"), "# h\n");
    write(&vault.join(".hidden/Secret.md"), "s");
    write(&vault.join(".trash/Old.md"), "o");
    write(&vault.join("node_modules/x/README.md"), "r");
    write(&vault.join("Notes/A.md"), "a");
    write(&vault.join("img/p.png"), "p");
    write(&vault.join("doc.pdf"), "p");
    write(&vault.join("script.sh"), "p");
    let index = vault_index(&vault.join("Home.md")).expect("a vault");
    let mut notes = index.notes.clone();
    notes.sort();
    assert_eq!(notes, ["Home.md", "Notes/A.md"]);
    let mut attachments = index.attachments.clone();
    attachments.sort();
    assert_eq!(attachments, ["doc.pdf", "img/p.png"]);
    assert!(!index.truncated);

    assert_eq!(MAX_INDEX_ENTRIES, 20_000);
    let big = dir.join("big");
    fs::create_dir_all(big.join(".obsidian")).unwrap();
    write(&big.join("Home.md"), "# h\n");
    for folder in 0..21 {
        let sub = big.join(format!("d{folder}"));
        fs::create_dir_all(&sub).unwrap();
        for file in 0..1000 {
            fs::write(sub.join(format!("n{file}.md")), "").unwrap();
        }
    }
    let capped = vault_index(&big.join("Home.md")).expect("a vault");
    assert!(capped.truncated);
    assert_eq!(capped.notes.len() + capped.attachments.len(), 20_000);
}
