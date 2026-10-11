//! The persistent stores (recents, settings, document state) as managed app state, and what a
//! change to them causes: the `recents-changed` and `settings-changed` events, a trace line and
//! a rebuilt Open Recent menu.
//!
//! The logic of each store is in its own module (`recents.rs`, `settings.rs`, `doc_state.rs`);
//! this file only connects it to the running app.

use crate::doc_state::DocStates;
use crate::error::{PlatformError, PlatformResult};
use crate::fs_util;
use crate::launch::LaunchState;
use crate::menu;
use crate::recents::{self, RecentEntry, Recents};
use crate::recovery::RecoveryStore;
use crate::session::{self, Session};
use crate::settings::{Settings, SettingsStore};
use crate::trace::Trace;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The event that carries the whole recents list to every window.
pub const RECENTS_CHANGED_EVENT: &str = "recents-changed";
/// The event that carries the new settings to every window.
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

pub struct Stores {
    recents: Mutex<Recents>,
    settings: Mutex<SettingsStore>,
    doc_states: Mutex<DocStates>,
    /// `session.json`, next to the other stores (Phase 3).
    session_file: PathBuf,
    /// Crash recovery entries (Phase 5), `recovery/` in the data folder.
    recovery: RecoveryStore,
    /// `snippets.json` in the config folder (WP5.5).
    snippets_file: PathBuf,
    /// The sessions of the windows of this run, put together when one of them changes.
    sessions: Mutex<session::SessionBook>,
    /// The canonical home folder, for showing `~` and for finding cloud folders.
    home: Option<PathBuf>,
}

/// The folders of the stores as (data, config): both are `chosen` when a folder was asked for
/// (`WRITEDOWN_CONFIG_DIR`), otherwise the app's own folders.
pub fn store_folders(chosen: Option<&Path>, data: PathBuf, config: PathBuf) -> (PathBuf, PathBuf) {
    match chosen {
        Some(folder) => (folder.to_path_buf(), folder.to_path_buf()),
        None => (data, config),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Stores {
    /// Opens the three stores in the app's folders. Recents and document state are in the data
    /// folder, the settings in the config folder (the same folder on macOS). With
    /// `WRITEDOWN_CONFIG_DIR` all three are in that folder instead, and the app's own folders are
    /// not touched.
    pub fn open(app: &AppHandle<Wry>) -> Self {
        let fallback = std::env::temp_dir().join("writedown");
        let data = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| fallback.clone());
        let config = app.path().app_config_dir().unwrap_or(fallback);
        let chosen = app.state::<LaunchState>().config_dir.clone();
        let (data, config) = store_folders(chosen.as_deref(), data, config);
        if let Some(folder) = chosen.as_deref()
            && let Err(error) = std::fs::create_dir_all(folder)
        {
            eprintln!(
                "writedown: the folder for the stores could not be created ({:?}).",
                error.kind()
            );
        }
        app.state::<Trace>().event(
            "stores",
            json!({
                "folder": config.to_string_lossy(),
                "overridden": chosen.is_some(),
            }),
        );
        let home = app
            .path()
            .home_dir()
            .ok()
            .map(|home| std::fs::canonicalize(&home).unwrap_or(home));
        Stores::in_folders(&data, &config, home)
    }

    /// The same, with the folders given (for tests).
    pub fn in_folders(data: &Path, config: &Path, home: Option<PathBuf>) -> Self {
        Stores {
            recents: Mutex::new(Recents::load(data.join("recents.json"))),
            settings: Mutex::new(SettingsStore::load(config.join("settings.json"))),
            doc_states: Mutex::new(DocStates::load(data.join("doc-state.json"))),
            session_file: data.join("session.json"),
            recovery: RecoveryStore::new(data.join("recovery")),
            snippets_file: config.join("snippets.json"),
            sessions: Mutex::new(session::SessionBook::default()),
            home,
        }
    }

    pub fn recovery(&self) -> &RecoveryStore {
        &self.recovery
    }

    pub fn snippets_file(&self) -> &Path {
        &self.snippets_file
    }

    pub fn home(&self) -> Option<&Path> {
        self.home.as_deref()
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).get().clone()
    }

    pub fn recents(&self) -> MutexGuard<'_, Recents> {
        lock(&self.recents)
    }

    pub fn doc_states(&self) -> MutexGuard<'_, DocStates> {
        lock(&self.doc_states)
    }

    /// The stored session, or `None` (no file, a broken file, the wrong shape).
    pub fn load_session(&self) -> Option<Session> {
        session::load(&self.session_file)
    }

    pub fn save_session(&self, session: &Session) -> std::io::Result<()> {
        session::save(&self.session_file, session)
    }

    /// The window `label` stored its session (and where it is): the stored session now holds
    /// every window of this run.
    pub fn save_window_session(
        &self,
        label: &str,
        session: Session,
        bounds: Option<session::SessionBounds>,
    ) -> std::io::Result<()> {
        let composed = {
            let mut book = lock(&self.sessions);
            book.set(label, session, bounds);
            book.compose()
        };
        match composed {
            Some(composed) => self.save_session(&composed),
            None => Ok(()),
        }
    }

    /// A window was closed on purpose: it is not part of the next session.
    pub fn forget_window_session(&self, label: &str) -> std::io::Result<()> {
        let composed = {
            let mut book = lock(&self.sessions);
            book.forget(label);
            book.compose()
        };
        match composed {
            Some(composed) => self.save_session(&composed),
            None => Ok(()),
        }
    }

    /// A rename or a move: recents and document state follow the item to its new path (the
    /// entries below it too, for a folder). Both stores are written. Returns true if the
    /// recents list changed.
    pub fn path_moved(&self, from: &str, to: &str) -> bool {
        let recents_changed = {
            let mut recents = self.recents();
            let changed = recents.moved(from, to);
            if changed && let Err(error) = recents.save() {
                eprintln!(
                    "writedown: the recents could not be saved ({:?}).",
                    error.kind()
                );
            }
            changed
        };
        {
            let mut states = self.doc_states();
            if states.moved(from, to) {
                let _ = states.save();
            }
        }
        recents_changed
    }

    /// The recents list with name, folder, size and whether each file still exists.
    pub fn recent_entries(&self) -> Vec<RecentEntry> {
        let stored = self.recents().entries().to_vec();
        recents::describe(&stored, self.home())
    }
}

/// A document was opened or saved: it moves to the front of the recents.
pub fn record_open(app: &AppHandle<Wry>, path: &Path) {
    crate::native_doc::note_recent(app, path);
    let stores = app.state::<Stores>();
    let limit = stores.settings().recent_limit as usize;
    let changed = {
        let mut recents = stores.recents();
        let changed = recents.touch(&path.to_string_lossy(), fs_util::now_ms(), limit);
        if let Err(error) = recents.save() {
            eprintln!(
                "writedown: the recents could not be saved ({:?}).",
                error.kind()
            );
        }
        changed
    };
    if changed {
        recents_changed(app);
    }
}

/// A file or folder was renamed or moved: recents and document state point at the new path.
pub fn path_moved(app: &AppHandle<Wry>, from: &Path, to: &Path) {
    let changed = app
        .state::<Stores>()
        .path_moved(&from.to_string_lossy(), &to.to_string_lossy());
    if changed {
        recents_changed(app);
    }
}

/// Removes one path from the recents.
pub fn remove_recent(app: &AppHandle<Wry>, path: &str) {
    let stores = app.state::<Stores>();
    let changed = {
        let mut recents = stores.recents();
        let changed = recents.remove(path);
        if changed && let Err(error) = recents.save() {
            eprintln!(
                "writedown: the recents could not be saved ({:?}).",
                error.kind()
            );
        }
        changed
    };
    if changed {
        recents_changed(app);
    }
}

/// Empties the recents (File > Open Recent > Clear Menu, and Clear History on the welcome
/// screen).
pub fn clear_recents(app: &AppHandle<Wry>) {
    crate::native_doc::clear_recent(app);
    let stores = app.state::<Stores>();
    let changed = {
        let mut recents = stores.recents();
        let changed = recents.clear();
        if changed && let Err(error) = recents.save() {
            eprintln!(
                "writedown: the recents could not be saved ({:?}).",
                error.kind()
            );
        }
        changed
    };
    if changed {
        recents_changed(app);
    }
}

/// A document window other than `main` was closed on purpose: it does not come back with the
/// session.
pub fn forget_window_session(app: &AppHandle<Wry>, label: &str) {
    if let Some(stores) = app.try_state::<Stores>()
        && let Err(error) = stores.forget_window_session(label)
    {
        eprintln!(
            "writedown: the session could not be saved ({:?}).",
            error.kind()
        );
    }
}

/// Tells every window and the Open Recent menu that the list changed.
pub fn recents_changed(app: &AppHandle<Wry>) {
    let entries = app.state::<Stores>().recent_entries();
    let _ = app.emit(RECENTS_CHANGED_EVENT, &entries);
    app.state::<Trace>().event(
        "recents-changed",
        json!({ "paths": entries.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>() }),
    );
    menu::refresh_recents(app, &entries);
}

/// Applies a settings update. A change is broadcast to every window (also to the one that made
/// it) and, if the recents limit was lowered, the list is cut to it. The new settings are in
/// force even if they could not be written (the answer is then an error).
pub fn update_settings(app: &AppHandle<Wry>, patch: &Value) -> PlatformResult<Settings> {
    let stores = app.state::<Stores>();
    let previous_vibrancy = stores.settings().vibrancy;
    let previous_shortcuts = stores.settings().shortcuts;
    let updated = lock(&stores.settings).update(patch);
    if updated.changed {
        let _ = app.emit(SETTINGS_CHANGED_EVENT, &updated.settings);
        if updated.settings.shortcuts != previous_shortcuts {
            app.state::<menu::MenuHandles>()
                .set_shortcuts(app, &updated.settings.shortcuts);
        }
        if updated.settings.vibrancy != previous_vibrancy {
            crate::vibrancy::apply_all(app, updated.settings.vibrancy);
        }
        app.state::<Trace>()
            .event("settings-changed", json!({ "settings": updated.settings }));
        let trimmed = {
            let mut recents = stores.recents();
            let trimmed = recents.trim(updated.settings.recent_limit as usize);
            if trimmed {
                let _ = recents.save();
            }
            trimmed
        };
        if trimmed {
            recents_changed(app);
        }
        if !updated.saved {
            return Err(PlatformError::io(
                "The settings could not be saved. They apply until you quit Writedown.",
            ));
        }
    }
    Ok(updated.settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn without_a_chosen_folder_the_app_folders_are_used() {
        let (data, config) = store_folders(None, PathBuf::from("/d"), PathBuf::from("/c"));
        assert_eq!((data, config), (PathBuf::from("/d"), PathBuf::from("/c")));
    }

    #[test]
    fn a_chosen_folder_holds_every_store() {
        let (data, config) = store_folders(
            Some(Path::new("/tmp/measure")),
            PathBuf::from("/d"),
            PathBuf::from("/c"),
        );
        assert_eq!(data, PathBuf::from("/tmp/measure"));
        assert_eq!(config, PathBuf::from("/tmp/measure"));
    }

    #[test]
    fn stores_in_a_chosen_folder_stay_out_of_the_default_one() {
        let chosen = TempDir::new();
        let own = TempDir::new();
        let (data, config) = store_folders(
            Some(chosen.path()),
            own.path().to_path_buf(),
            own.path().to_path_buf(),
        );
        let stores = Stores::in_folders(&data, &config, None);
        {
            let mut recents = stores.recents();
            recents.touch("/some/file.md", 1, 10);
            recents.save().expect("save");
        }
        assert!(chosen.path().join("recents.json").exists());
        assert!(!own.path().join("recents.json").exists());
    }

    #[test]
    fn a_session_is_stored_next_to_the_other_stores() {
        let folder = TempDir::new();
        let stores = Stores::in_folders(folder.path(), folder.path(), None);
        let session = Session::from_value(&json!({
            "tabs": [{"path": "/a.md", "view": "split"}], "folder": "/f", "sidebarTab": "files"
        }))
        .expect("session");

        assert_eq!(stores.load_session(), None);
        stores.save_session(&session).expect("saves");

        assert!(folder.path().join("session.json").exists());
        assert_eq!(stores.load_session(), Some(session));
    }

    #[test]
    fn a_move_updates_recents_and_document_state_and_both_files() {
        let folder = TempDir::new();
        let stores = Stores::in_folders(folder.path(), folder.path(), None);
        {
            let mut recents = stores.recents();
            recents.touch("/d/a.md", 1, 10);
            recents.save().expect("saves");
        }
        {
            let mut states = stores.doc_states();
            states.set("/d/a.md", &json!({ "flavor": "mdx", "scrollLine": 4 }));
            states.save().expect("saves");
        }

        assert!(stores.path_moved("/d", "/e"));

        assert!(stores.recents().contains("/e/a.md"));
        assert_eq!(
            stores.doc_states().get("/e/a.md").0.flavor.as_deref(),
            Some("mdx")
        );
        let reopened = Stores::in_folders(folder.path(), folder.path(), None);
        assert!(reopened.recents().contains("/e/a.md"));
        assert_eq!(reopened.doc_states().get("/e/a.md").0.scroll_line, Some(4));
        assert!(!stores.path_moved("/nothing", "/else"));
    }

    #[test]
    fn e51_every_windows_session_is_stored_and_a_closed_window_is_dropped() {
        let folder = TempDir::new();
        let stores = Stores::in_folders(folder.path(), folder.path(), None);
        let main = Session::from_value(&json!({"tabs": [{"path": "/a.md"}], "folder": "/f"}))
            .expect("session");
        let other = Session::from_value(&json!({"tabs": [{"path": "/b.md"}]})).expect("session");

        stores
            .save_window_session("main", main, None)
            .expect("main");
        stores
            .save_window_session("doc-1", other, None)
            .expect("doc");

        let stored = stores.load_session().expect("stored");
        assert_eq!(stored.tabs.len(), 1);
        assert_eq!(stored.windows.len(), 1);
        assert_eq!(stored.windows[0].tabs[0].path, "/b.md");

        stores.forget_window_session("doc-1").expect("forget");
        assert!(stores.load_session().expect("stored").windows.is_empty());
    }
}
