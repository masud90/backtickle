//! Native document chrome: the unsaved dot in the close button
//! (`NSWindow.documentEdited`) and the system list of recent documents (the Dock menu and Finder's
//! recent items, `NSDocumentController`). Every AppKit call is made on the main thread. Nothing
//! here polls; the callers say when something changed.
//!
//! On Windows: an unsaved document puts `*` before the window title (as Notepad does), recent
//! documents go to the system's recent items and the app's jump list (`SHAddToRecentDocs`), and
//! the default app is read from the file associations and changed through the system's "Open
//! with" chooser (Windows lets only the user change it).
//!
//! On Linux: the same `*` before the title (as GNOME's text editor does), recent documents go to
//! GTK's recent files (`recently-used.xbel`, which file managers and the file chooser list), and
//! the default app for Markdown is read and set through GIO (the user's `mimeapps.list`), with
//! Writedown's desktop entry (installed by the .deb package).

use serde::Serialize;
use std::path::{Path, PathBuf};

/// The path to hand to the system recents list, or `None`: only absolute paths of files that exist
/// are noted (the system would list a dead entry otherwise).
pub fn recent_target(path: &Path) -> Option<PathBuf> {
    (path.is_absolute() && path.is_file()).then(|| path.to_path_buf())
}

/// Shows or hides the unsaved dot on the window's close button.
#[cfg(target_os = "macos")]
pub fn set_edited(window: &tauri::WebviewWindow, edited: bool) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri returns the window's own NSWindow; this closure runs on the main thread
        // while the window object is held by `target`.
        let ns_window = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
        ns_window.setDocumentEdited(edited);
    });
}

/// The window title with the unsaved marker of Windows and Linux.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn marked_title(title: &str, edited: bool) -> String {
    if edited {
        format!("*{title}")
    } else {
        title.to_owned()
    }
}

/// Windows and Linux: the title each window was given and whether its document is edited.
#[cfg(not(target_os = "macos"))]
fn titles() -> std::sync::MutexGuard<'static, std::collections::HashMap<String, (String, bool)>> {
    static TITLES: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, (String, bool)>>,
    > = std::sync::OnceLock::new();
    TITLES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(not(target_os = "macos"))]
pub fn set_edited(window: &tauri::WebviewWindow, edited: bool) {
    let title = {
        let mut titles = titles();
        let entry = titles
            .entry(window.label().to_owned())
            .or_insert_with(|| (window.title().unwrap_or_default(), false));
        entry.1 = edited;
        marked_title(&entry.0, edited)
    };
    let _ = window.set_title(&title);
}

/// Sets the window title (with the unsaved marker on Windows and Linux).
pub fn set_title(window: &tauri::WebviewWindow, title: &str) -> tauri::Result<()> {
    #[cfg(not(target_os = "macos"))]
    let title = {
        let mut titles = titles();
        let entry = titles
            .entry(window.label().to_owned())
            .or_insert_with(|| (String::new(), false));
        entry.0 = title.to_owned();
        marked_title(title, entry.1)
    };
    window.set_title(title.as_ref())
}

/// Whether the calls to the system recents list are made. They are skipped when the stores are
/// in a folder chosen with `WRITEDOWN_CONFIG_DIR` (tests, benchmarks and real-app checks), so
/// those runs never touch the user's system recents. The app's own recents list is unaffected.
pub fn system_recents_enabled(overridden: bool) -> bool {
    !overridden
}

/// Notes a document in the system recents (the Dock icon's menu lists it).
#[cfg(target_os = "macos")]
pub fn note_recent(app: &tauri::AppHandle<tauri::Wry>, path: &Path) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let Some(target) = recent_target(path) else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSDocumentController;
        use objc2_foundation::{NSString, NSURL};
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let text = NSString::from_str(&target.to_string_lossy());
        let url = NSURL::fileURLWithPath(&text);
        NSDocumentController::sharedDocumentController(mtm).noteNewRecentDocumentURL(&url);
    });
}

/// Notes a document in the system's recent items and the app's jump list.
#[cfg(windows)]
pub fn note_recent(app: &tauri::AppHandle<tauri::Wry>, path: &Path) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let Some(target) = recent_target(path) else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        use ::windows::Win32::UI::Shell::{SHARD_PATHW, SHAddToRecentDocs};
        use ::windows::core::HSTRING;
        let wide = HSTRING::from(target.as_path());
        // SAFETY: SHARD_PATHW takes a NUL-terminated wide path that lives through the call.
        unsafe { SHAddToRecentDocs(SHARD_PATHW.0 as u32, Some(wide.as_ptr().cast())) };
    });
}

/// Notes a document in GTK's recent files.
#[cfg(not(any(target_os = "macos", windows)))]
pub fn note_recent(app: &tauri::AppHandle<tauri::Wry>, path: &Path) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let Some(uri) = recent_target(path)
        .and_then(|target| url::Url::from_file_path(target).ok())
        .map(String::from)
    else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        use gtk::prelude::RecentManagerExt;
        if let Some(manager) = gtk::RecentManager::default() {
            manager.add_item(&uri);
        }
    });
}

/// Empties the system recents list.
#[cfg(target_os = "macos")]
pub fn clear_recent(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let _ = app.run_on_main_thread(|| {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSDocumentController;
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // SAFETY: the sender is optional and unused.
        unsafe { NSDocumentController::sharedDocumentController(mtm).clearRecentDocuments(None) };
    });
}

/// Empties the app's jump list (the system-wide recent items stay: they are not the app's).
#[cfg(windows)]
pub fn clear_recent(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let _ = app.run_on_main_thread(|| {
        use ::windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
        use ::windows::Win32::UI::Shell::{ApplicationDestinations, IApplicationDestinations};
        // SAFETY: COM is initialized on the main thread by the window library; the object is
        // released when it goes out of scope.
        unsafe {
            if let Ok(destinations) = CoCreateInstance::<_, IApplicationDestinations>(
                &ApplicationDestinations,
                None,
                CLSCTX_INPROC_SERVER,
            ) {
                let _ = destinations.RemoveAllDestinations();
            }
        }
    });
}

/// Removes the recent files only Writedown has used from GTK's list (a file another app opened
/// too stays: it is that app's as well).
#[cfg(not(any(target_os = "macos", windows)))]
pub fn clear_recent(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if !system_recents_enabled(
        app.state::<crate::launch::LaunchState>()
            .config_dir
            .is_some(),
    ) {
        return;
    }
    let _ = app.run_on_main_thread(|| {
        use gtk::prelude::RecentManagerExt;
        let Some(manager) = gtk::RecentManager::default() else {
            return;
        };
        // GTK records an item under the program name it runs as.
        let Some(own) = gtk::glib::prgname() else {
            return;
        };
        for info in manager.items() {
            let applications = info.applications();
            if applications.len() == 1
                && applications[0] == own
                && let Some(uri) = info.uri()
            {
                let _ = manager.remove_item(&uri);
            }
        }
    });
}

/// The uniform type identifier of Markdown documents (the Info.plist type in `tauri.conf.json`).
pub const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

/// What Preferences shows for the default Markdown app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultMarkdownApp {
    /// Whether the default app is this one.
    pub is_writedown: bool,
    /// The default app's name without `.app`, or null when macOS names none.
    pub app_name: Option<String>,
}

/// The `.app` folder that holds the running executable, or `None` when the app runs from a plain
/// build folder (such runs cannot be the default app).
pub fn bundle_root(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

/// Whether `default_app` (an application bundle) is the bundle that runs `exe`.
pub fn is_writedown(default_app: &Path, exe: &Path) -> bool {
    let Some(root) = bundle_root(exe) else {
        return false;
    };
    match (default_app.canonicalize(), root.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => default_app == root,
    }
}

/// The name shown for an application bundle: its file name without `.app`.
pub fn app_name(default_app: &Path) -> Option<String> {
    default_app
        .file_stem()
        .map(|name| name.to_string_lossy().into_owned())
}

/// Reads the current default app for Markdown. Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn read_default_markdown_app() -> DefaultMarkdownApp {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    let none = DefaultMarkdownApp {
        is_writedown: false,
        app_name: None,
    };
    let (Some(ut_class), Some(exe)) = (AnyClass::get(c"UTType"), std::env::current_exe().ok())
    else {
        return none;
    };
    let identifier = NSString::from_str(MARKDOWN_UTI);
    // SAFETY: `UTType` answers `typeWithIdentifier:` with an object or nil.
    let content_type: Option<Retained<AnyObject>> =
        unsafe { msg_send![ut_class, typeWithIdentifier: &*identifier] };
    let Some(content_type) = content_type else {
        return none;
    };
    let workspace = NSWorkspace::sharedWorkspace();
    // SAFETY: the content type is a `UTType`; the answer is an application URL or nil.
    let url: Option<Retained<NSURL>> =
        unsafe { msg_send![&*workspace, URLForApplicationToOpenContentType: &*content_type] };
    let Some(path) = url.and_then(|url| url.path()) else {
        return none;
    };
    let app = PathBuf::from(path.to_string());
    DefaultMarkdownApp {
        is_writedown: is_writedown(&app, &exe),
        app_name: app_name(&app),
    }
}

/// Reads the program Windows opens `.md` files with.
#[cfg(windows)]
pub fn read_default_markdown_app() -> DefaultMarkdownApp {
    use ::windows::Win32::UI::Shell::{
        ASSOCF_NONE, ASSOCSTR, ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME, AssocQueryStringW,
    };
    use ::windows::core::{PWSTR, w};
    let query = |kind: ASSOCSTR| -> Option<String> {
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        // SAFETY: the buffer holds `length` wide characters; the extension and verb are constant
        // NUL-terminated strings.
        unsafe {
            AssocQueryStringW(
                ASSOCF_NONE,
                kind,
                w!(".md"),
                w!("open"),
                Some(PWSTR(buffer.as_mut_ptr())),
                &mut length,
            )
        }
        .ok()
        .ok()?;
        let end = buffer.iter().position(|&unit| unit == 0).unwrap_or(0);
        (end > 0).then(|| String::from_utf16_lossy(&buffer[..end]))
    };
    let exe = query(ASSOCSTR_EXECUTABLE).map(PathBuf::from);
    let is_writedown = match (exe, std::env::current_exe()) {
        (Some(default), Ok(own)) => match (
            crate::fs_util::canonicalize(&default),
            crate::fs_util::canonicalize(&own),
        ) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        },
        _ => false,
    };
    DefaultMarkdownApp {
        is_writedown,
        app_name: query(ASSOCSTR_FRIENDLYAPPNAME).filter(|name| !name.is_empty()),
    }
}

/// Reads the app GIO opens Markdown with (the freedesktop.org `mimeapps.list` rules, as file
/// managers apply them).
#[cfg(not(any(target_os = "macos", windows)))]
pub fn read_default_markdown_app() -> DefaultMarkdownApp {
    use gtk::gio::prelude::AppInfoExt;
    let Some(default) = gtk::gio::AppInfo::default_for_type(MARKDOWN_TYPES[0], false) else {
        return DefaultMarkdownApp {
            is_writedown: false,
            app_name: None,
        };
    };
    let own = own_app_info().and_then(|own| own.id());
    DefaultMarkdownApp {
        is_writedown: own.is_some() && default.id() == own,
        app_name: Some(default.display_name().to_string()),
    }
}

/// Sets Writedown as the default app for Markdown. Must run on the main thread. macOS shows its
/// own confirmation; `done` receives the outcome when the system calls back.
#[cfg(target_os = "macos")]
pub fn set_default_markdown_app(done: std::sync::mpsc::Sender<Result<(), &'static str>>) {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    let failed = "macOS did not change the default app.";
    let Some(bundle) = std::env::current_exe()
        .ok()
        .and_then(|exe| bundle_root(&exe))
    else {
        let _ = done.send(Err(
            "Writedown must run from its app bundle to be made the default.",
        ));
        return;
    };
    let Some(ut_class) = AnyClass::get(c"UTType") else {
        let _ = done.send(Err(failed));
        return;
    };
    let identifier = NSString::from_str(MARKDOWN_UTI);
    // SAFETY: as in `read_default_markdown_app`.
    let content_type: Option<Retained<AnyObject>> =
        unsafe { msg_send![ut_class, typeWithIdentifier: &*identifier] };
    let (Some(content_type), Some(path)) = (content_type, bundle.to_str().map(NSString::from_str))
    else {
        let _ = done.send(Err(failed));
        return;
    };
    let app_url = NSURL::fileURLWithPath(&path);
    let handler = block2::RcBlock::new(move |error: *mut AnyObject| {
        let _ = done.send(if error.is_null() { Ok(()) } else { Err(failed) });
    });
    let workspace = NSWorkspace::sharedWorkspace();
    // SAFETY: the arguments are an application URL, a `UTType` and a completion block that
    // matches the Objective-C signature (`NSError *` or nil).
    unsafe {
        let _: () = msg_send![
            &*workspace,
            setDefaultApplicationAtURL: &*app_url,
            toOpenContentType: &*content_type,
            completionHandler: &*handler
        ];
    }
}

/// Shows the system's "Open with" chooser for Markdown files, where the user picks Writedown and
/// "Always use this app" (Windows does not let an app make itself the default). Must run on the
/// main thread; the chooser is modal.
#[cfg(windows)]
pub fn set_default_markdown_app(done: std::sync::mpsc::Sender<Result<(), &'static str>>) {
    use ::windows::Win32::UI::Shell::{
        OAIF_ALLOW_REGISTRATION, OAIF_FORCE_REGISTRATION, OAIF_REGISTER_EXT, OPENASINFO,
        SHOpenWithDialog,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    use ::windows::core::w;
    let info = OPENASINFO {
        // The chooser only looks at the extension of the name.
        pcszFile: w!("document.md"),
        pcszClass: ::windows::core::PCWSTR::null(),
        oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT | OAIF_FORCE_REGISTRATION,
    };
    // SAFETY: `info` and its constant strings live through the modal call; the owner is the
    // window in front (Preferences, where the button was pressed).
    let result = unsafe { SHOpenWithDialog(Some(GetForegroundWindow()), &info) };
    let _ = done.send(result.map_err(|_| "Windows did not change the default app."));
}

/// Makes Writedown's desktop entry the default for the Markdown types (Linux asks for no
/// confirmation). GIO writes the choice to the user's `mimeapps.list`.
#[cfg(not(any(target_os = "macos", windows)))]
pub fn set_default_markdown_app(done: std::sync::mpsc::Sender<Result<(), &'static str>>) {
    use gtk::gio::prelude::AppInfoExt;
    let Some(own) = own_app_info() else {
        let _ = done.send(Err(
            "Writedown has no desktop entry on this system. Install the .deb package to make it the default app.",
        ));
        return;
    };
    let set = MARKDOWN_TYPES
        .iter()
        .all(|kind| own.set_as_default_for_type(kind).is_ok());
    let _ = done.send(if set {
        Ok(())
    } else {
        Err("The default app could not be changed.")
    });
}

/// The MIME types of Markdown documents (the second is the older name some systems still use).
#[cfg(not(any(target_os = "macos", windows)))]
const MARKDOWN_TYPES: [&str; 2] = ["text/markdown", "text/x-markdown"];

/// Writedown's own desktop entry, if one is installed: the one whose `Exec` starts this executable
/// (the .deb package), or the AppImage it runs from (an AppImage added to the app menu by an
/// integration tool).
#[cfg(not(any(target_os = "macos", windows)))]
fn own_app_info() -> Option<gtk::gio::AppInfo> {
    use gtk::gio::prelude::AppInfoExt;
    let mut programs: Vec<PathBuf> = std::env::current_exe().ok().into_iter().collect();
    if let Some(image) = std::env::var_os("APPIMAGE") {
        programs.push(PathBuf::from(image));
    }
    gtk::gio::AppInfo::all().into_iter().find(|info| {
        info.commandline()
            .is_some_and(|line| exec_starts(&line.to_string_lossy(), &programs))
    })
}

/// Whether the `Exec` line of a desktop entry starts one of `programs`: its first word (quotes
/// removed) is one of their paths, or, when it is a bare name, one of their file names.
#[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
pub fn exec_starts(exec: &str, programs: &[PathBuf]) -> bool {
    let exec = exec.trim_start();
    let first = match exec.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or_default(),
        None => exec.split_whitespace().next().unwrap_or_default(),
    };
    if first.is_empty() {
        return false;
    }
    let first = Path::new(first);
    if first.is_absolute() {
        programs.iter().any(|program| program == first)
    } else {
        first.components().count() == 1
            && programs
                .iter()
                .any(|program| program.file_name() == Some(first.as_os_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_exec_line_is_matched_by_path_or_by_bare_name() {
        let programs = [
            PathBuf::from("/usr/bin/writedown"),
            PathBuf::from("/home/me/Apps/Writedown.AppImage"),
        ];
        assert!(exec_starts("writedown %F", &programs));
        assert!(exec_starts("/usr/bin/writedown %F", &programs));
        assert!(exec_starts(
            "\"/home/me/Apps/Writedown.AppImage\" %U",
            &programs
        ));
        assert!(!exec_starts("/opt/writedown %F", &programs));
        assert!(!exec_starts("bin/writedown", &programs));
        assert!(!exec_starts("gedit %U", &programs));
        assert!(!exec_starts("", &programs));
    }

    #[test]
    fn the_windows_title_marks_an_unsaved_document_with_a_star() {
        assert_eq!(marked_title("notes.md", true), "*notes.md");
        assert_eq!(marked_title("notes.md", false), "notes.md");
    }

    #[test]
    fn system_recents_are_skipped_when_the_config_folder_is_overridden() {
        assert!(
            system_recents_enabled(false),
            "the app's own folders: noted"
        );
        assert!(
            !system_recents_enabled(true),
            "WRITEDOWN_CONFIG_DIR: skipped"
        );
    }

    #[test]
    fn only_existing_absolute_files_are_noted() {
        let dir = crate::test_support::TempDir::new();
        let file = dir.write("a.md", b"x");
        assert_eq!(recent_target(&file), Some(file.clone()));
        assert_eq!(recent_target(&dir.path().join("gone.md")), None);
        assert_eq!(
            recent_target(dir.path()),
            None,
            "a folder is not a document"
        );
        assert_eq!(recent_target(Path::new("relative.md")), None);
    }

    #[test]
    fn the_default_app_is_writedown_only_when_it_is_our_bundle() {
        let dir = crate::test_support::TempDir::new();
        let bundle = dir.path().join("Writedown.app");
        let exe = bundle.join("Contents/MacOS/writedown");
        assert_eq!(bundle_root(&exe), Some(bundle.clone()));
        assert!(is_writedown(&bundle, &exe));
        assert!(!is_writedown(&dir.path().join("Other.app"), &exe));
        assert!(
            !is_writedown(&bundle, Path::new("/tmp/target/debug/writedown")),
            "a plain build folder is not the bundle"
        );
        assert_eq!(bundle_root(Path::new("/tmp/target/debug/writedown")), None);
    }

    #[test]
    fn the_app_name_drops_the_app_suffix() {
        assert_eq!(
            app_name(Path::new("/Applications/Typora.app")),
            Some("Typora".to_string())
        );
        assert_eq!(app_name(Path::new("/")), None);
    }

    #[test]
    fn the_markdown_type_is_declared_as_an_editor_in_the_bundle() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let associations = config["bundle"]["fileAssociations"]
            .as_array()
            .expect("file associations");
        let declared = associations.iter().any(|entry| {
            entry["role"] == "Editor"
                && entry["contentTypes"]
                    .as_array()
                    .is_some_and(|types| types.iter().any(|t| t == MARKDOWN_UTI))
        });
        assert!(declared, "the Markdown type with role Editor");
    }

    #[test]
    fn the_default_app_serializes_in_camel_case() {
        let value = serde_json::to_value(DefaultMarkdownApp {
            is_writedown: true,
            app_name: Some("Writedown".into()),
        })
        .expect("json");
        assert_eq!(value["isWritedown"], true);
        assert_eq!(value["appName"], "Writedown");
    }
}
