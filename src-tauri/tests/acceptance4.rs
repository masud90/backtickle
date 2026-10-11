//! Phase 4 acceptance D09 and D10 (WP4.8a1), through the public API of the library and the shipped
//! configuration files. Expected values come from
//! tests/fixtures/settings-defaults.json, not from the code under test.

use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use writedown_lib::settings::{Settings, SettingsStore};

const PREFERENCES_CAPABILITY: &str = include_str!("../capabilities/preferences.json");
const MAIN_CAPABILITY: &str = include_str!("../capabilities/main.json");
const BUILD_RS: &str = include_str!("../build.rs");
const DEFAULTS: &str = include_str!("../../tests/fixtures/settings-defaults.json");

fn scratch(name: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "wd-acc4-{}-{}-{}",
        name,
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn defaults() -> Value {
    serde_json::from_str(DEFAULTS).unwrap()
}

/// D09: the Preferences capability allows exactly the commands of, and nothing that opens
/// files, creates windows or answers the close protocol.
#[test]
fn d09_preferences_capability_allows_exactly_the_spec_commands() {
    let capability: Value = serde_json::from_str(PREFERENCES_CAPABILITY).unwrap();
    assert_eq!(capability["windows"], json!(["preferences"]));
    let granted: BTreeSet<String> = capability["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .map(|p| p.as_str().expect("string permission").to_string())
        .collect();

    // Spec 2.1: getSettings, updateSettings, onSettingsChanged (event listen), appVersion,
    // pandocInfo, choosePandoc, chooseDefaultFolder, closing its own window, dragging by the
    // title strip, appVersion and perfMark.
    let commands: BTreeSet<&str> = [
        "allow-get-settings",
        "allow-update-settings",
        "allow-app-version",
        "allow-pandoc-info",
        "allow-choose-pandoc",
        "allow-choose-default-folder",
        "allow-default-markdown-app",
        "allow-make-default-markdown-app",
        "allow-perf-mark",
    ]
    .into_iter()
    .collect();
    let command_grants: BTreeSet<&str> = granted
        .iter()
        .map(String::as_str)
        .filter(|p| p.starts_with("allow-"))
        .collect();
    assert_eq!(command_grants, commands, "our own commands");

    let core: BTreeSet<&str> = granted
        .iter()
        .map(String::as_str)
        .filter(|p| p.starts_with("core:"))
        .collect();
    for p in &core {
        assert!(
            p.starts_with("core:window:allow-")
                || p.starts_with("core:event:allow-listen")
                || p.starts_with("core:event:allow-unlisten"),
            "unexpected core permission {p}"
        );
        assert!(!p.contains("create") && !p.contains("webview") && !p.contains("emit"));
    }
    assert!(core.contains("core:window:allow-start-dragging"));
    assert!(core.contains("core:window:allow-close") || core.contains("core:window:allow-destroy"));
    assert!(core.contains("core:event:allow-listen"));
    assert_eq!(
        granted.len(),
        command_grants.len() + core.len(),
        "every permission is classified"
    );

    // The two new dialogs exist as commands and the main window does not get them.
    for command in ["choose_pandoc", "choose_default_folder"] {
        assert!(
            BUILD_RS.contains(&format!("\"{command}\"")),
            "{command} in build.rs"
        );
    }
    let main: Value = serde_json::from_str(MAIN_CAPABILITY).unwrap();
    let main_perms: Vec<&str> = main["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for denied in [
        "allow-ack-close",
        "allow-finish-close",
        "allow-cancel-close",
    ] {
        assert!(
            !granted.contains(denied),
            "Preferences must not have {denied}"
        );
        assert!(main_perms.contains(&denied), "main keeps {denied}");
    }
}

/// D10: every Phase 4 key wrong-typed loads as its default, every number out of range is clamped,
/// unknown choices fall back, and unknown keys survive the next write.
#[test]
fn d10_wrong_typed_new_keys_load_as_defaults() {
    let wrong = json!({
        "editor": { "fontFamily": 7, "lineHeight": "tall", "insertSpaces": "yes", "currentLine": 1,
                     "autoPair": "on", "continueLists": null, "paneHeaders": [] },
        "preview": { "autoDetectFlavor": "no", "font": false, "fontSize": "big", "columnWidth": {},
                      "hashtagPills": 1, "obsidianCommentsDimmed": "x", "smartPunctuation": 0,
                      "math": "true", "remoteImages": null, "codeCards": 3 },
        "a11y": { "dyslexia": "true", "dyslexiaFont": 5, "ruler": 1, "rulerTint": [],
                   "spotlight": "y", "reduceMotion": true, "highContrast": 9, "scale": "large" },
        "saving": { "autoSave": "yes", "newLineEnding": 2, "newFinalNewline": "no",
                     "defaultFolder": 12 }
    });
    let loaded = Settings::from_value(&wrong).to_value();
    let expected = defaults();
    for group in ["preview", "a11y", "saving"] {
        assert_eq!(
            loaded[group], expected[group],
            "{group} falls back to defaults"
        );
    }
    for key in [
        "fontFamily",
        "lineHeight",
        "insertSpaces",
        "currentLine",
        "autoPair",
        "continueLists",
        "paneHeaders",
    ] {
        assert_eq!(
            loaded["editor"][key], expected["editor"][key],
            "editor.{key}"
        );
    }
}

#[test]
fn d10_out_of_range_and_unknown_choices() {
    let wild = json!({
        "editor": { "lineHeight": 9.0, "fontFamily": "comic-sans" },
        "preview": { "fontSize": 99, "columnWidth": 100000, "font": "wingdings", "codeCards": "neon" },
        "a11y": { "scale": 3.0, "rulerTint": "red", "reduceMotion": "maybe", "highContrast": "auto",
                   "dyslexiaFont": "inter" },
        "saving": { "newLineEnding": "cr" }
    });
    let high = Settings::from_value(&wild).to_value();
    let d = defaults();
    assert_eq!(high["editor"]["lineHeight"], json!(2.4));
    assert_eq!(high["editor"]["fontFamily"], d["editor"]["fontFamily"]);
    assert_eq!(high["preview"]["fontSize"], json!(28));
    assert_eq!(high["preview"]["columnWidth"], json!(1040));
    assert_eq!(high["preview"]["font"], d["preview"]["font"]);
    assert_eq!(high["preview"]["codeCards"], d["preview"]["codeCards"]);
    assert_eq!(high["a11y"]["scale"], json!(1.5));
    for key in ["rulerTint", "reduceMotion", "highContrast", "dyslexiaFont"] {
        assert_eq!(high["a11y"][key], d["a11y"][key], "a11y.{key}");
    }
    assert_eq!(
        high["saving"]["newLineEnding"],
        d["saving"]["newLineEnding"]
    );

    let low = Settings::from_value(&json!({
        "editor": { "lineHeight": 0.1 },
        "preview": { "fontSize": 1, "columnWidth": 1 },
        "a11y": { "scale": 0.2 }
    }))
    .to_value();
    assert_eq!(low["editor"]["lineHeight"], json!(1.2));
    assert_eq!(low["preview"]["fontSize"], json!(12));
    assert_eq!(low["preview"]["columnWidth"], json!(560));
    assert_eq!(low["a11y"]["scale"], json!(1.0));
}

#[test]
fn d10_a_file_with_bad_values_loads_and_keeps_unknown_keys_on_the_next_write() {
    let dir = scratch("d10");
    let file = dir.join("settings.json");
    fs::write(
        &file,
        r#"{ "version": 1, "futureKey": { "nested": [1, 2, 3] },
             "preview": { "fontSize": "huge", "extraPreview": true, "math": "maybe" },
             "a11y": { "scale": 7, "unknownA11y": "keep" },
             "saving": { "autoSave": 5 } }"#,
    )
    .unwrap();
    let mut store = SettingsStore::load(file.clone());
    let value = store.get().to_value();
    assert_eq!(value["preview"]["fontSize"], json!(15));
    assert_eq!(value["preview"]["math"], json!(true));
    assert_eq!(value["a11y"]["scale"], json!(1.5));
    assert_eq!(value["saving"]["autoSave"], json!(false));

    let updated = store.update(&json!({ "a11y": { "ruler": true } }));
    assert!(updated.changed);
    let written: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(written["futureKey"], json!({ "nested": [1, 2, 3] }));
    assert_eq!(written["preview"]["extraPreview"], json!(true));
    assert_eq!(written["a11y"]["unknownA11y"], json!("keep"));
    assert_eq!(written["a11y"]["ruler"], json!(true));
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn d10_the_defaults_equal_the_fixture() {
    assert_eq!(Settings::from_value(&json!({})).to_value(), defaults());
    assert_eq!(
        Settings::from_value(&json!("not an object")).to_value(),
        defaults()
    );
}
