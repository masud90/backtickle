//! Windows: the document windows (`main`, and `doc-<n>` for a tab moved to a new window), the
//! main window's look at launch, and the Preferences window.
//!
//! Memory rule: the main window is the only web view that exists all the
//! time. Preferences is created when it is opened and destroyed when it is closed. A document
//! window beyond `main` exists only while a moved tab (or a restored session) needs it.
//!
//! A "document window" is any window showing documents. Each has its own tabs, sidebar and menu
//! state; `DocWindows` knows which documents each one holds, so a file is never open twice, and
//! keeps the tab state that waits for a new window's page.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime, Theme, WebviewUrl, WebviewWindowBuilder, Wry};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, TitleBarStyle};

pub const MAIN_LABEL: &str = "main";
/// The label of every document window after `main` is `doc-` and a number.
pub const DOC_PREFIX: &str = "doc-";
pub const PREFERENCES_LABEL: &str = "preferences";
const PREFERENCES_PAGE: &str = "preferences.html";
const PREFERENCES_SIZE: (f64, f64) = (960.0, 720.0);
const PREFERENCES_MIN_SIZE: (f64, f64) = (640.0, 480.0);

/// Where the macOS traffic lights sit in an overlay title bar. The main window gets the same
/// values from `trafficLightPosition` in tauri.conf.json; a test keeps the two in step.
///
/// `x` is the distance of the close button from the left edge (the mock's 14 px). `y` was
/// measured on macOS 27: the buttons are 14 px tall and tao places their vertical center at
/// `y - 2` px from the top, so `y = 24` centers them in the 44 px title bar of the web page.
pub const TRAFFIC_LIGHT_X: f64 = 14.0;
pub const TRAFFIC_LIGHT_Y: f64 = 24.0;

/// The `canvas` color of `src/styles/tokens.css` in light and dark: what is behind the web view
/// until the page has painted. Without it a dark-mode launch flashes white.
pub const CANVAS_LIGHT: Color = Color(0xfb, 0xfb, 0xfd, 0xff);
pub const CANVAS_DARK: Color = Color(0x19, 0x19, 0x1b, 0xff);

pub fn canvas_for(theme: Theme) -> Color {
    match theme {
        Theme::Dark => CANVAS_DARK,
        _ => CANVAS_LIGHT,
    }
}

/// The system appearance, as reported by the main window.
fn system_theme<R: Runtime>(app: &AppHandle<R>) -> Theme {
    app.get_webview_window(MAIN_LABEL)
        .and_then(|window| window.theme().ok())
        .unwrap_or(Theme::Light)
}

/// Paints the main window's background in the canvas color of the current appearance.
pub fn paint_main_background<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        window.set_background_color(Some(canvas_for(system_theme(app))))?;
    }
    Ok(())
}

/// Opens the Preferences window, or brings it to the front if it is already open.
pub fn open_preferences<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PREFERENCES_LABEL) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        PREFERENCES_LABEL,
        WebviewUrl::App(PREFERENCES_PAGE.into()),
    )
    .title("Preferences")
    .inner_size(PREFERENCES_SIZE.0, PREFERENCES_SIZE.1)
    .min_inner_size(PREFERENCES_MIN_SIZE.0, PREFERENCES_MIN_SIZE.1)
    .center();
    // macOS: the page draws the title bar under the traffic lights. Windows keeps its own title
    // bar.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y));
    let window = builder
        .background_color(canvas_for(system_theme(app)))
        .transparent(true)
        .build()?;
    // Windows puts the app menu bar on every window; Preferences has none, as on macOS where the
    // menu bar is not part of a window.
    #[cfg(windows)]
    let _ = window.remove_menu();
    crate::vibrancy::apply(app, &window);
    Ok(())
}

// ---- document windows --------------------------------------------------------------------------

/// True for the label of a document window: `main` or `doc-<number>`.
pub fn is_document_label(label: &str) -> bool {
    label == MAIN_LABEL
        || label
            .strip_prefix(DOC_PREFIX)
            .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

/// The number of a `doc-<n>` label (`main` sorts first).
fn label_order(label: &str) -> u64 {
    label
        .strip_prefix(DOC_PREFIX)
        .and_then(|number| number.parse::<u64>().ok())
        .map_or(0, |number| number + 1)
}

/// Document window labels in a stable order: `main` first, then `doc-1`, `doc-2`, ...
pub fn sort_labels(labels: &mut [String]) {
    labels.sort_by_key(|label| label_order(label));
}

/// Where a window sits, in logical pixels (points). Stored in the session.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A new window beside `source`: to its right when that fits on the screen (`area` is the
/// screen's usable rectangle), otherwise down and right by a title bar's width so the two do not
/// cover each other exactly. The size is the source's.
pub fn place_beside(source: Bounds, area: Option<Bounds>) -> Bounds {
    const CASCADE: f64 = 30.0;
    let beside = Bounds {
        x: source.x + source.width,
        ..source
    };
    let fits = area.is_none_or(|area| {
        beside.x + beside.width <= area.x + area.width + 0.5
            && beside.y + beside.height <= area.y + area.height + 0.5
    });
    if fits {
        beside
    } else {
        Bounds {
            x: source.x + CASCADE,
            y: source.y + CASCADE,
            ..source
        }
    }
}

#[derive(Debug, Default)]
struct Registry {
    next: u64,
    documents: HashMap<String, Vec<String>>,
    transfers: HashMap<String, Value>,
    last_focus: Option<String>,
    restored: bool,
}

/// What the app knows about its document windows: the documents each holds, the tab state that
/// waits for a window's page, and which window had the focus last.
#[derive(Debug, Default)]
pub struct DocWindows {
    inner: Mutex<Registry>,
}

impl DocWindows {
    fn lock(&self) -> MutexGuard<'_, Registry> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The label for the next new window. Labels are not reused while the app runs.
    pub fn next_label(&self) -> String {
        let mut registry = self.lock();
        registry.next += 1;
        format!("{DOC_PREFIX}{}", registry.next)
    }

    /// A window reports the documents (canonical paths) it holds now.
    pub fn set_documents(&self, label: &str, paths: Vec<String>) {
        self.lock().documents.insert(label.to_owned(), paths);
    }

    /// The window that holds `path`, other than `except`. With several (it should not happen)
    /// the first in window order.
    pub fn holder_of(&self, path: &str, except: Option<&str>) -> Option<String> {
        let registry = self.lock();
        let mut holders: Vec<String> = registry
            .documents
            .iter()
            .filter(|(label, paths)| {
                Some(label.as_str()) != except && paths.iter().any(|held| held == path)
            })
            .map(|(label, _)| label.clone())
            .collect();
        sort_labels(&mut holders);
        holders.into_iter().next()
    }

    /// Keeps the state of a tab for the page of the window that will show it.
    pub fn put_transfer(&self, label: &str, payload: Value) {
        self.lock().transfers.insert(label.to_owned(), payload);
    }

    /// The tab state waiting for this window, once.
    pub fn take_transfer(&self, label: &str) -> Option<Value> {
        self.lock().transfers.remove(label)
    }

    /// A window no longer holds this document (it moved to another window).
    pub fn remove_document(&self, label: &str, path: &str) {
        if let Some(paths) = self.lock().documents.get_mut(label) {
            paths.retain(|held| held != path);
        }
    }

    /// True once per run: the other windows of the stored session may be restored now.
    pub fn begin_restore(&self) -> bool {
        !std::mem::replace(&mut self.lock().restored, true)
    }

    pub fn set_last_focus(&self, label: &str) {
        self.lock().last_focus = Some(label.to_owned());
    }

    pub fn last_focus(&self) -> Option<String> {
        self.lock().last_focus.clone()
    }

    /// The window is gone: nothing is remembered about it.
    pub fn forget(&self, label: &str) {
        let mut registry = self.lock();
        registry.documents.remove(label);
        registry.transfers.remove(label);
        if registry.last_focus.as_deref() == Some(label) {
            registry.last_focus = None;
        }
    }
}

/// The labels of the document windows that exist, `main` first.
pub fn document_labels(app: &AppHandle<Wry>) -> Vec<String> {
    let mut labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| is_document_label(label))
        .collect();
    sort_labels(&mut labels);
    labels
}

/// The document window that actions, new documents and opened files go to: the one with the
/// focus, else the one that had it last, else `main`, else any.
pub fn target_label(app: &AppHandle<Wry>) -> Option<String> {
    let labels = document_labels(app);
    let focused = app
        .webview_windows()
        .into_iter()
        .find(|(label, window)| is_document_label(label) && window.is_focused().unwrap_or(false))
        .map(|(label, _)| label);
    if let Some(label) = focused {
        return Some(label);
    }
    if let Some(last) = app.state::<DocWindows>().last_focus()
        && labels.contains(&last)
    {
        return Some(last);
    }
    if labels.iter().any(|label| label == MAIN_LABEL) {
        return Some(MAIN_LABEL.to_owned());
    }
    labels.into_iter().next()
}

/// Where a window is now, in logical pixels.
pub fn bounds_of(app: &AppHandle<Wry>, label: &str) -> Option<Bounds> {
    let window = app.get_webview_window(label)?;
    let scale = window.scale_factor().ok()?;
    let position = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.outer_size().ok()?.to_logical::<f64>(scale);
    Some(Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// The usable rectangle of the screen a window is on, in logical pixels.
fn screen_area_of(app: &AppHandle<Wry>, label: &str) -> Option<Bounds> {
    let window = app.get_webview_window(label)?;
    let monitor = window.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let position = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    Some(Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// Creates a document window from the main window's configuration under `label` (from
/// `DocWindows::next_label`; the tab state for its page is put in place before this call). `bounds`
/// places it (a moved tab: beside `source`; a restored session: where it was); without them the
/// window is centered. Its page is not ready for events until it asks.
pub fn create_document_window(
    app: &AppHandle<Wry>,
    label: String,
    source: Option<&str>,
    bounds: Option<Bounds>,
) -> tauri::Result<String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    let placed = bounds.or_else(|| {
        let source = source?;
        let from = bounds_of(app, source)?;
        Some(place_beside(from, screen_area_of(app, source)))
    });
    config.label = label.clone();
    if let Some(placed) = placed {
        config.center = false;
        config.x = Some(placed.x);
        config.y = Some(placed.y);
        config.width = placed.width;
        config.height = placed.height;
    }
    app.state::<crate::pending::Pages>().reset(&label);
    let theme = app.state::<crate::lifecycle::Lifecycle>().theme();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .background_color(canvas_for(theme))
        .build()?;
    crate::vibrancy::apply(app, &window);
    app.state::<crate::trace::Trace>()
        .event("window-opened", serde_json::json!({ "label": label }));
    Ok(label)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_canvas_colors_are_the_token_values() {
        // src/styles/tokens.css: --wd-canvas is #fbfbfd in light and #19191b in dark.
        assert_eq!(canvas_for(Theme::Light), Color(251, 251, 253, 255));
        assert_eq!(canvas_for(Theme::Dark), Color(25, 25, 27, 255));
    }

    #[test]
    fn labels_match_the_capability_files() {
        assert_eq!(MAIN_LABEL, "main");
        assert_eq!(PREFERENCES_LABEL, "preferences");
    }

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn e51_document_labels_are_main_and_doc_numbers() {
        for label in ["main", "doc-1", "doc-27"] {
            assert!(is_document_label(label), "{label}");
        }
        for label in [
            "preferences",
            "doc-",
            "doc-x",
            "doc-1a",
            "Main",
            "",
            "docs-1",
        ] {
            assert!(!is_document_label(label), "{label}");
        }
    }

    #[test]
    fn e51_labels_sort_main_first_then_by_number() {
        let mut labels = vec!["doc-10".to_owned(), "doc-2".to_owned(), "main".to_owned()];
        sort_labels(&mut labels);
        assert_eq!(labels, ["main", "doc-2", "doc-10"]);
    }

    #[test]
    fn e51_new_labels_are_never_reused() {
        let windows = DocWindows::default();
        assert_eq!(windows.next_label(), "doc-1");
        assert_eq!(windows.next_label(), "doc-2");
        windows.forget("doc-1");
        assert_eq!(windows.next_label(), "doc-3");
    }

    #[test]
    fn e51_the_holder_of_a_document_is_found_except_the_asker() {
        let windows = DocWindows::default();
        windows.set_documents("main", vec!["/a.md".into(), "/b.md".into()]);
        windows.set_documents("doc-1", vec!["/c.md".into()]);

        assert_eq!(windows.holder_of("/c.md", None).as_deref(), Some("doc-1"));
        assert_eq!(
            windows.holder_of("/a.md", Some("doc-1")).as_deref(),
            Some("main")
        );
        assert_eq!(windows.holder_of("/a.md", Some("main")), None);
        assert_eq!(windows.holder_of("/none.md", None), None);

        windows.forget("doc-1");
        assert_eq!(windows.holder_of("/c.md", None), None);
    }

    #[test]
    fn e51_a_transfer_is_handed_over_once() {
        let windows = DocWindows::default();
        windows.put_transfer("doc-1", serde_json::json!({ "text": "hello" }));

        assert_eq!(
            windows.take_transfer("doc-1"),
            Some(serde_json::json!({ "text": "hello" }))
        );
        assert_eq!(windows.take_transfer("doc-1"), None);
        assert_eq!(windows.take_transfer("doc-2"), None);
    }

    #[test]
    fn e51_the_last_focused_window_is_forgotten_with_the_window() {
        let windows = DocWindows::default();
        windows.set_last_focus("doc-2");
        assert_eq!(windows.last_focus().as_deref(), Some("doc-2"));

        windows.forget("main");
        assert_eq!(windows.last_focus().as_deref(), Some("doc-2"));
        windows.forget("doc-2");
        assert_eq!(windows.last_focus(), None);
    }

    #[test]
    fn e51_a_new_window_goes_beside_the_source_when_it_fits() {
        let screen = bounds(0.0, 0.0, 2560.0, 1440.0);
        let placed = place_beside(bounds(100.0, 50.0, 1200.0, 800.0), Some(screen));
        assert_eq!(placed, bounds(1300.0, 50.0, 1200.0, 800.0));
    }

    #[test]
    fn e51_a_new_window_cascades_when_there_is_no_room_beside() {
        let screen = bounds(0.0, 0.0, 1440.0, 900.0);
        let placed = place_beside(bounds(100.0, 50.0, 1280.0, 820.0), Some(screen));
        assert_eq!(placed, bounds(130.0, 80.0, 1280.0, 820.0));
    }

    #[test]
    fn e51_without_screen_information_the_new_window_goes_beside() {
        let placed = place_beside(bounds(0.0, 0.0, 900.0, 700.0), None);
        assert_eq!(placed.x, 900.0);
    }
}
