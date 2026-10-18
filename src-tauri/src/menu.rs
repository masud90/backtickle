//! The application menu bar, built from the description in `menu_spec.rs`.
//!
//! - Every item the frontend handles sends `menu-action` with its id to the main window; if the
//!   window is closed, New, Open and Markdown Guide create it first, and the action waits until
//!   its page is ready (`menu_ready`). Undo and Redo also send the Phase 0 `edit-command`
//!   event until the shell has moved over to `menu-action`.
//! - Settings, Quit, Clear Menu and the Open Recent entries are handled here.
//! - `updateMenuState` enables, disables and checks items; only items whose look changed are
//!   touched. The check items (the three views, sidebar, sync scroll) are put back to what the
//!   shell last said right after a click, because the system flips them by itself.
//! - Keys the editor binds itself (⌘Z, ⌘F, ⌘G) reach CodeMirror first when the editor has the
//!   focus and do not fire the menu item; keys it does not bind (⌘B and the other formatting
//!   keys) go to the menu. That is intended.

use crate::grants::PathGrants;
use crate::lifecycle::{self, AppCloseProtocol, CloseReason};
use crate::menu_spec::{
    self, ActionContext, Entry, Focus, ItemState, MENUS, MenuState, Predefined, Special, Step,
};
use crate::open_files;
use crate::pending::{Pages, Routed};
use crate::recents::RecentEntry;
use crate::stores::{self, Stores};
use crate::trace::Trace;
use crate::windows::{self, MAIN_LABEL, PREFERENCES_LABEL, open_preferences};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::menu::{
    AboutMetadataBuilder, CheckMenuItem, HELP_SUBMENU_ID, IsMenuItem, Menu, MenuEvent, MenuItem,
    PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub use crate::menu_spec::{REDO_ID, SETTINGS_ID, UNDO_ID};

/// The event name `onEditCommand` listens to in `src/lib/platform.ts` (Phase 0).
pub const EDIT_COMMAND_EVENT: &str = "edit-command";
/// The event name `onMenuAction` listens to.
pub const MENU_ACTION_EVENT: &str = "menu-action";
/// Open Recent shows at most this many entries.
pub const RECENT_MENU_ENTRIES: usize = 10;

#[derive(Clone)]
enum ItemHandle {
    Plain(MenuItem<Wry>),
    Check(CheckMenuItem<Wry>),
}

impl ItemHandle {
    fn apply(&self, state: ItemState) {
        match self {
            ItemHandle::Plain(item) => {
                let _ = item.set_enabled(state.enabled);
            }
            ItemHandle::Check(item) => {
                let _ = item.set_enabled(state.enabled);
                if let Some(checked) = state.checked {
                    let _ = item.set_checked(checked);
                }
            }
        }
    }
}

struct Runtime {
    /// What each document window last reported (`updateMenuState`), by window label.
    states: HashMap<String, MenuState>,
    /// The window whose state the menu shows: the one with the focus, else the last focused.
    target: Option<String>,
    window_open: bool,
    /// What each item was last set to, so only changes are applied.
    applied: HashMap<&'static str, ItemState>,
    /// The shortcut overrides the accelerators were last set from (Phase 5).
    shortcuts: BTreeMap<String, Option<String>>,
}

/// The items of the menu bar, as managed app state.
pub struct MenuHandles {
    items: HashMap<&'static str, ItemHandle>,
    recent: Submenu<Wry>,
    runtime: Mutex<Runtime>,
}

impl MenuHandles {
    fn runtime(&self) -> MutexGuard<'_, Runtime> {
        self.runtime.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A window's shell pushed a new state (`updateMenuState`). The menu shows it when the window
    /// is the one the menu follows (or when none is chosen yet).
    pub fn set_state(&self, app: &AppHandle<Wry>, label: &str, state: MenuState) {
        let mut runtime = self.runtime();
        runtime.states.insert(label.to_owned(), state);
        if runtime.target.is_none() {
            runtime.target = Some(label.to_owned());
        }
        self.apply(app, &mut runtime);
    }

    /// The menu follows this window from now on (it got the focus, or the one before it closed).
    pub fn set_target(&self, app: &AppHandle<Wry>, label: Option<String>) {
        let mut runtime = self.runtime();
        if runtime.target == label {
            return;
        }
        runtime.target = label;
        self.apply(app, &mut runtime);
    }

    /// A window is gone: its state is forgotten and, if the menu followed it, it follows nobody
    /// until `set_target` says otherwise.
    pub fn forget_window(&self, app: &AppHandle<Wry>, label: &str) {
        let mut runtime = self.runtime();
        runtime.states.remove(label);
        if runtime.target.as_deref() == Some(label) {
            runtime.target = None;
        }
        self.apply(app, &mut runtime);
    }

    /// A document window exists (or none does any more). With no window the menu offers only
    /// what works without one, and the states the old pages pushed are forgotten.
    pub fn set_window_open(&self, app: &AppHandle<Wry>, open: bool) {
        let mut runtime = self.runtime();
        runtime.window_open = open;
        if !open {
            runtime.states.clear();
            runtime.target = None;
        }
        self.apply(app, &mut runtime);
    }

    /// The number of tabs the followed window last reported.
    pub fn tab_count(&self) -> u32 {
        let runtime = self.runtime();
        current_state(&runtime).tab_count
    }

    /// Puts the checkmark of a check item back to what was last applied. The system toggles a
    /// check item when it is clicked; the shell's next state decides what it should show.
    fn snap_back(&self, id: &str) {
        let Some(ItemHandle::Check(item)) = self.items.get(id) else {
            return;
        };
        let checked = self
            .runtime()
            .applied
            .get(id)
            .and_then(|state| state.checked);
        if let Some(checked) = checked {
            let _ = item.set_checked(checked);
        }
    }

    /// The shortcuts changed (Preferences > Keyboard Shortcuts): every item takes its default
    /// accelerator or its override. Items already right are left alone; the work runs on the
    /// main thread.
    pub fn set_shortcuts(
        &self,
        app: &AppHandle<Wry>,
        overrides: &BTreeMap<String, Option<String>>,
    ) {
        let mut runtime = self.runtime();
        let before = std::mem::replace(&mut runtime.shortcuts, overrides.clone());
        let changed: Vec<(ItemHandle, Option<String>)> = menu_spec::accelerators_with(overrides)
            .into_iter()
            .filter(|(id, _)| before.get(*id) != overrides.get(*id))
            .filter_map(|(id, accelerator)| {
                let accelerator =
                    accelerator.and_then(|text| menu_spec::platform_accelerator(&text));
                self.items
                    .get(id)
                    .map(|handle| (handle.clone(), accelerator))
            })
            .collect();
        if changed.is_empty() {
            return;
        }
        let _ = app.run_on_main_thread(move || {
            for (handle, accelerator) in changed {
                match handle {
                    ItemHandle::Plain(item) => {
                        let _ = item.set_accelerator(accelerator);
                    }
                    ItemHandle::Check(item) => {
                        let _ = item.set_accelerator(accelerator);
                    }
                }
            }
        });
    }

    /// Applies the items whose state differs from what was applied, on the main thread.
    fn apply(&self, app: &AppHandle<Wry>, runtime: &mut Runtime) {
        let desired = menu_spec::item_states(&current_state(runtime), runtime.window_open);
        let mut changes: Vec<(ItemHandle, ItemState)> = Vec::new();
        for (id, state) in desired {
            if runtime.applied.get(id) == Some(&state) {
                continue;
            }
            runtime.applied.insert(id, state);
            if let Some(handle) = self.items.get(id) {
                changes.push((handle.clone(), state));
            }
        }
        if changes.is_empty() {
            return;
        }
        let _ = app.run_on_main_thread(move || {
            for (handle, state) in changes {
                handle.apply(state);
            }
        });
    }
}

/// The state the menu shows: the followed window's, or that of a window with no document.
fn current_state(runtime: &Runtime) -> MenuState {
    runtime
        .target
        .as_ref()
        .and_then(|label| runtime.states.get(label))
        .cloned()
        .unwrap_or_else(MenuState::without_document)
}

fn predefined(app: &AppHandle<Wry>, kind: Predefined) -> tauri::Result<PredefinedMenuItem<Wry>> {
    match kind {
        Predefined::About => {
            let about = AboutMetadataBuilder::new()
                .name(Some("Backtickle"))
                .version(Some(app.package_info().version.to_string()))
                .build();
            PredefinedMenuItem::about(app, Some("About Backtickle"), Some(about))
        }
        Predefined::Services => PredefinedMenuItem::services(app, None),
        Predefined::Hide => PredefinedMenuItem::hide(app, Some("Hide Backtickle")),
        Predefined::HideOthers => PredefinedMenuItem::hide_others(app, None),
        Predefined::ShowAll => PredefinedMenuItem::show_all(app, None),
        Predefined::Cut => PredefinedMenuItem::cut(app, None),
        Predefined::Copy => PredefinedMenuItem::copy(app, None),
        Predefined::Paste => PredefinedMenuItem::paste(app, None),
        Predefined::SelectAll => PredefinedMenuItem::select_all(app, None),
        Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, None),
        Predefined::Minimize => PredefinedMenuItem::minimize(app, None),
        Predefined::Zoom => PredefinedMenuItem::maximize(app, Some("Zoom")),
        Predefined::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, None),
    }
}

/// Whether the menu bar is the macOS one: an app menu, and system items for Services, Hide, Full
/// Screen and the window commands. Windows and Linux have no app menu and fewer system items.
const MAC_MENU_BAR: bool = cfg!(target_os = "macos");

/// The id of View > Full Screen on Windows and Linux, where the system has no full screen item of
/// its own.
pub const FULLSCREEN_ID: &str = "fullscreen";
/// The ids of Window > Minimize and Maximize on Linux, where the menu library has no working items
/// for them (it shows them disabled).
pub const MINIMIZE_ID: &str = "minimize";
pub const MAXIMIZE_ID: &str = "maximize";

/// The Edit items that the menu library on Linux can only carry out by faking a key press (X11
/// only). Backtickle has its own items there that run the web view's editing command; their keys
/// are not registered, so the web view still gets them directly as it does on every system.
#[cfg(not(any(target_os = "macos", windows)))]
const EDIT_COMMANDS: &[(Predefined, &str, &str)] = &[
    (Predefined::Cut, "edit-cut", "Cut"),
    (Predefined::Copy, "edit-copy", "Copy"),
    (Predefined::Paste, "edit-paste", "Paste"),
    (Predefined::SelectAll, "edit-select-all", "Select All"),
];

/// Whether the system item exists on this system: Windows and Linux have no Services, no Hide
/// Others or Show All, no Bring All to Front, and Full Screen is an item of the app there.
fn predefined_exists(kind: Predefined) -> bool {
    MAC_MENU_BAR
        || !matches!(
            kind,
            Predefined::Services
                | Predefined::Hide
                | Predefined::HideOthers
                | Predefined::ShowAll
                | Predefined::BringAllToFront
                | Predefined::Fullscreen
        )
}

/// The label an item has on this system (Windows names Finder File Explorer, Linux has a file
/// manager).
pub fn platform_label(id: &str, label: &'static str) -> &'static str {
    if cfg!(windows) {
        match id {
            "reveal-in-finder" => "Show in File Explorer",
            menu_spec::QUIT_ID => "Exit",
            _ => label,
        }
    } else if !MAC_MENU_BAR {
        match id {
            "reveal-in-finder" => "Show in File Manager",
            _ => label,
        }
    } else {
        label
    }
}

/// Linux: the item Backtickle has in place of a system item the menu library cannot carry out
/// (Minimize, Maximize, and the Edit items), or `None` for the system's own item.
#[cfg(not(any(target_os = "macos", windows)))]
fn linux_item(app: &AppHandle<Wry>, kind: Predefined) -> tauri::Result<Option<MenuItem<Wry>>> {
    let (id, label) = match kind {
        Predefined::Minimize => (MINIMIZE_ID, "Minimize"),
        Predefined::Zoom => (MAXIMIZE_ID, "Maximize"),
        _ => match EDIT_COMMANDS.iter().find(|(item, _, _)| *item == kind) {
            Some((_, id, label)) => (*id, *label),
            None => return Ok(None),
        },
    };
    MenuItem::with_id(app, id, label, true, None::<&str>).map(Some)
}

#[cfg(any(target_os = "macos", windows))]
fn linux_item(_app: &AppHandle<Wry>, _kind: Predefined) -> tauri::Result<Option<MenuItem<Wry>>> {
    Ok(None)
}

fn append_entries(
    app: &AppHandle<Wry>,
    parent: &Submenu<Wry>,
    entries: &[Entry],
    items: &mut HashMap<&'static str, ItemHandle>,
    recent: &mut Option<Submenu<Wry>>,
) -> tauri::Result<()> {
    for entry in entries {
        match entry {
            Entry::Item(item) if item.check => {
                let created = CheckMenuItem::with_id(
                    app,
                    item.id,
                    platform_label(item.id, item.label),
                    true,
                    false,
                    item.accelerator.and_then(menu_spec::platform_accelerator),
                )?;
                parent.append(&created)?;
                items.insert(item.id, ItemHandle::Check(created));
            }
            Entry::Item(item) => {
                let created = MenuItem::with_id(
                    app,
                    item.id,
                    platform_label(item.id, item.label),
                    true,
                    item.accelerator.and_then(menu_spec::platform_accelerator),
                )?;
                parent.append(&created)?;
                items.insert(item.id, ItemHandle::Plain(created));
            }
            Entry::Separator => parent.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Predefined(Predefined::Fullscreen) if !MAC_MENU_BAR => {
                let item = MenuItem::with_id(app, FULLSCREEN_ID, "Full Screen", true, Some("F11"))?;
                parent.append(&item)?;
            }
            Entry::Predefined(Predefined::Zoom) if cfg!(windows) => {
                parent.append(&PredefinedMenuItem::maximize(app, None)?)?;
            }
            Entry::Predefined(kind) if !predefined_exists(*kind) => {}
            Entry::Predefined(kind) => match linux_item(app, *kind)? {
                Some(item) => parent.append(&item)?,
                None => parent.append(&predefined(app, *kind)?)?,
            },
            Entry::Submenu { label, entries } => {
                let submenu = Submenu::new(app, *label, true)?;
                append_entries(app, &submenu, entries, items, recent)?;
                parent.append(&submenu)?;
            }
            Entry::OpenRecent => {
                let submenu = Submenu::new(app, "Open Recent", true)?;
                parent.append(&submenu)?;
                *recent = Some(submenu);
            }
        }
    }
    Ok(())
}

/// Builds the menu bar and the handles used to change it later. `recents` fills Open Recent.
pub fn build(
    app: &AppHandle<Wry>,
    recents: &[RecentEntry],
) -> tauri::Result<(Menu<Wry>, MenuHandles)> {
    let mut items = HashMap::new();
    let mut recent = None;
    let mut menus: Vec<Submenu<Wry>> = Vec::new();
    for spec in MENUS {
        // Windows and Linux have no app menu: its items move to File (Settings, Exit or Quit) and
        // Help (About), as apps there have them (`windows_extras`).
        if !MAC_MENU_BAR && spec.label == menu_spec::APP_MENU_LABEL {
            continue;
        }
        // macOS treats the Window and Help menus specially (window list, search field); Tauri
        // recognizes them by these ids.
        let submenu = match spec.special {
            Some(Special::Window) => Submenu::with_id(app, WINDOW_SUBMENU_ID, spec.label, true)?,
            Some(Special::Help) => Submenu::with_id(app, HELP_SUBMENU_ID, spec.label, true)?,
            None => Submenu::new(app, spec.label, true)?,
        };
        append_entries(app, &submenu, spec.entries, &mut items, &mut recent)?;
        if !MAC_MENU_BAR {
            append_entries(
                app,
                &submenu,
                menu_spec::windows_extras(spec.label),
                &mut items,
                &mut recent,
            )?;
        }
        menus.push(submenu);
    }
    let references: Vec<&dyn IsMenuItem<Wry>> = menus
        .iter()
        .map(|menu| menu as &dyn IsMenuItem<Wry>)
        .collect();
    let menu = Menu::with_items(app, &references)?;
    // The description always has Open Recent (a test checks); a detached submenu keeps the
    // types simple if that ever changed.
    let recent = match recent {
        Some(recent) => recent,
        None => Submenu::new(app, "Open Recent", true)?,
    };
    fill_recent(app, &recent, &recent_labels(recents))?;
    let handles = MenuHandles {
        items,
        recent,
        runtime: Mutex::new(Runtime {
            states: HashMap::new(),
            target: None,
            window_open: true,
            applied: HashMap::new(),
            shortcuts: BTreeMap::new(),
        }),
    };
    Ok((menu, handles))
}

/// The items of Open Recent: the id (which carries the path) and the label of each existing
/// entry, newest first, at most ten. Two files with the same name show their folder too. An
/// ampersand is doubled, because a single one marks a mnemonic.
pub fn recent_labels(entries: &[RecentEntry]) -> Vec<(String, String)> {
    let shown: Vec<&RecentEntry> = entries
        .iter()
        .filter(|entry| entry.exists)
        .take(RECENT_MENU_ENTRIES)
        .collect();
    shown
        .iter()
        .map(|entry| {
            let shares_name = shown
                .iter()
                .filter(|other| other.name == entry.name)
                .count()
                > 1;
            let label = if shares_name {
                format!("{} ({})", entry.name, entry.folder)
            } else {
                entry.name.clone()
            };
            (
                format!("{}{}", menu_spec::RECENT_PREFIX, entry.path),
                label.replace('&', "&&"),
            )
        })
        .collect()
}

/// Replaces the items of the Open Recent submenu: the entries, then a separator and Clear Menu
/// (disabled when there are no entries).
fn fill_recent(
    app: &AppHandle<Wry>,
    submenu: &Submenu<Wry>,
    labels: &[(String, String)],
) -> tauri::Result<()> {
    for existing in submenu.items()? {
        submenu.remove(&existing)?;
    }
    for (id, label) in labels {
        let item = MenuItem::with_id(app, id.as_str(), label, true, None::<&str>)?;
        submenu.append(&item)?;
    }
    if !labels.is_empty() {
        submenu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    let clear = MenuItem::with_id(
        app,
        menu_spec::CLEAR_RECENTS_ID,
        "Clear Menu",
        !labels.is_empty(),
        None::<&str>,
    )?;
    submenu.append(&clear)
}

/// Rebuilds Open Recent from the recents list (it mirrors it). Called whenever the list changes.
pub fn refresh_recents(app: &AppHandle<Wry>, entries: &[RecentEntry]) {
    let Some(handles) = app.try_state::<MenuHandles>() else {
        return; // the menu is not built yet; `build` reads the list itself
    };
    let submenu = handles.recent.clone();
    let labels = recent_labels(entries);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = fill_recent(&handle, &submenu, &labels) {
            eprintln!("backtickle: Open Recent could not be updated: {error}");
        }
    });
}

/// `updateMenuState`, from the window with this label.
pub fn apply_state(app: &AppHandle<Wry>, label: &str, state: MenuState) {
    app.state::<MenuHandles>().set_state(app, label, state);
}

/// The window that has the keyboard focus, as far as the menu cares: any document window is
/// `Main` (the window the actions go to is found by `windows::target_label`).
fn focus_of(app: &AppHandle<Wry>) -> Focus {
    let focused = app
        .webview_windows()
        .into_iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    match focused.as_deref() {
        Some(label) if windows::is_document_label(label) => Focus::Main,
        Some(PREFERENCES_LABEL) => Focus::Preferences,
        _ => Focus::Nothing,
    }
}

/// Sends a menu action to the page of the target window (the focused document window, else the
/// last focused, else `main`), or queues it until that page listens.
fn deliver_action(app: &AppHandle<Wry>, id: &str) {
    let trace = app.state::<Trace>();
    let label = windows::target_label(app).unwrap_or_else(|| MAIN_LABEL.to_owned());
    match app
        .state::<Pages>()
        .route_actions(&label, vec![id.to_owned()])
    {
        Routed::Deliver(actions) => {
            for action in actions {
                let _ = app.emit_to(label.as_str(), MENU_ACTION_EVENT, &action);
                trace.event(
                    "menu-action",
                    json!({ "action": action, "queued": false, "window": label }),
                );
                // Phase 0: the shell still listens for these two until it moves to menu-action.
                if action == UNDO_ID || action == REDO_ID {
                    let _ = app.emit_to(label.as_str(), EDIT_COMMAND_EVENT, action.as_str());
                }
            }
        }
        Routed::Queued => trace.event(
            "menu-action",
            json!({ "action": id, "queued": true, "window": label }),
        ),
    }
}

/// A menu item that the frontend handles was chosen.
fn dispatch(app: &AppHandle<Wry>, id: &str) {
    let handles = app.state::<MenuHandles>();
    handles.snap_back(id);
    let context = ActionContext {
        main_window_exists: !windows::document_labels(app).is_empty(),
        focus: focus_of(app),
        tab_count: handles.tab_count(),
    };
    for step in menu_spec::plan(id, &context) {
        match step {
            Step::ClosePreferences => {
                if let Some(window) = app.get_webview_window(PREFERENCES_LABEL) {
                    let _ = window.close();
                }
            }
            Step::CreateMainWindow => {
                if let Err(error) = lifecycle::create_main_window(app) {
                    eprintln!("backtickle: the main window could not be created: {error}");
                    return;
                }
            }
            Step::FocusMain => lifecycle::focus_target_window(app),
            Step::RequestWindowClose => {
                let label = windows::target_label(app).unwrap_or_else(|| MAIN_LABEL.to_owned());
                app.state::<AppCloseProtocol>()
                    .request(&label, CloseReason::Window)
            }
            Step::Deliver => deliver_action(app, id),
        }
    }
}

/// An Open Recent entry was chosen: grant it and open it like a file from Finder.
fn open_recent(app: &AppHandle<Wry>, path: &str) {
    if !app.state::<Stores>().recents().contains(path) {
        return;
    }
    match crate::fs_util::canonicalize(path) {
        Ok(canonical) if canonical.is_file() => {
            app.state::<PathGrants>().grant_resolved(&canonical);
            open_files::deliver(app, vec![crate::fs_util::path_text(&canonical)]);
        }
        // The file is gone: refresh the menu so the stale entry disappears.
        _ => stores::recents_changed(app),
    }
}

/// Every menu item comes here.
pub fn handle_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == SETTINGS_ID {
        if let Err(error) = open_preferences(app) {
            eprintln!("could not open Preferences: {error}");
        }
    } else if id == menu_spec::QUIT_ID {
        match app.try_state::<AppCloseProtocol>() {
            Some(protocol) => protocol.request(MAIN_LABEL, CloseReason::Quit),
            None => app.exit(0),
        }
    } else if id == FULLSCREEN_ID {
        if let Some(label) = windows::target_label(app)
            && let Some(window) = app.get_webview_window(&label)
        {
            let _ = window.set_fullscreen(!window.is_fullscreen().unwrap_or(false));
        }
    } else if id == MINIMIZE_ID || id == MAXIMIZE_ID {
        if let Some(window) = focused_window(app) {
            if id == MINIMIZE_ID {
                let _ = window.minimize();
            } else if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
    } else if let Some(command) = edit_command(id) {
        run_edit_command(app, command);
    } else if id == menu_spec::CLEAR_RECENTS_ID {
        stores::clear_recents(app);
    } else if let Some(path) = menu_spec::recent_path(id) {
        open_recent(app, path);
    } else if menu_spec::is_action(id) {
        dispatch(app, id);
    }
    // The other items (Hide, Services, Minimize, Zoom, Full Screen, Cut, Copy, Paste, ...) are
    // the system's and do their own work.
}

/// The window in front (the menu bar of Windows and Linux belongs to it), or the window actions
/// go to.
fn focused_window(app: &AppHandle<Wry>) -> Option<tauri::WebviewWindow<Wry>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| windows::target_label(app).and_then(|label| app.get_webview_window(&label)))
}

/// The web view editing command of a Linux Edit item (`EDIT_COMMANDS`), if `id` is one.
#[cfg(not(any(target_os = "macos", windows)))]
fn edit_command(id: &str) -> Option<&'static str> {
    EDIT_COMMANDS
        .iter()
        .find(|(_, item, _)| *item == id)
        .map(|(_, _, label)| match *label {
            "Select All" => "SelectAll",
            other => other,
        })
}

#[cfg(any(target_os = "macos", windows))]
fn edit_command(_id: &str) -> Option<&'static str> {
    None
}

/// Runs a WebKitGTK editing command (Cut, Copy, Paste, SelectAll) in the window in front, as the
/// system items do on macOS. The page sees the same events as for the keys.
#[cfg(not(any(target_os = "macos", windows)))]
fn run_edit_command(app: &AppHandle<Wry>, command: &'static str) {
    use webkit2gtk::WebViewExt;
    if let Some(window) = focused_window(app) {
        let _ = window.with_webview(move |webview| {
            webview.inner().execute_editing_command(command);
        });
    }
}

#[cfg(any(target_os = "macos", windows))]
fn run_edit_command(_app: &AppHandle<Wry>, _command: &'static str) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, folder: &str, exists: bool) -> RecentEntry {
        RecentEntry {
            path: format!("{folder}/{name}"),
            name: name.to_owned(),
            folder: folder.to_owned(),
            opened_at_ms: 0,
            bytes: Some(1),
            exists,
        }
    }

    #[test]
    fn the_event_names_match_the_frontend() {
        // src/lib/platform.ts listens to these names.
        assert_eq!(EDIT_COMMAND_EVENT, "edit-command");
        assert_eq!(MENU_ACTION_EVENT, "menu-action");
        assert_ne!(UNDO_ID, REDO_ID);
        assert_eq!(SETTINGS_ID, "settings");
    }

    #[test]
    fn open_recent_mirrors_the_list_newest_first_with_ids_that_carry_the_path() {
        let labels = recent_labels(&[
            entry("b.md", "~/Notes", true),
            entry("a.md", "~/Docs", true),
        ]);

        assert_eq!(
            labels,
            [
                ("recent:~/Notes/b.md".to_owned(), "b.md".to_owned()),
                ("recent:~/Docs/a.md".to_owned(), "a.md".to_owned())
            ]
        );
    }

    #[test]
    fn open_recent_hides_files_that_are_gone() {
        let labels = recent_labels(&[entry("gone.md", "/x", false), entry("here.md", "/x", true)]);

        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].1, "here.md");
    }

    #[test]
    fn open_recent_shows_at_most_ten_entries() {
        let entries: Vec<RecentEntry> = (0..25)
            .map(|index| entry(&format!("{index}.md"), "/x", true))
            .collect();

        let labels = recent_labels(&entries);

        assert_eq!(labels.len(), 10);
        assert_eq!(labels[0].1, "0.md");
        assert_eq!(labels[9].1, "9.md");
    }

    #[test]
    fn the_ten_are_counted_after_the_missing_files_are_left_out() {
        let mut entries: Vec<RecentEntry> = (0..5)
            .map(|index| entry(&format!("gone{index}.md"), "/x", false))
            .collect();
        entries.extend((0..12).map(|index| entry(&format!("{index}.md"), "/x", true)));

        assert_eq!(recent_labels(&entries).len(), 10);
    }

    #[test]
    fn files_with_the_same_name_show_their_folder() {
        let labels = recent_labels(&[
            entry("notes.md", "~/Work", true),
            entry("notes.md", "~/Home", true),
            entry("other.md", "~/Home", true),
        ]);

        assert_eq!(labels[0].1, "notes.md (~/Work)");
        assert_eq!(labels[1].1, "notes.md (~/Home)");
        assert_eq!(labels[2].1, "other.md");
    }

    #[test]
    fn an_ampersand_in_a_name_is_doubled_so_it_is_not_taken_for_a_mnemonic() {
        let labels = recent_labels(&[entry("R&D plan.md", "/x", true)]);

        assert_eq!(labels[0].1, "R&&D plan.md");
        assert!(
            labels[0].0.ends_with("R&D plan.md"),
            "the id keeps the real path"
        );
    }

    #[test]
    fn an_empty_list_gives_no_entries() {
        assert!(recent_labels(&[]).is_empty());
    }
}
