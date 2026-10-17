//! The life of the document windows and of the app.
//!
//! - **Document windows.** `main` and any `doc-<n>` window (a tab moved to a new window). Each
//!   has its own page, tabs and close round; `main` can be closed while the app keeps running
//!   (the macOS convention), and so can any other.
//! - **The main window.** It can be closed while the app keeps running (the macOS convention).
//!   A click on the Dock icon, a file opened from Finder, or New, Open and Markdown Guide from the
//!   menu create it again from the configuration in `tauri.conf.json`.
//! - **Closing and quitting.** The red close button, Close Window and Quit do not close anything
//!   by themselves. Rust asks the page (`close-requested` with `window` or `quit`; a quit asks the
//!   windows one after the other, and a Cancel in any of them stops the quit); the page asks
//!   the user about unsaved changes and answers with `finishClose`, or does nothing if the user
//!   cancelled. The page must acknowledge the request (`ackClose`) within two seconds. If it
//!   does not, because it is broken or hung, Rust closes or quits anyway, so a broken page can
//!   never trap the user.
//! - **Cancelling.** A page whose user chose Cancel says so with `cancelClose`. It ends the round
//!   (a later close starts cleanly) and, for a quit, answers a waiting system quit with "no".
//! - **System quits.** `NSApplication terminate:` (Dock menu Quit, logout, restart, shutdown, an
//!   AppleScript `quit`) runs the same quit round. `terminate.rs` adds `applicationShouldTerminate:`
//!   to the app delegate; `CloseProtocol::system_quit` answers "now" (no window, or already
//!   quitting) or "later" and starts the round. The page's `finishClose('quit')` (or the
//!   acknowledgement valve) then replies yes, `cancelClose('quit')` replies no.
//!
//! The protocol is plain logic over a small `Host` trait, so it is tested with a fake host and a
//! fake clock; `AppHost` is the real host.

use crate::menu::MenuHandles;
use crate::open_files;
use crate::pending::Pages;
use crate::terminate::{self, Installed};
use crate::trace::Trace;
use crate::windows::{self, MAIN_LABEL};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, RunEvent, Theme, Webview, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent, Wry,
};

/// How long the page has to acknowledge `close-requested`.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(2);

/// `CloseReason` in `src/lib/platform.ts` (lower case on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseReason {
    /// The window's close button or Close Window: close the window, keep the app.
    Window,
    /// Quit Writedown.
    Quit,
}

impl CloseReason {
    pub fn as_str(self) -> &'static str {
        match self {
            CloseReason::Window => "window",
            CloseReason::Quit => "quit",
        }
    }
}

/// The close requests that wait for the page to acknowledge them, and the state of a quit that
/// the system asked for.
#[derive(Debug, Default)]
pub struct CloseRounds {
    next_id: u64,
    waiting: Option<(u64, CloseReason)>,
    /// A system quit was answered with "later": AppKit waits for exactly one reply.
    owes_reply: bool,
    /// The app is going away (exit started, or yes replied): a system quit answers "now".
    finishing: bool,
}

/// What `CloseRounds::system_quit` decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemQuit {
    /// Terminate at once: no main window, or the app is already quitting.
    Now,
    /// Terminate later; a quit round with this id starts now.
    Ask(u64),
    /// Terminate later; a quit round is already running, nothing new starts.
    Joined,
}

/// The answer to `applicationShouldTerminate:` (see `terminate.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminateAnswer {
    Now,
    Later,
}

impl CloseRounds {
    /// The system asks the app to quit. `window_exists`: there is a main window to ask the page
    /// through. Exactly one reply is owed after anything but `Now`, however many system quits
    /// arrive meanwhile.
    pub fn system_quit(&mut self, window_exists: bool) -> SystemQuit {
        if self.finishing || !window_exists {
            return SystemQuit::Now;
        }
        if self.owes_reply {
            return SystemQuit::Joined;
        }
        self.owes_reply = true;
        match self.begin(CloseReason::Quit) {
            Some(id) => SystemQuit::Ask(id),
            None => SystemQuit::Joined, // our own Quit waits for the page: it decides
        }
    }

    /// The page cancelled a round of `reason`. The waiting round ends if it is of that reason
    /// (a quit that replaced a window close is not touched by the window's cancel). Returns
    /// true if a waiting system quit must now be answered "no".
    pub fn cancel(&mut self, reason: CloseReason) -> bool {
        if matches!(self.waiting, Some((_, waiting)) if waiting == reason) {
            self.waiting = None;
        }
        reason == CloseReason::Quit && std::mem::take(&mut self.owes_reply)
    }

    /// The app is going away. Returns true if a system quit waits for its "yes".
    pub fn finish_quit(&mut self) -> bool {
        self.waiting = None;
        self.finishing = true;
        std::mem::take(&mut self.owes_reply)
    }

    /// The main window is gone. Returns true if a system quit is still owed its answer: there is
    /// nobody left to ask, so the answer is "yes".
    pub fn window_gone(&mut self) -> bool {
        self.waiting = None;
        if self.owes_reply {
            self.finishing = true;
        }
        std::mem::take(&mut self.owes_reply)
    }

    pub fn owes_reply(&self) -> bool {
        self.owes_reply
    }

    /// A close or quit was asked for. Returns the id of the new round, or `None` if a request
    /// is still waiting for the page (the user pressed the button twice). A quit replaces a
    /// waiting window close: it is the stronger wish.
    pub fn begin(&mut self, reason: CloseReason) -> Option<u64> {
        match (self.waiting, reason) {
            (Some((_, CloseReason::Quit)), _)
            | (Some((_, CloseReason::Window)), CloseReason::Window) => None,
            _ => {
                self.next_id += 1;
                self.waiting = Some((self.next_id, reason));
                Some(self.next_id)
            }
        }
    }

    /// The page acknowledged: nothing waits any more.
    pub fn ack(&mut self) {
        self.waiting = None;
    }

    /// The time for round `id` is up. Returns its reason if the page never acknowledged it (and
    /// no later request replaced it).
    pub fn expire(&mut self, id: u64) -> Option<CloseReason> {
        match self.waiting {
            Some((waiting, reason)) if waiting == id => {
                self.waiting = None;
                Some(reason)
            }
            _ => None,
        }
    }

    /// Forgets whatever waits (the window is gone).
    pub fn clear(&mut self) {
        self.waiting = None;
    }

    pub fn is_waiting(&self) -> bool {
        self.waiting.is_some()
    }
}

/// What the close protocol needs from the app.
pub trait Host: Send + Sync + 'static {
    /// The labels of the document windows that exist (`main` first).
    fn document_windows(&self) -> Vec<String>;
    /// Sends `close-requested` to the page of this window.
    fn emit_close_requested(&self, label: &str, reason: CloseReason);
    /// Destroys this window without asking again.
    fn destroy_window(&self, label: &str);
    /// Exits the app.
    fn exit(&self);
    /// Answers the system's pending "terminate later" (on the main thread): yes lets the app
    /// terminate, no cancels the quit, a logout or a restart.
    fn reply_terminate(&self, allow: bool);
    fn trace(&self, name: &str, fields: Value);
    /// Runs `task` once, after `delay`, without blocking the caller.
    fn after(&self, delay: Duration, task: Box<dyn FnOnce() + Send>);
}

/// Who is being asked: the window whose acknowledgement is awaited, and during a quit the
/// windows still to ask after the current one.
#[derive(Debug, Default)]
struct Targets {
    waiting: Option<(u64, String)>,
    quit_current: Option<String>,
    quit_rest: Vec<String>,
}

/// The close and quit protocol of, with its safety valve. A window close concerns one
/// window; a quit walks every document window in turn (one question sequence at a time).
pub struct CloseProtocol<H: Host> {
    host: Arc<H>,
    rounds: Mutex<CloseRounds>,
    targets: Mutex<Targets>,
}

impl<H: Host> CloseProtocol<H> {
    pub fn new(host: Arc<H>) -> Arc<Self> {
        Arc::new(CloseProtocol {
            host,
            rounds: Mutex::new(CloseRounds::default()),
            targets: Mutex::new(Targets::default()),
        })
    }

    fn rounds(&self) -> std::sync::MutexGuard<'_, CloseRounds> {
        self.rounds.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn targets(&self) -> std::sync::MutexGuard<'_, Targets> {
        self.targets.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The window's close button or Close Window (`Window`, for the window `label`), or Quit.
    /// With no document window a quit exits at once and a window close does nothing. Otherwise
    /// the page is asked, and if it does not acknowledge within `ACK_TIMEOUT` the window is closed
    /// (or, for a quit, left out) anyway. A quit is not asked twice while a system quit waits
    /// for the page's answer.
    pub fn request(self: &Arc<Self>, label: &str, reason: CloseReason) {
        let windows = self.host.document_windows();
        if reason == CloseReason::Window && !windows.iter().any(|window| window == label) {
            return;
        }
        if windows.is_empty() {
            if reason == CloseReason::Quit {
                self.host.trace(
                    "close-requested",
                    json!({ "reason": "quit", "page": false }),
                );
                self.end_quit();
            }
            return;
        }
        if reason == CloseReason::Quit && self.rounds().owes_reply() {
            return; // the page is already dealing with a quit the system asked for
        }
        let Some(id) = self.rounds().begin(reason) else {
            return; // a request is already waiting for the page
        };
        match reason {
            CloseReason::Window => self.ask_page(id, label, reason),
            CloseReason::Quit => self.start_quit(id, windows),
        }
    }

    /// `[NSApp terminate:]` was called (logout, restart, Dock menu Quit, AppleScript `quit`):
    /// the answer to `applicationShouldTerminate:`. With no document window, or when the app is
    /// already quitting, it is "now". Otherwise the quit round of `request` starts and the
    /// answer is "later"; the reply (`finish`, `cancel`, the valve, or the windows going away)
    /// comes through `Host::reply_terminate`.
    pub fn system_quit(self: &Arc<Self>) -> TerminateAnswer {
        let windows = self.host.document_windows();
        let decision = self.rounds().system_quit(!windows.is_empty());
        let answer = match decision {
            SystemQuit::Now => TerminateAnswer::Now,
            SystemQuit::Ask(_) | SystemQuit::Joined => TerminateAnswer::Later,
        };
        self.host.trace(
            "should-terminate",
            json!({ "answer": match answer {
                TerminateAnswer::Now => "now",
                TerminateAnswer::Later => "later",
            } }),
        );
        if let SystemQuit::Ask(id) = decision {
            self.start_quit(id, windows);
        }
        answer
    }

    /// A quit round: the first window is asked now, the others one after the other as each
    /// answers.
    fn start_quit(self: &Arc<Self>, id: u64, windows: Vec<String>) {
        let Some((first, rest)) = windows.split_first() else {
            return;
        };
        {
            let mut targets = self.targets();
            targets.quit_current = Some(first.clone());
            targets.quit_rest = rest.to_vec();
        }
        self.ask_page(id, first, CloseReason::Quit);
    }

    /// The window in front of the quit round is done (finished, left out by the valve, or
    /// gone): the next one still there is asked, and when none is left the app goes away.
    fn advance_quit(self: &Arc<Self>) {
        loop {
            let next = {
                let mut targets = self.targets();
                if targets.quit_rest.is_empty() {
                    targets.quit_current = None;
                    None
                } else {
                    Some(targets.quit_rest.remove(0))
                }
            };
            let Some(next) = next else {
                return self.end_quit();
            };
            if !self.host.document_windows().contains(&next) {
                continue;
            }
            let id = self.rounds().begin(CloseReason::Quit);
            let Some(id) = id else {
                return; // a newer request is waiting; it decides
            };
            self.targets().quit_current = Some(next.clone());
            return self.ask_page(id, &next, CloseReason::Quit);
        }
    }

    fn ask_page(self: &Arc<Self>, id: u64, label: &str, reason: CloseReason) {
        self.targets().waiting = Some((id, label.to_owned()));
        self.host.trace(
            "close-requested",
            json!({ "reason": reason.as_str(), "label": label }),
        );
        self.host.emit_close_requested(label, reason);
        let protocol = Arc::clone(self);
        self.host
            .after(ACK_TIMEOUT, Box::new(move || protocol.expire(id)));
    }

    /// The page has seen the request and is dealing with it (asking the user, saving).
    pub fn ack(&self) {
        self.rounds().ack();
        self.targets().waiting = None;
        self.host.trace("ack-close", Value::Null);
    }

    /// The page of `label` is done. It has asked the user about every unsaved document; the
    /// window is destroyed, or (quit) the next window is asked and, after the last, the app
    /// exits (for a system quit: "yes, terminate").
    pub fn finish(self: &Arc<Self>, label: &str, reason: CloseReason) {
        self.rounds().clear();
        self.targets().waiting = None;
        self.host.trace(
            "finish-close",
            json!({ "reason": reason.as_str(), "label": label }),
        );
        self.close(label, reason);
    }

    /// The page's user chose Cancel. The round ends, so the next close starts cleanly; a system
    /// quit that waits for the answer gets "no" (the logout or restart is cancelled). A cancelled
    /// quit asks no further window.
    pub fn cancel(&self, label: &str, reason: CloseReason) {
        let owed = self.rounds().cancel(reason);
        {
            let mut targets = self.targets();
            targets.waiting = None;
            if reason == CloseReason::Quit {
                targets.quit_current = None;
                targets.quit_rest.clear();
            }
        }
        self.host.trace(
            "cancel-close",
            json!({ "reason": reason.as_str(), "label": label }),
        );
        if owed {
            self.reply(false);
        }
    }

    /// A document window went away by other means: nothing is waiting for it any more. When it
    /// was the last one, a system quit that waited for the page is answered "yes": nobody is left
    /// to ask. Otherwise a quit that was waiting for this window moves on to the next.
    pub fn window_gone(self: &Arc<Self>, label: &str) {
        let remaining = self
            .host
            .document_windows()
            .into_iter()
            .filter(|window| window != label)
            .count();
        if remaining == 0 {
            if self.rounds().window_gone() {
                self.reply(true);
            }
            *self.targets() = Targets::default();
            return;
        }
        let was_current = {
            let mut targets = self.targets();
            targets.quit_rest.retain(|window| window != label);
            if targets
                .waiting
                .as_ref()
                .is_some_and(|(_, who)| who == label)
            {
                targets.waiting = None;
            }
            targets.quit_current.as_deref() == Some(label)
        };
        if was_current {
            self.rounds().clear();
            self.advance_quit();
        }
    }

    fn expire(self: &Arc<Self>, id: u64) {
        let Some(reason) = self.rounds().expire(id) else {
            return;
        };
        let label = {
            let mut targets = self.targets();
            match targets.waiting.take() {
                Some((waiting, label)) if waiting == id => Some(label),
                other => {
                    targets.waiting = other;
                    None
                }
            }
        };
        self.host.trace(
            "close-forced",
            json!({ "reason": reason.as_str(), "label": label }),
        );
        self.close(label.as_deref().unwrap_or(MAIN_LABEL), reason);
    }

    fn close(self: &Arc<Self>, label: &str, reason: CloseReason) {
        match reason {
            CloseReason::Window => self.host.destroy_window(label),
            CloseReason::Quit => self.advance_quit(),
        }
    }

    /// The app goes away: with a waiting system quit by replying "yes" (AppKit terminates the
    /// app normally and tao shuts down), otherwise by exiting.
    fn end_quit(&self) {
        if self.rounds().finish_quit() {
            self.reply(true);
        } else {
            self.host.exit();
        }
    }

    fn reply(&self, allow: bool) {
        self.host
            .trace("terminate-reply", json!({ "allow": allow }));
        self.host.reply_terminate(allow);
    }
}

// ---- the real app ------------------------------------------------------------------------

/// The `Host` of the running app.
pub struct AppHost {
    app: AppHandle<Wry>,
}

impl AppHost {
    pub fn new(app: &AppHandle<Wry>) -> Self {
        AppHost { app: app.clone() }
    }
}

impl Host for AppHost {
    fn document_windows(&self) -> Vec<String> {
        windows::document_labels(&self.app)
    }

    fn emit_close_requested(&self, label: &str, reason: CloseReason) {
        let _ = self.app.emit_to(label, "close-requested", reason);
    }

    fn destroy_window(&self, label: &str) {
        // A window closed on purpose does not come back with the session.
        if label != MAIN_LABEL {
            crate::stores::forget_window_session(&self.app, label);
        }
        if let Some(window) = self.app.get_webview_window(label) {
            let _ = window.destroy();
        }
    }

    fn exit(&self) {
        self.app.exit(0);
    }

    fn reply_terminate(&self, allow: bool) {
        // AppKit wants the reply on the main thread; the page's commands and the valve timer run
        // on other threads. A failure (the event loop is gone) means the app is ending anyway.
        let _ = self.app.run_on_main_thread(move || terminate::reply(allow));
    }

    fn trace(&self, name: &str, fields: Value) {
        self.app.state::<Trace>().event(name, fields);
    }

    fn after(&self, delay: Duration, task: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            task();
        });
    }
}

/// The managed close protocol of the running app.
pub type AppCloseProtocol = Arc<CloseProtocol<AppHost>>;

/// Facts about the window the app remembers: the system appearance (so a window created later
/// has the right background) and whether the first main window has been closed.
pub struct Lifecycle {
    theme: Mutex<Theme>,
    main_closed: AtomicBool,
    setup_done: AtomicBool,
}

impl Default for Lifecycle {
    fn default() -> Self {
        Lifecycle {
            theme: Mutex::new(Theme::Light),
            main_closed: AtomicBool::new(false),
            setup_done: AtomicBool::new(false),
        }
    }
}

impl Lifecycle {
    pub fn theme(&self) -> Theme {
        *self.theme.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_theme(&self, theme: Theme) {
        *self.theme.lock().unwrap_or_else(PoisonError::into_inner) = theme;
    }

    /// The first main window has been closed: windows created from now on are "reopened".
    pub fn mark_main_closed(&self) {
        self.main_closed.store(true, Ordering::SeqCst);
    }

    pub fn main_has_been_closed(&self) -> bool {
        self.main_closed.load(Ordering::SeqCst)
    }

    /// `setup` has finished: Tauri has created the windows of `tauri.conf.json`.
    pub fn mark_setup_done(&self) {
        self.setup_done.store(true, Ordering::SeqCst);
    }

    pub fn is_setup_done(&self) -> bool {
        self.setup_done.load(Ordering::SeqCst)
    }
}

/// Whether the app should create `main` itself. macOS can deliver the open-documents event
/// (`Opened`) or `Reopen` before Tauri has created the windows of `tauri.conf.json`; creating
/// `main` then makes Tauri panic with "a webview with label `main` already exists".
pub fn should_create_main(no_document_window: bool, setup_done: bool) -> bool {
    no_document_window && setup_done
}

/// Creates the main window from the configuration in `tauri.conf.json`, with the background
/// color of the current appearance (as the first window gets it in `setup`). Its page is not
/// ready for events until it asks.
pub fn create_main_window(app: &AppHandle<Wry>) -> tauri::Result<WebviewWindow<Wry>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    app.state::<Pages>().reset(MAIN_LABEL);
    let theme = app.state::<Lifecycle>().theme();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .background_color(windows::canvas_for(theme))
        .build()?;
    crate::vibrancy::apply(app, &window);
    if let Some(menu) = app.try_state::<MenuHandles>() {
        menu.set_window_open(app, true);
    }
    Ok(window)
}

/// Brings a document window to the front, un-minimizing it if needed.
pub fn focus_window(app: &AppHandle<Wry>, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Brings the document window that actions go to (the focused one, else the last focused, else
/// `main`) to the front.
pub fn focus_target_window(app: &AppHandle<Wry>) {
    if let Some(label) = windows::target_label(app) {
        focus_window(app, &label);
    }
}

/// A document window is gone: its page cannot listen, so events for it are dropped (`main`: they
/// queue again for the window that is created next); the menu follows the windows that are left;
/// nothing waits for an acknowledgement any more.
fn document_window_destroyed(app: &AppHandle<Wry>, label: &str) {
    if label == MAIN_LABEL {
        app.state::<Pages>().reset(label);
        app.state::<Lifecycle>().mark_main_closed();
    } else {
        app.state::<Pages>().forget(label);
    }
    app.state::<windows::DocWindows>().forget(label);
    crate::watcher::forget_window(app, label);
    if let Some(protocol) = app.try_state::<AppCloseProtocol>() {
        protocol.window_gone(label);
    }
    if let Some(menu) = app.try_state::<MenuHandles>() {
        let remaining: Vec<String> = windows::document_labels(app)
            .into_iter()
            .filter(|window| window != label)
            .collect();
        menu.forget_window(app, label);
        menu.set_window_open(app, !remaining.is_empty());
        if let Some(next) = remaining.first() {
            let target = windows::target_label(app).filter(|target| target != label);
            menu.set_target(app, target.or_else(|| Some(next.clone())));
        }
    }
    app.state::<Trace>()
        .event("window-closed", json!({ "label": label }));
}

/// The page of a document window starts loading (also after a reload): it has not listened yet.
pub fn on_page_load(webview: &Webview<Wry>, payload: &PageLoadPayload<'_>) {
    if windows::is_document_label(webview.label()) && payload.event() == PageLoadEvent::Started {
        webview.app_handle().state::<Pages>().reset(webview.label());
    }
}

/// Events of the document windows: the close button, the window going away, the focus moving,
/// the system appearance changing, and files dropped on a window.
pub fn on_window_event(window: &Window<Wry>, event: &WindowEvent) {
    let label = window.label();
    if !windows::is_document_label(label) {
        return;
    }
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // Before the protocol exists (the app is still starting) the window closes as usual.
            if let Some(protocol) = app.try_state::<AppCloseProtocol>() {
                api.prevent_close();
                protocol.request(label, CloseReason::Window);
            }
        }
        WindowEvent::Destroyed => document_window_destroyed(app, label),
        WindowEvent::Focused(true) => {
            app.state::<windows::DocWindows>().set_last_focus(label);
            if let Some(menu) = app.try_state::<MenuHandles>() {
                menu.set_target(app, Some(label.to_owned()));
            }
        }
        WindowEvent::ThemeChanged(theme) => app.state::<Lifecycle>().set_theme(*theme),
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) => {
            let grants = app.state::<crate::grants::PathGrants>();
            open_files::deliver_to(app, label, open_files::accept_paths(&grants, paths));
            // Images go to the editor of that window, where they were dropped (in CSS pixels).
            let images = app
                .state::<crate::pasted_images::DroppedImages>()
                .accept(paths);
            if !images.is_empty() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let _ = app.emit_to(
                    label,
                    crate::pasted_images::DROP_IMAGES_EVENT,
                    json!({
                        "paths": images.iter().map(|path| crate::fs_util::path_text(path)).collect::<Vec<_>>(),
                        "x": position.x / scale,
                        "y": position.y / scale,
                    }),
                );
            }
        }
        _ => {}
    }
}

/// Makes system-initiated quits run the quit protocol (see `on_run_event`).
fn install_system_quit(app: &AppHandle<Wry>) {
    let Some(protocol) = app.try_state::<AppCloseProtocol>() else {
        return;
    };
    let protocol: AppCloseProtocol = protocol.inner().clone();
    match terminate::install(move || protocol.system_quit()) {
        Installed::Yes => {}
        Installed::No(reason) => app
            .state::<Trace>()
            .event("should-terminate-unavailable", json!({ "reason": reason })),
    }
}

/// Events of the whole app.
///
/// - Closing the last window does not quit (`ExitRequested` without a code is prevented), so
///   the Dock icon and the menu bar stay and a click on the Dock icon brings the window back.
/// - Files opened from Finder or dropped on the Dock icon arrive as `Opened`.
/// - A click on the Dock icon arrives as `Reopen`: if no document window is open, `main` is created.
///
/// System-initiated quits (logout, restart, shutdown, Dock menu Quit, AppleScript `quit`) end in
/// `NSApplication terminate:`. The window library (tao 0.37) does not implement
/// `applicationShouldTerminate:`, so `terminate::install` adds it to the app delegate once the
/// app is ready (`Ready`), and `CloseProtocol::system_quit` runs the same quit round as our own
/// Quit item. When the page says yes, or the valve expires, the reply is "terminate": AppKit
/// ends the process from `applicationWillTerminate:` and tao reports `Exit`, without an
/// `ExitRequested` event. If the method cannot be added the old behavior stays (the process
/// ends at once), and `should-terminate-unavailable` is traced.
pub fn on_run_event(app: &AppHandle<Wry>, event: RunEvent) {
    match event {
        RunEvent::Ready => install_system_quit(app),
        RunEvent::ExitRequested { code, api, .. } => {
            // Windows has no Dock icon to bring a window back, so there the app ends with its
            // last window, as Windows apps do.
            let prevented = code.is_none() && cfg!(not(windows));
            if prevented {
                api.prevent_exit();
            }
            app.state::<Trace>().event(
                "exit-requested",
                json!({ "code": code, "prevented": prevented }),
            );
        }
        RunEvent::Exit => app.state::<Trace>().event("exit", Value::Null),
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            let grants = app.state::<crate::grants::PathGrants>();
            let paths = open_files::urls_to_paths(&urls);
            open_files::deliver(app, open_files::accept_paths(&grants, &paths));
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => reopen(app),
        _ => {}
    }
}

/// A click on the Dock icon (macOS), or a second launch without files (Windows): `main` is
/// created if no document window is open, otherwise the last focused one comes to the front.
pub fn reopen(app: &AppHandle<Wry>) {
    // Reopen can arrive before Tauri has created the configured windows: wait for setup.
    if should_create_main(
        windows::document_labels(app).is_empty(),
        app.state::<Lifecycle>().is_setup_done(),
    ) {
        if let Err(error) = create_main_window(app) {
            eprintln!("writedown: the main window could not be created: {error}");
        }
    } else if cfg!(not(target_os = "macos")) && app.state::<Lifecycle>().is_setup_done() {
        focus_target_window(app);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn should_create_main_needs_both() {
        assert!(super::should_create_main(true, true));
        assert!(!super::should_create_main(true, false));
        assert!(!super::should_create_main(false, true));
        assert!(!super::should_create_main(false, false));
    }

    #[test]
    fn setup_done_defaults_false_then_true() {
        let lifecycle = super::Lifecycle::default();
        assert!(!lifecycle.is_setup_done());
        lifecycle.mark_setup_done();
        assert!(lifecycle.is_setup_done());
    }

    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Everything the protocol did, in order.
    #[derive(Debug, Clone, PartialEq)]
    enum Did {
        /// `close-requested` to the main window.
        Emit(CloseReason),
        /// `close-requested` to another document window.
        EmitTo(String, CloseReason),
        Destroy,
        DestroyOther(String),
        Exit,
        /// The answer to the system's pending quit.
        Reply(bool),
        Trace(String),
    }

    type Timer = (Duration, Box<dyn FnOnce() + Send>);

    struct FakeHost {
        windows: Mutex<Vec<String>>,
        log: Mutex<Vec<Did>>,
        timers: Mutex<Vec<Timer>>,
        scheduled: AtomicUsize,
    }

    impl FakeHost {
        fn new(window: bool) -> Arc<Self> {
            FakeHost::with_windows(if window { &["main"] } else { &[] })
        }

        fn with_windows(labels: &[&str]) -> Arc<Self> {
            Arc::new(FakeHost {
                windows: Mutex::new(labels.iter().map(|label| (*label).to_owned()).collect()),
                log: Mutex::new(Vec::new()),
                timers: Mutex::new(Vec::new()),
                scheduled: AtomicUsize::new(0),
            })
        }

        fn log(&self) -> Vec<Did> {
            self.log.lock().expect("log").clone()
        }

        fn main_window_exists(&self) -> bool {
            self.windows
                .lock()
                .expect("windows")
                .iter()
                .any(|label| label == "main")
        }

        /// What happened, without the trace lines.
        fn actions(&self) -> Vec<Did> {
            self.log()
                .into_iter()
                .filter(|entry| !matches!(entry, Did::Trace(_)))
                .collect()
        }

        fn traces(&self) -> Vec<String> {
            self.log()
                .into_iter()
                .filter_map(|entry| match entry {
                    Did::Trace(name) => Some(name),
                    _ => None,
                })
                .collect()
        }

        /// The clock moves on: every scheduled timer fires, in the order it was set.
        fn run_timers(&self) -> Vec<Duration> {
            let timers: Vec<_> = std::mem::take(&mut *self.timers.lock().expect("timers"));
            let delays = timers.iter().map(|(delay, _)| *delay).collect();
            for (_, task) in timers {
                task();
            }
            delays
        }
    }

    impl Host for FakeHost {
        fn document_windows(&self) -> Vec<String> {
            self.windows.lock().expect("windows").clone()
        }
        fn emit_close_requested(&self, label: &str, reason: CloseReason) {
            let entry = if label == "main" {
                Did::Emit(reason)
            } else {
                Did::EmitTo(label.to_owned(), reason)
            };
            self.log.lock().expect("log").push(entry);
        }
        fn destroy_window(&self, label: &str) {
            self.windows
                .lock()
                .expect("windows")
                .retain(|window| window != label);
            let entry = if label == "main" {
                Did::Destroy
            } else {
                Did::DestroyOther(label.to_owned())
            };
            self.log.lock().expect("log").push(entry);
        }
        fn exit(&self) {
            self.log.lock().expect("log").push(Did::Exit);
        }
        fn reply_terminate(&self, allow: bool) {
            self.log.lock().expect("log").push(Did::Reply(allow));
        }
        fn trace(&self, name: &str, _fields: Value) {
            self.log
                .lock()
                .expect("log")
                .push(Did::Trace(name.to_owned()));
        }
        fn after(&self, delay: Duration, task: Box<dyn FnOnce() + Send>) {
            self.scheduled.fetch_add(1, Ordering::SeqCst);
            self.timers.lock().expect("timers").push((delay, task));
        }
    }

    // ---- the rounds ------------------------------------------------------------------

    #[test]
    fn a_request_starts_a_round_and_a_second_one_waits_for_the_first() {
        let mut rounds = CloseRounds::default();

        let first = rounds.begin(CloseReason::Window);
        let second = rounds.begin(CloseReason::Window);

        assert!(first.is_some());
        assert_eq!(second, None);
        assert!(rounds.is_waiting());
    }

    #[test]
    fn after_the_page_acknowledged_the_next_request_starts_a_new_round() {
        let mut rounds = CloseRounds::default();
        let first = rounds.begin(CloseReason::Window).expect("first");

        rounds.ack();
        let second = rounds.begin(CloseReason::Window).expect("second");

        assert_ne!(first, second);
        assert!(rounds.is_waiting());
    }

    #[test]
    fn a_quit_replaces_a_waiting_window_close_but_not_the_other_way_round() {
        let mut rounds = CloseRounds::default();
        let window = rounds.begin(CloseReason::Window).expect("window");

        let quit = rounds.begin(CloseReason::Quit).expect("a quit replaces it");

        assert_ne!(window, quit);
        assert_eq!(rounds.begin(CloseReason::Window), None);
        assert_eq!(rounds.begin(CloseReason::Quit), None);
        assert_eq!(
            rounds.expire(window),
            None,
            "the replaced round has no effect"
        );
        assert_eq!(rounds.expire(quit), Some(CloseReason::Quit));
    }

    #[test]
    fn a_round_that_is_never_acknowledged_expires_with_its_reason_once() {
        let mut rounds = CloseRounds::default();
        let id = rounds.begin(CloseReason::Quit).expect("round");

        assert_eq!(rounds.expire(id), Some(CloseReason::Quit));
        assert_eq!(rounds.expire(id), None, "only once");
        assert!(!rounds.is_waiting());
    }

    #[test]
    fn an_acknowledged_round_does_not_expire() {
        let mut rounds = CloseRounds::default();
        let id = rounds.begin(CloseReason::Window).expect("round");

        rounds.ack();

        assert_eq!(rounds.expire(id), None);
    }

    #[test]
    fn clearing_forgets_the_round() {
        let mut rounds = CloseRounds::default();
        let id = rounds.begin(CloseReason::Window).expect("round");

        rounds.clear();

        assert_eq!(rounds.expire(id), None);
        assert!(!rounds.is_waiting());
    }

    // ---- the protocol ----------------------------------------------------------------

    #[test]
    fn closing_the_window_asks_the_page_and_waits_two_seconds_for_the_acknowledgement() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("main", CloseReason::Window);

        assert_eq!(host.actions(), [Did::Emit(CloseReason::Window)]);
        assert_eq!(host.traces(), ["close-requested"]);
        assert_eq!(host.timers.lock().expect("timers").len(), 1);
        assert_eq!(
            host.timers.lock().expect("timers")[0].0,
            Duration::from_secs(2)
        );
        assert_eq!(ACK_TIMEOUT, Duration::from_secs(2));
    }

    #[test]
    fn a_page_that_acknowledges_is_left_alone_however_long_the_user_takes() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);

        protocol.ack();
        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Window)],
            "nothing is forced"
        );
        assert!(host.main_window_exists());
    }

    #[test]
    fn a_page_that_never_acknowledges_loses_its_window_after_the_timeout() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);

        let delays = host.run_timers();

        assert_eq!(delays, [Duration::from_secs(2)]);
        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Window), Did::Destroy]
        );
        assert!(host.traces().contains(&"close-forced".to_owned()));
    }

    #[test]
    fn a_page_that_never_acknowledges_a_quit_is_quit_after_the_timeout() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);

        host.run_timers();

        assert_eq!(host.actions(), [Did::Emit(CloseReason::Quit), Did::Exit]);
        assert!(
            host.main_window_exists(),
            "the window is left for the exit to take down"
        );
    }

    #[test]
    fn finishing_a_window_close_destroys_the_window_and_quitting_exits() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());

        protocol.finish("main", CloseReason::Window);
        assert_eq!(host.actions(), [Did::Destroy]);
        protocol.finish("main", CloseReason::Quit);
        assert_eq!(host.actions(), [Did::Destroy, Did::Exit]);
        assert_eq!(host.traces(), ["finish-close", "finish-close"]);
    }

    #[test]
    fn finishing_ends_the_wait_so_a_late_timer_does_nothing() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);

        protocol.finish("main", CloseReason::Window);
        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Window), Did::Destroy]
        );
    }

    #[test]
    fn pressing_the_close_button_twice_asks_the_page_once() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("main", CloseReason::Window);
        protocol.request("main", CloseReason::Window);

        assert_eq!(host.actions(), [Did::Emit(CloseReason::Window)]);
        assert_eq!(host.scheduled.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn after_the_page_acknowledged_the_user_can_ask_again_for_example_after_cancelling() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);
        protocol.ack(); // the page showed its sheet, the user chose Cancel and sent nothing

        protocol.request("main", CloseReason::Window);

        assert_eq!(
            host.actions(),
            [
                Did::Emit(CloseReason::Window),
                Did::Emit(CloseReason::Window)
            ]
        );
    }

    #[test]
    fn a_quit_while_a_window_close_waits_asks_again_with_quit_and_the_old_timer_is_harmless() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);

        protocol.request("main", CloseReason::Quit);
        let delays = host.run_timers();

        assert_eq!(delays.len(), 2);
        assert_eq!(
            host.actions(),
            [
                Did::Emit(CloseReason::Window),
                Did::Emit(CloseReason::Quit),
                Did::Exit
            ],
            "only the quit is forced, the window is not destroyed first"
        );
    }

    #[test]
    fn quitting_with_no_main_window_exits_at_once() {
        let host = FakeHost::new(false);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("main", CloseReason::Quit);

        assert_eq!(host.actions(), [Did::Exit]);
        assert_eq!(host.scheduled.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn closing_a_window_that_is_not_there_does_nothing() {
        let host = FakeHost::new(false);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("main", CloseReason::Window);

        assert!(host.actions().is_empty());
    }

    #[test]
    fn a_window_that_went_away_by_itself_cancels_the_wait() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);

        protocol.window_gone("main");
        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit)],
            "no forced exit"
        );
    }

    #[test]
    fn closing_the_last_window_does_not_quit() {
        // Rust only exits for a quit; finishing a window close just destroys the window.
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);
        protocol.ack();

        protocol.finish("main", CloseReason::Window);

        assert!(!host.actions().contains(&Did::Exit));
    }

    #[test]
    fn the_acknowledgement_is_traced() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());

        protocol.ack();

        assert_eq!(host.traces(), ["ack-close"]);
    }

    // ---- system-initiated quits ----------------------------------------------------------

    #[test]
    fn a_system_quit_with_no_main_window_terminates_at_once() {
        let host = FakeHost::new(false);
        let protocol = CloseProtocol::new(host.clone());

        let answer = protocol.system_quit();

        assert_eq!(answer, TerminateAnswer::Now);
        assert!(host.actions().is_empty(), "nothing to ask, no reply owed");
        assert_eq!(host.scheduled.load(Ordering::SeqCst), 0);
        assert_eq!(host.traces(), ["should-terminate"]);
    }

    #[test]
    fn a_system_quit_asks_the_page_like_our_own_quit_and_answers_later() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());

        let answer = protocol.system_quit();

        assert_eq!(answer, TerminateAnswer::Later);
        assert_eq!(host.actions(), [Did::Emit(CloseReason::Quit)]);
        assert_eq!(host.traces(), ["should-terminate", "close-requested"]);
        assert_eq!(
            host.timers.lock().expect("timers")[0].0,
            ACK_TIMEOUT,
            "the same acknowledgement valve"
        );
    }

    #[test]
    fn a_system_quit_then_acknowledged_and_finished_replies_yes_instead_of_exiting() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();

        protocol.ack();
        protocol.finish("main", CloseReason::Quit);
        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "AppKit terminates the app by itself; the valve does not reply again"
        );
        assert_eq!(
            host.traces(),
            [
                "should-terminate",
                "close-requested",
                "ack-close",
                "finish-close",
                "terminate-reply"
            ]
        );
    }

    #[test]
    fn a_system_quit_then_acknowledged_and_cancelled_replies_no_and_the_app_goes_on() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();
        protocol.ack();

        protocol.cancel("main", CloseReason::Quit);
        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(false)]
        );
        assert!(host.main_window_exists());
        assert!(host.traces().contains(&"cancel-close".to_owned()));
        assert!(host.traces().contains(&"terminate-reply".to_owned()));

        // The next quit, from the system or from us, starts a clean round.
        assert_eq!(protocol.system_quit(), TerminateAnswer::Later);
        protocol.request("main", CloseReason::Quit);
        assert_eq!(
            host.actions()[2..],
            [Did::Emit(CloseReason::Quit)],
            "our own Quit is ignored only while the system quit waits"
        );
        protocol.cancel("main", CloseReason::Quit);
        protocol.request("main", CloseReason::Quit);
        assert_eq!(
            host.actions()[3..],
            [Did::Reply(false), Did::Emit(CloseReason::Quit)]
        );
    }

    #[test]
    fn a_system_quit_whose_page_never_acknowledges_replies_yes_when_the_valve_expires() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();

        host.run_timers();

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "a broken page cannot trap the user, and the app is not exited behind AppKit's back"
        );
        assert_eq!(
            host.traces(),
            [
                "should-terminate",
                "close-requested",
                "close-forced",
                "terminate-reply"
            ]
        );
    }

    #[test]
    fn a_second_system_quit_while_one_waits_joins_it_and_owes_no_second_reply() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();

        let again = protocol.system_quit();
        protocol.ack();
        let after_ack = protocol.system_quit();
        protocol.finish("main", CloseReason::Quit);
        host.run_timers();

        assert_eq!(again, TerminateAnswer::Later);
        assert_eq!(after_ack, TerminateAnswer::Later);
        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "one question for the user, one reply for AppKit"
        );
        assert_eq!(host.scheduled.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn once_the_app_is_quitting_a_system_quit_terminates_now() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.finish("main", CloseReason::Quit); // our own Quit finished: the app exits

        let answer = protocol.system_quit();

        assert_eq!(answer, TerminateAnswer::Now);
        assert_eq!(host.actions(), [Did::Exit]);
    }

    #[test]
    fn our_own_quit_while_a_system_quit_waits_is_not_asked_again_and_the_answer_is_one_reply() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();
        protocol.ack(); // the page is showing its Save sheet

        protocol.request("main", CloseReason::Quit);
        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit)],
            "the page is not walked a second time"
        );
        protocol.finish("main", CloseReason::Quit);

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "the system quit gets its yes; the app is not exited a second time"
        );
    }

    #[test]
    fn our_own_quit_that_waits_for_the_acknowledgement_is_joined_by_a_system_quit() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);

        let answer = protocol.system_quit();
        host.run_timers();

        assert_eq!(answer, TerminateAnswer::Later);
        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "one question, and the valve answers the system"
        );
    }

    #[test]
    fn our_own_quit_still_exits_directly_when_no_system_quit_is_involved() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);
        protocol.ack();

        protocol.finish("main", CloseReason::Quit);

        assert_eq!(host.actions(), [Did::Emit(CloseReason::Quit), Did::Exit]);
    }

    #[test]
    fn a_window_that_goes_away_while_a_system_quit_waits_answers_yes() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();
        protocol.ack();

        protocol.window_gone("main");
        protocol.window_gone("main");

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Reply(true)],
            "nobody is left to ask, and only once"
        );
    }

    #[test]
    fn cancelling_a_window_close_ends_the_round_and_replies_to_nobody() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);

        protocol.cancel("main", CloseReason::Window);
        host.run_timers();
        protocol.request("main", CloseReason::Window);

        assert_eq!(
            host.actions(),
            [
                Did::Emit(CloseReason::Window),
                Did::Emit(CloseReason::Window)
            ],
            "the cancel ended the first round (its valve does nothing) and the next one starts clean"
        );
        assert!(host.traces().contains(&"cancel-close".to_owned()));
        assert!(!host.traces().contains(&"terminate-reply".to_owned()));
    }

    #[test]
    fn cancelling_a_window_close_does_not_touch_a_quit_that_replaced_it_or_a_waiting_system_quit() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Window);
        protocol.system_quit(); // a quit replaces the window close

        protocol.cancel("main", CloseReason::Window); // the page cancels its old window walk
        protocol.finish("main", CloseReason::Quit);

        assert_eq!(
            host.actions(),
            [
                Did::Emit(CloseReason::Window),
                Did::Emit(CloseReason::Quit),
                Did::Reply(true)
            ]
        );
    }

    #[test]
    fn cancelling_a_quit_nobody_asked_the_system_about_replies_to_nobody() {
        let host = FakeHost::new(true);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);
        protocol.ack();

        protocol.cancel("main", CloseReason::Quit);
        protocol.request("main", CloseReason::Quit);

        assert_eq!(
            host.actions(),
            [Did::Emit(CloseReason::Quit), Did::Emit(CloseReason::Quit)]
        );
    }

    #[test]
    fn the_rounds_decide_what_a_system_quit_does() {
        let mut rounds = CloseRounds::default();
        assert_eq!(rounds.system_quit(false), SystemQuit::Now);
        assert!(!rounds.owes_reply());

        let SystemQuit::Ask(id) = rounds.system_quit(true) else {
            panic!("a window is there: the page is asked");
        };
        assert!(rounds.owes_reply());
        assert_eq!(rounds.system_quit(true), SystemQuit::Joined);
        assert_eq!(rounds.expire(id), Some(CloseReason::Quit));

        assert!(rounds.cancel(CloseReason::Quit), "the reply is owed: no");
        assert!(!rounds.cancel(CloseReason::Quit), "only once");
        assert!(!rounds.finish_quit());
        assert_eq!(
            rounds.system_quit(true),
            SystemQuit::Now,
            "already quitting"
        );
    }

    // ---- several windows (Phase 5) -----------------------------------------------------

    fn emitted_to(label: &str, reason: CloseReason) -> Did {
        if label == "main" {
            Did::Emit(reason)
        } else {
            Did::EmitTo(label.to_owned(), reason)
        }
    }

    #[test]
    fn e51_a_quit_asks_the_windows_one_after_the_other_and_exits_after_the_last() {
        let host = FakeHost::with_windows(&["main", "doc-1", "doc-2"]);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("doc-1", CloseReason::Quit);
        assert_eq!(host.actions(), [emitted_to("main", CloseReason::Quit)]);
        protocol.ack();
        protocol.finish("main", CloseReason::Quit);
        assert_eq!(host.actions().len(), 2);
        assert_eq!(host.actions()[1], emitted_to("doc-1", CloseReason::Quit));
        protocol.ack();
        protocol.finish("doc-1", CloseReason::Quit);
        protocol.ack();
        assert!(
            !host.actions().contains(&Did::Exit),
            "doc-2 is still to be asked"
        );
        protocol.finish("doc-2", CloseReason::Quit);

        assert_eq!(
            host.actions(),
            [
                emitted_to("main", CloseReason::Quit),
                emitted_to("doc-1", CloseReason::Quit),
                emitted_to("doc-2", CloseReason::Quit),
                Did::Exit
            ]
        );
    }

    #[test]
    fn e51_cancel_in_any_window_stops_the_quit_and_asks_no_further_window() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);
        protocol.ack();
        protocol.finish("main", CloseReason::Quit);
        protocol.ack();

        protocol.cancel("doc-1", CloseReason::Quit);
        host.run_timers();

        assert!(!host.actions().contains(&Did::Exit));
        assert_eq!(host.actions().len(), 2);
        // A later quit starts again from the first window.
        protocol.request("main", CloseReason::Quit);
        assert_eq!(host.actions()[2], emitted_to("main", CloseReason::Quit));
    }

    #[test]
    fn e51_a_window_that_never_acknowledges_a_quit_is_left_out_and_the_next_is_asked() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);

        host.run_timers(); // main is hung: the valve moves on

        assert_eq!(
            host.actions(),
            [
                emitted_to("main", CloseReason::Quit),
                emitted_to("doc-1", CloseReason::Quit)
            ]
        );
        host.run_timers(); // doc-1 hangs too: nothing is left to ask
        assert_eq!(host.actions().last(), Some(&Did::Exit));
    }

    #[test]
    fn e51_closing_one_window_asks_and_destroys_only_that_window() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("doc-1", CloseReason::Window);
        protocol.ack();
        protocol.finish("doc-1", CloseReason::Window);

        assert_eq!(
            host.actions(),
            [
                emitted_to("doc-1", CloseReason::Window),
                Did::DestroyOther("doc-1".to_owned())
            ]
        );
        assert!(host.main_window_exists());
    }

    #[test]
    fn e51_a_hung_window_close_destroys_that_window_after_the_timeout() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("doc-1", CloseReason::Window);

        host.run_timers();

        assert_eq!(
            host.actions().last(),
            Some(&Did::DestroyOther("doc-1".to_owned()))
        );
        assert!(host.main_window_exists());
    }

    #[test]
    fn e51_closing_a_window_that_does_not_exist_does_nothing_even_with_others_open() {
        let host = FakeHost::with_windows(&["main"]);
        let protocol = CloseProtocol::new(host.clone());

        protocol.request("doc-9", CloseReason::Window);

        assert!(host.actions().is_empty());
    }

    #[test]
    fn e51_a_window_that_goes_away_during_a_quit_lets_the_quit_move_on() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());
        protocol.request("main", CloseReason::Quit);
        protocol.ack();

        host.windows
            .lock()
            .expect("windows")
            .retain(|label| label != "main");
        protocol.window_gone("main");

        assert_eq!(
            host.actions(),
            [
                emitted_to("main", CloseReason::Quit),
                emitted_to("doc-1", CloseReason::Quit)
            ]
        );
    }

    #[test]
    fn e51_a_system_quit_over_two_windows_asks_both_and_replies_yes_once() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());

        assert_eq!(protocol.system_quit(), TerminateAnswer::Later);
        protocol.ack();
        protocol.finish("main", CloseReason::Quit);
        protocol.ack();
        assert_eq!(
            protocol.system_quit(),
            TerminateAnswer::Later,
            "joins the quit"
        );
        protocol.finish("doc-1", CloseReason::Quit);
        host.run_timers();

        assert_eq!(
            host.actions(),
            [
                emitted_to("main", CloseReason::Quit),
                emitted_to("doc-1", CloseReason::Quit),
                Did::Reply(true)
            ]
        );
    }

    #[test]
    fn e51_cancelling_the_second_window_of_a_system_quit_replies_no() {
        let host = FakeHost::with_windows(&["main", "doc-1"]);
        let protocol = CloseProtocol::new(host.clone());
        protocol.system_quit();
        protocol.ack();
        protocol.finish("main", CloseReason::Quit);
        protocol.ack();

        protocol.cancel("doc-1", CloseReason::Quit);

        assert_eq!(host.actions().last(), Some(&Did::Reply(false)));
    }

    #[test]
    fn reasons_serialize_in_lower_case_like_the_frontend_type() {
        assert_eq!(
            serde_json::to_value(CloseReason::Window).expect("serializes"),
            json!("window")
        );
        assert_eq!(
            serde_json::to_value(CloseReason::Quit).expect("serializes"),
            json!("quit")
        );
        let parsed: CloseReason = serde_json::from_value(json!("quit")).expect("parses");
        assert_eq!(parsed, CloseReason::Quit);
        assert!(serde_json::from_value::<CloseReason>(json!("both")).is_err());
        assert_eq!(CloseReason::Window.as_str(), "window");
    }

    #[test]
    fn a_window_created_later_is_marked_as_reopened_after_the_first_close() {
        let lifecycle = Lifecycle::default();

        assert!(!lifecycle.main_has_been_closed());
        lifecycle.mark_main_closed();

        assert!(lifecycle.main_has_been_closed());
        lifecycle.set_theme(Theme::Dark);
        assert_eq!(lifecycle.theme(), Theme::Dark);
    }
}
