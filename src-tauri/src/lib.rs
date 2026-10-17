pub mod assets;
pub mod bridge;
pub mod clipboard;
pub mod commands;
pub mod context;
pub mod dialogs;
pub mod doc_state;
pub mod documents;
pub mod encoding;
pub mod error;
pub mod exports;
pub mod file_ops;
pub mod file_types;
pub mod folders;
pub mod fs_util;
pub mod grants;
pub mod launch;
pub mod lifecycle;
pub mod line_endings;
pub mod linked_text;
pub mod links;
pub mod menu;
pub mod menu_spec;
pub mod native_doc;
pub mod open_files;
pub mod os_text;
pub mod pandoc;
pub mod pasted_images;
pub mod pdf;
pub mod pending;
pub mod perf;
pub mod recents;
pub mod recovery;
pub mod render;
pub mod safe_save;
pub mod search;
pub mod session;
pub mod settings;
pub mod snippets;
pub mod store;
pub mod stores;
pub mod terminate;
pub mod text_file;
pub mod trace;
pub mod tracked;
pub mod vault;
pub mod vibrancy;
pub mod watcher;
pub mod windows;

use dialogs::DialogGuard;
use exports::ExportTargets;
use grants::PathGrants;
use launch::{LaunchConfig, LaunchState};
use lifecycle::{AppCloseProtocol, AppHost, CloseProtocol, Lifecycle};
use pending::Pages;
use search::SearchRegistry;
use std::path::Path;
use std::sync::Arc;
use stores::Stores;
use tauri::Manager;
use trace::Trace;
use tracked::TrackedFiles;
use watcher::WatchService;

#[cfg(test)]
pub(crate) mod test_support;

/// Resolves and allows the file given with `--open`. A path that cannot be used is reported on
/// stderr and the app starts without it.
fn allow_open_argument(grants: &PathGrants, config: &LaunchConfig) -> Option<String> {
    if config.welcome {
        return None;
    }
    let requested = config.open.as_deref()?;
    match grants.grant(Path::new(requested)) {
        Ok(path) => Some(fs_util::path_text(&path)),
        Err(message) => {
            eprintln!("--open {requested}: {message}");
            None
        }
    }
}

/// Resolves and allows the folder given with `--folder`, with everything below it. A path that
/// cannot be used is reported on stderr and the app starts without it.
fn allow_folder_argument(
    grants: &PathGrants,
    config: &LaunchConfig,
    trace: &Trace,
) -> Option<String> {
    if config.welcome {
        return None;
    }
    let requested = config.folder.as_deref()?;
    match grants.grant_folder(Path::new(requested)) {
        Ok(path) => {
            let path = fs_util::path_text(&path);
            trace.event(
                "folder-opened",
                serde_json::json!({ "path": path, "source": "launch" }),
            );
            Some(path)
        }
        Err(error) => {
            eprintln!("--folder {requested}: {}", error.message);
            None
        }
    }
}

/// Windows: the documents File Explorer passed as plain arguments (relative ones are taken from
/// `cwd`), opened like files from Finder. Used for this launch and for the arguments a second
/// launch hands over.
#[cfg(windows)]
fn open_argument_files(app: &tauri::AppHandle, files: &[String], cwd: &Path) {
    let paths: Vec<std::path::PathBuf> = files.iter().map(|file| cwd.join(file)).collect();
    let accepted = open_files::accept_paths(&app.state::<PathGrants>(), &paths);
    if !accepted.is_empty() {
        open_files::deliver(app, accepted);
    }
}

pub fn run() {
    // First thing: the clock that WRITEDOWN_PERF marks are measured against.
    perf::start_clock();

    let config = LaunchConfig::from_process();
    let grants = PathGrants::default();
    let open_path = allow_open_argument(&grants, &config);
    let trace = Trace::new(config.trace);
    let folder_path = allow_folder_argument(&grants, &config, &trace);
    let state = LaunchState::new(&config, open_path).with_folder(folder_path);

    let builder = tauri::Builder::default();
    // Windows starts a new process for every document opened from File Explorer; the plugin hands
    // its arguments to the running app and the new process ends. macOS sends `Opened` instead.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let config = LaunchConfig::parse(args.into_iter().skip(1), |_| None);
        if config.files.is_empty() {
            lifecycle::reopen(app);
        } else {
            open_argument_files(app, &config.files, Path::new(&cwd));
        }
    }));
    #[cfg(windows)]
    let files = config.files.clone();
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .manage(grants)
        .manage(state)
        .manage(trace)
        .manage(TrackedFiles::default())
        .manage(pasted_images::DroppedImages::default())
        .manage(Pages::default())
        .manage(DialogGuard::default())
        .manage(ExportTargets::default())
        .manage(Lifecycle::default())
        .manage(windows::DocWindows::default())
        .manage(WatchService::default())
        .manage(SearchRegistry::default())
        .on_menu_event(menu::handle_event)
        .on_window_event(lifecycle::on_window_event)
        .on_page_load(lifecycle::on_page_load)
        .setup(move |app| {
            let handle = app.handle();
            // Everything that needs the app's folders or its windows is created here.
            let stores = Stores::open(handle);
            let recents = stores.recent_entries();
            // The folder and files of the last session are allowed again, unless the app was
            // started with --open, --folder or --welcome or the setting is off.
            if app.state::<LaunchState>().options.restore_session
                && stores.settings().restore_session
                && let Some(session) = stores.load_session()
            {
                session.regrant(&app.state::<PathGrants>());
            }
            // The files of documents kept by crash recovery are allowed again, so a recovered
            // document can be saved (a cheap folder check when there is nothing to recover).
            for path in stores.recovery().paths() {
                let path = std::path::Path::new(&path);
                if let Ok(canonical) = crate::fs_util::canonicalize(path)
                    && canonical == path
                    && canonical.is_file()
                {
                    let _ = app.state::<PathGrants>().grant(&canonical);
                }
            }
            app.manage(stores);
            for (_, window) in handle.webview_windows() {
                vibrancy::apply(handle, &window);
            }
            let protocol: AppCloseProtocol = CloseProtocol::new(Arc::new(AppHost::new(handle)));
            app.manage(protocol);
            // The PDF benchmark (`WRITEDOWN_BENCH=pdf`): its one path is an export target.
            if let Some(path) = app.state::<LaunchState>().options.bench_pdf.clone() {
                app.state::<ExportTargets>()
                    .allow(std::path::Path::new(&path));
            }

            let (menu, handles) = menu::build(handle, &recents)?;
            handles.set_shortcuts(
                handle,
                &handle.state::<stores::Stores>().settings().shortcuts,
            );
            app.manage(handles);
            app.set_menu(menu)?;
            let main_exists = handle.get_webview_window(windows::MAIN_LABEL).is_some();
            handle
                .state::<menu::MenuHandles>()
                .set_window_open(handle, main_exists);

            windows::paint_main_background(handle)?;
            if let Some(window) = handle.get_webview_window(windows::MAIN_LABEL)
                && let Ok(theme) = window.theme()
            {
                handle.state::<Lifecycle>().set_theme(theme);
            }
            if app.state::<LaunchState>().prefs {
                windows::open_preferences(handle)?;
            }
            handle.state::<Lifecycle>().mark_setup_done();
            #[cfg(windows)]
            if let Ok(cwd) = std::env::current_dir() {
                open_argument_files(handle, &files, &cwd);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::app_version,
            commands::launch_options,
            commands::pick_file,
            commands::read_text_file,
            commands::perf_mark,
            commands::bench_report,
            commands::bench_search_report,
            bridge::open_dialog,
            bridge::save_dialog,
            bridge::read_document,
            bridge::save_document,
            bridge::document_context,
            bridge::reveal_in_finder,
            bridge::open_external,
            bridge::open_linked_document,
            bridge::reveal_linked_file,
            bridge::resolve_image,
            bridge::recent_documents,
            bridge::open_recent,
            bridge::remove_recent,
            bridge::clear_recents,
            bridge::get_settings,
            bridge::get_snippets,
            bridge::set_snippets,
            bridge::update_settings,
            bridge::get_doc_state,
            bridge::set_doc_state,
            bridge::take_pending_open_files,
            bridge::confirm_unsaved,
            bridge::ask,
            bridge::update_menu_state,
            bridge::set_window_title,
            bridge::set_document_edited,
            bridge::open_preferences,
            bridge::ack_close,
            bridge::finish_close,
            bridge::cancel_close,
            bridge::menu_ready,
            bridge::read_linked_text,
            bridge::vault_index,
            bridge::quarto_project,
            bridge::folder_dialog,
            bridge::list_folder,
            bridge::file_index,
            bridge::create_file,
            bridge::create_folder,
            bridge::rename_path,
            bridge::move_path,
            bridge::duplicate_path,
            bridge::trash_path,
            bridge::write_clipboard,
            bridge::read_clipboard_text,
            bridge::print_page,
            bridge::write_export,
            bridge::pandoc_info,
            bridge::default_markdown_app,
            bridge::make_default_markdown_app,
            bridge::choose_pandoc,
            bridge::choose_default_folder,
            bridge::export_docx,
            bridge::pandoc_preview,
            bridge::cancel_pandoc_preview,
            bridge::export_pdf,
            bridge::render_with_quarto,
            bridge::read_image_bytes,
            bridge::save_pasted_image,
            bridge::import_dropped_image,
            bridge::get_session,
            bridge::set_session,
            bridge::recovery_write,
            bridge::recovery_remove,
            bridge::recovery_list,
            bridge::move_tab,
            bridge::take_transfer,
            bridge::set_window_documents,
            bridge::focus_open_document,
            bridge::restore_windows,
            bridge::watch,
            bridge::search_folder,
            bridge::cancel_search
        ])
        .build(tauri::generate_context!())
        .expect("error while building Writedown");

    app.run(lifecycle::on_run_event);
}
