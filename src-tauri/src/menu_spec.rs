//! What the menu bar contains and when each item is enabled or checked.
//!
//! This file is plain data and plain functions, so it can be tested without a running app;
//! `menu.rs` turns it into the real menu. Every item has an id. The ids of the items that the
//! frontend handles are exactly the `MenuAction` strings of `src/lib/platform.ts` (a test reads
//! that file and compares), and they are what the `menu-action` event carries.

use serde::Deserialize;
use std::collections::BTreeMap;

pub const SETTINGS_ID: &str = "settings";
pub const QUIT_ID: &str = "quit";
pub const CLEAR_RECENTS_ID: &str = "clear-recents";
/// Open Recent entries have the id `recent:` followed by the canonical path of the file.
pub const RECENT_PREFIX: &str = "recent:";
pub const UNDO_ID: &str = "undo";
pub const REDO_ID: &str = "redo";

/// Items that need a different state to be enabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// Always (New, Open, Settings, Quit, Markdown Guide).
    Always,
    /// A document window is open (Close Tab, Close Window, Show Sidebar).
    Window,
    /// A document is open (Save As, Find, view modes, zoom).
    Document,
    /// A document is open and has something to save.
    CanSave,
    /// A document is open and the editor is visible (every Format item).
    Editor,
    /// Two or more tabs are open.
    Tabs,
    /// A document is open and saved in a file (Duplicate, Rename, Move To, Revert, Copy as HTML).
    SavedDocument,
    /// A document is open and Pandoc was found (Export > Word Document).
    CanExportDocx,
    /// A document is open, Pandoc was found and the flavor has an exact preview (View > Exact Preview).
    CanExactPreview,
    /// A document is open, saved in a file, and a Quarto or R Markdown one (File > Render with Quarto).
    CanRender,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Item {
    pub id: &'static str,
    pub label: &'static str,
    /// In the syntax of the menu library: `CmdOrCtrl+Shift+Z`.
    pub accelerator: Option<&'static str>,
    /// A checkmark item.
    pub check: bool,
    pub need: Need,
}

/// Items the system provides and handles itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Predefined {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Zoom,
    BringAllToFront,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entry {
    Item(Item),
    Separator,
    Predefined(Predefined),
    Submenu {
        label: &'static str,
        entries: &'static [Entry],
    },
    /// The Open Recent submenu, filled from the recents list.
    OpenRecent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Menu {
    pub label: &'static str,
    /// Set for the Window and Help menus, which macOS treats specially.
    pub special: Option<Special>,
    pub entries: &'static [Entry],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Special {
    Window,
    Help,
}

const fn item(
    id: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
    need: Need,
) -> Entry {
    Entry::Item(Item {
        id,
        label,
        accelerator,
        check: false,
        need,
    })
}

const fn check(
    id: &'static str,
    label: &'static str,
    accelerator: Option<&'static str>,
    need: Need,
) -> Entry {
    Entry::Item(Item {
        id,
        label,
        accelerator,
        check: true,
        need,
    })
}

const FIND: &[Entry] = &[
    item("find", "Find\u{2026}", Some("CmdOrCtrl+F"), Need::Document),
    item(
        "find-replace",
        "Find and Replace\u{2026}",
        Some("CmdOrCtrl+Alt+F"),
        Need::Document,
    ),
    item(
        "find-next",
        "Find Next",
        Some("CmdOrCtrl+G"),
        Need::Document,
    ),
    item(
        "find-previous",
        "Find Previous",
        Some("CmdOrCtrl+Shift+G"),
        Need::Document,
    ),
    item(
        "search-folder",
        "Search in Folder\u{2026}",
        Some("CmdOrCtrl+Shift+F"),
        Need::Always,
    ),
];

const EXPORT: &[Entry] = &[
    item("export-html", "HTML\u{2026}", None, Need::Document),
    item(
        "export-docx",
        "Word Document\u{2026}",
        None,
        Need::CanExportDocx,
    ),
    item(
        "export-pdf",
        "PDF\u{2026}",
        Some("CmdOrCtrl+Alt+P"),
        Need::Document,
    ),
];

const HEADINGS: &[Entry] = &[
    item(
        "heading-1",
        "Heading 1",
        Some("CmdOrCtrl+Alt+1"),
        Need::Editor,
    ),
    item(
        "heading-2",
        "Heading 2",
        Some("CmdOrCtrl+Alt+2"),
        Need::Editor,
    ),
    item(
        "heading-3",
        "Heading 3",
        Some("CmdOrCtrl+Alt+3"),
        Need::Editor,
    ),
    item(
        "heading-4",
        "Heading 4",
        Some("CmdOrCtrl+Alt+4"),
        Need::Editor,
    ),
    item(
        "heading-5",
        "Heading 5",
        Some("CmdOrCtrl+Alt+5"),
        Need::Editor,
    ),
    item(
        "heading-6",
        "Heading 6",
        Some("CmdOrCtrl+Alt+6"),
        Need::Editor,
    ),
    Entry::Separator,
    item(
        "paragraph",
        "Paragraph",
        Some("CmdOrCtrl+Alt+0"),
        Need::Editor,
    ),
];

/// The label of the app menu (macOS only; see `windows_extras`).
pub const APP_MENU_LABEL: &str = "Writedown";

/// What a menu gets at its end on Windows, where there is no app menu: File ends with Settings
/// and Exit (the Quit item), Help with About.
pub fn windows_extras(menu_label: &str) -> &'static [Entry] {
    const FILE_EXTRAS: &[Entry] = &[
        Entry::Separator,
        item(
            SETTINGS_ID,
            "Settings\u{2026}",
            Some("CmdOrCtrl+,"),
            Need::Always,
        ),
        Entry::Separator,
        item(QUIT_ID, "Quit Writedown", Some("CmdOrCtrl+Q"), Need::Always),
    ];
    const HELP_EXTRAS: &[Entry] = &[Entry::Separator, Entry::Predefined(Predefined::About)];
    match menu_label {
        "File" => FILE_EXTRAS,
        "Help" => HELP_EXTRAS,
        _ => &[],
    }
}

const WRITEDOWN_MENU: &[Entry] = &[
    Entry::Predefined(Predefined::About),
    Entry::Separator,
    item(
        SETTINGS_ID,
        "Settings\u{2026}",
        Some("CmdOrCtrl+,"),
        Need::Always,
    ),
    Entry::Separator,
    Entry::Predefined(Predefined::Services),
    Entry::Separator,
    Entry::Predefined(Predefined::Hide),
    Entry::Predefined(Predefined::HideOthers),
    Entry::Predefined(Predefined::ShowAll),
    Entry::Separator,
    item(QUIT_ID, "Quit Writedown", Some("CmdOrCtrl+Q"), Need::Always),
];

const FILE_MENU: &[Entry] = &[
    item("new", "New", Some("CmdOrCtrl+N"), Need::Always),
    item("open", "Open\u{2026}", Some("CmdOrCtrl+O"), Need::Always),
    Entry::OpenRecent,
    item(
        "open-folder",
        "Open Folder\u{2026}",
        Some("CmdOrCtrl+Alt+O"),
        Need::Always,
    ),
    item(
        "quick-open",
        "Quick Open\u{2026}",
        Some("CmdOrCtrl+Shift+O"),
        Need::Always,
    ),
    Entry::Separator,
    item("close-tab", "Close Tab", Some("CmdOrCtrl+W"), Need::Window),
    item(
        "close-window",
        "Close Window",
        Some("CmdOrCtrl+Shift+W"),
        Need::Window,
    ),
    Entry::Separator,
    item("save", "Save", Some("CmdOrCtrl+S"), Need::CanSave),
    item(
        "save-as",
        "Save As\u{2026}",
        Some("CmdOrCtrl+Shift+S"),
        Need::Document,
    ),
    item("duplicate", "Duplicate", None, Need::SavedDocument),
    item("rename", "Rename\u{2026}", None, Need::SavedDocument),
    item("move-to", "Move To\u{2026}", None, Need::SavedDocument),
    item("revert", "Revert to Saved", None, Need::SavedDocument),
    Entry::Separator,
    Entry::Submenu {
        label: "Export",
        entries: EXPORT,
    },
    item(
        "render-quarto",
        "Render with Quarto\u{2026}",
        None,
        Need::CanRender,
    ),
    item(
        "print",
        "Print\u{2026}",
        Some("CmdOrCtrl+P"),
        Need::Document,
    ),
    Entry::Separator,
    item("reveal-in-finder", "Reveal in Finder", None, Need::Document),
];

const EDIT_MENU: &[Entry] = &[
    item(UNDO_ID, "Undo", Some("CmdOrCtrl+Z"), Need::Document),
    item(REDO_ID, "Redo", Some("CmdOrCtrl+Shift+Z"), Need::Document),
    Entry::Separator,
    Entry::Predefined(Predefined::Cut),
    Entry::Predefined(Predefined::Copy),
    item("copy-html", "Copy as HTML", None, Need::SavedDocument),
    Entry::Predefined(Predefined::Paste),
    item(
        "paste-plain",
        "Paste and Match Style",
        Some("CmdOrCtrl+Alt+Shift+V"),
        Need::Editor,
    ),
    Entry::Predefined(Predefined::SelectAll),
    Entry::Separator,
    Entry::Submenu {
        label: "Find",
        entries: FIND,
    },
];

const FORMAT_MENU: &[Entry] = &[
    item("bold", "Bold", Some("CmdOrCtrl+B"), Need::Editor),
    item("italic", "Italic", Some("CmdOrCtrl+I"), Need::Editor),
    item(
        "strikethrough",
        "Strikethrough",
        Some("CmdOrCtrl+Shift+X"),
        Need::Editor,
    ),
    item("code", "Inline Code", Some("CmdOrCtrl+E"), Need::Editor),
    item("link", "Link\u{2026}", Some("CmdOrCtrl+K"), Need::Editor),
    item("image", "Image", None, Need::Editor),
    Entry::Separator,
    Entry::Submenu {
        label: "Heading",
        entries: HEADINGS,
    },
    Entry::Separator,
    item("quote", "Quote", Some("CmdOrCtrl+Shift+."), Need::Editor),
    item(
        "bullet-list",
        "Bulleted List",
        Some("CmdOrCtrl+Shift+8"),
        Need::Editor,
    ),
    item(
        "numbered-list",
        "Numbered List",
        Some("CmdOrCtrl+Shift+7"),
        Need::Editor,
    ),
    item(
        "task-list",
        "Task List",
        Some("CmdOrCtrl+Shift+9"),
        Need::Editor,
    ),
    Entry::Separator,
    item("code-block", "Code Block", None, Need::Editor),
    item("table", "Table", None, Need::Editor),
    item("rule", "Horizontal Rule", None, Need::Editor),
];

const VIEW_MENU: &[Entry] = &[
    item(
        "command-palette",
        "Command Palette\u{2026}",
        Some("CmdOrCtrl+Shift+P"),
        Need::Always,
    ),
    Entry::Separator,
    check("view-editor", "Editor", Some("CmdOrCtrl+1"), Need::Document),
    check("view-split", "Split", Some("CmdOrCtrl+2"), Need::Document),
    check(
        "view-preview",
        "Preview",
        Some("CmdOrCtrl+3"),
        Need::Document,
    ),
    Entry::Separator,
    check(
        "toggle-sidebar",
        "Show Sidebar",
        Some("Ctrl+CmdOrCtrl+S"),
        Need::Window,
    ),
    check("toggle-sync-scroll", "Sync Scroll", None, Need::Document),
    check(
        "toggle-typewriter",
        "Typewriter Scrolling",
        None,
        Need::Document,
    ),
    check(
        "toggle-live-preview",
        "Live Preview in Editor",
        None,
        Need::Document,
    ),
    check(
        "toggle-exact-preview",
        "Exact Preview (Pandoc)",
        None,
        Need::CanExactPreview,
    ),
    Entry::Separator,
    item("zoom-in", "Zoom In", Some("CmdOrCtrl+="), Need::Document),
    item("zoom-out", "Zoom Out", Some("CmdOrCtrl+-"), Need::Document),
    item(
        "zoom-reset",
        "Actual Size",
        Some("CmdOrCtrl+0"),
        Need::Document,
    ),
    Entry::Separator,
    Entry::Predefined(Predefined::Fullscreen),
];

const WINDOW_MENU: &[Entry] = &[
    Entry::Predefined(Predefined::Minimize),
    Entry::Predefined(Predefined::Zoom),
    Entry::Separator,
    item("next-tab", "Show Next Tab", Some("Ctrl+Tab"), Need::Tabs),
    item(
        "previous-tab",
        "Show Previous Tab",
        Some("Ctrl+Shift+Tab"),
        Need::Tabs,
    ),
    item(
        "move-tab-to-new-window",
        "Move Tab to New Window",
        None,
        Need::Tabs,
    ),
    Entry::Separator,
    Entry::Predefined(Predefined::BringAllToFront),
];

const HELP_MENU: &[Entry] = &[item("markdown-guide", "Markdown Guide", None, Need::Always)];

/// The menu bar, left to right.
pub const MENUS: &[Menu] = &[
    Menu {
        label: APP_MENU_LABEL,
        special: None,
        entries: WRITEDOWN_MENU,
    },
    Menu {
        label: "File",
        special: None,
        entries: FILE_MENU,
    },
    Menu {
        label: "Edit",
        special: None,
        entries: EDIT_MENU,
    },
    Menu {
        label: "Format",
        special: None,
        entries: FORMAT_MENU,
    },
    Menu {
        label: "View",
        special: None,
        entries: VIEW_MENU,
    },
    Menu {
        label: "Window",
        special: Some(Special::Window),
        entries: WINDOW_MENU,
    },
    Menu {
        label: "Help",
        special: Some(Special::Help),
        entries: HELP_MENU,
    },
];

fn collect<'a>(entries: &'a [Entry], out: &mut Vec<&'a Item>) {
    for entry in entries {
        match entry {
            Entry::Item(item) => out.push(item),
            Entry::Submenu { entries, .. } => collect(entries, out),
            _ => {}
        }
    }
}

/// Every item of the menu bar (not the Open Recent entries), in menu order.
pub fn all_items() -> Vec<&'static Item> {
    let mut items = Vec::new();
    for menu in MENUS {
        collect(menu.entries, &mut items);
    }
    items
}

/// The ids the frontend handles through `menu-action`: every item except the ones Rust handles
/// itself (Settings, Quit).
pub fn action_ids() -> Vec<&'static str> {
    all_items()
        .into_iter()
        .map(|item| item.id)
        .filter(|id| *id != SETTINGS_ID && *id != QUIT_ID)
        .collect()
}

/// True if `id` is an item whose `menu-action` the frontend handles.
pub fn is_action(id: &str) -> bool {
    action_ids().contains(&id)
}

/// A shortcut as the user sees it (`⇧⌘O`, `⌃Tab`, `⌥↑`, `F5`; `^` also means Control), split
/// into its modifiers and key. The key is one upper-case character or a name: `Tab`, `Enter`,
/// `Escape`, `Backspace`, `Delete`, `Space`, `Up`, `Down`, `Left`, `Right`, `F1` to `F20`.
/// `src/lib/shortcut-keys.ts` reads the same strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shortcut {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub cmd: bool,
    pub key: String,
}

const SHORTCUT_NAMES: [(&str, &str); 10] = [
    ("↑", "Up"),
    ("↓", "Down"),
    ("←", "Left"),
    ("→", "Right"),
    ("↩", "Enter"),
    ("⇥", "Tab"),
    ("⎋", "Escape"),
    ("⌫", "Backspace"),
    ("⌦", "Delete"),
    ("␣", "Space"),
];

pub fn parse_shortcut(text: &str) -> Option<Shortcut> {
    let mut shortcut = Shortcut {
        ctrl: false,
        alt: false,
        shift: false,
        cmd: false,
        key: String::new(),
    };
    let text = text.trim();
    let mut rest = text;
    while let Some(first) = rest.chars().next() {
        match first {
            '⌃' | '^' => shortcut.ctrl = true,
            '⌥' => shortcut.alt = true,
            '⇧' => shortcut.shift = true,
            '⌘' => shortcut.cmd = true,
            _ => break,
        }
        rest = &rest[first.len_utf8()..];
    }
    if rest.is_empty() {
        return None;
    }
    let named = SHORTCUT_NAMES
        .iter()
        .find(|(symbol, _)| *symbol == rest)
        .map(|(_, name)| (*name).to_owned());
    let word = ["Tab", "Enter", "Escape", "Backspace", "Delete", "Space"].contains(&rest)
        || ["Up", "Down", "Left", "Right"].contains(&rest);
    let function = rest.strip_prefix('F').is_some_and(|number| {
        number.parse::<u32>().is_ok_and(|n| (1..=20).contains(&n))
            && !number.starts_with('0')
            && !number.starts_with('+')
    });
    shortcut.key = if let Some(name) = named {
        name
    } else if word || function {
        rest.to_owned()
    } else if rest.chars().count() == 1 && !rest.chars().all(char::is_whitespace) {
        let upper: String = rest.to_uppercase();
        if upper.chars().count() == 1 {
            upper
        } else {
            rest.to_owned()
        }
    } else {
        return None;
    };
    Some(shortcut)
}

/// The canonical text of a shortcut: `⌃⌥⇧⌘`, then the key (names as symbols, except `Tab`).
pub fn canonical_shortcut(text: &str) -> Option<String> {
    let shortcut = parse_shortcut(text)?;
    let mut out = String::new();
    for (on, symbol) in [
        (shortcut.ctrl, '⌃'),
        (shortcut.alt, '⌥'),
        (shortcut.shift, '⇧'),
        (shortcut.cmd, '⌘'),
    ] {
        if on {
            out.push(symbol);
        }
    }
    let key = SHORTCUT_NAMES
        .iter()
        .find(|(_, name)| *name == shortcut.key && *name != "Tab")
        .map_or(shortcut.key.as_str(), |(symbol, _)| *symbol);
    out.push_str(key);
    Some(out)
}

/// The menu library's accelerator for a shortcut: `⇧⌘O` is `CmdOrCtrl+Shift+O`.
pub fn accelerator_for(text: &str) -> Option<String> {
    let shortcut = parse_shortcut(text)?;
    let mut parts: Vec<&str> = Vec::new();
    if shortcut.ctrl {
        parts.push("Ctrl");
    }
    if shortcut.alt {
        parts.push("Alt");
    }
    if shortcut.shift {
        parts.push("Shift");
    }
    if shortcut.cmd {
        parts.push("CmdOrCtrl");
    }
    parts.push(shortcut.key.as_str());
    Some(parts.join("+"))
}

/// An accelerator for the system the app runs on (see `accelerator_on`).
pub fn platform_accelerator(accelerator: &str) -> Option<String> {
    accelerator_on(accelerator, cfg!(windows))
}

/// An accelerator as `windows` needs it, or as it is elsewhere. Windows has no Command key:
/// `CmdOrCtrl` is Ctrl there, so a shortcut with both Control and Command (`⌃⌘S`, the sidebar)
/// turns its Control into Alt. With Alt already in it the shortcut has no Windows form (`None`).
/// The page applies the same rule to what it shows (src/lib/shortcut-keys.ts).
pub fn accelerator_on(accelerator: &str, windows: bool) -> Option<String> {
    let parts: Vec<&str> = accelerator.split('+').collect();
    let has = |name: &str| parts.iter().any(|part| part.eq_ignore_ascii_case(name));
    if !windows || !(has("Ctrl") && has("CmdOrCtrl")) {
        return Some(accelerator.to_owned());
    }
    if has("Alt") {
        return None;
    }
    let mapped: Vec<&str> = parts
        .iter()
        .map(|part| {
            if part.eq_ignore_ascii_case("Ctrl") {
                "Alt"
            } else {
                part
            }
        })
        .collect();
    Some(mapped.join("+"))
}

#[cfg(test)]
mod platform_tests {
    use super::*;

    #[test]
    fn on_windows_control_with_command_becomes_alt_and_everything_else_stays() {
        assert_eq!(
            accelerator_on("Ctrl+CmdOrCtrl+S", true).as_deref(),
            Some("Alt+CmdOrCtrl+S")
        );
        assert_eq!(
            accelerator_on("Ctrl+CmdOrCtrl+S", false).as_deref(),
            Some("Ctrl+CmdOrCtrl+S")
        );
        assert_eq!(
            accelerator_on("CmdOrCtrl+Shift+O", true).as_deref(),
            Some("CmdOrCtrl+Shift+O")
        );
        assert_eq!(
            accelerator_on("Ctrl+Tab", true).as_deref(),
            Some("Ctrl+Tab")
        );
        assert_eq!(accelerator_on("Ctrl+Alt+CmdOrCtrl+S", true), None);
    }

    #[test]
    fn every_default_accelerator_has_a_windows_form_and_no_two_collide() {
        let mut seen = std::collections::BTreeMap::new();
        for item in all_items() {
            let Some(accelerator) = item.accelerator else {
                continue;
            };
            let windows = accelerator_on(accelerator, true).expect(item.id);
            let key = windows
                .replace("CmdOrCtrl", "Ctrl")
                .to_ascii_lowercase()
                .split('+')
                .map(str::to_owned)
                .collect::<std::collections::BTreeSet<_>>();
            if let Some(other) = seen.insert(key, item.id) {
                panic!("{} and {} share {windows} on Windows", item.id, other);
            }
        }
    }

    #[test]
    fn windows_puts_settings_and_exit_in_file_and_about_in_help() {
        let ids = |label: &str| -> Vec<&str> {
            windows_extras(label)
                .iter()
                .filter_map(|entry| match entry {
                    Entry::Item(item) => Some(item.id),
                    _ => None,
                })
                .collect()
        };
        assert_eq!(ids("File"), [SETTINGS_ID, QUIT_ID]);
        assert!(
            windows_extras("Help").contains(&Entry::Predefined(Predefined::About)),
            "About"
        );
        assert!(windows_extras("Edit").is_empty());
        assert_eq!(MENUS[0].label, APP_MENU_LABEL);
    }
}

/// The id prefix of the editor's own commands in the `shortcuts` setting.
pub const EDITOR_SHORTCUT_PREFIX: &str = "editor:";

/// A command whose shortcut can be changed: a menu action other than Settings and Quit, or an
/// editor command (`editor:<CodeMirror key>`).
pub fn is_shortcut_command(id: &str) -> bool {
    is_action(id)
        || id
            .strip_prefix(EDITOR_SHORTCUT_PREFIX)
            .is_some_and(|key| !key.is_empty())
}

/// What each menu item's accelerator is: the default, or the override (`None` removes it).
pub fn accelerators_with(
    overrides: &BTreeMap<String, Option<String>>,
) -> Vec<(&'static str, Option<String>)> {
    all_items()
        .into_iter()
        .map(|item| {
            let wanted = match overrides.get(item.id) {
                Some(Some(text)) => accelerator_for(text),
                Some(None) => None,
                None => item.accelerator.map(str::to_owned),
            };
            (item.id, wanted)
        })
        .collect()
}

/// Actions that make sense without a main window: the app creates the window and delivers them
/// once its page is ready.
pub fn opens_window(id: &str) -> bool {
    matches!(
        id,
        "new"
            | "open"
            | "markdown-guide"
            | "open-folder"
            | "quick-open"
            | "command-palette"
            | "search-folder"
    )
}

/// The path of an Open Recent entry id.
pub fn recent_path(id: &str) -> Option<&str> {
    id.strip_prefix(RECENT_PREFIX)
}

/// Which window has the keyboard focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    /// Any document window (`main` or a window a tab was moved to).
    Main,
    Preferences,
    /// No Writedown window (the app is in the background or has no window).
    Nothing,
}

/// What the app knows when a menu item is chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActionContext {
    /// At least one document window exists (`main` or a window a tab was moved to).
    pub main_window_exists: bool,
    pub focus: Focus,
    /// Open tabs in the window the action goes to, as last reported by its shell.
    pub tab_count: u32,
}

/// One thing to do for a chosen item, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Close the Preferences window, which has the focus.
    ClosePreferences,
    /// Create the main window (its page is not ready; `Deliver` queues the action).
    CreateMainWindow,
    /// Bring the main window to the front.
    FocusMain,
    /// Run the window close protocol (`close-requested` with `window`).
    RequestWindowClose,
    /// Send `menu-action` to the main page (queued if it is not ready).
    Deliver,
}

/// What to do when the item `id` (one of `action_ids`) is chosen.
///
/// - Close Tab and Close Window close the Preferences window when it has the focus.
/// - Without a main window only New, Open and Markdown Guide do anything: they create it.
/// - Other actions are not sent to the page behind the Preferences window.
/// - Close Window starts the window close protocol; so does Close Tab when no tab is open
///   (then it closes the window). Both are still sent to the page as `menu-action`.
pub fn plan(id: &str, context: &ActionContext) -> Vec<Step> {
    if context.focus == Focus::Preferences && matches!(id, "close-tab" | "close-window") {
        return vec![Step::ClosePreferences];
    }
    if !context.main_window_exists {
        return if opens_window(id) {
            vec![Step::CreateMainWindow, Step::Deliver]
        } else {
            Vec::new()
        };
    }
    if context.focus == Focus::Preferences && !opens_window(id) {
        // The Preferences window is in front: only the actions that make the main window
        // appear still work, the others would act on a page the user is not looking at.
        return Vec::new();
    }
    let mut steps = Vec::new();
    if opens_window(id) && context.focus != Focus::Main {
        steps.push(Step::FocusMain);
    }
    if id == "close-window" || (id == "close-tab" && context.tab_count == 0) {
        steps.push(Step::RequestWindowClose);
    }
    steps.push(Step::Deliver);
    steps
}

/// `MenuState` in `src/lib/platform.ts`: what the shell tells the menu about itself.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuState {
    pub has_document: bool,
    pub can_save: bool,
    /// The editor is visible.
    pub can_format: bool,
    /// `editor`, `split`, `preview`, or none.
    pub view_mode: Option<String>,
    pub sidebar_visible: bool,
    pub sync_scroll: bool,
    /// Typewriter scrolling is on (Phase 5). Missing means false.
    #[serde(default)]
    pub typewriter: bool,
    /// Live preview in the editor is on. Missing means false.
    #[serde(default)]
    pub live_preview: bool,
    pub tab_count: u32,
    /// The active document is saved in a file (Phase 3). Missing means false.
    #[serde(default)]
    pub has_path: bool,
    /// Pandoc was found, so Export > Word Document works (Phase 3). Missing means false.
    #[serde(default)]
    pub can_export_docx: bool,
    /// Pandoc was found and the flavor of the document has an exact preview (Phase 5). Missing means false.
    #[serde(default)]
    pub can_exact_preview: bool,
    /// The active document is a saved `.qmd` or `.Rmd` file (File > Render with Quarto) (Phase 5). Missing means false.
    #[serde(default)]
    pub can_render: bool,
    /// The exact preview (Pandoc) is on in this window (Phase 5). Missing means false.
    #[serde(default)]
    pub exact_preview: bool,
}

impl MenuState {
    /// The state of a window with no document open (and what is assumed until the page says
    /// otherwise). The sidebar and sync scroll follow the defaults of the settings.
    pub fn without_document() -> Self {
        MenuState {
            has_document: false,
            can_save: false,
            can_format: false,
            view_mode: None,
            sidebar_visible: true,
            sync_scroll: true,
            typewriter: false,
            live_preview: false,
            tab_count: 0,
            has_path: false,
            can_export_docx: false,
            can_exact_preview: false,
            can_render: false,
            exact_preview: false,
        }
    }
}

/// What one item looks like.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemState {
    pub enabled: bool,
    /// Only for checkmark items.
    pub checked: Option<bool>,
}

fn enabled(need: Need, state: &MenuState, window_open: bool) -> bool {
    match need {
        Need::Always => true,
        Need::Window => window_open,
        Need::Document => window_open && state.has_document,
        Need::CanSave => window_open && state.has_document && state.can_save,
        Need::Editor => window_open && state.has_document && state.can_format,
        Need::Tabs => window_open && state.tab_count >= 2,
        Need::SavedDocument => window_open && state.has_document && state.has_path,
        Need::CanExportDocx => window_open && state.has_document && state.can_export_docx,
        Need::CanExactPreview => window_open && state.has_document && state.can_exact_preview,
        Need::CanRender => window_open && state.has_document && state.can_render,
    }
}

fn checked(id: &str, state: &MenuState, window_open: bool) -> bool {
    if !window_open {
        return false;
    }
    match id {
        "view-editor" => state.view_mode.as_deref() == Some("editor"),
        "view-split" => state.view_mode.as_deref() == Some("split"),
        "view-preview" => state.view_mode.as_deref() == Some("preview"),
        "toggle-sidebar" => state.sidebar_visible,
        "toggle-sync-scroll" => state.sync_scroll,
        "toggle-typewriter" => state.typewriter,
        "toggle-live-preview" => state.live_preview,
        "toggle-exact-preview" => state.exact_preview,
        _ => false,
    }
}

/// The state of every item for a menu state. `window_open` is false while the main window is
/// closed (the app keeps running; the menu then offers only what works without a window).
pub fn item_states(state: &MenuState, window_open: bool) -> BTreeMap<&'static str, ItemState> {
    all_items()
        .into_iter()
        .map(|item| {
            (
                item.id,
                ItemState {
                    enabled: enabled(item.need, state, window_open),
                    checked: item.check.then(|| checked(item.id, state, window_open)),
                },
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, HashMap};
    use std::str::FromStr;

    /// The `MenuAction` strings in the `Platform` interface file.
    fn frontend_actions() -> BTreeSet<String> {
        let source = include_str!("../../src/lib/platform.ts");
        let start = source
            .find("export type MenuAction")
            .expect("MenuAction type");
        let rest = &source[start..];
        let end = rest.find(';').expect("end of the union");
        rest[..end]
            .split('\'')
            .enumerate()
            .filter(|(index, _)| index % 2 == 1)
            .map(|(_, action)| action.to_owned())
            .collect()
    }

    fn state(update: impl FnOnce(&mut MenuState)) -> MenuState {
        let mut state = MenuState::without_document();
        update(&mut state);
        state
    }

    fn document() -> MenuState {
        state(|s| {
            s.has_document = true;
            s.can_save = true;
            s.can_format = true;
            s.view_mode = Some("split".into());
            s.tab_count = 1;
            s.has_path = true;
            s.can_export_docx = true;
            s.can_exact_preview = true;
            s.can_render = true;
        })
    }

    fn enabled_ids(menu_state: &MenuState, window_open: bool) -> BTreeSet<&'static str> {
        item_states(menu_state, window_open)
            .into_iter()
            .filter(|(_, item)| item.enabled)
            .map(|(id, _)| id)
            .collect()
    }

    // ---- structure -----------------------------------------------------------------------

    #[test]
    fn the_menu_bar_has_the_seven_menus_of_the_spec_in_order() {
        let labels: Vec<&str> = MENUS.iter().map(|menu| menu.label).collect();

        assert_eq!(
            labels,
            [
                "Writedown",
                "File",
                "Edit",
                "Format",
                "View",
                "Window",
                "Help"
            ]
        );
        assert_eq!(MENUS[5].special, Some(Special::Window));
        assert_eq!(MENUS[6].special, Some(Special::Help));
    }

    #[test]
    fn item_ids_are_unique() {
        let ids: Vec<&str> = all_items().iter().map(|item| item.id).collect();
        let unique: BTreeSet<&str> = ids.iter().copied().collect();

        assert_eq!(ids.len(), unique.len(), "{ids:?}");
        assert!(!ids.iter().any(|id| id.starts_with(RECENT_PREFIX)));
    }

    #[test]
    fn the_action_ids_are_exactly_the_menu_actions_of_the_frontend_type() {
        let ours: BTreeSet<String> = action_ids().iter().map(|id| (*id).to_owned()).collect();

        assert_eq!(ours, frontend_actions());
        assert_eq!(
            ours.len(),
            63,
            "44 from Phase 1 and 2, 13 added in Phase 3, 5 in Phase 5 (typewriter, move tab to new window, export-pdf, exact preview, render with Quarto), 1 for live preview"
        );
    }

    #[test]
    fn settings_and_quit_are_handled_by_rust_and_are_not_actions() {
        for id in [SETTINGS_ID, QUIT_ID, CLEAR_RECENTS_ID] {
            assert!(!is_action(id), "{id}");
        }
        assert!(is_action("save") && is_action("zoom-reset"));
        assert!(!is_action("recent:/a.md") && !is_action("unknown"));
    }

    #[test]
    fn labels_follow_the_spec() {
        let label_of = |id: &str| {
            all_items()
                .into_iter()
                .find(|item| item.id == id)
                .map(|item| item.label)
                .expect(id)
        };

        assert_eq!(label_of("open"), "Open\u{2026}");
        assert_eq!(label_of("save-as"), "Save As\u{2026}");
        assert_eq!(label_of("find"), "Find\u{2026}");
        assert_eq!(label_of("find-replace"), "Find and Replace\u{2026}");
        assert_eq!(label_of("link"), "Link\u{2026}");
        assert_eq!(label_of("image"), "Image");
        assert_eq!(label_of("code"), "Inline Code");
        assert_eq!(label_of("bullet-list"), "Bulleted List");
        assert_eq!(label_of("rule"), "Horizontal Rule");
        assert_eq!(label_of("zoom-reset"), "Actual Size");
        assert_eq!(label_of("toggle-sidebar"), "Show Sidebar");
        assert_eq!(label_of("next-tab"), "Show Next Tab");
        assert_eq!(label_of("markdown-guide"), "Markdown Guide");
        assert_eq!(label_of(QUIT_ID), "Quit Writedown");
    }

    #[test]
    fn no_label_contains_a_dash_or_an_ampersand() {
        for item in all_items() {
            assert!(
                !item.label.contains('\u{2014}')
                    && !item.label.contains('\u{2013}')
                    && !item.label.contains('&'),
                "{}",
                item.label
            );
        }
    }

    #[test]
    fn the_accelerators_are_the_shortcuts_of_the_spec() {
        let accelerator_of = |id: &str| {
            all_items()
                .into_iter()
                .find(|item| item.id == id)
                .and_then(|item| item.accelerator)
        };
        let expected = [
            ("settings", "CmdOrCtrl+,"),
            ("quit", "CmdOrCtrl+Q"),
            ("new", "CmdOrCtrl+N"),
            ("open", "CmdOrCtrl+O"),
            ("close-tab", "CmdOrCtrl+W"),
            ("close-window", "CmdOrCtrl+Shift+W"),
            ("save", "CmdOrCtrl+S"),
            ("save-as", "CmdOrCtrl+Shift+S"),
            ("undo", "CmdOrCtrl+Z"),
            ("redo", "CmdOrCtrl+Shift+Z"),
            ("find", "CmdOrCtrl+F"),
            ("find-replace", "CmdOrCtrl+Alt+F"),
            ("find-next", "CmdOrCtrl+G"),
            ("find-previous", "CmdOrCtrl+Shift+G"),
            ("bold", "CmdOrCtrl+B"),
            ("italic", "CmdOrCtrl+I"),
            ("strikethrough", "CmdOrCtrl+Shift+X"),
            ("code", "CmdOrCtrl+E"),
            ("link", "CmdOrCtrl+K"),
            ("heading-1", "CmdOrCtrl+Alt+1"),
            ("heading-6", "CmdOrCtrl+Alt+6"),
            ("paragraph", "CmdOrCtrl+Alt+0"),
            ("quote", "CmdOrCtrl+Shift+."),
            ("bullet-list", "CmdOrCtrl+Shift+8"),
            ("numbered-list", "CmdOrCtrl+Shift+7"),
            ("task-list", "CmdOrCtrl+Shift+9"),
            ("view-editor", "CmdOrCtrl+1"),
            ("view-split", "CmdOrCtrl+2"),
            ("view-preview", "CmdOrCtrl+3"),
            ("toggle-sidebar", "Ctrl+CmdOrCtrl+S"),
            ("zoom-in", "CmdOrCtrl+="),
            ("zoom-out", "CmdOrCtrl+-"),
            ("zoom-reset", "CmdOrCtrl+0"),
            ("next-tab", "Ctrl+Tab"),
            ("previous-tab", "Ctrl+Shift+Tab"),
            ("open-folder", "CmdOrCtrl+Alt+O"),
            ("quick-open", "CmdOrCtrl+Shift+O"),
            ("print", "CmdOrCtrl+P"),
            ("export-pdf", "CmdOrCtrl+Alt+P"),
            ("paste-plain", "CmdOrCtrl+Alt+Shift+V"),
            ("search-folder", "CmdOrCtrl+Shift+F"),
            ("command-palette", "CmdOrCtrl+Shift+P"),
        ];

        for (id, accelerator) in expected {
            assert_eq!(accelerator_of(id), Some(accelerator), "{id}");
        }
        for id in [
            "image",
            "code-block",
            "table",
            "rule",
            "reveal-in-finder",
            "toggle-sync-scroll",
            "markdown-guide",
            "duplicate",
            "rename",
            "move-to",
            "revert",
            "export-html",
            "export-docx",
            "copy-html",
        ] {
            assert_eq!(accelerator_of(id), None, "{id} has no shortcut");
        }
    }

    #[test]
    fn every_accelerator_parses_because_the_menu_library_drops_one_that_does_not() {
        for item in all_items() {
            if let Some(accelerator) = item.accelerator {
                assert!(
                    muda::accelerator::Accelerator::from_str(accelerator).is_ok(),
                    "{} has an accelerator the menu library cannot parse: {accelerator}",
                    item.id
                );
            }
        }
    }

    #[test]
    fn no_two_items_share_a_shortcut() {
        let mut seen: HashMap<muda::accelerator::Accelerator, &str> = HashMap::new();
        for item in all_items() {
            if let Some(accelerator) = item.accelerator {
                let parsed = muda::accelerator::Accelerator::from_str(accelerator).expect("parses");
                if let Some(other) = seen.insert(parsed, item.id) {
                    panic!("{other} and {} both use {accelerator}", item.id);
                }
            }
        }
    }

    #[test]
    fn the_three_views_sidebar_sync_scroll_and_typewriter_are_checkmark_items_and_nothing_else_is()
    {
        let checks: BTreeSet<&str> = all_items()
            .into_iter()
            .filter(|item| item.check)
            .map(|item| item.id)
            .collect();

        assert_eq!(
            checks,
            BTreeSet::from([
                "view-editor",
                "view-split",
                "view-preview",
                "toggle-sidebar",
                "toggle-sync-scroll",
                "toggle-typewriter",
                "toggle-live-preview",
                "toggle-exact-preview"
            ])
        );
    }

    #[test]
    fn the_file_menu_has_the_open_recent_submenu_after_open() {
        let file = &MENUS[1];
        let position = |wanted: &Entry| file.entries.iter().position(|entry| entry == wanted);

        let open = file
            .entries
            .iter()
            .position(|entry| matches!(entry, Entry::Item(item) if item.id == "open"))
            .expect("open");
        let recent = position(&Entry::OpenRecent).expect("open recent");

        assert_eq!(recent, open + 1);
    }

    #[test]
    fn the_find_and_heading_submenus_are_nested_where_the_spec_puts_them() {
        let nested = |menu: usize, wanted: &str| {
            MENUS[menu]
                .entries
                .iter()
                .any(|entry| matches!(entry, Entry::Submenu { label, .. } if *label == wanted))
        };

        assert!(nested(2, "Find"));
        assert!(nested(3, "Heading"));
    }

    #[test]
    fn the_recent_path_is_the_id_after_the_prefix() {
        assert_eq!(recent_path("recent:/Users/me/a.md"), Some("/Users/me/a.md"));
        assert_eq!(recent_path("recent:"), Some(""));
        assert_eq!(recent_path("save"), None);
    }

    #[test]
    fn only_new_open_the_guide_and_the_phase_3_launchers_create_a_window() {
        for id in [
            "new",
            "open",
            "markdown-guide",
            "open-folder",
            "quick-open",
            "command-palette",
            "search-folder",
        ] {
            assert!(opens_window(id), "{id}");
        }
        for id in [
            "save",
            "close-tab",
            "bold",
            "toggle-sidebar",
            "find",
            "print",
            "rename",
            "export-html",
            "export-pdf",
            "copy-html",
            "paste-plain",
        ] {
            assert!(!opens_window(id), "{id}");
        }
    }

    // ---- enabled and checked -------------------------------------------------------------

    #[test]
    fn with_a_document_open_everything_is_enabled_except_the_tab_items() {
        let all: BTreeSet<&str> = all_items().iter().map(|item| item.id).collect();

        let enabled = enabled_ids(&document(), true);

        let disabled: BTreeSet<&str> = all.difference(&enabled).copied().collect();
        assert_eq!(
            disabled,
            BTreeSet::from(["next-tab", "previous-tab", "move-tab-to-new-window"])
        );
    }

    #[test]
    fn two_tabs_enable_the_tab_items() {
        let two = state(|s| {
            s.has_document = true;
            s.tab_count = 2;
        });

        let enabled = enabled_ids(&two, true);

        assert!(enabled.contains("next-tab") && enabled.contains("previous-tab"));
        let one = state(|s| {
            s.has_document = true;
            s.tab_count = 1;
        });
        assert!(!enabled_ids(&one, true).contains("next-tab"));
    }

    #[test]
    fn without_a_document_only_the_items_that_need_none_are_enabled() {
        let enabled = enabled_ids(&MenuState::without_document(), true);

        assert_eq!(
            enabled,
            BTreeSet::from([
                "settings",
                "quit",
                "new",
                "open",
                "close-tab",
                "close-window",
                "toggle-sidebar",
                "markdown-guide",
                "open-folder",
                "quick-open",
                "command-palette",
                "search-folder"
            ])
        );
    }

    #[test]
    fn close_tab_works_without_a_document_because_it_then_closes_the_window() {
        let enabled = enabled_ids(&MenuState::without_document(), true);

        assert!(enabled.contains("close-tab") && enabled.contains("close-window"));
    }

    #[test]
    fn save_needs_something_to_save_but_save_as_only_needs_a_document() {
        let clean = state(|s| {
            s.has_document = true;
            s.can_save = false;
        });

        let enabled = enabled_ids(&clean, true);

        assert!(!enabled.contains("save"));
        assert!(enabled.contains("save-as") && enabled.contains("reveal-in-finder"));
    }

    #[test]
    fn formatting_is_disabled_when_the_editor_is_hidden() {
        let preview = state(|s| {
            s.has_document = true;
            s.can_format = false;
            s.view_mode = Some("preview".into());
        });

        let enabled = enabled_ids(&preview, true);

        for id in [
            "bold",
            "italic",
            "heading-3",
            "paragraph",
            "quote",
            "table",
            "rule",
            "image",
            "link",
        ] {
            assert!(!enabled.contains(id), "{id}");
        }
        for id in ["find", "undo", "view-editor", "zoom-in", "save-as"] {
            assert!(enabled.contains(id), "{id}");
        }
    }

    #[test]
    fn formatting_needs_a_document_even_if_the_flag_says_the_editor_is_visible() {
        let odd = state(|s| {
            s.has_document = false;
            s.can_format = true;
        });

        assert!(!enabled_ids(&odd, true).contains("bold"));
    }

    #[test]
    fn with_the_window_closed_only_the_items_that_work_without_one_are_enabled() {
        let enabled = enabled_ids(&document(), false);

        assert_eq!(
            enabled,
            BTreeSet::from([
                "settings",
                "quit",
                "new",
                "open",
                "markdown-guide",
                "open-folder",
                "quick-open",
                "command-palette",
                "search-folder"
            ])
        );
    }

    #[test]
    fn the_views_are_a_radio_group_with_the_current_view_checked() {
        for (mode, checked_id) in [
            ("editor", "view-editor"),
            ("split", "view-split"),
            ("preview", "view-preview"),
        ] {
            let states = item_states(
                &state(|s| {
                    s.has_document = true;
                    s.view_mode = Some(mode.into());
                }),
                true,
            );
            let checked: Vec<&str> = ["view-editor", "view-split", "view-preview"]
                .into_iter()
                .filter(|id| states[id].checked == Some(true))
                .collect();

            assert_eq!(checked, [checked_id], "{mode}");
        }
    }

    #[test]
    fn no_view_is_checked_when_the_view_is_unknown() {
        let states = item_states(&state(|s| s.has_document = true), true);

        for id in ["view-editor", "view-split", "view-preview"] {
            assert_eq!(states[id].checked, Some(false), "{id}");
        }
    }

    #[test]
    fn the_sidebar_and_sync_scroll_checkmarks_follow_the_state() {
        let on = item_states(&document(), true);
        let off = item_states(
            &state(|s| {
                s.has_document = true;
                s.sidebar_visible = false;
                s.sync_scroll = false;
            }),
            true,
        );

        assert_eq!(on["toggle-sidebar"].checked, Some(true));
        assert_eq!(on["toggle-sync-scroll"].checked, Some(true));
        assert_eq!(off["toggle-sidebar"].checked, Some(false));
        assert_eq!(off["toggle-sync-scroll"].checked, Some(false));
    }

    #[test]
    fn the_typewriter_checkmark_follows_the_state_and_needs_a_document() {
        let off = item_states(&document(), true);
        let on = item_states(
            &state(|s| {
                s.has_document = true;
                s.typewriter = true;
            }),
            true,
        );
        let none = item_states(&MenuState::without_document(), true);

        assert_eq!(off["toggle-typewriter"].checked, Some(false));
        assert_eq!(on["toggle-typewriter"].checked, Some(true));
        assert!(off["toggle-typewriter"].enabled);
        assert!(!none["toggle-typewriter"].enabled);
    }

    #[test]
    fn the_render_item_needs_a_saved_quarto_or_rmd_document() {
        let without = item_states(&state(|s| s.has_document = true), true);
        let with = item_states(
            &state(|s| {
                s.has_document = true;
                s.can_render = true;
            }),
            true,
        );
        assert!(!without["render-quarto"].enabled);
        assert!(with["render-quarto"].enabled);
        assert_eq!(with["render-quarto"].checked, None);
        assert!(!item_states(&MenuState::without_document(), true)["render-quarto"].enabled);
        let parsed: MenuState = serde_json::from_str(
            r#"{"hasDocument": true, "canSave": true, "canFormat": true, "viewMode": "split",
                "sidebarVisible": true, "syncScroll": true, "tabCount": 1, "canRender": true}"#,
        )
        .expect("state");
        assert!(parsed.can_render);
    }

    #[test]
    fn the_exact_preview_item_needs_pandoc_and_a_flavor_that_has_one() {
        let without = item_states(&state(|s| s.has_document = true), true);
        let with = item_states(
            &state(|s| {
                s.has_document = true;
                s.can_exact_preview = true;
            }),
            true,
        );
        let on = item_states(
            &state(|s| {
                s.has_document = true;
                s.can_exact_preview = true;
                s.exact_preview = true;
            }),
            true,
        );
        assert!(!without["toggle-exact-preview"].enabled);
        assert!(with["toggle-exact-preview"].enabled);
        assert_eq!(with["toggle-exact-preview"].checked, Some(false));
        assert_eq!(on["toggle-exact-preview"].checked, Some(true));
        assert!(!item_states(&MenuState::without_document(), true)["toggle-exact-preview"].enabled);
    }

    #[test]
    fn items_that_are_not_checkmarks_have_no_checked_state() {
        let states = item_states(&document(), true);

        assert_eq!(states["save"].checked, None);
        assert_eq!(states["bold"].checked, None);
    }

    #[test]
    fn with_the_window_closed_no_checkmark_is_shown() {
        let states = item_states(&document(), false);

        for id in ["view-split", "toggle-sidebar", "toggle-sync-scroll"] {
            assert_eq!(states[id].checked, Some(false), "{id}");
        }
    }

    // ---- what a chosen item does ----------------------------------------------------------

    fn context(main_window_exists: bool, focus: Focus, tab_count: u32) -> ActionContext {
        ActionContext {
            main_window_exists,
            focus,
            tab_count,
        }
    }

    #[test]
    fn an_ordinary_action_is_sent_to_the_page() {
        for id in [
            "save",
            "bold",
            "view-split",
            "zoom-in",
            "toggle-sidebar",
            "find",
            "undo",
        ] {
            assert_eq!(
                plan(id, &context(true, Focus::Main, 1)),
                [Step::Deliver],
                "{id}"
            );
        }
    }

    #[test]
    fn close_window_starts_the_close_protocol_and_is_still_sent_to_the_page() {
        assert_eq!(
            plan("close-window", &context(true, Focus::Main, 3)),
            [Step::RequestWindowClose, Step::Deliver]
        );
    }

    #[test]
    fn close_tab_closes_a_tab_when_there_are_tabs_and_the_window_when_there_are_none() {
        assert_eq!(
            plan("close-tab", &context(true, Focus::Main, 2)),
            [Step::Deliver]
        );
        assert_eq!(
            plan("close-tab", &context(true, Focus::Main, 0)),
            [Step::RequestWindowClose, Step::Deliver]
        );
    }

    #[test]
    fn close_tab_and_close_window_close_the_preferences_window_when_it_has_the_focus() {
        for id in ["close-tab", "close-window"] {
            assert_eq!(
                plan(id, &context(true, Focus::Preferences, 2)),
                [Step::ClosePreferences],
                "{id}"
            );
            assert_eq!(
                plan(id, &context(false, Focus::Preferences, 0)),
                [Step::ClosePreferences],
                "{id} with no main window"
            );
        }
    }

    #[test]
    fn without_a_main_window_new_open_and_the_guide_create_it_and_nothing_else_does_anything() {
        for id in ["new", "open", "markdown-guide"] {
            assert_eq!(
                plan(id, &context(false, Focus::Nothing, 0)),
                [Step::CreateMainWindow, Step::Deliver],
                "{id}"
            );
        }
        for id in [
            "save",
            "close-tab",
            "close-window",
            "bold",
            "toggle-sidebar",
            "zoom-in",
            "find",
        ] {
            assert!(
                plan(id, &context(false, Focus::Nothing, 0)).is_empty(),
                "{id}"
            );
        }
    }

    #[test]
    fn actions_are_not_sent_to_the_page_behind_the_preferences_window() {
        for id in [
            "save",
            "bold",
            "view-editor",
            "find",
            "undo",
            "toggle-sidebar",
        ] {
            assert!(
                plan(id, &context(true, Focus::Preferences, 1)).is_empty(),
                "{id}"
            );
        }
    }

    #[test]
    fn new_and_open_from_the_preferences_window_bring_the_main_window_forward() {
        for id in ["new", "open", "markdown-guide"] {
            assert_eq!(
                plan(id, &context(true, Focus::Preferences, 1)),
                [Step::FocusMain, Step::Deliver],
                "{id}"
            );
        }
    }

    #[test]
    fn new_and_open_with_the_main_window_in_front_just_deliver() {
        for id in ["new", "open", "markdown-guide"] {
            assert_eq!(
                plan(id, &context(true, Focus::Main, 1)),
                [Step::Deliver],
                "{id}"
            );
        }
    }

    #[test]
    fn with_the_app_in_the_background_actions_still_reach_the_main_window() {
        // The menu bar can only be used by an active app, so "nothing focused" is rare; the
        // main window is the only place the actions can go.
        assert_eq!(
            plan("save", &context(true, Focus::Nothing, 1)),
            [Step::Deliver]
        );
    }

    #[test]
    fn every_action_has_a_plan_in_every_situation_without_panicking() {
        for id in action_ids() {
            for exists in [false, true] {
                for focus in [Focus::Main, Focus::Preferences, Focus::Nothing] {
                    for tabs in [0, 1, 5] {
                        let steps = plan(id, &context(exists, focus, tabs));
                        // A window is only created for the actions that open one.
                        if steps.contains(&Step::CreateMainWindow) {
                            assert!(opens_window(id) && !exists, "{id}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_state_the_shell_sends_deserializes() {
        let state: MenuState = serde_json::from_str(
            r#"{"hasDocument": true, "canSave": false, "canFormat": true, "viewMode": null,
                "sidebarVisible": true, "syncScroll": false, "tabCount": 3,
                "hasPath": true, "canExportDocx": true}"#,
        )
        .expect("parses");

        assert!(state.has_path && state.can_export_docx);
        let without: MenuState = serde_json::from_str(
            r#"{"hasDocument": true, "canSave": false, "canFormat": true, "viewMode": null,
                "sidebarVisible": true, "syncScroll": false, "tabCount": 3}"#,
        )
        .expect("parses without the Phase 3 fields");
        assert!(!without.has_path && !without.can_export_docx);

        assert!(state.has_document && !state.can_save && state.can_format);
        assert_eq!(state.view_mode, None);
        assert_eq!(state.tab_count, 3);
        assert!(!state.sync_scroll);
        assert!(serde_json::from_str::<MenuState>(r#"{"hasDocument": true}"#).is_err());
    }

    // ---- Phase 3 ----------------------------------------------------------------

    fn item_labels(entries: &[Entry]) -> Vec<String> {
        entries
            .iter()
            .map(|entry| match entry {
                Entry::Item(item) => item.id.to_owned(),
                Entry::Separator => "-".to_owned(),
                Entry::Predefined(_) => "predefined".to_owned(),
                Entry::Submenu { label, .. } => format!("{label} >"),
                Entry::OpenRecent => "open-recent".to_owned(),
            })
            .collect()
    }

    #[test]
    fn c35_the_file_menu_has_the_phase_3_items_in_the_order_of_the_spec() {
        assert_eq!(
            item_labels(MENUS[1].entries),
            [
                "new",
                "open",
                "open-recent",
                "open-folder",
                "quick-open",
                "-",
                "close-tab",
                "close-window",
                "-",
                "save",
                "save-as",
                "duplicate",
                "rename",
                "move-to",
                "revert",
                "-",
                "Export >",
                "render-quarto",
                "print",
                "-",
                "reveal-in-finder"
            ]
        );
        let export = MENUS[1]
            .entries
            .iter()
            .find_map(|entry| match entry {
                Entry::Submenu {
                    label: "Export",
                    entries,
                } => Some(*entries),
                _ => None,
            })
            .expect("Export submenu");
        assert_eq!(
            item_labels(export),
            ["export-html", "export-docx", "export-pdf"]
        );
    }

    #[test]
    fn c35_the_edit_and_view_menus_have_the_phase_3_items() {
        let edit = item_labels(MENUS[2].entries);
        let position = |id: &str| edit.iter().position(|entry| entry == id).expect(id);
        // Copy as HTML right after Copy, Paste and Match Style right after Paste.
        assert_eq!(position("copy-html"), position("paste-plain") - 2);
        assert_eq!(edit[position("copy-html") - 1], "predefined");
        assert_eq!(edit[position("paste-plain") - 1], "predefined");
        let find = MENUS[2]
            .entries
            .iter()
            .find_map(|entry| match entry {
                Entry::Submenu {
                    label: "Find",
                    entries,
                } => Some(*entries),
                _ => None,
            })
            .expect("Find submenu");
        assert!(item_labels(find).contains(&"search-folder".to_owned()));
        assert_eq!(item_labels(MENUS[4].entries)[0], "command-palette");
    }

    #[test]
    fn c35_the_phase_3_labels_follow_the_spec() {
        let label_of = |id: &str| {
            all_items()
                .into_iter()
                .find(|item| item.id == id)
                .map(|item| item.label)
                .expect(id)
        };
        for (id, label) in [
            ("open-folder", "Open Folder\u{2026}"),
            ("quick-open", "Quick Open\u{2026}"),
            ("duplicate", "Duplicate"),
            ("rename", "Rename\u{2026}"),
            ("move-to", "Move To\u{2026}"),
            ("revert", "Revert to Saved"),
            ("export-html", "HTML\u{2026}"),
            ("export-docx", "Word Document\u{2026}"),
            ("export-pdf", "PDF\u{2026}"),
            ("print", "Print\u{2026}"),
            ("copy-html", "Copy as HTML"),
            ("paste-plain", "Paste and Match Style"),
            ("search-folder", "Search in Folder\u{2026}"),
            ("command-palette", "Command Palette\u{2026}"),
        ] {
            assert_eq!(label_of(id), label, "{id}");
        }
    }

    #[test]
    fn c35_the_launchers_are_always_enabled_with_or_without_a_window() {
        for window_open in [false, true] {
            let enabled = enabled_ids(&MenuState::without_document(), window_open);
            for id in [
                "open-folder",
                "quick-open",
                "command-palette",
                "search-folder",
            ] {
                assert!(enabled.contains(id), "{id} (window {window_open})");
            }
        }
    }

    #[test]
    fn c35_the_saved_document_items_need_a_file() {
        let saved = ["duplicate", "rename", "move-to", "revert", "copy-html"];
        let untitled = state(|s| {
            s.has_document = true;
            s.can_save = true;
            s.can_format = true;
            s.has_path = false;
        });

        let enabled = enabled_ids(&untitled, true);

        for id in saved {
            assert!(!enabled.contains(id), "{id} needs a saved document");
        }
        // Export and print also work for an untitled document.
        for id in [
            "export-html",
            "export-pdf",
            "print",
            "paste-plain",
            "save-as",
        ] {
            assert!(enabled.contains(id), "{id}");
        }
        let with_file = enabled_ids(
            &state(|s| {
                s.has_document = true;
                s.has_path = true;
            }),
            true,
        );
        for id in saved {
            assert!(with_file.contains(id), "{id}");
        }
        // Nothing needs a document when none is open.
        let none = enabled_ids(&MenuState::without_document(), true);
        for id in saved.iter().chain(&[
            "export-html",
            "export-docx",
            "export-pdf",
            "print",
            "paste-plain",
        ]) {
            assert!(!none.contains(id), "{id}");
        }
    }

    #[test]
    fn c35_word_export_needs_pandoc_and_paste_and_match_style_needs_the_editor() {
        let no_pandoc = state(|s| {
            s.has_document = true;
            s.has_path = true;
            s.can_export_docx = false;
            s.can_format = true;
        });
        let preview = state(|s| {
            s.has_document = true;
            s.has_path = true;
            s.can_export_docx = true;
            s.can_format = false;
        });

        assert!(!enabled_ids(&no_pandoc, true).contains("export-docx"));
        assert!(enabled_ids(&no_pandoc, true).contains("export-html"));
        assert!(enabled_ids(&no_pandoc, true).contains("paste-plain"));
        assert!(enabled_ids(&preview, true).contains("export-docx"));
        assert!(!enabled_ids(&preview, true).contains("paste-plain"));
        assert!(!enabled_ids(&document(), false).contains("export-docx"));
    }

    #[test]
    fn c35_the_launchers_create_the_window_when_there_is_none_and_the_others_do_nothing() {
        for id in [
            "open-folder",
            "quick-open",
            "command-palette",
            "search-folder",
        ] {
            assert_eq!(
                plan(id, &context(false, Focus::Nothing, 0)),
                [Step::CreateMainWindow, Step::Deliver],
                "{id}"
            );
            assert_eq!(
                plan(id, &context(true, Focus::Preferences, 1)),
                [Step::FocusMain, Step::Deliver],
                "{id}"
            );
        }
        for id in [
            "print",
            "rename",
            "duplicate",
            "copy-html",
            "export-html",
            "export-pdf",
        ] {
            assert!(
                plan(id, &context(false, Focus::Nothing, 0)).is_empty(),
                "{id}"
            );
        }
    }
}

#[cfg(test)]
mod shortcut_tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn a_shortcut_reads_as_macos_shows_it() {
        let s = parse_shortcut("⇧⌘O").expect("parses");
        assert!(s.shift && s.cmd && !s.ctrl && !s.alt);
        assert_eq!(s.key, "O");
        assert_eq!(parse_shortcut("⌃Tab").expect("tab").key, "Tab");
        assert!(parse_shortcut("^⇧Tab").expect("caret").ctrl);
        assert_eq!(parse_shortcut("⌥↑").expect("arrow").key, "Up");
        assert_eq!(parse_shortcut("F5").expect("function").key, "F5");
        assert_eq!(parse_shortcut("⌘k").expect("lower").key, "K");
    }

    #[test]
    fn things_that_are_not_shortcuts_do_not_parse() {
        for bad in ["", "⌘", "⌘AB", "⌘F0", "⌘F21", "⌘ ", "Cmd+K", "⌘⌘"] {
            assert!(parse_shortcut(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn canonical_form_orders_the_modifiers_and_uses_symbols_for_named_keys() {
        assert_eq!(canonical_shortcut("⌘⇧o").as_deref(), Some("⇧⌘O"));
        assert_eq!(canonical_shortcut("^⌘S").as_deref(), Some("⌃⌘S"));
        assert_eq!(canonical_shortcut("⌥Up").as_deref(), Some("⌥↑"));
        assert_eq!(canonical_shortcut("⌃⇥").as_deref(), Some("⌃Tab"));
        assert_eq!(canonical_shortcut("⌘Space").as_deref(), Some("⌘␣"));
    }

    #[test]
    fn the_accelerator_of_every_default_shortcut_round_trips_and_parses_in_the_menu_library() {
        // The frontend lists defaults as macOS shows them; the Rust data holds accelerators.
        for item in all_items() {
            let Some(accelerator) = item.accelerator else {
                continue;
            };
            assert!(
                muda::accelerator::Accelerator::from_str(accelerator).is_ok(),
                "{accelerator}"
            );
        }
        for (text, expected) in [
            ("⇧⌘O", "Shift+CmdOrCtrl+O"),
            ("⌥⌘1", "Alt+CmdOrCtrl+1"),
            ("⌃⇧Tab", "Ctrl+Shift+Tab"),
            ("⌥↓", "Alt+Down"),
            ("⌘↩", "CmdOrCtrl+Enter"),
            ("F5", "F5"),
            ("⌘[", "CmdOrCtrl+["),
            ("⌘␣", "CmdOrCtrl+Space"),
        ] {
            let accelerator = accelerator_for(text).expect("accelerator");
            assert_eq!(accelerator, expected);
            assert!(
                muda::accelerator::Accelerator::from_str(&accelerator).is_ok(),
                "{accelerator}"
            );
        }
    }

    #[test]
    fn only_menu_actions_and_editor_keys_can_have_a_shortcut() {
        assert!(is_shortcut_command("bold"));
        assert!(is_shortcut_command("editor:Mod-d"));
        assert!(!is_shortcut_command("editor:"));
        assert!(!is_shortcut_command(SETTINGS_ID));
        assert!(!is_shortcut_command(QUIT_ID));
        assert!(!is_shortcut_command("no-such-command"));
    }

    #[test]
    fn the_menu_takes_overrides_and_falls_back_to_the_defaults() {
        let mut overrides = BTreeMap::new();
        overrides.insert("bold".to_owned(), Some("⌥⌘B".to_owned()));
        overrides.insert("italic".to_owned(), None);
        overrides.insert("image".to_owned(), Some("⌃⌘I".to_owned()));
        let wanted: BTreeMap<_, _> = accelerators_with(&overrides).into_iter().collect();
        // Built without `Some("...")` literals: the D08 unit test reads every one of those in
        // this file as a menu accelerator.
        assert_eq!(wanted["bold"], accelerator_for("⌥⌘B"));
        assert_eq!(wanted["italic"], None);
        assert_eq!(wanted["image"], accelerator_for("⌃⌘I"));
        assert_eq!(
            wanted["save"],
            all_items()
                .into_iter()
                .find(|item| item.id == "save")
                .and_then(|item| item.accelerator.map(str::to_owned))
        );
        assert_eq!(wanted["duplicate"], None);
        assert_eq!(wanted.len(), all_items().len());
    }
}
