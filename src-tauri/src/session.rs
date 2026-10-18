//! The session: which documents and folder were open when the app quit (and
//! 2.7). One JSON file, `session.json`, in the same folder as the other stores (so
//! `BACKTICKLE_CONFIG_DIR` covers it):
//!
//! ```text
//! {"version": 1, "tabs": [{"path": "/a.md", "view": "split"}], "active": 0,
//!  "folder": "/notes", "sidebarTab": "files", "expanded": ["/notes/sub"],
//!  "bounds": {"x": 40, "y": 60, "width": 1280, "height": 820},
//!  "windows": [{"tabs": [{"path": "/b.md", "view": "preview"}], "active": 0, "bounds": {...}}]}
//! ```
//!
//! The top-level fields describe the main window (the Files folder belongs to it); `windows`
//! lists the other document windows (a tab moved to a new window), each with its tabs, active
//! tab and place on the screen. A file written before windows existed has neither `bounds` nor
//! `windows` and reads as a session with one window.
//!
//! Reading is forgiving: a file that is not valid JSON or has the wrong shape means "no session"
//! (and is kept aside as `session.json.corrupt`, see `store.rs`); single wrong values are
//! replaced by defaults.
//!
//! Trust: the page writes the session, and Rust grants the folder and the files in it at the
//! next launch. So `Session::sanitize` keeps only paths that are granted right now (the folder
//! must be a granted folder) and at launch only paths that still exist and are still spelled
//! canonically are granted again (`regrant`). The page can therefore not use the session to get
//! access to anything it did not already have.

use crate::grants::PathGrants;
use crate::store::{self, Loaded};
use serde::Serialize;
use serde_json::{Value, json};
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_TABS: usize = 200;
pub const MAX_WINDOWS: usize = 16;
pub const MAX_EXPANDED: usize = 1000;
const VIEWS: [&str; 3] = ["editor", "split", "preview"];
const SIDEBAR_TABS: [&str; 4] = ["outline", "files", "search", "snippets"];

/// `SessionTab` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SessionTab {
    pub path: String,
    /// `editor`, `split` or `preview`.
    pub view: String,
}

/// Where a window sat on the screen, in logical pixels (points).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SessionBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl SessionBounds {
    /// Rounds window bounds; `None` for values no screen has (a damaged file).
    pub fn from_value(value: &Value) -> Option<SessionBounds> {
        let number = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite())
        };
        let (x, y) = (number("x")?, number("y")?);
        let (width, height) = (number("width")?, number("height")?);
        let sane = (-20_000.0..=20_000.0).contains(&x)
            && (-20_000.0..=20_000.0).contains(&y)
            && (200.0..=20_000.0).contains(&width)
            && (150.0..=20_000.0).contains(&height);
        sane.then(|| SessionBounds {
            x: x.round() as i32,
            y: y.round() as i32,
            width: width.round() as u32,
            height: height.round() as u32,
        })
    }

    pub fn from_window(bounds: crate::windows::Bounds) -> Option<SessionBounds> {
        SessionBounds::from_value(&json!({
            "x": bounds.x, "y": bounds.y, "width": bounds.width, "height": bounds.height
        }))
    }

    pub fn to_window(self) -> crate::windows::Bounds {
        crate::windows::Bounds {
            x: f64::from(self.x),
            y: f64::from(self.y),
            width: f64::from(self.width),
            height: f64::from(self.height),
        }
    }

    fn to_value(self) -> Value {
        json!({ "x": self.x, "y": self.y, "width": self.width, "height": self.height })
    }
}

/// A document window other than `main`: `SessionWindow` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWindow {
    pub tabs: Vec<SessionTab>,
    pub active: usize,
    pub bounds: Option<SessionBounds>,
}

/// `Session` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    /// The index of the active tab in `tabs` (0 when there are no tabs).
    pub active: usize,
    pub folder: Option<String>,
    /// `outline`, `files` or `search`.
    pub sidebar_tab: String,
    /// Folders expanded in the Files tree.
    pub expanded: Vec<String>,
    /// Where the main window sat (only kept when other windows exist).
    pub bounds: Option<SessionBounds>,
    /// The other document windows.
    pub windows: Vec<SessionWindow>,
}

/// The valid tabs of a JSON list: no repeats, wrong views replaced by the default.
fn parse_tabs(list: &[Value]) -> Vec<SessionTab> {
    let mut tabs: Vec<SessionTab> = Vec::new();
    for item in list {
        let Some(path) = item.get("path").and_then(Value::as_str) else {
            continue;
        };
        if path.is_empty() || tabs.iter().any(|tab| tab.path == path) {
            continue;
        }
        let view = item
            .get("view")
            .and_then(Value::as_str)
            .filter(|view| VIEWS.contains(view))
            .unwrap_or("preview");
        tabs.push(SessionTab {
            path: path.to_owned(),
            view: view.to_owned(),
        });
    }
    tabs.truncate(MAX_TABS);
    tabs
}

/// The active index from JSON, kept inside `tabs`.
fn parse_active(value: Option<&Value>, tab_count: usize) -> usize {
    let active = value
        .and_then(Value::as_f64)
        .filter(|index| index.is_finite() && *index >= 0.0)
        .map_or(0, |index| index as usize);
    if tab_count == 0 {
        0
    } else {
        active.min(tab_count - 1)
    }
}

impl Session {
    /// A session of the shape above from any JSON value, or `None` if `value` is not an object
    /// with a `tabs` array. Entries and values that do not fit are dropped or replaced by
    /// defaults; nothing is checked against the file system or the grants.
    pub fn from_value(value: &Value) -> Option<Session> {
        let object = value.as_object()?;
        let list = object.get("tabs")?.as_array()?;
        let tabs = parse_tabs(list);
        let active = parse_active(object.get("active"), tabs.len());
        let folder = object
            .get("folder")
            .and_then(Value::as_str)
            .filter(|folder| !folder.is_empty())
            .map(str::to_owned);
        let sidebar_tab = object
            .get("sidebarTab")
            .and_then(Value::as_str)
            .filter(|tab| SIDEBAR_TABS.contains(tab))
            .unwrap_or("outline")
            .to_owned();
        let mut expanded: Vec<String> = Vec::new();
        if let Some(list) = object.get("expanded").and_then(Value::as_array) {
            for item in list.iter().filter_map(Value::as_str) {
                if !item.is_empty() && !expanded.iter().any(|seen| seen == item) {
                    expanded.push(item.to_owned());
                }
            }
        }
        expanded.truncate(MAX_EXPANDED);
        let bounds = object.get("bounds").and_then(SessionBounds::from_value);
        let mut windows: Vec<SessionWindow> = Vec::new();
        if let Some(list) = object.get("windows").and_then(Value::as_array) {
            for item in list {
                let Some(window_tabs) = item.get("tabs").and_then(Value::as_array) else {
                    continue;
                };
                let tabs = parse_tabs(window_tabs);
                if tabs.is_empty() {
                    continue;
                }
                windows.push(SessionWindow {
                    active: parse_active(item.get("active"), tabs.len()),
                    bounds: item.get("bounds").and_then(SessionBounds::from_value),
                    tabs,
                });
            }
        }
        windows.truncate(MAX_WINDOWS);
        Some(Session {
            tabs,
            active,
            folder,
            sidebar_tab,
            expanded,
            bounds,
            windows,
        })
    }

    pub fn to_value(&self) -> Value {
        let tabs = |tabs: &[SessionTab]| {
            tabs.iter()
                .map(|tab| json!({ "path": tab.path, "view": tab.view }))
                .collect::<Vec<_>>()
        };
        let mut value = json!({
            "version": 1,
            "tabs": tabs(&self.tabs),
            "active": self.active,
            "folder": self.folder,
            "sidebarTab": self.sidebar_tab,
            "expanded": self.expanded,
        });
        if let Some(object) = value.as_object_mut() {
            if let Some(bounds) = self.bounds {
                object.insert("bounds".to_owned(), bounds.to_value());
            }
            if !self.windows.is_empty() {
                let windows: Vec<Value> = self
                    .windows
                    .iter()
                    .map(|window| {
                        json!({
                            "tabs": tabs(&window.tabs),
                            "active": window.active,
                            "bounds": window.bounds.map(SessionBounds::to_value),
                        })
                    })
                    .collect();
                object.insert("windows".to_owned(), Value::Array(windows));
            }
        }
        value
    }

    /// The session as it may be stored when the page sends it: only tabs whose file is granted
    /// now, only a folder that is a granted folder, only expanded folders below that folder.
    /// The active index follows the tab that was active (or the nearest one left).
    pub fn sanitize(mut self, grants: &PathGrants) -> Session {
        let active_path = self.tabs.get(self.active).map(|tab| tab.path.clone());
        self.tabs
            .retain(|tab| grants.is_permitted(Path::new(&tab.path)));
        self.active = active_path
            .and_then(|path| self.tabs.iter().position(|tab| tab.path == path))
            .unwrap_or_else(|| self.active.min(self.tabs.len().saturating_sub(1)));
        self.folder = self
            .folder
            .filter(|folder| grants.is_folder_root(Path::new(folder)));
        let folder = self.folder.as_deref().map(PathBuf::from);
        self.expanded.retain(|path| {
            folder
                .as_ref()
                .is_some_and(|folder| Path::new(path).starts_with(folder))
                && grants.folder_root_of(Path::new(path)).is_some()
        });
        // The other windows: granted files only, and a file is in one window only (the first).
        let mut seen: Vec<String> = self.tabs.iter().map(|tab| tab.path.clone()).collect();
        let mut windows = Vec::new();
        for mut window in std::mem::take(&mut self.windows) {
            let active_path = window.tabs.get(window.active).map(|tab| tab.path.clone());
            window.tabs.retain(|tab| {
                grants.is_permitted(Path::new(&tab.path)) && !seen.contains(&tab.path)
            });
            if window.tabs.is_empty() {
                continue;
            }
            seen.extend(window.tabs.iter().map(|tab| tab.path.clone()));
            window.active = active_path
                .and_then(|path| window.tabs.iter().position(|tab| tab.path == path))
                .unwrap_or_else(|| window.active.min(window.tabs.len() - 1));
            windows.push(window);
        }
        windows.truncate(MAX_WINDOWS);
        self.windows = windows;
        self
    }

    /// Grants again, at launch, what the stored session refers to: its folder if it is still a
    /// folder, and each tab's file that is still a file at the same canonical path. Returns the
    /// number of grants made.
    pub fn regrant(&self, grants: &PathGrants) -> usize {
        let mut granted = 0;
        if let Some(folder) = &self.folder
            && let Ok(canonical) = crate::fs_util::canonicalize(folder)
            && canonical == Path::new(folder)
            && grants.grant_folder(&canonical).is_ok()
        {
            granted += 1;
        }
        let all_tabs = self
            .tabs
            .iter()
            .chain(self.windows.iter().flat_map(|window| window.tabs.iter()));
        for tab in all_tabs {
            let path = Path::new(&tab.path);
            if let Ok(canonical) = crate::fs_util::canonicalize(path)
                && canonical == path
                && canonical.is_file()
                && grants.grant(&canonical).is_ok()
            {
                granted += 1;
            }
        }
        granted
    }
}

/// The sessions of the windows of this run, put together into the one stored session. Each
/// window sends its own (`setSession`); the book keeps the latest of each and writes them all.
#[derive(Debug, Default)]
pub struct SessionBook {
    main: Option<Session>,
    windows: std::collections::BTreeMap<u64, SessionWindow>,
}

fn window_number(label: &str) -> u64 {
    label
        .strip_prefix(crate::windows::DOC_PREFIX)
        .and_then(|number| number.parse().ok())
        .unwrap_or(0)
}

impl SessionBook {
    /// The session `label` just sent, with where its window is. For `main` it is the base of the
    /// stored session; for another window it becomes one entry of `windows`.
    pub fn set(&mut self, label: &str, session: Session, bounds: Option<SessionBounds>) {
        if label == crate::windows::MAIN_LABEL {
            self.main = Some(Session {
                bounds,
                windows: Vec::new(),
                ..session
            });
        } else {
            self.windows.insert(
                window_number(label),
                SessionWindow {
                    tabs: session.tabs,
                    active: session.active,
                    bounds,
                },
            );
        }
    }

    /// The window was closed on purpose: it does not come back.
    pub fn forget(&mut self, label: &str) {
        if label == crate::windows::MAIN_LABEL {
            self.main = None;
        } else {
            self.windows.remove(&window_number(label));
        }
    }

    /// The session to store: main's, with the other windows that have tabs. `None` when nothing
    /// is known at all.
    pub fn compose(&self) -> Option<Session> {
        let windows: Vec<SessionWindow> = self
            .windows
            .values()
            .filter(|window| !window.tabs.is_empty())
            .take(MAX_WINDOWS)
            .cloned()
            .collect();
        match (&self.main, windows.is_empty()) {
            (None, true) => None,
            (Some(main), true) => Some(Session {
                // One window: the layout is the window's own, nothing to restore.
                bounds: None,
                ..main.clone()
            }),
            (main, false) => {
                let base = main.clone().unwrap_or(Session {
                    tabs: Vec::new(),
                    active: 0,
                    folder: None,
                    sidebar_tab: "outline".to_owned(),
                    expanded: Vec::new(),
                    bounds: None,
                    windows: Vec::new(),
                });
                Some(Session { windows, ..base })
            }
        }
    }
}

/// The session stored in `file`, or `None` if there is none, it is not valid JSON or it has the
/// wrong shape (a broken file is kept aside as `<name>.corrupt`).
pub fn load(file: &Path) -> Option<Session> {
    match store::read_json(file) {
        Loaded::Valid(value) => {
            let session = Session::from_value(&value);
            if session.is_none() {
                store::quarantine(file);
            }
            session
        }
        Loaded::Missing | Loaded::Corrupt => None,
    }
}

pub fn save(file: &Path, session: &Session) -> io::Result<()> {
    store::write_json(file, &session.to_value())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn tab(path: &str, view: &str) -> SessionTab {
        SessionTab {
            path: path.to_owned(),
            view: view.to_owned(),
        }
    }

    fn sample() -> Session {
        Session {
            tabs: vec![tab("/a.md", "split"), tab("/b.md", "editor")],
            active: 1,
            folder: Some("/notes".to_owned()),
            sidebar_tab: "files".to_owned(),
            expanded: vec!["/notes/sub".to_owned()],
            bounds: None,
            windows: Vec::new(),
        }
    }

    #[test]
    fn a_session_survives_a_save_and_a_load() {
        let dir = TempDir::new();
        let file = dir.path().join("session.json");

        save(&file, &sample()).expect("saves");

        assert_eq!(load(&file), Some(sample()));
    }

    #[test]
    fn a_missing_file_means_no_session() {
        let dir = TempDir::new();

        assert_eq!(load(&dir.path().join("session.json")), None);
    }

    #[test]
    fn c26_a_corrupt_file_means_no_session_and_is_kept_aside() {
        let dir = TempDir::new();
        let file = dir.write("session.json", b"{ not json");

        assert_eq!(load(&file), None);

        assert_eq!(
            std::fs::read(store::corrupt_copy_path(&file)).expect("copy"),
            b"{ not json"
        );
    }

    #[test]
    fn c26_valid_json_of_the_wrong_shape_means_no_session() {
        let dir = TempDir::new();
        for (index, text) in [
            "[]",
            "42",
            "null",
            r#"{"tabs": "x"}"#,
            r#"{"folder": "/a"}"#,
        ]
        .iter()
        .enumerate()
        {
            let file = dir.write(&format!("s{index}.json"), text.as_bytes());

            assert_eq!(load(&file), None, "{text}");
        }
    }

    #[test]
    fn wrong_values_are_replaced_by_defaults_and_bad_entries_dropped() {
        let value = json!({
            "tabs": [
                {"path": "/a.md", "view": "nonsense"},
                {"path": "/a.md", "view": "editor"},
                {"path": 7},
                {"view": "split"},
                {"path": ""},
                {"path": "/b.md"}
            ],
            "active": 99,
            "folder": 12,
            "sidebarTab": "nope",
            "expanded": ["/x", "/x", "", 5]
        });

        let session = Session::from_value(&value).expect("a session");

        assert_eq!(
            session.tabs,
            [tab("/a.md", "preview"), tab("/b.md", "preview")]
        );
        assert_eq!(session.active, 1, "clamped to the last tab");
        assert_eq!(session.folder, None);
        assert_eq!(session.sidebar_tab, "outline");
        assert_eq!(session.expanded, ["/x"]);
    }

    #[test]
    fn an_empty_session_keeps_the_active_index_at_zero() {
        let session = Session::from_value(&json!({"tabs": [], "active": 5})).expect("a session");

        assert_eq!(session.active, 0);
        assert!(session.tabs.is_empty());
    }

    #[test]
    fn the_number_of_tabs_and_expanded_folders_is_capped() {
        let tabs: Vec<Value> = (0..(MAX_TABS + 20))
            .map(|i| json!({"path": format!("/{i}.md")}))
            .collect();
        let expanded: Vec<Value> = (0..(MAX_EXPANDED + 20))
            .map(|i| json!(format!("/d{i}")))
            .collect();

        let session =
            Session::from_value(&json!({"tabs": tabs, "expanded": expanded})).expect("a session");

        assert_eq!(session.tabs.len(), MAX_TABS);
        assert_eq!(session.expanded.len(), MAX_EXPANDED);
    }

    #[test]
    fn sanitizing_keeps_only_what_is_granted() {
        let dir = TempDir::new();
        let outside = TempDir::new();
        let grants = PathGrants::default();
        let root = grants.grant_folder(dir.path()).expect("folder");
        let inside = dir.write("in.md", b"x");
        let alone = grants
            .grant(&outside.write("alone.md", b"x"))
            .expect("file");
        let secret = outside.write("secret.md", b"x");
        let session = Session {
            bounds: None,
            windows: Vec::new(),
            tabs: vec![
                tab(inside.to_str().expect("utf8"), "split"),
                tab(secret.to_str().expect("utf8"), "split"),
                tab(alone.to_str().expect("utf8"), "editor"),
            ],
            active: 2,
            folder: Some(root.to_string_lossy().into_owned()),
            sidebar_tab: "files".to_owned(),
            expanded: vec![
                root.join("sub").to_string_lossy().into_owned(),
                outside.path().to_string_lossy().into_owned(),
                root.join("..").to_string_lossy().into_owned(),
            ],
        };

        let kept = session.sanitize(&grants);

        assert_eq!(kept.tabs.len(), 2);
        assert_eq!(kept.tabs[0].path, inside.to_string_lossy());
        assert_eq!(kept.tabs[1].path, alone.to_string_lossy());
        assert_eq!(kept.active, 1, "the active tab is still the same file");
        assert_eq!(
            kept.folder.as_deref(),
            Some(root.to_string_lossy().as_ref())
        );
        assert_eq!(
            kept.expanded,
            [root.join("sub").to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn sanitizing_drops_a_folder_that_was_never_granted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        let session = Session {
            bounds: None,
            windows: Vec::new(),
            tabs: Vec::new(),
            active: 0,
            folder: Some(dir.path().to_string_lossy().into_owned()),
            sidebar_tab: "files".to_owned(),
            expanded: vec![dir.path().join("sub").to_string_lossy().into_owned()],
        };

        let kept = session.sanitize(&grants);

        assert_eq!(kept.folder, None);
        assert!(kept.expanded.is_empty());
    }

    #[test]
    fn regranting_covers_an_existing_folder_and_files_and_skips_the_rest() {
        let dir = TempDir::new();
        let file = dir.write("a.md", b"x");
        let session = Session {
            bounds: None,
            windows: Vec::new(),
            tabs: vec![
                tab(file.to_str().expect("utf8"), "split"),
                tab(dir.path().join("gone.md").to_str().expect("utf8"), "split"),
            ],
            active: 0,
            folder: Some(dir.path().to_string_lossy().into_owned()),
            sidebar_tab: "files".to_owned(),
            expanded: Vec::new(),
        };
        let grants = PathGrants::default();

        let count = session.regrant(&grants);

        assert_eq!(count, 2, "the folder and the file that exists");
        assert!(grants.is_folder_root(dir.path()));
        assert!(grants.is_granted(&file));
        assert!(!grants.is_granted(&dir.path().join("gone.md")));
    }

    #[cfg(unix)]
    #[test]
    fn regranting_skips_a_missing_folder_and_a_path_that_became_a_link() {
        let dir = TempDir::new();
        let target = dir.write("target.md", b"x");
        let link = dir.path().join("link.md");
        std::os::unix::fs::symlink(&target, &link).expect("symlink");
        let session = Session {
            bounds: None,
            windows: Vec::new(),
            tabs: vec![tab(link.to_str().expect("utf8"), "split")],
            active: 0,
            folder: Some(dir.path().join("missing").to_string_lossy().into_owned()),
            sidebar_tab: "outline".to_owned(),
            expanded: Vec::new(),
        };
        let grants = PathGrants::default();

        assert_eq!(session.regrant(&grants), 0);
        assert!(!grants.is_permitted(&link));
    }

    fn bounds(x: i32, y: i32) -> SessionBounds {
        SessionBounds {
            x,
            y,
            width: 1000,
            height: 700,
        }
    }

    #[test]
    fn e51_windows_and_bounds_survive_a_save_and_a_load() {
        let dir = TempDir::new();
        let file = dir.path().join("session.json");
        let mut session = sample();
        session.bounds = Some(bounds(10, 20));
        session.windows = vec![SessionWindow {
            tabs: vec![tab("/c.md", "preview")],
            active: 0,
            bounds: Some(bounds(1010, 20)),
        }];

        save(&file, &session).expect("saves");

        assert_eq!(load(&file), Some(session));
    }

    #[test]
    fn e51_an_old_session_without_windows_reads_as_one_window() {
        let session = Session::from_value(&json!({
            "version": 1, "tabs": [{"path": "/a.md", "view": "split"}]
        }))
        .expect("session");

        assert!(session.windows.is_empty());
        assert_eq!(session.bounds, None);
    }

    #[test]
    fn e51_bad_windows_and_bounds_are_dropped() {
        let session = Session::from_value(&json!({
            "tabs": [],
            "bounds": {"x": 0, "y": 0, "width": 5, "height": 5},
            "windows": [
                {"tabs": []},
                {"tabs": "x"},
                {"tabs": [{"path": "/w.md"}], "active": 9,
                 "bounds": {"x": 5, "y": 6, "width": 800, "height": 600}}
            ]
        }))
        .expect("session");

        assert_eq!(session.bounds, None, "a window of 5 by 5 is not a window");
        assert_eq!(session.windows.len(), 1);
        assert_eq!(session.windows[0].active, 0);
        assert_eq!(
            session.windows[0].bounds,
            Some(SessionBounds {
                x: 5,
                y: 6,
                width: 800,
                height: 600
            })
        );
    }

    #[test]
    fn e51_sanitizing_keeps_a_file_in_the_first_window_only_and_drops_ungranted_files() {
        let dir = TempDir::new();
        let a = dir.write("a.md", b"x");
        let b = dir.write("b.md", b"x");
        let c = dir.write("c.md", b"x");
        let grants = PathGrants::default();
        let (a, b) = (grants.grant(&a).expect("a"), grants.grant(&b).expect("b"));
        let text = |p: &std::path::Path| p.to_string_lossy().into_owned();
        let session = Session {
            tabs: vec![tab(&text(&a), "split")],
            active: 0,
            folder: None,
            sidebar_tab: "outline".to_owned(),
            expanded: vec![],
            bounds: None,
            windows: vec![
                SessionWindow {
                    tabs: vec![
                        tab(&text(&a), "split"),
                        tab(&text(&b), "preview"),
                        tab(&text(&c), "split"),
                    ],
                    active: 2,
                    bounds: None,
                },
                SessionWindow {
                    tabs: vec![tab(&text(&c), "split")],
                    active: 0,
                    bounds: None,
                },
            ],
        };

        let clean = session.sanitize(&grants);

        assert_eq!(
            clean.windows.len(),
            1,
            "the window with only an ungranted file goes"
        );
        assert_eq!(clean.windows[0].tabs, [tab(&text(&b), "preview")]);
        assert_eq!(clean.windows[0].active, 0);
    }

    #[test]
    fn e51_the_book_puts_the_windows_together() {
        let mut book = SessionBook::default();
        assert_eq!(book.compose(), None);

        book.set("main", sample(), Some(bounds(0, 0)));
        assert_eq!(
            book.compose().expect("one window").bounds,
            None,
            "a single window keeps no bounds"
        );

        let mut other = sample();
        other.tabs = vec![tab("/z.md", "preview")];
        other.active = 0;
        book.set("doc-2", other.clone(), Some(bounds(1000, 0)));
        book.set("doc-10", other.clone(), None);
        let composed = book.compose().expect("two windows");
        assert_eq!(composed.bounds, Some(bounds(0, 0)));
        assert_eq!(composed.windows.len(), 2);
        assert_eq!(
            composed.windows[0].bounds,
            Some(bounds(1000, 0)),
            "doc-2 before doc-10"
        );
        assert_eq!(composed.tabs, sample().tabs);

        book.forget("doc-2");
        book.forget("doc-10");
        assert_eq!(book.compose().expect("main only").windows.len(), 0);
    }

    #[test]
    fn e51_without_main_the_other_windows_still_come_back() {
        let mut book = SessionBook::default();
        let mut other = sample();
        other.tabs = vec![tab("/z.md", "split")];
        book.set("doc-1", other, None);

        let composed = book.compose().expect("a session");

        assert!(composed.tabs.is_empty());
        assert_eq!(composed.windows.len(), 1);
    }
}
