//! Settings (Settings).
//!
//! One JSON file in the app config folder, schema version 1. Reading is forgiving, writing is
//! careful:
//!
//! - a value of the wrong type is replaced by its default, a number outside its range is
//!   clamped, an unknown choice falls back to the default;
//! - keys the app does not know are kept when the file is written, at every level, in the order
//!   they had (the file is meant to be edited by hand);
//! - an update is a deep partial object: only the keys it names change, and a patch value of the
//!   wrong type is ignored (the current value stays);
//! - `version` is always 1.
//!
//! The `Settings` struct is `Settings` in `src/lib/platform.ts`.

use crate::menu_spec;
use crate::store::{self, Loaded};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// `FlavorId` in `src/lib/platform.ts`.
pub const FLAVORS: [&str; 6] = ["commonmark", "gfm", "obsidian", "pandoc", "quarto", "mdx"];
const VIEW_MODES: [&str; 3] = ["editor", "split", "preview"];
const NEW_VIEW_MODES: [&str; 2] = ["editor", "split"];
const APPEARANCES: [&str; 3] = ["system", "light", "dark"];

pub const SCHEMA_VERSION: u32 = 1;
pub const RECENT_LIMIT_RANGE: (u32, u32) = (1, 100);
pub const READING_WPM_RANGE: (u32, u32) = (50, 1000);
pub const FONT_SIZE_RANGE: (u32, u32) = (9, 32);
pub const TAB_SIZE_RANGE: (u32, u32) = (1, 8);
pub const SIDEBAR_WIDTH_RANGE: (u32, u32) = (180, 480);
pub const SPLIT_RATIO_RANGE: (f64, f64) = (0.2, 0.8);
pub const ZOOM_RANGE: (f64, f64) = (0.5, 2.0);
pub const LINE_HEIGHT_RANGE: (f64, f64) = (1.2, 2.4);
pub const PREVIEW_FONT_SIZE_RANGE: (u32, u32) = (12, 28);
pub const COLUMN_WIDTH_RANGE: (u32, u32) = (560, 1040);
pub const SCALE_RANGE: (f64, f64) = (1.0, 1.5);
const EDITOR_FONTS: [&str; 3] = ["jetbrains-mono", "sf-mono", "menlo"];
const PREVIEW_FONTS: [&str; 6] = [
    "inter",
    "system",
    "literata",
    "atkinson",
    "lexend",
    "opendyslexic",
];
const DYSLEXIA_FONTS: [&str; 3] = ["opendyslexic", "atkinson", "lexend"];
const CODE_CARDS: [&str; 2] = ["dark", "light"];
const RULER_TINTS: [&str; 4] = ["yellow", "blue", "green", "pink"];
const TRI_STATES: [&str; 3] = ["system", "on", "off"];
const LINE_ENDINGS: [&str; 2] = ["lf", "crlf"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    /// `jetbrains-mono`, `sf-mono` or `menlo`.
    pub font_family: String,
    pub font_size: u32,
    /// 1.2 to 2.4.
    pub line_height: f64,
    pub insert_spaces: bool,
    pub current_line: bool,
    pub auto_pair: bool,
    pub continue_lists: bool,
    pub typewriter: bool,
    /// Live preview in the editor: syntax hidden outside the lines being edited.
    pub live_preview: bool,
    pub pane_headers: bool,
    pub tab_size: u32,
    pub soft_wrap: bool,
    pub line_numbers: bool,
    pub spellcheck: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSettings {
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub split_ratio: f64,
    pub sync_scroll: bool,
    pub zoom: f64,
}

/// Names that the Files tree, Quick Open and the search skip at any depth, besides every hidden
/// entry.
pub const DEFAULT_FILES_IGNORE: [&str; 6] = [
    "node_modules",
    "_site",
    "_freeze",
    "renv",
    "venv",
    "__pycache__",
];
/// At most this many ignored names are kept.
pub const MAX_IGNORED_NAMES: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesSettings {
    /// Names (not paths) skipped at any depth.
    pub ignore: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    /// The Pandoc to use for Word documents, or null to look for one. Only an absolute path
    /// whose file name is `pandoc` is accepted.
    pub pandoc_path: Option<String>,
}

/// Phase 4: the preview.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSettings {
    pub auto_detect_flavor: bool,
    pub font: String,
    pub font_size: u32,
    pub column_width: u32,
    pub hashtag_pills: bool,
    pub obsidian_comments_dimmed: bool,
    pub smart_punctuation: bool,
    pub math: bool,
    pub remote_images: bool,
    /// `dark` or `light`.
    pub code_cards: String,
}

/// Phase 4: accessibility.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A11ySettings {
    pub dyslexia: bool,
    pub dyslexia_font: String,
    pub ruler: bool,
    pub ruler_tint: String,
    pub spotlight: bool,
    /// `system`, `on` or `off`.
    pub reduce_motion: String,
    /// `system`, `on` or `off`.
    pub high_contrast: String,
    /// 1.0 to 1.5.
    pub scale: f64,
}

/// Phase 4: saving.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavingSettings {
    pub auto_save: bool,
    /// `lf` or `crlf`.
    pub new_line_ending: String,
    pub new_final_newline: bool,
    /// Where the Save dialog starts: an absolute path, or null. Existence is checked when used.
    pub default_folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    /// A `FlavorId`.
    pub default_flavor: String,
    /// `editor`, `split` or `preview`.
    pub open_existing_in: String,
    /// `editor` or `split`.
    pub open_new_in: String,
    pub recent_limit: u32,
    /// `system`, `light` or `dark`.
    pub appearance: String,
    pub reading_wpm: u32,
    pub editor: EditorSettings,
    pub view: ViewSettings,
    /// Phase 3: open the documents and the folder of the last session at launch.
    pub restore_session: bool,
    /// Phase 5: the macOS sidebar material behind the sidebar (default on).
    pub vibrancy: bool,
    /// Phase 5: shortcuts changed from the defaults, by command id; `None` removes the shortcut.
    pub shortcuts: BTreeMap<String, Option<String>>,
    pub files: FilesSettings,
    pub export: ExportSettings,
    pub preview: PreviewSettings,
    pub a11y: A11ySettings,
    pub saving: SavingSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: SCHEMA_VERSION,
            default_flavor: "gfm".to_owned(),
            open_existing_in: "preview".to_owned(),
            open_new_in: "split".to_owned(),
            recent_limit: 20,
            appearance: "system".to_owned(),
            reading_wpm: 238,
            editor: EditorSettings {
                font_family: "jetbrains-mono".to_owned(),
                font_size: 13,
                line_height: 1.7,
                insert_spaces: true,
                current_line: true,
                auto_pair: false,
                continue_lists: true,
                typewriter: false,
                live_preview: false,
                pane_headers: true,
                tab_size: 2,
                soft_wrap: true,
                line_numbers: true,
                spellcheck: true,
            },
            view: ViewSettings {
                sidebar_visible: true,
                sidebar_width: 240,
                split_ratio: 0.5,
                sync_scroll: true,
                zoom: 1.0,
            },
            restore_session: true,
            vibrancy: true,
            shortcuts: BTreeMap::new(),
            files: FilesSettings {
                ignore: DEFAULT_FILES_IGNORE
                    .iter()
                    .map(|name| (*name).to_owned())
                    .collect(),
            },
            export: ExportSettings { pandoc_path: None },
            preview: PreviewSettings {
                auto_detect_flavor: true,
                font: "inter".to_owned(),
                font_size: 15,
                column_width: 720,
                hashtag_pills: false,
                obsidian_comments_dimmed: false,
                smart_punctuation: true,
                math: true,
                remote_images: true,
                code_cards: "dark".to_owned(),
            },
            a11y: A11ySettings {
                dyslexia: false,
                dyslexia_font: "opendyslexic".to_owned(),
                ruler: false,
                ruler_tint: "yellow".to_owned(),
                spotlight: false,
                reduce_motion: "system".to_owned(),
                high_contrast: "system".to_owned(),
                scale: 1.0,
            },
            saving: SavingSettings {
                auto_save: false,
                new_line_ending: "lf".to_owned(),
                new_final_newline: false,
                default_folder: None,
            },
        }
    }
}

/// A whole number from a JSON number, rounded and clamped; anything else keeps `fallback`.
fn pick_int(source: Option<&Value>, fallback: u32, (min, max): (u32, u32)) -> u32 {
    match source.and_then(Value::as_f64) {
        Some(number) if number.is_finite() => {
            number.round().clamp(f64::from(min), f64::from(max)) as u32
        }
        _ => fallback,
    }
}

fn pick_float(source: Option<&Value>, fallback: f64, (min, max): (f64, f64)) -> f64 {
    match source.and_then(Value::as_f64) {
        Some(number) if number.is_finite() => number.clamp(min, max),
        _ => fallback,
    }
}

fn pick_bool(source: Option<&Value>, fallback: bool) -> bool {
    source.and_then(Value::as_bool).unwrap_or(fallback)
}

fn pick_choice(source: Option<&Value>, allowed: &[&str], fallback: &str) -> String {
    match source.and_then(Value::as_str) {
        Some(text) if allowed.contains(&text) => text.to_owned(),
        _ => fallback.to_owned(),
    }
}

/// A list of names from a JSON array: strings only, trimmed, not empty, without a `/`, no
/// duplicates, at most `MAX_IGNORED_NAMES`. Anything that is not an array keeps `fallback`.
fn pick_names(source: Option<&Value>, fallback: &[String]) -> Vec<String> {
    let Some(list) = source.and_then(Value::as_array) else {
        return fallback.to_vec();
    };
    let mut names: Vec<String> = Vec::new();
    for name in list.iter().filter_map(Value::as_str).map(str::trim) {
        if !name.is_empty()
            && name.len() <= 255
            && !name.contains('/')
            && !name.contains('\0')
            && !names.iter().any(|seen| seen == name)
        {
            names.push(name.to_owned());
        }
    }
    names.truncate(MAX_IGNORED_NAMES);
    names
}

/// The shortcut overrides: an object of command id to a shortcut string or null. Unknown commands
/// and strings that do not parse are dropped; the object replaces the old one (a patch carries
/// all of them). Anything that is not an object keeps `fallback`.
fn pick_shortcuts(
    source: Option<&Value>,
    fallback: &BTreeMap<String, Option<String>>,
) -> BTreeMap<String, Option<String>> {
    let Some(object) = source.and_then(Value::as_object) else {
        return fallback.clone();
    };
    let mut out = BTreeMap::new();
    for (id, value) in object {
        if !menu_spec::is_shortcut_command(id) {
            continue;
        }
        match value {
            Value::Null => {
                out.insert(id.clone(), None);
            }
            Value::String(text) => {
                if let Some(canonical) = menu_spec::canonical_shortcut(text) {
                    out.insert(id.clone(), Some(canonical));
                }
            }
            _ => {}
        }
    }
    out
}

/// The Pandoc path: null (or an empty string) clears it, an absolute path to a file named
/// `pandoc` (`pandoc.exe` on Windows) sets it, anything else keeps `fallback`.
fn pick_pandoc_path(source: Option<&Value>, fallback: &Option<String>) -> Option<String> {
    match source {
        Some(Value::Null) => None,
        Some(Value::String(path)) if path.is_empty() => None,
        Some(Value::String(path))
            if std::path::Path::new(path).is_absolute()
                && path.len() <= 1024
                && !path.contains('\0')
                && crate::dialogs::is_pandoc_name(std::path::Path::new(path)) =>
        {
            Some(path.clone())
        }
        _ => fallback.clone(),
    }
}

/// The default folder: null (or an empty string) clears it, an absolute path sets it, anything
/// else keeps `fallback`. Whether the folder exists is checked when it is used.
fn pick_folder_path(source: Option<&Value>, fallback: &Option<String>) -> Option<String> {
    match source {
        Some(Value::Null) => None,
        Some(Value::String(path)) if path.is_empty() => None,
        Some(Value::String(path))
            if std::path::Path::new(path).is_absolute()
                && path.len() <= 1024
                && !path.contains('\0') =>
        {
            Some(path.clone())
        }
        _ => fallback.clone(),
    }
}

impl Settings {
    /// The settings in `source`: every missing or invalid value comes from `base`, every
    /// number is clamped. `from_value` is this with the defaults as the base; `apply_patch` is
    /// this with the current settings as the base.
    pub fn merged(base: &Settings, source: &Value) -> Settings {
        let editor_source = source.get("editor");
        let view_source = source.get("view");
        let editor = |key: &str| editor_source.and_then(|section| section.get(key));
        let view = |key: &str| view_source.and_then(|section| section.get(key));
        let files_source = source.get("files");
        let export_source = source.get("export");
        let preview_source = source.get("preview");
        let a11y_source = source.get("a11y");
        let saving_source = source.get("saving");
        let preview = |key: &str| preview_source.and_then(|section| section.get(key));
        let a11y = |key: &str| a11y_source.and_then(|section| section.get(key));
        let saving = |key: &str| saving_source.and_then(|section| section.get(key));
        let get = |key: &str| source.get(key);
        Settings {
            version: SCHEMA_VERSION,
            default_flavor: pick_choice(get("defaultFlavor"), &FLAVORS, &base.default_flavor),
            open_existing_in: pick_choice(
                get("openExistingIn"),
                &VIEW_MODES,
                &base.open_existing_in,
            ),
            open_new_in: pick_choice(get("openNewIn"), &NEW_VIEW_MODES, &base.open_new_in),
            recent_limit: pick_int(get("recentLimit"), base.recent_limit, RECENT_LIMIT_RANGE),
            appearance: pick_choice(get("appearance"), &APPEARANCES, &base.appearance),
            reading_wpm: pick_int(get("readingWpm"), base.reading_wpm, READING_WPM_RANGE),
            editor: EditorSettings {
                font_family: pick_choice(
                    editor("fontFamily"),
                    &EDITOR_FONTS,
                    &base.editor.font_family,
                ),
                line_height: pick_float(
                    editor("lineHeight"),
                    base.editor.line_height,
                    LINE_HEIGHT_RANGE,
                ),
                insert_spaces: pick_bool(editor("insertSpaces"), base.editor.insert_spaces),
                current_line: pick_bool(editor("currentLine"), base.editor.current_line),
                auto_pair: pick_bool(editor("autoPair"), base.editor.auto_pair),
                continue_lists: pick_bool(editor("continueLists"), base.editor.continue_lists),
                typewriter: pick_bool(editor("typewriter"), base.editor.typewriter),
                live_preview: pick_bool(editor("livePreview"), base.editor.live_preview),
                pane_headers: pick_bool(editor("paneHeaders"), base.editor.pane_headers),
                font_size: pick_int(editor("fontSize"), base.editor.font_size, FONT_SIZE_RANGE),
                tab_size: pick_int(editor("tabSize"), base.editor.tab_size, TAB_SIZE_RANGE),
                soft_wrap: pick_bool(editor("softWrap"), base.editor.soft_wrap),
                line_numbers: pick_bool(editor("lineNumbers"), base.editor.line_numbers),
                spellcheck: pick_bool(editor("spellcheck"), base.editor.spellcheck),
            },
            view: ViewSettings {
                sidebar_visible: pick_bool(view("sidebarVisible"), base.view.sidebar_visible),
                sidebar_width: pick_int(
                    view("sidebarWidth"),
                    base.view.sidebar_width,
                    SIDEBAR_WIDTH_RANGE,
                ),
                split_ratio: pick_float(
                    view("splitRatio"),
                    base.view.split_ratio,
                    SPLIT_RATIO_RANGE,
                ),
                sync_scroll: pick_bool(view("syncScroll"), base.view.sync_scroll),
                zoom: pick_float(view("zoom"), base.view.zoom, ZOOM_RANGE),
            },
            restore_session: pick_bool(get("restoreSession"), base.restore_session),
            vibrancy: pick_bool(get("vibrancy"), base.vibrancy),
            shortcuts: pick_shortcuts(get("shortcuts"), &base.shortcuts),
            files: FilesSettings {
                ignore: pick_names(
                    files_source.and_then(|section| section.get("ignore")),
                    &base.files.ignore,
                ),
            },
            export: ExportSettings {
                pandoc_path: pick_pandoc_path(
                    export_source.and_then(|section| section.get("pandocPath")),
                    &base.export.pandoc_path,
                ),
            },
            preview: PreviewSettings {
                auto_detect_flavor: pick_bool(
                    preview("autoDetectFlavor"),
                    base.preview.auto_detect_flavor,
                ),
                font: pick_choice(preview("font"), &PREVIEW_FONTS, &base.preview.font),
                font_size: pick_int(
                    preview("fontSize"),
                    base.preview.font_size,
                    PREVIEW_FONT_SIZE_RANGE,
                ),
                column_width: pick_int(
                    preview("columnWidth"),
                    base.preview.column_width,
                    COLUMN_WIDTH_RANGE,
                ),
                hashtag_pills: pick_bool(preview("hashtagPills"), base.preview.hashtag_pills),
                obsidian_comments_dimmed: pick_bool(
                    preview("obsidianCommentsDimmed"),
                    base.preview.obsidian_comments_dimmed,
                ),
                smart_punctuation: pick_bool(
                    preview("smartPunctuation"),
                    base.preview.smart_punctuation,
                ),
                math: pick_bool(preview("math"), base.preview.math),
                remote_images: pick_bool(preview("remoteImages"), base.preview.remote_images),
                code_cards: pick_choice(
                    preview("codeCards"),
                    &CODE_CARDS,
                    &base.preview.code_cards,
                ),
            },
            a11y: A11ySettings {
                dyslexia: pick_bool(a11y("dyslexia"), base.a11y.dyslexia),
                dyslexia_font: pick_choice(
                    a11y("dyslexiaFont"),
                    &DYSLEXIA_FONTS,
                    &base.a11y.dyslexia_font,
                ),
                ruler: pick_bool(a11y("ruler"), base.a11y.ruler),
                ruler_tint: pick_choice(a11y("rulerTint"), &RULER_TINTS, &base.a11y.ruler_tint),
                spotlight: pick_bool(a11y("spotlight"), base.a11y.spotlight),
                reduce_motion: pick_choice(
                    a11y("reduceMotion"),
                    &TRI_STATES,
                    &base.a11y.reduce_motion,
                ),
                high_contrast: pick_choice(
                    a11y("highContrast"),
                    &TRI_STATES,
                    &base.a11y.high_contrast,
                ),
                scale: pick_float(a11y("scale"), base.a11y.scale, SCALE_RANGE),
            },
            saving: SavingSettings {
                auto_save: pick_bool(saving("autoSave"), base.saving.auto_save),
                new_line_ending: pick_choice(
                    saving("newLineEnding"),
                    &LINE_ENDINGS,
                    &base.saving.new_line_ending,
                ),
                new_final_newline: pick_bool(
                    saving("newFinalNewline"),
                    base.saving.new_final_newline,
                ),
                default_folder: pick_folder_path(
                    saving("defaultFolder"),
                    &base.saving.default_folder,
                ),
            },
        }
    }

    /// The settings stored in a parsed file (anything that is not an object gives the defaults).
    pub fn from_value(value: &Value) -> Settings {
        Settings::merged(&Settings::default(), value)
    }

    /// These settings with a deep partial update applied.
    pub fn apply_patch(&self, patch: &Value) -> Settings {
        Settings::merged(self, patch)
    }

    /// The settings as the JSON object that is written to the file.
    pub fn to_value(&self) -> Value {
        json!({
            "version": self.version,
            "defaultFlavor": self.default_flavor,
            "openExistingIn": self.open_existing_in,
            "openNewIn": self.open_new_in,
            "recentLimit": self.recent_limit,
            "appearance": self.appearance,
            "readingWpm": self.reading_wpm,
            "editor": {
                "fontFamily": self.editor.font_family,
                "lineHeight": self.editor.line_height,
                "insertSpaces": self.editor.insert_spaces,
                "currentLine": self.editor.current_line,
                "autoPair": self.editor.auto_pair,
                "continueLists": self.editor.continue_lists,
                "typewriter": self.editor.typewriter,
                "livePreview": self.editor.live_preview,
                "paneHeaders": self.editor.pane_headers,
                "fontSize": self.editor.font_size,
                "tabSize": self.editor.tab_size,
                "softWrap": self.editor.soft_wrap,
                "lineNumbers": self.editor.line_numbers,
                "spellcheck": self.editor.spellcheck,
            },
            "view": {
                "sidebarVisible": self.view.sidebar_visible,
                "sidebarWidth": self.view.sidebar_width,
                "splitRatio": self.view.split_ratio,
                "syncScroll": self.view.sync_scroll,
                "zoom": self.view.zoom,
            },
            "restoreSession": self.restore_session,
            "vibrancy": self.vibrancy,
            "shortcuts": self.shortcuts,
            "files": { "ignore": self.files.ignore },
            "export": { "pandocPath": self.export.pandoc_path },
            "preview": {
                "autoDetectFlavor": self.preview.auto_detect_flavor,
                "font": self.preview.font,
                "fontSize": self.preview.font_size,
                "columnWidth": self.preview.column_width,
                "hashtagPills": self.preview.hashtag_pills,
                "obsidianCommentsDimmed": self.preview.obsidian_comments_dimmed,
                "smartPunctuation": self.preview.smart_punctuation,
                "math": self.preview.math,
                "remoteImages": self.preview.remote_images,
                "codeCards": self.preview.code_cards,
            },
            "a11y": {
                "dyslexia": self.a11y.dyslexia,
                "dyslexiaFont": self.a11y.dyslexia_font,
                "ruler": self.a11y.ruler,
                "rulerTint": self.a11y.ruler_tint,
                "spotlight": self.a11y.spotlight,
                "reduceMotion": self.a11y.reduce_motion,
                "highContrast": self.a11y.high_contrast,
                "scale": self.a11y.scale,
            },
            "saving": {
                "autoSave": self.saving.auto_save,
                "newLineEnding": self.saving.new_line_ending,
                "newFinalNewline": self.saving.new_final_newline,
                "defaultFolder": self.saving.default_folder,
            },
        })
    }
}

/// Writes `top` over `base`: objects are merged key by key, everything else is replaced. A key
/// that is only in `base` stays, and a key keeps its place.
fn overlay(base: &mut Map<String, Value>, top: &Value) {
    let Some(top) = top.as_object() else {
        return;
    };
    for (key, value) in top {
        // The shortcut overrides are replaced as a whole, so that a reset removes entries.
        if key == "shortcuts" {
            base.insert(key.clone(), value.clone());
            continue;
        }
        match (base.get_mut(key), value) {
            (Some(Value::Object(inner)), Value::Object(_)) => overlay(inner, value),
            _ => {
                base.insert(key.clone(), value.clone());
            }
        }
    }
}

/// What an update did.
#[derive(Debug, Clone, PartialEq)]
pub struct Updated {
    pub settings: Settings,
    /// The settings differ from before (so the change must be broadcast).
    pub changed: bool,
    /// The file was written. False if nothing changed or the write failed.
    pub saved: bool,
}

/// The settings in memory and the file they are stored in.
pub struct SettingsStore {
    file: PathBuf,
    /// Everything that was in the file, including keys this version does not know.
    raw: Map<String, Value>,
    current: Settings,
}

impl SettingsStore {
    /// Reads the file. A missing file gives the defaults; a broken one gives the defaults too
    /// and is kept as `<name>.corrupt` until the next write replaces it.
    pub fn load(file: PathBuf) -> Self {
        let raw = match store::read_json(&file) {
            Loaded::Valid(Value::Object(map)) => map,
            Loaded::Valid(_) => {
                store::quarantine(&file);
                Map::new()
            }
            Loaded::Missing | Loaded::Corrupt => Map::new(),
        };
        let current = Settings::from_value(&Value::Object(raw.clone()));
        SettingsStore { file, raw, current }
    }

    pub fn get(&self) -> &Settings {
        &self.current
    }

    /// Applies a deep partial update, and writes the file if anything changed. The new
    /// settings are used even if the write fails (`saved` is then false).
    pub fn update(&mut self, patch: &Value) -> Updated {
        let next = self.current.apply_patch(patch);
        if next == self.current {
            return Updated {
                settings: next,
                changed: false,
                saved: false,
            };
        }
        let mut raw = self.raw.clone();
        overlay(&mut raw, &next.to_value());
        let saved = store::write_json(&self.file, &Value::Object(raw.clone())).is_ok();
        self.raw = raw;
        self.current = next.clone();
        Updated {
            settings: next,
            changed: true,
            saved,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn store_in(dir: &TempDir) -> SettingsStore {
        SettingsStore::load(dir.path().join("settings.json"))
    }

    fn file_json(dir: &TempDir) -> Value {
        let text = std::fs::read_to_string(dir.path().join("settings.json")).expect("read");
        serde_json::from_str(&text).expect("json")
    }

    // ---- defaults ------------------------------------------------------------------------

    #[test]
    fn r06_the_defaults_are_the_ones_of_the_spec() {
        let settings = Settings::default();

        assert_eq!(settings.version, 1);
        assert_eq!(settings.default_flavor, "gfm");
        assert_eq!(settings.open_existing_in, "preview");
        assert_eq!(settings.open_new_in, "split");
        assert_eq!(settings.recent_limit, 20);
        assert_eq!(settings.appearance, "system");
        assert_eq!(settings.reading_wpm, 238);
        assert_eq!(settings.editor.font_size, 13);
        assert_eq!(settings.editor.tab_size, 2);
        assert_eq!(settings.view.sidebar_width, 240);
        assert_eq!(settings.view.split_ratio, 0.5);
        assert_eq!(settings.view.zoom, 1.0);
    }

    #[test]
    fn the_boolean_defaults_match_the_phase_zero_editor_and_the_mock() {
        let settings = Settings::default();

        assert!(settings.editor.soft_wrap && settings.editor.line_numbers);
        assert!(settings.editor.spellcheck);
        assert!(settings.view.sidebar_visible && settings.view.sync_scroll);
    }

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let dir = TempDir::new();

        assert_eq!(*store_in(&dir).get(), Settings::default());
    }

    #[test]
    fn an_empty_object_and_non_objects_give_the_defaults() {
        for value in [
            json!({}),
            json!(null),
            json!([1, 2]),
            json!("text"),
            json!(7),
        ] {
            assert_eq!(Settings::from_value(&value), Settings::default(), "{value}");
        }
    }

    // ---- clamping ------------------------------------------------------------------------

    #[test]
    fn r06_numbers_are_clamped_into_their_ranges() {
        let low = Settings::from_value(&json!({
            "recentLimit": 0, "readingWpm": 1,
            "editor": { "fontSize": 2, "tabSize": 0 },
            "view": { "sidebarWidth": 10, "splitRatio": 0.0, "zoom": 0.1 }
        }));
        let high = Settings::from_value(&json!({
            "recentLimit": 5000, "readingWpm": 99999,
            "editor": { "fontSize": 400, "tabSize": 40 },
            "view": { "sidebarWidth": 9000, "splitRatio": 3.0, "zoom": 10 }
        }));

        assert_eq!((low.recent_limit, high.recent_limit), (1, 100));
        assert_eq!((low.reading_wpm, high.reading_wpm), (50, 1000));
        assert_eq!((low.editor.font_size, high.editor.font_size), (9, 32));
        assert_eq!((low.editor.tab_size, high.editor.tab_size), (1, 8));
        assert_eq!(
            (low.view.sidebar_width, high.view.sidebar_width),
            (180, 480)
        );
        assert_eq!((low.view.split_ratio, high.view.split_ratio), (0.2, 0.8));
        assert_eq!((low.view.zoom, high.view.zoom), (0.5, 2.0));
    }

    #[test]
    fn values_on_the_edges_of_their_ranges_are_kept() {
        let settings = Settings::from_value(&json!({
            "recentLimit": 100, "readingWpm": 50,
            "editor": { "fontSize": 9, "tabSize": 8 },
            "view": { "sidebarWidth": 480, "splitRatio": 0.2, "zoom": 2 }
        }));

        assert_eq!(settings.recent_limit, 100);
        assert_eq!(settings.reading_wpm, 50);
        assert_eq!(settings.editor.font_size, 9);
        assert_eq!(settings.editor.tab_size, 8);
        assert_eq!(settings.view.sidebar_width, 480);
        assert_eq!(settings.view.split_ratio, 0.2);
        assert_eq!(settings.view.zoom, 2.0);
    }

    #[test]
    fn whole_number_settings_given_as_fractions_are_rounded() {
        let settings = Settings::from_value(&json!({
            "editor": { "fontSize": 13.6, "tabSize": 3.2 }, "readingWpm": 238.5
        }));

        assert_eq!(settings.editor.font_size, 14);
        assert_eq!(settings.editor.tab_size, 3);
        assert_eq!(settings.reading_wpm, 239);
    }

    #[test]
    fn fractions_stay_fractions() {
        let settings =
            Settings::from_value(&json!({ "view": { "splitRatio": 0.35, "zoom": 1.25 } }));

        assert_eq!(settings.view.split_ratio, 0.35);
        assert_eq!(settings.view.zoom, 1.25);
    }

    // ---- wrong types ---------------------------------------------------------------------

    #[test]
    fn r06_values_of_the_wrong_type_are_replaced_by_defaults() {
        let settings = Settings::from_value(&json!({
            "defaultFlavor": 7,
            "openExistingIn": true,
            "openNewIn": ["editor"],
            "recentLimit": "twenty",
            "appearance": null,
            "readingWpm": { "wpm": 200 },
            "editor": { "fontSize": "big", "tabSize": null, "softWrap": "yes", "lineNumbers": 1, "spellcheck": [] },
            "view": { "sidebarVisible": "no", "sidebarWidth": false, "splitRatio": "half", "syncScroll": 0, "zoom": "2x" }
        }));

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn sections_that_are_not_objects_are_replaced_by_their_defaults() {
        let settings = Settings::from_value(&json!({ "editor": 5, "view": "wide" }));

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn unknown_choices_fall_back_to_the_default() {
        let settings = Settings::from_value(&json!({
            "defaultFlavor": "markdown-extra",
            "openExistingIn": "side-by-side",
            "openNewIn": "preview",
            "appearance": "sepia"
        }));

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn every_valid_choice_is_accepted() {
        for flavor in FLAVORS {
            let settings = Settings::from_value(&json!({ "defaultFlavor": flavor }));
            assert_eq!(settings.default_flavor, flavor);
        }
        for mode in ["editor", "split", "preview"] {
            assert_eq!(
                Settings::from_value(&json!({ "openExistingIn": mode })).open_existing_in,
                mode
            );
        }
        for mode in ["editor", "split"] {
            assert_eq!(
                Settings::from_value(&json!({ "openNewIn": mode })).open_new_in,
                mode
            );
        }
        for appearance in ["system", "light", "dark"] {
            assert_eq!(
                Settings::from_value(&json!({ "appearance": appearance })).appearance,
                appearance
            );
        }
    }

    #[test]
    fn one_bad_value_does_not_spoil_its_neighbours() {
        let settings = Settings::from_value(&json!({
            "editor": { "fontSize": "huge", "tabSize": 4, "softWrap": false }
        }));

        assert_eq!(settings.editor.font_size, 13);
        assert_eq!(settings.editor.tab_size, 4);
        assert!(!settings.editor.soft_wrap);
    }

    // ---- version -------------------------------------------------------------------------

    #[test]
    fn r06_the_version_is_always_one() {
        for value in [
            json!({}),
            json!({ "version": 1 }),
            json!({ "version": 2 }),
            json!({ "version": "one" }),
            json!({ "version": null }),
        ] {
            assert_eq!(Settings::from_value(&value).version, 1, "{value}");
        }
    }

    #[test]
    fn a_file_with_another_version_is_written_back_as_version_one() {
        let dir = TempDir::new();
        dir.write("settings.json", br#"{"version": 9, "appearance": "dark"}"#);
        let mut store = store_in(&dir);

        assert_eq!(store.get().appearance, "dark");
        store.update(&json!({ "readingWpm": 300 }));

        assert_eq!(file_json(&dir)["version"], 1);
    }

    // ---- patches -------------------------------------------------------------------------

    #[test]
    fn a_patch_changes_only_the_keys_it_names() {
        let current = Settings::from_value(&json!({
            "appearance": "dark", "editor": { "fontSize": 16, "tabSize": 4 }
        }));

        let next = current.apply_patch(&json!({ "editor": { "tabSize": 8 }, "readingWpm": 300 }));

        assert_eq!(next.appearance, "dark");
        assert_eq!(
            next.editor.font_size, 16,
            "a key the patch does not name stays"
        );
        assert_eq!(next.editor.tab_size, 8);
        assert_eq!(next.reading_wpm, 300);
    }

    #[test]
    fn a_patch_value_of_the_wrong_type_is_ignored_and_keeps_the_current_value() {
        let current = Settings::from_value(&json!({ "recentLimit": 50, "appearance": "dark" }));

        let next = current.apply_patch(&json!({ "recentLimit": "ten", "appearance": 3 }));

        assert_eq!(next.recent_limit, 50);
        assert_eq!(next.appearance, "dark");
    }

    #[test]
    fn a_patch_value_out_of_range_is_clamped() {
        let next =
            Settings::default().apply_patch(&json!({ "view": { "zoom": 9, "sidebarWidth": 1 } }));

        assert_eq!(next.view.zoom, 2.0);
        assert_eq!(next.view.sidebar_width, 180);
    }

    // ---- the store -----------------------------------------------------------------------

    #[test]
    fn an_update_is_written_and_survives_a_restart() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);

        let updated =
            store.update(&json!({ "appearance": "dark", "view": { "syncScroll": false } }));

        assert!(updated.changed && updated.saved);
        assert_eq!(updated.settings.appearance, "dark");
        let reloaded = store_in(&dir);
        assert_eq!(reloaded.get().appearance, "dark");
        assert!(!reloaded.get().view.sync_scroll);
        assert_eq!(reloaded.get().editor, Settings::default().editor);
    }

    #[test]
    fn the_written_file_has_every_known_key_in_the_documented_layout() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);

        store.update(&json!({ "recentLimit": 30 }));

        assert_eq!(file_json(&dir), {
            let mut expected = Settings::default().to_value();
            expected["recentLimit"] = json!(30);
            expected
        });
    }

    #[test]
    fn r06_unknown_keys_are_preserved_when_the_file_is_written() {
        let dir = TempDir::new();
        dir.write(
            "settings.json",
            br#"{
              "note": "kept",
              "version": 1,
              "appearance": "light",
              "editor": { "fontSize": 15, "ligatures": true },
              "experimental": { "a": [1, 2, 3] }
            }"#,
        );
        let mut store = store_in(&dir);

        store.update(&json!({ "appearance": "dark", "editor": { "tabSize": 4 } }));

        let written = file_json(&dir);
        assert_eq!(written["note"], "kept");
        assert_eq!(written["experimental"], json!({ "a": [1, 2, 3] }));
        assert_eq!(
            written["editor"]["ligatures"], true,
            "unknown keys inside a section too"
        );
        assert_eq!(written["editor"]["fontSize"], 15);
        assert_eq!(written["editor"]["tabSize"], 4);
        assert_eq!(written["appearance"], "dark");
    }

    #[test]
    fn unknown_keys_keep_their_place_and_new_keys_follow_them() {
        let dir = TempDir::new();
        dir.write(
            "settings.json",
            br#"{"zeta": 1, "appearance": "light", "alpha": 2}"#,
        );
        let mut store = store_in(&dir);

        store.update(&json!({ "readingWpm": 300 }));

        let text = std::fs::read_to_string(dir.path().join("settings.json")).expect("read");
        let position = |key: &str| text.find(&format!("\"{key}\"")).expect(key);
        assert!(position("zeta") < position("appearance"), "{text}");
        assert!(position("appearance") < position("alpha"), "{text}");
        assert!(
            position("alpha") < position("version"),
            "new keys are added after: {text}"
        );
    }

    #[test]
    fn a_patch_cannot_add_unknown_keys() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);

        store.update(
            &json!({ "appearance": "dark", "injected": { "x": 1 }, "editor": { "evil": 1 } }),
        );

        let written = file_json(&dir);
        assert!(written.get("injected").is_none());
        assert!(written["editor"].get("evil").is_none());
    }

    #[test]
    fn an_update_that_changes_nothing_writes_nothing() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);

        let updated =
            store.update(&json!({ "appearance": "system", "editor": { "fontSize": 13 } }));

        assert!(!updated.changed);
        assert!(!updated.saved);
        assert!(!dir.path().join("settings.json").exists());
        let empty = store.update(&json!({}));
        assert!(!empty.changed);
    }

    #[test]
    fn a_value_that_is_clamped_to_what_it_already_was_changes_nothing() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);
        store.update(&json!({ "view": { "zoom": 2.0 } }));

        let updated = store.update(&json!({ "view": { "zoom": 50 } }));

        assert!(!updated.changed);
    }

    #[test]
    fn r06_a_corrupt_file_gives_the_defaults_and_is_kept_as_a_copy() {
        let dir = TempDir::new();
        let file = dir.write("settings.json", b"{ \"appearance\": dark ");

        let store = SettingsStore::load(file.clone());

        assert_eq!(*store.get(), Settings::default());
        assert_eq!(
            std::fs::read(store::corrupt_copy_path(&file)).expect("copy"),
            b"{ \"appearance\": dark "
        );
    }

    #[test]
    fn a_file_that_holds_something_other_than_an_object_is_corrupt() {
        let dir = TempDir::new();
        let file = dir.write("settings.json", b"[1, 2, 3]");

        let store = SettingsStore::load(file.clone());

        assert_eq!(*store.get(), Settings::default());
        assert!(store::corrupt_copy_path(&file).exists());
    }

    #[test]
    fn writing_after_a_corrupt_file_replaces_it() {
        let dir = TempDir::new();
        let file = dir.write("settings.json", b"not json");
        let mut store = SettingsStore::load(file);

        store.update(&json!({ "appearance": "light" }));

        assert_eq!(file_json(&dir)["appearance"], "light");
    }

    #[test]
    fn a_failed_write_still_applies_the_update_in_memory() {
        let dir = TempDir::new();
        // The settings file's place is taken by a folder, so the final rename fails.
        std::fs::create_dir(dir.path().join("settings.json")).expect("mkdir");
        let mut store = store_in(&dir);

        let updated = store.update(&json!({ "appearance": "dark" }));

        assert!(updated.changed);
        assert!(!updated.saved);
        assert_eq!(store.get().appearance, "dark");
    }

    // ---- wire format ---------------------------------------------------------------------

    #[test]
    fn settings_serialize_with_the_names_of_the_frontend_type() {
        let value = serde_json::to_value(Settings::default()).expect("serializes");

        assert_eq!(value, Settings::default().to_value());
        assert_eq!(value["editor"]["fontSize"], 13);
        assert_eq!(value["view"]["splitRatio"], 0.5);
        assert_eq!(value["defaultFlavor"], "gfm");
    }

    // ---- Phase 4 keys (D10) -----------------------------------------------------

    fn after(patch: Value) -> Settings {
        Settings::default().apply_patch(&patch)
    }

    #[test]
    fn the_defaults_equal_the_shared_fixture() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/settings-defaults.json"))
                .expect("fixture");

        assert_eq!(Settings::default().to_value(), fixture);
        assert_eq!(Settings::from_value(&fixture), Settings::default());
    }

    #[test]
    fn phase_4_number_keys_are_clamped_and_wrong_types_keep_the_default() {
        let low = after(json!({
            "editor": { "lineHeight": 0.5 },
            "preview": { "fontSize": 1, "columnWidth": 10 },
            "a11y": { "scale": 0.2 },
        }));
        assert_eq!(low.editor.line_height, 1.2);
        assert_eq!(low.preview.font_size, 12);
        assert_eq!(low.preview.column_width, 560);
        assert_eq!(low.a11y.scale, 1.0);

        let high = after(json!({
            "editor": { "lineHeight": 9 },
            "preview": { "fontSize": 99, "columnWidth": 5000 },
            "a11y": { "scale": 7 },
        }));
        assert_eq!(high.editor.line_height, 2.4);
        assert_eq!(high.preview.font_size, 28);
        assert_eq!(high.preview.column_width, 1040);
        assert_eq!(high.a11y.scale, 1.5);

        let inside = after(json!({
            "editor": { "lineHeight": 1.9 },
            "preview": { "fontSize": 18, "columnWidth": 800 },
            "a11y": { "scale": 1.3 },
        }));
        assert_eq!(inside.editor.line_height, 1.9);
        assert_eq!(inside.preview.font_size, 18);
        assert_eq!(inside.preview.column_width, 800);
        assert_eq!(inside.a11y.scale, 1.3);

        let wrong = after(json!({
            "editor": { "lineHeight": "tall" },
            "preview": { "fontSize": true, "columnWidth": [1] },
            "a11y": { "scale": null },
        }));
        assert_eq!(wrong, Settings::default());
    }

    #[test]
    fn phase_4_choices_fall_back_to_the_default() {
        let wrong = after(json!({
            "editor": { "fontFamily": "comic-sans" },
            "preview": { "font": "papyrus", "codeCards": "blue" },
            "a11y": {
                "dyslexiaFont": "inter",
                "rulerTint": "red",
                "reduceMotion": "maybe",
                "highContrast": 3,
            },
            "saving": { "newLineEnding": "cr" },
        }));
        assert_eq!(wrong, Settings::default());

        let right = after(json!({
            "editor": { "fontFamily": "menlo" },
            "preview": { "font": "opendyslexic", "codeCards": "light" },
            "a11y": {
                "dyslexiaFont": "lexend",
                "rulerTint": "pink",
                "reduceMotion": "on",
                "highContrast": "off",
            },
            "saving": { "newLineEnding": "crlf" },
        }));
        assert_eq!(right.editor.font_family, "menlo");
        assert_eq!(right.preview.font, "opendyslexic");
        assert_eq!(right.preview.code_cards, "light");
        assert_eq!(right.a11y.dyslexia_font, "lexend");
        assert_eq!(right.a11y.ruler_tint, "pink");
        assert_eq!(right.a11y.reduce_motion, "on");
        assert_eq!(right.a11y.high_contrast, "off");
        assert_eq!(right.saving.new_line_ending, "crlf");
    }

    #[test]
    fn shortcuts_default_to_none_and_keep_only_known_commands_with_good_strings() {
        assert!(Settings::default().shortcuts.is_empty());
        let got = after(json!({ "shortcuts": {
            "bold": "⌘⌥b",
            "italic": null,
            "editor:Mod-d": "⌃D",
            "no-such": "⌘J",
            "save": "not a key",
            "quit": "⌘J",
            "link": 5,
        }}));
        let mut expected = BTreeMap::new();
        expected.insert("bold".to_owned(), Some("⌥⌘B".to_owned()));
        expected.insert("italic".to_owned(), None);
        expected.insert("editor:Mod-d".to_owned(), Some("⌃D".to_owned()));
        assert_eq!(got.shortcuts, expected);
        assert_eq!(
            got.to_value()["shortcuts"],
            json!({ "bold": "⌥⌘B", "editor:Mod-d": "⌃D", "italic": null })
        );
        // A value that is not an object keeps the current overrides.
        assert_eq!(
            got.apply_patch(&json!({ "shortcuts": 3 })).shortcuts,
            expected
        );
    }

    #[test]
    fn a_shortcuts_patch_replaces_the_overrides_in_the_file_so_a_reset_removes_entries() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);
        store.update(&json!({ "shortcuts": { "bold": "⌥⌘B", "italic": "⌥⌘I" } }));
        let updated = store.update(&json!({ "shortcuts": { "bold": "⌥⌘B" } }));
        assert!(updated.changed);
        assert_eq!(updated.settings.shortcuts.len(), 1);
        let text = std::fs::read_to_string(dir.path().join("settings.json")).expect("file");
        let file: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(file["shortcuts"], json!({ "bold": "⌥⌘B" }));
        let cleared = store.update(&json!({ "shortcuts": {} }));
        assert!(cleared.settings.shortcuts.is_empty());
    }

    #[test]
    fn vibrancy_defaults_on_takes_only_booleans_and_is_written_back() {
        assert!(Settings::default().vibrancy);
        assert!(!after(json!({ "vibrancy": false })).vibrancy);
        assert!(after(json!({ "vibrancy": "off" })).vibrancy);
        assert!(after(json!({ "vibrancy": 0 })).vibrancy);
        assert_eq!(
            after(json!({ "vibrancy": false })).to_value()["vibrancy"],
            false
        );
    }

    #[test]
    fn phase_4_flags_take_only_booleans() {
        let flipped = after(json!({
            "editor": {
                "insertSpaces": false, "currentLine": false, "autoPair": true,
                "continueLists": false, "paneHeaders": false, "typewriter": true,
            },
            "preview": {
                "autoDetectFlavor": false, "hashtagPills": true, "obsidianCommentsDimmed": true,
                "smartPunctuation": false, "math": false, "remoteImages": false,
            },
            "a11y": { "dyslexia": true, "ruler": true, "spotlight": true },
            "saving": { "autoSave": true, "newFinalNewline": true },
        }));
        assert!(!flipped.editor.insert_spaces && !flipped.editor.current_line);
        assert!(flipped.editor.auto_pair && flipped.editor.typewriter);
        assert!(!flipped.editor.continue_lists && !flipped.editor.pane_headers);
        assert!(!flipped.preview.auto_detect_flavor && flipped.preview.hashtag_pills);
        assert!(flipped.preview.obsidian_comments_dimmed);
        assert!(!flipped.preview.smart_punctuation && !flipped.preview.math);
        assert!(!flipped.preview.remote_images);
        assert!(flipped.a11y.dyslexia && flipped.a11y.ruler && flipped.a11y.spotlight);
        assert!(flipped.saving.auto_save && flipped.saving.new_final_newline);

        let wrong = after(json!({
            "editor": { "insertSpaces": 0, "autoPair": "yes" },
            "preview": { "math": null, "remoteImages": "no" },
            "a11y": { "ruler": 1 },
            "saving": { "autoSave": "true" },
        }));
        assert_eq!(wrong, Settings::default());
    }

    /// `path` as an absolute path on this system (Windows wants a drive).
    fn absolute(path: &str) -> String {
        if cfg!(windows) {
            format!("C:{path}")
        } else {
            path.to_owned()
        }
    }

    #[test]
    fn the_default_folder_is_an_absolute_path_or_null() {
        let documents = absolute("/Users/someone/Documents");
        let set = after(json!({ "saving": { "defaultFolder": documents } }));
        assert_eq!(set.saving.default_folder, Some(documents));
        // It need not exist: that is checked when the folder is used.
        let nowhere = absolute("/no/such/folder");
        let missing = after(json!({ "saving": { "defaultFolder": nowhere } }));
        assert_eq!(missing.saving.default_folder, Some(nowhere));

        assert_eq!(
            set.apply_patch(&json!({ "saving": { "defaultFolder": null } })),
            Settings::default()
        );
        assert_eq!(
            set.apply_patch(&json!({ "saving": { "defaultFolder": "" } })),
            Settings::default()
        );
        // A relative path or another type keeps the current value.
        for bad in [
            json!("relative/path"),
            json!(5),
            json!(true),
            json!("/a\u{0}b"),
        ] {
            assert_eq!(
                set.apply_patch(&json!({ "saving": { "defaultFolder": bad } })),
                set
            );
        }
    }

    #[test]
    fn phase_4_keys_round_trip_through_the_file() {
        let dir = TempDir::new();
        let mut store = store_in(&dir);
        let patch = json!({
            "editor": { "fontFamily": "sf-mono", "lineHeight": 2.0, "autoPair": true },
            "preview": { "font": "literata", "columnWidth": 880, "codeCards": "light" },
            "a11y": { "dyslexia": true, "scale": 1.2, "reduceMotion": "on" },
            "saving": { "autoSave": true, "newLineEnding": "crlf", "defaultFolder": absolute("/tmp/notes") },
        });
        let updated = store.update(&patch);
        assert!(updated.changed && updated.saved);

        let reloaded = store_in(&dir);
        assert_eq!(reloaded.get(), &updated.settings);
        let file = file_json(&dir);
        assert_eq!(file["editor"]["fontFamily"], "sf-mono");
        assert_eq!(file["preview"]["columnWidth"], 880);
        assert_eq!(file["a11y"]["scale"], 1.2);
        assert_eq!(file["saving"]["defaultFolder"], absolute("/tmp/notes"));
    }

    #[test]
    fn d10_every_new_key_wrong_or_out_of_range_loads_defaults_or_clamped_values() {
        let dir = TempDir::new();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{
              "version": 1,
              "mystery": { "keep": [1, 2] },
              "editor": {
                "fontFamily": 7, "lineHeight": 99, "insertSpaces": "yes", "currentLine": 1,
                "autoPair": null, "continueLists": [], "paneHeaders": {}, "extra": "kept"
              },
              "preview": {
                "autoDetectFlavor": "no", "font": "nope", "fontSize": 0, "columnWidth": 99999,
                "hashtagPills": 1, "obsidianCommentsDimmed": "x", "smartPunctuation": null,
                "math": 0, "remoteImages": "off", "codeCards": "grey"
              },
              "a11y": {
                "dyslexia": "on", "dyslexiaFont": "inter", "ruler": 3, "rulerTint": "red",
                "spotlight": [], "reduceMotion": true, "highContrast": "high", "scale": -4
              },
              "saving": {
                "autoSave": "yes", "newLineEnding": "cr", "newFinalNewline": 0,
                "defaultFolder": "not/absolute"
              }
            }"#,
        )
        .expect("write");

        let mut store = store_in(&dir);
        let mut expected = Settings::default();
        expected.editor.line_height = 2.4;
        expected.preview.font_size = 12;
        expected.preview.column_width = 1040;
        expected.a11y.scale = 1.0;
        assert_eq!(store.get(), &expected);

        // The unknown keys survive the next write.
        store.update(&json!({ "editor": { "autoPair": true } }));
        let file = file_json(&dir);
        assert_eq!(file["mystery"]["keep"], json!([1, 2]));
        assert_eq!(file["editor"]["extra"], "kept");
        assert_eq!(file["editor"]["autoPair"], true);
    }
}
