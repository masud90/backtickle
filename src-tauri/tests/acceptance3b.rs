//! Phase 3 acceptance C22, C26, C33 and the Rust part of C35 (WP3.8a2), through the public API of
//! the library only. Expected values are written from the specification. Every
//! test works inside its own temporary folder. The watcher tests use the real FSEvents backend.

// Some tests here need symbolic links or Unix permissions and run on macOS only.
#![cfg_attr(windows, allow(unused))]

use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use writedown_lib::doc_state::DocStates;
use writedown_lib::encoding::Encoding;
use writedown_lib::error::ErrorCode;
use writedown_lib::file_ops::{self, Trasher};
use writedown_lib::grants::PathGrants;
use writedown_lib::line_endings::LineEnding;
use writedown_lib::menu_spec::{self, Entry, MenuState, Need};
use writedown_lib::safe_save::{self, SaveFormat, SaveOptions};
use writedown_lib::session::{self, Session};
use writedown_lib::store;
use writedown_lib::stores::Stores;
use writedown_lib::watcher::{
    ChangeKind, FileChange, OwnWrites, ResolvedSet, Scope, Sink, Watcher,
};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A fresh canonical folder under the system temporary folder.
fn temp() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("wd-acc3b-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    writedown_lib::fs_util::canonicalize(&dir).unwrap()
}

fn write(path: &Path, text: &str) -> PathBuf {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
    path.to_path_buf()
}

// ---- C22: the watcher ------------------------------------------------------------------------

struct Harness {
    _watcher: Watcher,
    batches: Receiver<Vec<FileChange>>,
}

fn start(set: ResolvedSet) -> Harness {
    let (sender, batches) = mpsc::channel();
    let sender = Mutex::new(sender);
    let sink: Sink = Arc::new(move |changes| {
        let _ = sender.lock().unwrap().send(changes);
    });
    let watcher = Watcher::start(sink, OwnWrites::global()).expect("the watcher starts");
    watcher.set(set);
    // FSEvents may still report what happened just before it started.
    std::thread::sleep(Duration::from_millis(800));
    let harness = Harness {
        _watcher: watcher,
        batches,
    };
    while harness.batches.try_recv().is_ok() {}
    harness
}

fn folder_set(root: &Path) -> ResolvedSet {
    ResolvedSet {
        folder: Some(root.to_path_buf()),
        ..ResolvedSet::default()
    }
}

fn names(batch: &[FileChange]) -> Vec<(String, ChangeKind, Scope)> {
    let mut out: Vec<_> = batch
        .iter()
        .map(|change| {
            (
                Path::new(&change.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                change.kind,
                change.scope,
            )
        })
        .collect();
    out.sort();
    out
}

fn app_save(path: &Path, text: &str) {
    let format = SaveFormat {
        encoding: Encoding::Utf8,
        line_ending: LineEnding::Lf,
    };
    let options = SaveOptions {
        overwrite_external_change: true,
        ..SaveOptions::default()
    };
    safe_save::save(path, text, format, &options, None).expect("the app saves");
}

struct FolderTrash(PathBuf);

impl Trasher for FolderTrash {
    fn trash(&self, path: &Path) -> std::io::Result<()> {
        fs::rename(path, self.0.join(path.file_name().unwrap()))
    }
}

#[test]
fn c22_an_outside_write_create_and_remove_come_in_one_batch_within_a_second() {
    let root = temp();
    write(&root.join("edit.md"), "one");
    write(&root.join("gone.md"), "bye");
    let harness = start(folder_set(&root));

    let began = Instant::now();
    fs::write(root.join("edit.md"), "two, a longer text").unwrap();
    fs::write(root.join("fresh.md"), "new").unwrap();
    fs::remove_file(root.join("gone.md")).unwrap();
    let batch = harness
        .batches
        .recv_timeout(Duration::from_secs(1))
        .expect("a batch arrives within one second");
    assert!(began.elapsed() < Duration::from_secs(1));
    assert_eq!(
        names(&batch),
        vec![
            ("edit.md".to_owned(), ChangeKind::Modified, Scope::Folder),
            ("fresh.md".to_owned(), ChangeKind::Created, Scope::Folder),
            ("gone.md".to_owned(), ChangeKind::Removed, Scope::Folder),
        ]
    );
    assert!(
        harness
            .batches
            .recv_timeout(Duration::from_millis(500))
            .is_err(),
        "the three changes are one batch"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn c22_the_apps_own_save_rename_and_trash_report_nothing() {
    let root = temp();
    let bin = temp();
    let grants = PathGrants::default();
    let granted = grants.grant_folder(&root).unwrap();
    let saved = write(&granted.join("saved.md"), "start");
    let renamed_from = write(&granted.join("old-name.md"), "start");
    let trashed = write(&granted.join("trash-me.md"), "start");
    let harness = start(folder_set(&granted));

    app_save(&saved, "saved by the app, with more text");
    file_ops::rename_path(&grants, &renamed_from, "new-name.md").unwrap();
    file_ops::trash_path(&grants, &trashed, &FolderTrash(bin.clone())).unwrap();
    assert!(
        harness
            .batches
            .recv_timeout(Duration::from_millis(1000))
            .is_err(),
        "the app's own work is not an outside change"
    );

    // The same file written from outside afterwards is reported.
    fs::write(&saved, "an outside edit that is clearly longer than before").unwrap();
    let batch = harness
        .batches
        .recv_timeout(Duration::from_secs(1))
        .expect("the outside write is reported");
    assert_eq!(
        names(&batch),
        vec![("saved.md".to_owned(), ChangeKind::Modified, Scope::Folder)]
    );
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&bin);
}

#[test]
fn c22_a_watched_document_reports_only_its_own_path() {
    let root = temp();
    let document = write(&root.join("doc.md"), "one");
    let neighbor = write(&root.join("neighbor.md"), "one");
    let harness = start(ResolvedSet {
        documents: HashSet::from([document.clone()]),
        ..ResolvedSet::default()
    });
    fs::write(&neighbor, "changed neighbor").unwrap();
    fs::write(&document, "changed document").unwrap();
    let batch = harness
        .batches
        .recv_timeout(Duration::from_secs(1))
        .expect("a batch");
    assert_eq!(
        names(&batch),
        vec![("doc.md".to_owned(), ChangeKind::Modified, Scope::Document)]
    );
    let _ = fs::remove_dir_all(&root);
}

// ---- C26: stores that survive corruption, and grants ------------------------------------------

fn sample_session() -> Session {
    Session::from_value(&json!({
        "tabs": [
            { "path": "/tmp/a.md", "view": "preview" },
            { "path": "/tmp/b.md", "view": "split" }
        ],
        "active": 1,
        "folder": "/tmp",
        "sidebarTab": "files",
        "expanded": ["/tmp/sub"]
    }))
    .expect("a valid session")
}

#[test]
fn c26_a_corrupt_session_file_gives_no_session_and_is_kept_aside() {
    let dir = temp();
    let file = dir.join("session.json");
    fs::write(&file, "{ this is not json").unwrap();
    assert!(session::load(&file).is_none());
    let copy = store::corrupt_copy_path(&file);
    assert_eq!(fs::read_to_string(&copy).unwrap(), "{ this is not json");

    // Valid JSON of the wrong shape is no session either.
    for wrong in ["[]", "42", r#"{"tabs": 5}"#, r#"{"folder": "/x"}"#] {
        fs::write(&file, wrong).unwrap();
        assert!(session::load(&file).is_none(), "{wrong}");
    }

    // A good session round-trips.
    let good = sample_session();
    session::save(&file, &good).unwrap();
    assert_eq!(session::load(&file), Some(good));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn c26_a_session_with_bad_entries_keeps_the_good_ones() {
    let session = Session::from_value(&json!({
        "tabs": [
            { "path": "/tmp/a.md", "view": "preview" },
            { "view": "split" },
            { "path": "/tmp/c.md", "view": "no-such-view" },
            7
        ],
        "active": 99,
        "sidebarTab": "no-such-tab"
    }))
    .expect("a session");
    assert!(session.tabs.iter().any(|tab| tab.path == "/tmp/a.md"));
    assert!(session.tabs.iter().all(|tab| !tab.path.is_empty()));
    assert!(["editor", "split", "preview"].contains(&session.tabs[0].view.as_str()));
    assert!(session.active < session.tabs.len().max(1));
    assert!(["outline", "files", "search"].contains(&session.sidebar_tab.as_str()));
}

#[test]
fn c26_a_corrupt_document_state_file_starts_empty_and_a_good_one_round_trips() {
    let dir = temp();
    let file = dir.join("doc-state.json");
    fs::write(&file, "\u{0}\u{0} not json").unwrap();
    let mut states = DocStates::load(file.clone());
    assert!(states.is_empty());
    assert!(store::corrupt_copy_path(&file).exists());

    states.set(
        "/tmp/a.md",
        &json!({ "cursor": { "line": 12, "column": 3 }, "scrollLine": 9 }),
    );
    states.set(
        "/tmp/bad.md",
        &json!({ "cursor": { "line": 0, "column": 0 } }),
    );
    states.save().unwrap();

    let mut again = DocStates::load(file);
    assert_eq!(again.len(), 1, "a cursor on line 0 is not remembered");
    let (state, _) = again.get("/tmp/a.md");
    let cursor = state.cursor.expect("a cursor");
    assert_eq!((cursor.line, cursor.column), (12, 3));
    assert_eq!(state.scroll_line, Some(9));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn c26_the_stores_open_with_defaults_when_every_file_is_corrupt() {
    let data = temp();
    let config = temp();
    for name in ["recents.json", "doc-state.json", "session.json"] {
        fs::write(data.join(name), "garbage").unwrap();
    }
    fs::write(config.join("settings.json"), "garbage").unwrap();
    let stores = Stores::in_folders(&data, &config, None);
    assert!(
        stores.settings().restore_session,
        "settings fall back to the defaults"
    );
    assert!(stores.doc_states().is_empty());
    assert!(stores.load_session().is_none());
    assert!(stores.recent_entries().is_empty());
    let _ = fs::remove_dir_all(&data);
    let _ = fs::remove_dir_all(&config);
}

#[test]
fn c26_operations_outside_granted_folders_are_refused() {
    let granted_dir = temp();
    let other = temp();
    let grants = PathGrants::default();
    let root = grants.grant_folder(&granted_dir).unwrap();
    let inside = write(&root.join("in.md"), "x");
    let outside = write(&other.join("out.md"), "x");

    let code = |result: Result<PathBuf, writedown_lib::error::PlatformError>| {
        result.expect_err("refused").code
    };
    assert_eq!(
        code(file_ops::create_file(&grants, &other, "n.md")),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        code(file_ops::create_folder(&grants, &other, "n")),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        code(file_ops::rename_path(&grants, &outside, "r.md")),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        code(file_ops::duplicate_path(&grants, &outside)),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        code(file_ops::move_path(&grants, &outside, &root)),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        code(file_ops::move_path(&grants, &inside, &other)),
        ErrorCode::NotAllowed
    );
    assert_eq!(
        file_ops::trash_path(&grants, &outside, &FolderTrash(temp()))
            .expect_err("refused")
            .code,
        ErrorCode::NotAllowed
    );
    // A path that walks out with `..` while it starts with the folder is refused too.
    let sneaky = root
        .join("..")
        .join(other.file_name().unwrap())
        .join("out.md");
    assert_eq!(
        code(file_ops::rename_path(&grants, &sneaky, "r.md")),
        ErrorCode::NotAllowed
    );
    assert!(outside.exists(), "nothing outside was touched");

    // Inside, the refusals have their own codes.
    assert_eq!(
        code(file_ops::rename_path(&grants, &inside, "a/b.md")),
        ErrorCode::InvalidName
    );
    assert_eq!(
        code(file_ops::rename_path(&grants, &inside, ".hidden")),
        ErrorCode::InvalidName
    );
    write(&root.join("taken.md"), "y");
    assert_eq!(
        code(file_ops::rename_path(&grants, &inside, "taken.md")),
        ErrorCode::Exists
    );
    assert_eq!(
        code(file_ops::create_file(&grants, &root, "taken.md")),
        ErrorCode::Exists
    );
    let _ = fs::remove_dir_all(&granted_dir);
    let _ = fs::remove_dir_all(&other);
}

#[test]
fn c26_a_rename_or_move_takes_the_grant_with_the_item() {
    let dir = temp();
    let grants = PathGrants::default();
    let root = grants.grant_folder(&dir).unwrap();
    let sub = root.join("sub");
    fs::create_dir_all(&sub).unwrap();
    let file = write(&sub.join("note.md"), "x");

    // A folder inside the grant that is renamed still allows its files, under the new path.
    let renamed = file_ops::rename_path(&grants, &sub, "renamed").unwrap();
    assert!(grants.is_permitted(&renamed.join("note.md")));

    // A single granted file: after a rename the new path is granted and the old one is not.
    let lone_dir = temp();
    let lone = write(&lone_dir.join("lone.md"), "x");
    let granted = grants.grant(&lone).unwrap();
    assert!(grants.is_granted(&granted));
    let moved = file_ops::rename_path(&grants, &granted, "lone2.md").unwrap();
    assert!(grants.is_granted(&moved));
    assert!(!grants.is_granted(&granted));

    // A move into another granted folder keeps the file permitted there.
    let target = renamed.clone();
    let loose = write(&root.join("loose.md"), "x");
    let landed = file_ops::move_path(&grants, &loose, &target).unwrap();
    assert!(grants.is_permitted(&landed));
    assert!(file.parent().unwrap() != landed.parent().unwrap());
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&lone_dir);
}

// ---- C33: source scans -------------------------------------------------------------------------

fn rust_sources() -> Vec<(String, String)> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    for entry in fs::read_dir(&folder).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            out.push((name, fs::read_to_string(&path).unwrap()));
        }
    }
    assert!(out.len() > 30, "the scan found the source files");
    out
}

/// The part of a source file before its unit tests.
fn code_of(text: &str) -> &str {
    text.split("#[cfg(test)]").next().unwrap_or("")
}

#[test]
fn c33_command_new_appears_only_in_pandoc_rs() {
    let mut in_pandoc = false;
    for (name, text) in rust_sources() {
        let code = code_of(&text);
        for needle in ["Command::new", "process::Command", "process::{Command"] {
            if name == "pandoc.rs" {
                in_pandoc |= code.contains(needle);
            } else {
                assert!(!code.contains(needle), "{name} contains {needle}");
            }
        }
    }
    assert!(in_pandoc, "pandoc.rs is where Pandoc is started");
}

#[test]
fn c33_remove_file_and_remove_dir_appear_only_in_the_save_and_temporary_file_code() {
    let allowed = ["safe_save.rs", "fs_util.rs", "test_support.rs"];
    for (name, text) in rust_sources() {
        if allowed.contains(&name.as_str()) {
            continue;
        }
        let code = code_of(&text);
        for needle in ["remove_file", "remove_dir"] {
            assert!(!code.contains(needle), "{name} contains {needle}");
        }
    }
}

// ---- C35: menu items, shortcuts and enabling ----------------------------------------

fn item(id: &str) -> menu_spec::Item {
    **menu_spec::all_items()
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("menu item {id}"))
}

fn menu_entries(label: &str) -> &'static [Entry] {
    menu_spec::MENUS
        .iter()
        .find(|menu| menu.label == label)
        .unwrap_or_else(|| panic!("menu {label}"))
        .entries
}

fn position_of(entries: &[Entry], id: &str) -> usize {
    entries
        .iter()
        .position(|entry| matches!(entry, Entry::Item(item) if item.id == id))
        .unwrap_or_else(|| panic!("{id} is an item of this menu"))
}

fn submenu<'a>(entries: &'a [Entry], label: &str) -> &'a [Entry] {
    entries
        .iter()
        .find_map(|entry| match entry {
            Entry::Submenu { label: l, entries } if *l == label => Some(*entries),
            _ => None,
        })
        .unwrap_or_else(|| panic!("submenu {label}"))
}

#[test]
fn c35_shortcuts_of_the_new_items() {
    let expected: [(&str, Option<&str>); 14] = [
        ("open-folder", Some("CmdOrCtrl+Alt+O")),
        ("quick-open", Some("CmdOrCtrl+Shift+O")),
        ("search-folder", Some("CmdOrCtrl+Shift+F")),
        ("command-palette", Some("CmdOrCtrl+Shift+P")),
        ("print", Some("CmdOrCtrl+P")),
        ("paste-plain", Some("CmdOrCtrl+Alt+Shift+V")),
        ("duplicate", None),
        ("rename", None),
        ("move-to", None),
        ("revert", None),
        ("export-html", None),
        ("export-docx", None),
        ("copy-html", None),
        ("reveal-in-finder", None),
    ];
    for (id, accelerator) in expected {
        assert_eq!(item(id).accelerator, accelerator, "{id}");
    }
}

#[test]
fn c35_the_new_items_sit_where_the_spec_puts_them() {
    let file = menu_entries("File");
    assert!(position_of(file, "open-folder") > position_of(file, "open"));
    assert_eq!(
        position_of(file, "quick-open"),
        position_of(file, "open-folder") + 1
    );
    let save_as = position_of(file, "save-as");
    for (offset, id) in ["duplicate", "rename", "move-to", "revert"]
        .iter()
        .enumerate()
    {
        assert_eq!(position_of(file, id), save_as + 1 + offset, "{id}");
    }
    let export = submenu(file, "Export");
    assert_eq!(position_of(export, "export-html"), 0);
    assert_eq!(position_of(export, "export-docx"), 1);
    assert!(position_of(file, "print") > position_of(file, "revert"));
    assert_eq!(item("export-html").label, "HTML\u{2026}");
    assert_eq!(item("export-docx").label, "Word Document\u{2026}");

    let edit = menu_entries("Edit");
    let copy = edit
        .iter()
        .position(|entry| matches!(entry, Entry::Predefined(menu_spec::Predefined::Copy)))
        .unwrap();
    assert!(matches!(&edit[copy + 1], Entry::Item(i) if i.id == "copy-html"));
    let paste = edit
        .iter()
        .position(|entry| matches!(entry, Entry::Predefined(menu_spec::Predefined::Paste)))
        .unwrap();
    assert!(matches!(&edit[paste + 1], Entry::Item(i) if i.id == "paste-plain"));
    let find = submenu(edit, "Find");
    assert!(matches!(find.last(), Some(Entry::Item(i)) if i.id == "search-folder"));

    let view = menu_entries("View");
    assert!(matches!(&view[0], Entry::Item(i) if i.id == "command-palette"));
}

fn enabled(state: &MenuState, window_open: bool) -> impl Fn(&str) -> bool {
    let states = menu_spec::item_states(state, window_open);
    move |id: &str| states[id].enabled
}

#[test]
fn c35_always_enabled_items_work_without_a_window_or_a_document() {
    let state = MenuState::without_document();
    for window_open in [true, false] {
        let on = enabled(&state, window_open);
        for id in [
            "open-folder",
            "quick-open",
            "command-palette",
            "search-folder",
        ] {
            assert!(on(id), "{id} (window open: {window_open})");
        }
        for id in [
            "duplicate",
            "rename",
            "move-to",
            "revert",
            "copy-html",
            "export-html",
            "export-docx",
            "print",
            "paste-plain",
        ] {
            assert!(
                !on(id),
                "{id} needs a document (window open: {window_open})"
            );
        }
    }
}

#[test]
fn c35_file_items_need_a_saved_document_and_export_and_print_also_take_an_untitled_one() {
    let mut untitled = MenuState::without_document();
    untitled.has_document = true;
    untitled.tab_count = 1;
    let on = enabled(&untitled, true);
    for id in ["duplicate", "rename", "move-to", "revert", "copy-html"] {
        assert!(!on(id), "{id} needs a saved document");
    }
    assert!(on("export-html"));
    assert!(on("print"));
    assert!(!on("export-docx"), "no Pandoc");
    assert!(!on("paste-plain"), "the editor is not visible");

    let mut saved = untitled.clone();
    saved.has_path = true;
    let on = enabled(&saved, true);
    for id in [
        "duplicate",
        "rename",
        "move-to",
        "revert",
        "copy-html",
        "export-html",
        "print",
    ] {
        assert!(on(id), "{id}");
    }
    assert!(!on("export-docx"));

    let mut with_pandoc = saved.clone();
    with_pandoc.can_export_docx = true;
    assert!(enabled(&with_pandoc, true)("export-docx"));
    assert!(!enabled(&with_pandoc, false)("export-docx"), "no window");

    let mut editing = saved.clone();
    editing.can_format = true;
    assert!(enabled(&editing, true)("paste-plain"));
}

#[test]
fn c35_the_menu_state_fields_default_to_false_when_the_page_omits_them() {
    let state: MenuState = serde_json::from_value(json!({
        "hasDocument": true,
        "canSave": false,
        "canFormat": false,
        "viewMode": "split",
        "sidebarVisible": true,
        "syncScroll": true,
        "tabCount": 1
    }))
    .unwrap();
    assert!(!state.has_path);
    assert!(!state.can_export_docx);
    // Need is public: the new needs exist.
    let _ = (Need::SavedDocument, Need::CanExportDocx);
}

// ---- C32 (Rust part): the fixed argument list ---------------------------------------------------

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::time::Duration as StdDuration;
use writedown_lib::pandoc::{self, DocxRequest};

fn request(from: &str, citeproc: bool, input: &str, doc: Option<&Path>, out: &Path) -> DocxRequest {
    serde_json::from_value(json!({
        "docPath": doc.map(|p| p.to_string_lossy().into_owned()),
        "outPath": out.to_string_lossy(),
        "input": input,
        "from": from,
        "citeproc": citeproc,
    }))
    .unwrap()
}

#[test]
fn c32_the_argument_list_is_exactly_the_one_of_the_spec() {
    let out = Path::new("/tmp/out.docx");
    let resource = Path::new("/tmp/folder");
    let args = |from: &str, citeproc: bool| -> Vec<String> {
        pandoc::docx_args(from, citeproc, resource, out)
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    };
    assert_eq!(
        args("markdown", false),
        [
            "-f",
            "markdown",
            "--resource-path",
            "/tmp/folder",
            "-o",
            "/tmp/out.docx"
        ]
    );
    assert_eq!(
        args("gfm+tex_math_dollars", true),
        [
            "-f",
            "gfm+tex_math_dollars",
            "--citeproc",
            "--resource-path",
            "/tmp/folder",
            "-o",
            "/tmp/out.docx"
        ]
    );
    assert_eq!(
        pandoc::ROUTES,
        [
            "commonmark",
            "gfm+tex_math_dollars",
            "markdown",
            "markdown_mmd",
            "html"
        ]
    );
}

#[cfg(unix)]
#[test]
fn c32_a_document_cannot_add_arguments_and_the_input_goes_to_stdin_only() {
    let dir = temp();
    let doc = write(&dir.join("doc.md"), "x");
    let script = dir.join("fake-pandoc");
    fs::write(
        &script,
        "#!/bin/sh\n/usr/bin/printf '%s\\n' \"$@\" > \"$0.args\"\n/bin/cat > \"$0.stdin\"\n/bin/pwd > \"$0.cwd\"\n",
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    let out = dir.join("out.docx");
    let hostile =
        "--lua-filter=evil.lua\n---\npandoc-args: [--filter, evil]\n---\n$(touch pwned)\n";

    let result = pandoc::export_docx(
        &script,
        &request("markdown", true, hostile, Some(&doc), &out),
        &dir,
        StdDuration::from_secs(10),
    );
    assert!(result.is_ok(), "{result:?}");
    let args = fs::read_to_string(dir.join("fake-pandoc.args")).unwrap();
    assert_eq!(
        args,
        format!(
            "-f\nmarkdown\n--citeproc\n--resource-path\n{0}\n-o\n{1}\n",
            dir.display(),
            out.display()
        )
    );
    assert_eq!(
        fs::read_to_string(dir.join("fake-pandoc.stdin")).unwrap(),
        hostile
    );
    assert_eq!(
        fs::read_to_string(dir.join("fake-pandoc.cwd"))
            .unwrap()
            .trim(),
        dir.to_string_lossy()
    );
    assert!(!dir.join("pwned").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn c32_unknown_routes_and_non_docx_outputs_are_refused_before_anything_starts() {
    let dir = temp();
    let marker = dir.join("started");
    let script = dir.join("fake-pandoc");
    fs::write(
        &script,
        format!("#!/bin/sh\n/usr/bin/touch {}\n", marker.display()),
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    let docx = dir.join("o.docx");
    for (from, out) in [
        ("latex", docx.clone()),
        ("markdown --lua-filter=x", docx.clone()),
        ("markdown", dir.join("o.html")),
        ("markdown", dir.join("o")),
    ] {
        let result = pandoc::export_docx(
            &script,
            &request(from, false, "x", None, &out),
            &dir,
            StdDuration::from_secs(5),
        );
        assert!(result.is_err(), "{from} -> {}", out.display());
    }
    assert!(!marker.exists(), "no process was started");
    let _ = fs::remove_dir_all(&dir);
}
