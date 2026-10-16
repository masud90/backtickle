//! The native dialogs. They are shown from Rust only; the web view has no dialog
//! permission. Each one is a sheet on the window that asked, and every path a dialog returns
//! is granted by the caller (see `bridge.rs`).
//!
//! - Open: one or several Markdown or text files.
//! - Save: a suggested name and folder.
//! - Unsaved changes: Save (Return), Don't Save, Cancel (Escape). macOS gives Return to the first
//!   button and Escape to the button titled Cancel.
//! - Ask: two buttons with the labels the page gives.
//!
//! The functions that show a dialog block until it is answered: call them from a blocking task.
//! Text that comes from the page is cleaned first (one line, no control characters, a sensible
//! length), because it ends up in a system dialog.

use crate::file_types::DOCUMENT_EXTENSIONS;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, WebviewWindow, Wry};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

const FILTER_NAME: &str = "Markdown and text";
pub const SAVE_LABEL: &str = "Save";
pub const DONT_SAVE_LABEL: &str = "Don't Save";
pub const CANCEL_LABEL: &str = "Cancel";
pub const UNSAVED_MESSAGE: &str = "Your changes will be lost if you don't save them.";

const MAX_NAME_CHARS: usize = 60;
const MAX_TITLE_CHARS: usize = 120;
const MAX_MESSAGE_CHARS: usize = 600;
const MAX_LABEL_CHARS: usize = 40;
const MAX_FILE_NAME_CHARS: usize = 120;

/// What the save sheet is for (`kind` of `saveDialog` in `src/lib/platform.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SaveKind {
    /// A Markdown or text document: the path is granted for reading and saving.
    #[default]
    Document,
    /// An HTML export: the path is only remembered for `write_export`.
    Html,
    /// A Word export: the path is only remembered for the Pandoc export.
    Docx,
    /// A PDF export: the path is only remembered for `export_pdf`.
    Pdf,
}

impl SaveKind {
    /// The extension an export gets, or `None` for a document.
    pub fn export_extension(self) -> Option<&'static str> {
        match self {
            SaveKind::Document => None,
            SaveKind::Html => Some("html"),
            SaveKind::Docx => Some("docx"),
            SaveKind::Pdf => Some("pdf"),
        }
    }

    fn title(self) -> &'static str {
        match self {
            SaveKind::Document => "Save",
            SaveKind::Html => "Export as HTML",
            SaveKind::Docx => "Export as Word Document",
            SaveKind::Pdf => "Export as PDF",
        }
    }

    fn filter(self) -> (&'static str, Vec<&'static str>) {
        match self {
            SaveKind::Document => (FILTER_NAME, filter_extensions()),
            SaveKind::Html => ("HTML", vec!["html"]),
            SaveKind::Docx => ("Word Document", vec!["docx"]),
            SaveKind::Pdf => ("PDF", vec!["pdf"]),
        }
    }
}

/// The path with the extension of the export added when the user left it out or typed another
/// one. A document keeps the path as it is.
pub fn with_export_extension(path: PathBuf, kind: SaveKind) -> PathBuf {
    let Some(wanted) = kind.export_extension() else {
        return path;
    };
    let has_it = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(wanted));
    if has_it {
        return path;
    }
    let mut name = path.into_os_string();
    name.push(".");
    name.push(wanted);
    PathBuf::from(name)
}

/// The answer of the unsaved-changes sheet (`'save' | 'discard' | 'cancel'` in `platform.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnsavedChoice {
    Save,
    Discard,
    Cancel,
}

/// At most one open or save dialog at a time: holding the key repeat of ⌘O must not pile up
/// sheets.
#[derive(Default)]
pub struct DialogGuard {
    open: AtomicBool,
}

/// Held while a dialog is shown.
pub struct Permit<'a>(&'a AtomicBool);

impl DialogGuard {
    /// Takes the right to show a dialog, or `None` if one is already shown.
    pub fn try_acquire(&self) -> Option<Permit<'_>> {
        self.open
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Permit(&self.open))
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}\u{2026}", kept.trim_end())
}

/// One line of text for a dialog title or button: control characters and line breaks become
/// spaces, runs of white space become one space, and the result is cut to `max_chars`.
pub fn clean_line(text: &str, max_chars: usize) -> String {
    let spaced: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&collapsed, max_chars)
}

/// Text for the body of a dialog: line breaks are kept, other control characters are dropped.
pub fn clean_message(text: &str, max_chars: usize) -> String {
    let kept: String = text
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect();
    truncate(kept.trim(), max_chars)
}

/// The question of the unsaved-changes sheet.
pub fn unsaved_title(name: &str) -> String {
    let name = clean_line(name, MAX_NAME_CHARS);
    if name.is_empty() {
        "Do you want to save the changes you made to this document?".to_owned()
    } else {
        format!("Do you want to save the changes you made to \u{201C}{name}\u{201D}?")
    }
}

/// Which button of the unsaved-changes sheet was pressed. Anything but Save and Don't Save,
/// including a dialog that was closed some other way, is Cancel.
pub fn unsaved_choice(result: &MessageDialogResult) -> UnsavedChoice {
    match result {
        MessageDialogResult::Custom(label) if label == SAVE_LABEL => UnsavedChoice::Save,
        MessageDialogResult::Custom(label) if label == DONT_SAVE_LABEL => UnsavedChoice::Discard,
        MessageDialogResult::Yes => UnsavedChoice::Save,
        MessageDialogResult::No => UnsavedChoice::Discard,
        _ => UnsavedChoice::Cancel,
    }
}

/// A file name for the save sheet from a suggestion: no path separators or colons (macOS shows
/// a slash as a colon), no leading dots, at most 120 characters; "Untitled.md" if nothing is
/// left.
pub fn suggested_file_name(name: &str) -> String {
    let replaced: String = name
        .trim()
        .chars()
        .map(|c| {
            if c == '/' || c == ':' || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = replaced.trim().trim_start_matches('.').trim();
    if trimmed.is_empty() {
        return "Untitled.md".to_owned();
    }
    truncate_name(trimmed)
}

/// Cuts a file name to the limit without cutting off the extension.
fn truncate_name(name: &str) -> String {
    if name.chars().count() <= MAX_FILE_NAME_CHARS {
        return name.to_owned();
    }
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if name.chars().count() - name[..dot].chars().count() <= 12 => {
            (&name[..dot], &name[dot..])
        }
        _ => (name, ""),
    };
    let room = MAX_FILE_NAME_CHARS.saturating_sub(extension.chars().count());
    let kept: String = stem.chars().take(room).collect();
    format!("{}{extension}", kept.trim_end())
}

/// The extensions the open and save sheets offer: the Markdown family first.
pub fn filter_extensions() -> Vec<&'static str> {
    DOCUMENT_EXTENSIONS.to_vec()
}

/// The open sheet. Returns what the user chose (nothing if cancelled).
pub fn pick_files(
    app: &AppHandle<Wry>,
    window: &WebviewWindow<Wry>,
    multiple: bool,
) -> Vec<PathBuf> {
    let dialog = app
        .dialog()
        .file()
        .set_title("Open")
        .add_filter(FILTER_NAME, &filter_extensions())
        .set_parent(window);
    let chosen = if multiple {
        dialog.blocking_pick_files().unwrap_or_default()
    } else {
        dialog.blocking_pick_file().into_iter().collect()
    };
    chosen
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .collect()
}

/// The save sheet with a suggested name and folder. Returns the path the user chose (the file
/// does not exist yet unless the user agreed to replace it).
pub fn pick_save_path(
    app: &AppHandle<Wry>,
    window: &WebviewWindow<Wry>,
    suggested_name: &str,
    directory: Option<&Path>,
    kind: SaveKind,
) -> Option<PathBuf> {
    let (filter_name, extensions) = kind.filter();
    let mut dialog = app
        .dialog()
        .file()
        .set_title(kind.title())
        .add_filter(filter_name, &extensions)
        .set_file_name(suggested_file_name(suggested_name))
        .set_can_create_directories(true)
        .set_parent(window);
    if let Some(directory) = directory.filter(|directory| directory.is_dir()) {
        dialog = dialog.set_directory(directory);
    }
    dialog.blocking_save_file()?.into_path().ok()
}

/// The folder sheet of Open Folder (`open`) and Move To (`move`). Returns the folder the user
/// chose, if any.
pub fn pick_folder(
    app: &AppHandle<Wry>,
    window: &WebviewWindow<Wry>,
    purpose: FolderPurpose,
) -> Option<PathBuf> {
    let dialog = app
        .dialog()
        .file()
        .set_title(purpose.title())
        .set_can_create_directories(true)
        .set_parent(window);
    dialog.blocking_pick_folder()?.into_path().ok()
}

/// The sheet of "Choose Pandoc": any file. Returns the file the user chose, if any.
pub fn pick_pandoc(app: &AppHandle<Wry>, window: &WebviewWindow<Wry>) -> Option<PathBuf> {
    app.dialog()
        .file()
        .set_title("Choose Pandoc")
        .set_parent(window)
        .blocking_pick_file()?
        .into_path()
        .ok()
}

/// The sheet of "Choose Default Folder": a folder where the Save dialog starts.
pub fn pick_default_folder(app: &AppHandle<Wry>, window: &WebviewWindow<Wry>) -> Option<PathBuf> {
    app.dialog()
        .file()
        .set_title("Choose Default Folder")
        .set_can_create_directories(true)
        .set_parent(window)
        .blocking_pick_folder()?
        .into_path()
        .ok()
}

/// True if the file is named exactly `pandoc` (the only name `export.pandocPath` accepts), or
/// `pandoc.exe` in any letter case on Windows.
pub fn is_pandoc_name(path: &Path) -> bool {
    let name = path.file_name().and_then(|name| name.to_str());
    if cfg!(windows) {
        name.is_some_and(|name| name.eq_ignore_ascii_case(crate::pandoc::PANDOC_FILE))
    } else {
        name == Some(crate::pandoc::PANDOC_FILE)
    }
}

/// What the folder sheet is for (`purpose` of `folderDialog`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderPurpose {
    Open,
    Move,
}

impl FolderPurpose {
    fn title(self) -> &'static str {
        match self {
            FolderPurpose::Open => "Open Folder",
            FolderPurpose::Move => "Move To",
        }
    }
}

/// The three-button sheet for a document with unsaved changes.
pub fn confirm_unsaved(
    app: &AppHandle<Wry>,
    window: &WebviewWindow<Wry>,
    name: &str,
) -> UnsavedChoice {
    let result = app
        .dialog()
        .message(UNSAVED_MESSAGE)
        .title(unsaved_title(name))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            SAVE_LABEL.to_owned(),
            DONT_SAVE_LABEL.to_owned(),
            CANCEL_LABEL.to_owned(),
        ))
        .parent(window)
        .blocking_show_with_result();
    unsaved_choice(&result)
}

/// A two-button sheet with the page's labels. True if the first button was pressed.
pub fn ask(
    app: &AppHandle<Wry>,
    window: &WebviewWindow<Wry>,
    title: &str,
    message: &str,
    ok: &str,
    cancel: &str,
) -> bool {
    let label = |text: &str, fallback: &str| {
        let cleaned = clean_line(text, MAX_LABEL_CHARS);
        if cleaned.is_empty() {
            fallback.to_owned()
        } else {
            cleaned
        }
    };
    app.dialog()
        .message(clean_message(message, MAX_MESSAGE_CHARS))
        .title(clean_line(title, MAX_TITLE_CHARS))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            label(ok, "OK"),
            label(cancel, CANCEL_LABEL),
        ))
        .parent(window)
        .blocking_show()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_unsaved_sheet_has_the_three_buttons_in_the_order_that_gives_return_to_save() {
        // NSAlert makes the first button the default (Return) and the one titled Cancel the
        // Escape button.
        assert_eq!(SAVE_LABEL, "Save");
        assert_eq!(DONT_SAVE_LABEL, "Don't Save");
        assert_eq!(CANCEL_LABEL, "Cancel");
    }

    #[test]
    fn the_buttons_map_to_the_three_answers() {
        let custom = |label: &str| MessageDialogResult::Custom(label.to_owned());

        assert_eq!(unsaved_choice(&custom("Save")), UnsavedChoice::Save);
        assert_eq!(
            unsaved_choice(&custom("Don't Save")),
            UnsavedChoice::Discard
        );
        assert_eq!(unsaved_choice(&custom("Cancel")), UnsavedChoice::Cancel);
        assert_eq!(
            unsaved_choice(&MessageDialogResult::Cancel),
            UnsavedChoice::Cancel
        );
        assert_eq!(
            unsaved_choice(&MessageDialogResult::Yes),
            UnsavedChoice::Save
        );
        assert_eq!(
            unsaved_choice(&MessageDialogResult::No),
            UnsavedChoice::Discard
        );
    }

    #[test]
    fn a_dialog_closed_any_other_way_means_cancel() {
        for result in [
            MessageDialogResult::Ok,
            MessageDialogResult::Custom(String::new()),
            MessageDialogResult::Custom("Something else".into()),
            MessageDialogResult::default(),
        ] {
            assert_eq!(unsaved_choice(&result), UnsavedChoice::Cancel, "{result:?}");
        }
    }

    #[test]
    fn the_answers_serialize_as_the_strings_of_the_frontend() {
        for (choice, text) in [
            (UnsavedChoice::Save, "save"),
            (UnsavedChoice::Discard, "discard"),
            (UnsavedChoice::Cancel, "cancel"),
        ] {
            assert_eq!(
                serde_json::to_value(choice).expect("serializes"),
                serde_json::json!(text)
            );
        }
    }

    #[test]
    fn the_question_names_the_document_in_curly_quotes() {
        assert_eq!(
            unsaved_title("Notes.md"),
            "Do you want to save the changes you made to \u{201C}Notes.md\u{201D}?"
        );
        assert_eq!(
            unsaved_title("Untitled 2"),
            "Do you want to save the changes you made to \u{201C}Untitled 2\u{201D}?"
        );
    }

    #[test]
    fn the_question_without_a_usable_name_does_not_show_empty_quotes() {
        for name in ["", "   ", "\n\t"] {
            assert_eq!(
                unsaved_title(name),
                "Do you want to save the changes you made to this document?"
            );
        }
    }

    #[test]
    fn a_name_with_line_breaks_and_a_huge_length_is_made_safe() {
        let title = unsaved_title(&format!("evil\nname\u{7}{}", "x".repeat(500)));

        assert!(!title.contains('\n') && !title.contains('\u{7}'));
        assert!(title.chars().count() < 140, "{}", title.chars().count());
        assert!(title.contains('\u{2026}'));
    }

    #[test]
    fn clean_line_makes_one_line_without_control_characters() {
        assert_eq!(clean_line("  a \n b\tc\u{0}d  ", 50), "a b c d");
        assert_eq!(clean_line("", 50), "");
    }

    #[test]
    fn clean_line_cuts_by_characters_not_bytes() {
        let text = "é".repeat(10);

        assert_eq!(clean_line(&text, 10), text);
        assert_eq!(clean_line(&text, 5), format!("{}\u{2026}", "é".repeat(4)));
        let emoji = "👨‍👩‍👧‍👦".repeat(3);
        assert!(clean_line(&emoji, 4).chars().count() <= 4);
    }

    #[test]
    fn clean_message_keeps_line_breaks_and_drops_other_control_characters() {
        assert_eq!(
            clean_message("  The file changed.\nOverwrite it?\u{7}\u{0}  ", 100),
            "The file changed.\nOverwrite it?"
        );
        assert_eq!(clean_message(&"y".repeat(700), 600).chars().count(), 600);
    }

    #[test]
    fn a_suggested_file_name_has_no_separators_dots_or_colons() {
        assert_eq!(suggested_file_name("Notes.md"), "Notes.md");
        assert_eq!(suggested_file_name("a/b: c.md"), "a-b- c.md");
        assert_eq!(suggested_file_name(".hidden.md"), "hidden.md");
        assert_eq!(suggested_file_name("..."), "Untitled.md");
        assert_eq!(suggested_file_name(""), "Untitled.md");
        assert_eq!(suggested_file_name("  \n "), "Untitled.md");
        assert_eq!(suggested_file_name("Réunion 快速.md"), "Réunion 快速.md");
    }

    #[test]
    fn a_long_suggested_file_name_keeps_its_extension() {
        let name = suggested_file_name(&format!("{}.md", "a".repeat(300)));

        assert!(name.ends_with(".md"));
        assert_eq!(name.chars().count(), 120);
    }

    #[test]
    fn the_sheets_offer_the_document_types_markdown_first() {
        let extensions = filter_extensions();

        assert_eq!(&extensions[..5], ["md", "markdown", "mdown", "mkd", "mkdn"]);
        for extension in ["mdx", "qmd", "rmd", "mmd", "txt"] {
            assert!(extensions.contains(&extension), "{extension}");
        }
        assert_eq!(extensions.len(), 10);
    }

    #[test]
    fn only_one_open_or_save_dialog_can_be_shown_at_a_time() {
        let guard = DialogGuard::default();

        let first = guard.try_acquire();
        assert!(first.is_some());
        assert!(guard.try_acquire().is_none(), "a second sheet must wait");
        drop(first);
        assert!(
            guard.try_acquire().is_some(),
            "free again once the first is answered"
        );
    }

    #[test]
    fn an_export_path_gets_its_extension_and_a_document_path_is_left_alone() {
        let html = |name: &str| with_export_extension(PathBuf::from(name), SaveKind::Html);
        let docx = |name: &str| with_export_extension(PathBuf::from(name), SaveKind::Docx);

        assert_eq!(html("/n/a.html"), PathBuf::from("/n/a.html"));
        assert_eq!(html("/n/a.HTML"), PathBuf::from("/n/a.HTML"));
        assert_eq!(html("/n/a"), PathBuf::from("/n/a.html"));
        assert_eq!(html("/n/a.md"), PathBuf::from("/n/a.md.html"));
        assert_eq!(docx("/n/a"), PathBuf::from("/n/a.docx"));
        assert_eq!(docx("/n/a.docx"), PathBuf::from("/n/a.docx"));
        let pdf = |name: &str| with_export_extension(PathBuf::from(name), SaveKind::Pdf);
        assert_eq!(pdf("/n/a"), PathBuf::from("/n/a.pdf"));
        assert_eq!(pdf("/n/a.PDF"), PathBuf::from("/n/a.PDF"));
        assert_eq!(pdf("/n/a.html"), PathBuf::from("/n/a.html.pdf"));
        assert_eq!(
            with_export_extension(PathBuf::from("/n/a"), SaveKind::Document),
            PathBuf::from("/n/a")
        );
    }

    #[test]
    fn the_save_kinds_come_from_the_page_in_lower_case_and_default_to_a_document() {
        let parse = |text: &str| serde_json::from_str::<SaveKind>(text).expect(text);

        assert_eq!(parse("\"document\""), SaveKind::Document);
        assert_eq!(parse("\"html\""), SaveKind::Html);
        assert_eq!(parse("\"docx\""), SaveKind::Docx);
        assert_eq!(parse("\"pdf\""), SaveKind::Pdf);
        assert!(serde_json::from_str::<SaveKind>("\"exe\"").is_err());
        assert_eq!(SaveKind::default(), SaveKind::Document);
        assert_eq!(SaveKind::Html.filter().1, ["html"]);
        assert_eq!(SaveKind::Docx.filter().1, ["docx"]);
        assert_eq!(SaveKind::Pdf.filter().1, ["pdf"]);
        assert_eq!(SaveKind::Document.filter().1.len(), 10);
    }

    #[test]
    fn the_folder_purposes_come_from_the_page_in_lower_case() {
        let parse = |text: &str| serde_json::from_str::<FolderPurpose>(text).expect(text);

        assert_eq!(parse("\"open\""), FolderPurpose::Open);
        assert_eq!(parse("\"move\""), FolderPurpose::Move);
        assert!(serde_json::from_str::<FolderPurpose>("\"delete\"").is_err());
        assert_eq!(FolderPurpose::Open.title(), "Open Folder");
        assert_eq!(FolderPurpose::Move.title(), "Move To");
    }

    #[test]
    fn only_a_file_named_pandoc_is_taken_for_pandoc() {
        #[cfg(not(windows))]
        {
            assert!(is_pandoc_name(Path::new("/usr/local/bin/pandoc")));
            assert!(!is_pandoc_name(Path::new("/usr/local/bin/pandoc.sh")));
            assert!(!is_pandoc_name(Path::new("/usr/local/bin/Pandoc")));
        }
        #[cfg(windows)]
        {
            assert!(is_pandoc_name(Path::new(
                "C:/Program Files/Pandoc/pandoc.exe"
            )));
            assert!(is_pandoc_name(Path::new(
                "C:/Program Files/Pandoc/Pandoc.EXE"
            )));
            assert!(!is_pandoc_name(Path::new("C:/Program Files/Pandoc/pandoc")));
        }
        assert!(!is_pandoc_name(Path::new("/")));
    }
}
