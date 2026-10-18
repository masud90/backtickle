//! The Phase 1 commands the web view can call. Each one is a thin wrapper around the
//! plain functions of the other modules; the logic and its tests are there.
//!
//! The TypeScript side of every command is in `src/lib/platform.ts` and nowhere else. Every
//! command is also listed in `build.rs` and granted to the main window in
//! `capabilities/main.json`.
//!
//! Rules every command follows:
//! - The web view never supplies a path that Rust trusts. A path is accepted only if it was
//!   granted (`grants.rs`): by a dialog, the command line, Finder, drag and drop, the recents
//!   list, or a link or image of a document that is itself granted.
//! - A failure is a `PlatformError` with a code and a plain message.
//! - File and dialog work runs on a blocking thread, never on the main thread.

use crate::assets;
use crate::clipboard;
use crate::context::{self, DocumentContext};
use crate::dialogs::{self, DialogGuard, FolderPurpose, SaveKind, UnsavedChoice};
use crate::doc_state::DocState;
use crate::documents::{self, DocumentFile};
use crate::error::{PlatformError, PlatformResult};
use crate::exports::ExportTargets;
use crate::file_ops::{self, SystemTrash};
use crate::folders::{self, FileIndex, FolderListing};
use crate::grants::PathGrants;
use crate::lifecycle::{AppCloseProtocol, CloseReason};
use crate::linked_text::{self, LinkedText, Purpose};
use crate::links;
use crate::menu::{self, EDIT_COMMAND_EVENT, MENU_ACTION_EVENT};
use crate::menu_spec::{MenuState, REDO_ID, UNDO_ID};
use crate::open_files;
use crate::pasted_images;
use crate::pending::Pages;
use crate::recents::RecentEntry;
use crate::safe_save::{self, SaveFormat, SaveOptions, SaveResult};
use crate::search::{self, SearchRegistry, SearchRequest, SearchResult};
use crate::session::{Session, SessionBounds};
use crate::settings::Settings;
use crate::snippets;
use crate::stores::{self, Stores};
use crate::trace::Trace;
use crate::tracked::TrackedFiles;
use crate::vault::{self, VaultIndex};
use crate::watcher::{self, FileChange, WatchRequest, WatchService};
use crate::windows::{self, DocWindows, open_preferences as show_preferences};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

/// Runs `task` on a blocking thread. An interrupted task is an `io` error.
async fn blocking<T, F>(task: F) -> PlatformResult<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| PlatformError::io("The operation was interrupted. Please try again."))
}

fn as_text(path: &Path) -> String {
    crate::fs_util::path_text(path)
}

/// Grants a file the user chose in a dialog: it must exist and be a file.
fn grant_chosen(grants: &PathGrants, path: &Path) -> PlatformResult<PathBuf> {
    let canonical = crate::fs_util::canonicalize(path).map_err(|e| PlatformError::from_read(&e))?;
    if !canonical.is_file() {
        return Err(PlatformError::io("The chosen item is not a file."));
    }
    grants.grant_resolved(&canonical);
    Ok(canonical)
}

fn reveal(path: &Path) -> PlatformResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path)
        .map_err(|_| PlatformError::io("Finder could not show this file."))
}

// ---- dialogs ---------------------------------------------------------------------------------

/// The open sheet. Resolves to the granted (canonical) paths, or `[]` if the user cancelled.
#[tauri::command]
pub async fn open_dialog(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
    guard: State<'_, DialogGuard>,
    multiple: bool,
) -> PlatformResult<Vec<String>> {
    let Some(_permit) = guard.try_acquire() else {
        return Ok(Vec::new()); // a dialog is already open
    };
    let picked = blocking(move || dialogs::pick_files(&app, &window, multiple)).await?;
    let mut granted = Vec::new();
    let mut first_error = None;
    for path in &picked {
        match grant_chosen(&grants, path) {
            Ok(canonical) => granted.push(as_text(&canonical)),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    match (granted.is_empty(), first_error) {
        (true, Some(error)) => Err(error),
        _ => Ok(granted),
    }
}

/// The save sheet. For a document it resolves to the granted path (the file may not exist
/// yet), or null. For an export (`kind` `html` or `docx`) the path is not granted as a document:
/// it is only remembered for `write_export` and the Pandoc export.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_dialog(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
    exports: State<'_, ExportTargets>,
    guard: State<'_, DialogGuard>,
    suggested_name: String,
    directory: Option<String>,
    kind: Option<SaveKind>,
) -> PlatformResult<Option<String>> {
    let Some(_permit) = guard.try_acquire() else {
        return Ok(None);
    };
    let kind = kind.unwrap_or_default();
    // The folder only decides where the sheet starts; no path is granted for it.
    let directory = directory.map(PathBuf::from);
    let chosen = blocking(move || {
        dialogs::pick_save_path(&app, &window, &suggested_name, directory.as_deref(), kind)
    })
    .await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    let path = dialogs::with_export_extension(path, kind);
    if kind == SaveKind::Document {
        return Ok(Some(as_text(&grants.grant_new(&path)?)));
    }
    let resolved = grants.resolve_new(&path)?;
    exports.allow(&resolved);
    Ok(Some(as_text(&resolved)))
}

/// The folder sheet of Open Folder and Move To. Resolves to the chosen folder, which is now
/// granted with everything below it, or null if the user cancelled.
#[tauri::command]
pub async fn folder_dialog(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
    guard: State<'_, DialogGuard>,
    purpose: FolderPurpose,
) -> PlatformResult<Option<String>> {
    let Some(_permit) = guard.try_acquire() else {
        return Ok(None);
    };
    let handle = app.clone();
    let chosen = blocking(move || dialogs::pick_folder(&handle, &window, purpose)).await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    let canonical = grants.grant_folder(&path)?;
    if purpose == FolderPurpose::Open {
        app.state::<Trace>().event(
            "folder-opened",
            json!({ "path": as_text(&canonical), "source": "dialog" }),
        );
    }
    Ok(Some(as_text(&canonical)))
}

/// "Choose Pandoc" in Preferences: a file sheet; a file named `pandoc` that runs `--version`
/// (through `pandoc.rs`) is stored in `export.pandocPath` and broadcast as a settings change.
/// Resolves to the stored path, or null if the user cancelled.
#[tauri::command]
pub async fn choose_pandoc(
    app: AppHandle,
    window: WebviewWindow,
    guard: State<'_, DialogGuard>,
) -> PlatformResult<Option<String>> {
    let Some(_permit) = guard.try_acquire() else {
        return Ok(None);
    };
    let handle = app.clone();
    let chosen = blocking(move || dialogs::pick_pandoc(&handle, &window)).await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    let probed = path.clone();
    let works = blocking(move || {
        dialogs::is_pandoc_name(&probed) && crate::pandoc::probe(&probed).is_some()
    })
    .await?;
    if !works {
        return Err(PlatformError::io(
            "That file is not Pandoc. Choose the file named pandoc.",
        ));
    }
    let text = as_text(&path);
    stores::update_settings(&app, &json!({ "export": { "pandocPath": text } }))?;
    Ok(Some(text))
}

/// "Choose Default Folder" in Preferences: a folder sheet; the folder is stored in
/// `saving.defaultFolder`. It only decides where the Save dialog starts and grants no access.
#[tauri::command]
pub async fn choose_default_folder(
    app: AppHandle,
    window: WebviewWindow,
    guard: State<'_, DialogGuard>,
) -> PlatformResult<Option<String>> {
    let Some(_permit) = guard.try_acquire() else {
        return Ok(None);
    };
    let handle = app.clone();
    let chosen = blocking(move || dialogs::pick_default_folder(&handle, &window)).await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    let text = as_text(&path);
    stores::update_settings(&app, &json!({ "saving": { "defaultFolder": text } }))?;
    Ok(Some(text))
}

/// The three-button sheet for a document with unsaved changes.
#[tauri::command]
pub async fn confirm_unsaved(
    app: AppHandle,
    window: WebviewWindow,
    name: String,
) -> PlatformResult<UnsavedChoice> {
    blocking(move || dialogs::confirm_unsaved(&app, &window, &name)).await
}

/// A two-button sheet with the page's labels. True if the first button was pressed.
#[tauri::command]
pub async fn ask(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    message: String,
    ok: String,
    cancel: String,
) -> PlatformResult<bool> {
    blocking(move || dialogs::ask(&app, &window, &title, &message, &ok, &cancel)).await
}

// ---- documents -------------------------------------------------------------------------------

/// Reads a granted file and adds it to the recents.
#[tauri::command]
pub async fn read_document(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    tracked: State<'_, TrackedFiles>,
    path: String,
) -> PlatformResult<DocumentFile> {
    let canonical = grants.check_document(Path::new(&path))?;
    let target = canonical.clone();
    let read = blocking(move || documents::read_document(&target)).await??;
    tracked.record_read(&canonical, read.stamp, read.document.lossy);
    stores::record_open(&app, &canonical);
    Ok(read.document)
}

/// The safe save. A new file must have been granted by the save dialog.
#[tauri::command]
pub async fn save_document(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    tracked: State<'_, TrackedFiles>,
    path: String,
    text: String,
    format: SaveFormat,
    options: SaveOptions,
) -> PlatformResult<SaveResult> {
    let target = grants.check_for_save(Path::new(&path))?;
    let known = tracked.get(&target);
    let to_write = target.clone();
    let saved =
        blocking(move || safe_save::save(&to_write, &text, format, &options, known)).await??;
    let written = PathBuf::from(&saved.result.path);
    grants.grant_resolved(&written);
    tracked.record_saved(&written, saved.stamp);
    stores::record_open(&app, &written);
    app.state::<Trace>().event(
        "save",
        json!({
            "path": saved.result.path,
            "bytes": saved.result.bytes,
            "encoding": format.encoding,
            "lineEnding": format.line_ending,
        }),
    );
    Ok(saved.result)
}

#[tauri::command]
pub async fn document_context(
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    path: String,
) -> PlatformResult<DocumentContext> {
    let canonical = grants.check_document(Path::new(&path))?;
    Ok(context::document_context(&canonical, stores.home()))
}

#[tauri::command]
pub async fn reveal_in_finder(grants: State<'_, PathGrants>, path: String) -> PlatformResult<()> {
    let canonical = grants.check_document(Path::new(&path))?;
    blocking(move || reveal(&canonical)).await?
}

/// Opens an http, https or mailto link with the system. Any other URL is refused.
#[tauri::command]
pub async fn open_external(url: String) -> PlatformResult<()> {
    let parsed = links::external_url(&url)?;
    blocking(move || {
        tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>)
            .map_err(|_| PlatformError::io("Your web browser could not be opened."))
    })
    .await?
}

/// A link to a Markdown or text document: resolves it next to the granted document and grants
/// it. Resolves to the canonical path (the caller keeps the `#fragment`).
#[tauri::command]
pub async fn open_linked_document(
    grants: State<'_, PathGrants>,
    from_path: String,
    href: String,
) -> PlatformResult<String> {
    let from = grants.check_document(Path::new(&from_path))?;
    let target = links::resolve_document(&from, &href)?;
    grants.grant_resolved(&target);
    Ok(as_text(&target))
}

/// A link to any other existing local file or folder: shows it in Finder. It is not granted.
#[tauri::command]
pub async fn reveal_linked_file(
    grants: State<'_, PathGrants>,
    from_path: String,
    href: String,
) -> PlatformResult<()> {
    let from = grants.check_document(Path::new(&from_path))?;
    let target = links::resolve(&from, &href)?;
    blocking(move || reveal(&target)).await?
}

/// The URL of a local image of a granted document. Only that one file is made reachable.
#[tauri::command]
pub async fn resolve_image(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    doc_path: String,
    src: String,
) -> PlatformResult<String> {
    let from = grants.check_document(Path::new(&doc_path))?;
    let image = assets::resolve_image(&from, &src)?;
    app.asset_protocol_scope()
        .allow_file(&image)
        .map_err(|_| PlatformError::io("The image could not be shown."))?;
    Ok(assets::asset_url(&image))
}

/// The bytes of a local image of a granted document, for HTML export and Copy as HTML (they
/// embed it as a `data:` URI). Resolved like `resolve_image`; `TooLarge` over `max_bytes`.
#[tauri::command]
pub async fn read_image_bytes(
    grants: State<'_, PathGrants>,
    doc_path: String,
    src: String,
    max_bytes: u64,
) -> PlatformResult<tauri::ipc::Response> {
    let from = grants.check_document(Path::new(&doc_path))?;
    let bytes = blocking(move || assets::read_image_bytes(&from, &src, max_bytes)).await??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A pasted image: the bytes are the raw body of the call, the document path (`x-doc-path`) and
/// a name for the file (`x-image-name`) are percent-encoded headers. The image is written into
/// the `assets` folder next to the granted document; the answer is the Markdown `src`.
#[tauri::command]
pub async fn save_pasted_image(
    grants: State<'_, PathGrants>,
    request: tauri::ipc::Request<'_>,
) -> PlatformResult<String> {
    let header = |name: &str| -> PlatformResult<String> {
        let value = request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| PlatformError::io("The pasted image came without its document."))?;
        percent_encoding::percent_decode_str(value)
            .decode_utf8()
            .map(|text| text.into_owned())
            .map_err(|_| PlatformError::io("The pasted image came without its document."))
    };
    let doc_path = header("x-doc-path")?;
    let name = header("x-image-name").unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(PlatformError::io(
            "The pasted image came without its bytes.",
        ));
    };
    let doc = grants.check_for_save(Path::new(&doc_path))?;
    let bytes = bytes.clone();
    blocking(move || pasted_images::save_pasted(&doc, &bytes, &name)).await?
}

/// An image dropped on the window (remembered by the drop, see `pasted_images.rs`): linked
/// where it is when it is in the document's folder, copied into `assets` otherwise.
#[tauri::command]
pub async fn import_dropped_image(
    grants: State<'_, PathGrants>,
    dropped: State<'_, pasted_images::DroppedImages>,
    doc_path: String,
    source: String,
) -> PlatformResult<String> {
    let doc = grants.check_for_save(Path::new(&doc_path))?;
    let source = dropped.check(Path::new(&source))?;
    blocking(move || pasted_images::import_dropped(&doc, &source)).await?
}

/// The text of a bibliography, an included file or an embedded note that a granted document
/// refers to. The file gets a read-only grant (only further linked reads may start from it) and
/// does not enter the recents.
#[tauri::command]
pub async fn read_linked_text(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    from_path: String,
    href: String,
    purpose: Purpose,
) -> PlatformResult<LinkedText> {
    let from = grants.check_readable(Path::new(&from_path))?;
    let read = blocking(move || linked_text::read_linked_text(&from, &href, purpose)).await??;
    grants.grant_read_only(Path::new(&read.path));
    app.state::<Trace>().event(
        "linked-text",
        json!({
            "purpose": purpose.name(),
            "path": read.path,
            "bytes": read.text.len(),
        }),
    );
    Ok(read)
}

/// The notes and attachments of the Obsidian vault that holds a granted document, or null.
#[tauri::command]
pub async fn vault_index(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    doc_path: String,
) -> PlatformResult<Option<VaultIndex>> {
    let doc = grants.check_readable(Path::new(&doc_path))?;
    let index = blocking(move || vault::vault_index(&doc)).await?;
    if let Some(index) = &index {
        app.state::<Trace>().event(
            "vault-index",
            json!({
                "root": index.root,
                "notes": index.notes.len(),
                "attachments": index.attachments.len(),
                "truncated": index.truncated,
            }),
        );
    }
    Ok(index)
}

/// The `_quarto.yml` that applies to a granted document, or null.
#[tauri::command]
pub async fn quarto_project(
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    doc_path: String,
) -> PlatformResult<Option<LinkedText>> {
    let doc = grants.check_readable(Path::new(&doc_path))?;
    let home = stores.home().map(Path::to_path_buf);
    blocking(move || linked_text::quarto_project(&doc, home.as_deref())).await?
}

// ---- recents, settings, document state ----------------------------------------------------------

#[tauri::command]
pub async fn recent_documents(app: AppHandle) -> PlatformResult<Vec<RecentEntry>> {
    blocking(move || app.state::<Stores>().recent_entries()).await
}

/// Grants a path from the recents list. A path that is not in the list is refused.
#[tauri::command]
pub async fn open_recent(
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    path: String,
) -> PlatformResult<String> {
    if !stores.recents().contains(&path) {
        return Err(PlatformError::not_allowed());
    }
    let canonical =
        crate::fs_util::canonicalize(&path).map_err(|e| PlatformError::from_read(&e))?;
    if !canonical.is_file() {
        return Err(PlatformError::not_found());
    }
    grants.grant_resolved(&canonical);
    Ok(as_text(&canonical))
}

#[tauri::command]
pub async fn remove_recent(app: AppHandle, path: String) -> PlatformResult<()> {
    stores::remove_recent(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn clear_recents(app: AppHandle) -> PlatformResult<()> {
    stores::clear_recents(&app);
    Ok(())
}

/// The snippets (the starter set on first use). Re-read each time: several windows share the file.
#[tauri::command]
pub async fn get_snippets(stores: State<'_, Stores>) -> PlatformResult<Vec<snippets::Snippet>> {
    let file = stores.snippets_file().to_path_buf();
    blocking(move || snippets::load(&file)).await
}

/// Replaces the whole list (cleaned like a read) and resolves to what was stored.
#[tauri::command]
pub async fn set_snippets(
    stores: State<'_, Stores>,
    list: Vec<snippets::Snippet>,
) -> PlatformResult<Vec<snippets::Snippet>> {
    let file = stores.snippets_file().to_path_buf();
    blocking(move || {
        let clean = snippets::sanitize(&list);
        snippets::save(&file, &clean)
            .map(|()| clean)
            .map_err(|e| PlatformError::from_write(&e))
    })
    .await?
}

#[tauri::command]
pub async fn get_settings(stores: State<'_, Stores>) -> PlatformResult<Settings> {
    Ok(stores.settings())
}

/// Applies a deep partial update: values are clamped, wrong types ignored, unknown keys never
/// added. Resolves to the new settings.
#[tauri::command]
pub async fn update_settings(app: AppHandle, patch: Value) -> PlatformResult<Settings> {
    stores::update_settings(&app, &patch)
}

#[tauri::command]
pub async fn get_doc_state(
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    path: String,
) -> PlatformResult<DocState> {
    let key = as_text(&grants.check_document(Path::new(&path))?);
    let mut states = stores.doc_states();
    let (state, moved) = states.get(&key);
    if moved {
        let _ = states.save();
    }
    Ok(state)
}

#[tauri::command]
pub async fn set_doc_state(
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    path: String,
    patch: Value,
) -> PlatformResult<()> {
    let key = as_text(&grants.check_document(Path::new(&path))?);
    let mut states = stores.doc_states();
    if states.set(&key, &patch) {
        let _ = states.save();
    }
    Ok(())
}

// ---- folders and file operations (Phase 3) -------------------------------------------------------

fn file_op(app: &AppHandle, op: &str, from: Option<&Path>, to: Option<&Path>) {
    app.state::<Trace>().event(
        "file-op",
        json!({
            "op": op,
            "from": from.map(as_text),
            "to": to.map(as_text),
        }),
    );
}

/// One level of a granted folder: folders and Markdown-family files, hidden and ignored names
/// left out.
#[tauri::command]
pub async fn list_folder(app: AppHandle, path: String) -> PlatformResult<FolderListing> {
    let ignore = app.state::<Stores>().settings().files.ignore;
    let folder = PathBuf::from(path);
    blocking(move || folders::list_folder(&app.state::<PathGrants>(), &folder, &ignore)).await?
}

/// Every Markdown-family file below a granted folder, for Quick Open.
#[tauri::command]
pub async fn file_index(app: AppHandle, folder: String) -> PlatformResult<FileIndex> {
    let ignore = app.state::<Stores>().settings().files.ignore;
    let folder = PathBuf::from(folder);
    blocking(move || folders::file_index(&app.state::<PathGrants>(), &folder, &ignore)).await?
}

#[tauri::command]
pub async fn create_file(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    folder: String,
    name: String,
) -> PlatformResult<String> {
    let created = file_ops::create_file(&grants, Path::new(&folder), &name)?;
    file_op(&app, "create-file", None, Some(&created));
    Ok(as_text(&created))
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    folder: String,
    name: String,
) -> PlatformResult<String> {
    let created = file_ops::create_folder(&grants, Path::new(&folder), &name)?;
    file_op(&app, "create-folder", None, Some(&created));
    Ok(as_text(&created))
}

/// What follows a rename or a move: recents, document state and the tracked stamps point at the
/// new path.
fn followed(app: &AppHandle, from: &Path, to: &Path) {
    if from == to {
        return;
    }
    stores::path_moved(app, from, to);
    app.state::<TrackedFiles>().moved(from, to);
}

#[tauri::command]
pub async fn rename_path(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    path: String,
    new_name: String,
) -> PlatformResult<String> {
    let from = PathBuf::from(&path);
    let renamed = file_ops::rename_path(&grants, &from, &new_name)?;
    followed(&app, &from, &renamed);
    file_op(&app, "rename", Some(&from), Some(&renamed));
    Ok(as_text(&renamed))
}

#[tauri::command]
pub async fn move_path(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    path: String,
    to_folder: String,
) -> PlatformResult<String> {
    let from = PathBuf::from(&path);
    let moved = file_ops::move_path(&grants, &from, Path::new(&to_folder))?;
    followed(&app, &from, &moved);
    file_op(&app, "move", Some(&from), Some(&moved));
    Ok(as_text(&moved))
}

#[tauri::command]
pub async fn duplicate_path(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    path: String,
) -> PlatformResult<String> {
    let from = PathBuf::from(&path);
    let copy = file_ops::duplicate_path(&grants, &from)?;
    // A copy of a document the open dialog granted is a document of its own: it can be opened.
    grants.grant_resolved(&copy);
    file_op(&app, "duplicate", Some(&from), Some(&copy));
    Ok(as_text(&copy))
}

#[tauri::command]
pub async fn trash_path(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    path: String,
) -> PlatformResult<()> {
    let from = PathBuf::from(&path);
    file_ops::trash_path(&grants, &from, &SystemTrash)?;
    file_op(&app, "trash", Some(&from), None);
    Ok(())
}

// ---- watching and searching (Phase 3) -------------------------------------------------------------

/// Replaces the set of watched files and the watched folder. Paths that are not granted are
/// left out. Changes arrive as `file-changed` events.
#[tauri::command]
pub async fn watch(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    service: State<'_, WatchService>,
    set: WatchRequest,
) -> PlatformResult<()> {
    let ignore = stores.settings().files.ignore;
    let resolved = watcher::resolve(
        &grants,
        &set.documents,
        &set.linked,
        set.folder.as_deref(),
        &ignore,
    );
    let handle = app.clone();
    service
        .set_for(window.label(), resolved, move || {
            std::sync::Arc::new(move |changes: Vec<FileChange>| {
                let mut scopes: Vec<&str> = changes.iter().map(|c| c.scope.name()).collect();
                scopes.sort_unstable();
                scopes.dedup();
                handle.state::<Trace>().event(
                    "file-changed",
                    json!({ "count": changes.len(), "scopes": scopes }),
                );
                let _ = handle.emit("file-changed", &changes);
            })
        })
        .map_err(|message| PlatformError::io(&message))
}

/// Searches the open folder. The search runs on a worker thread; a newer request with a higher
/// id cancels older ones.
#[tauri::command]
pub async fn search_folder(app: AppHandle, request: SearchRequest) -> PlatformResult<SearchResult> {
    let ignore = app.state::<Stores>().settings().files.ignore;
    blocking(move || {
        search::search_folder(
            &app.state::<PathGrants>(),
            &app.state::<SearchRegistry>(),
            &ignore,
            &request,
        )
    })
    .await?
}

/// Cancels the search with this id (it may not have started yet).
#[tauri::command]
pub async fn cancel_search(registry: State<'_, SearchRegistry>, id: u64) -> PlatformResult<()> {
    registry.cancel(id);
    Ok(())
}

// ---- clipboard, print, export (Phase 3) ------------------------------------------------------------

/// Puts text, and HTML if given, on the system pasteboard.
#[tauri::command]
pub async fn write_clipboard(
    app: AppHandle,
    text: String,
    html: Option<String>,
) -> PlatformResult<()> {
    let written = blocking(move || clipboard::write_clipboard(&text, html.as_deref())).await??;
    app.state::<Trace>().event(
        "clipboard",
        json!({ "bytes": written.bytes, "html": written.html }),
    );
    Ok(())
}

/// The plain text on the system pasteboard, for Paste and Match Style.
#[tauri::command]
pub async fn read_clipboard_text() -> PlatformResult<String> {
    blocking(clipboard::read_clipboard_text).await?
}

/// Shows the system print panel for the page (the page has put the document in its print root).
#[tauri::command]
pub async fn print_page(app: AppHandle, window: WebviewWindow) -> PlatformResult<()> {
    window
        .print()
        .map_err(|_| PlatformError::io("The print panel could not be shown."))?;
    app.state::<Trace>().event("print", json!({}));
    Ok(())
}

/// Writes the text of an export to the path the save dialog just returned for it (once), with
/// the safe save: a temporary file next to it, then a rename.
#[tauri::command]
pub async fn write_export(
    app: AppHandle,
    exports: State<'_, ExportTargets>,
    path: String,
    contents: String,
) -> PlatformResult<()> {
    let target = PathBuf::from(&path);
    if !exports.is_allowed(&target) {
        return Err(PlatformError::not_allowed());
    }
    let format = SaveFormat {
        encoding: crate::encoding::Encoding::Utf8,
        line_ending: crate::line_endings::LineEnding::Lf,
    };
    // The user agreed to replace an existing file in the save sheet.
    let options = SaveOptions {
        overwrite_external_change: true,
        ..SaveOptions::default()
    };
    let to_write = target.clone();
    let saved =
        blocking(move || safe_save::save(&to_write, &contents, format, &options, None)).await??;
    exports.finish(&target);
    app.state::<Trace>().event(
        "export",
        json!({ "kind": "html", "path": saved.result.path, "bytes": saved.result.bytes }),
    );
    Ok(())
}

/// The document path of an export request, checked against the grants (canonical spelling).
fn checked_doc_path(
    grants: &PathGrants,
    doc_path: Option<String>,
) -> PlatformResult<Option<String>> {
    doc_path
        .map(|path| grants.check_document(Path::new(&path)).map(|p| as_text(&p)))
        .transpose()
}

/// The Pandoc that Word export would use, or null. Found once per path, then remembered.
#[tauri::command]
pub async fn pandoc_info(
    stores: State<'_, Stores>,
) -> PlatformResult<Option<crate::pandoc::PandocInfo>> {
    let setting = stores.settings().export.pandoc_path;
    blocking(move || crate::pandoc::info(setting.as_deref())).await
}

/// Preferences: the current default app for Markdown, read on the main thread.
#[tauri::command]
pub async fn default_markdown_app(
    app: AppHandle,
) -> PlatformResult<crate::native_doc::DefaultMarkdownApp> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(crate::native_doc::read_default_markdown_app());
    })
    .map_err(|_| PlatformError::io("The default app could not be read."))?;
    blocking(move || receiver.recv().ok())
        .await?
        .ok_or_else(|| PlatformError::io("The default app could not be read."))
}

/// Preferences: "Make Backtickle the default Markdown app". macOS shows its own confirmation; the
/// command answers when the system reports the outcome.
#[tauri::command]
pub async fn make_default_markdown_app(app: AppHandle) -> PlatformResult<()> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || crate::native_doc::set_default_markdown_app(sender))
        .map_err(|_| PlatformError::io("The default app could not be changed."))?;
    match blocking(move || receiver.recv().ok()).await? {
        Some(Ok(())) => Ok(()),
        Some(Err(message)) => Err(PlatformError::io(message)),
        None => Err(PlatformError::io("The default app could not be changed.")),
    }
}

/// Runs Pandoc with the fixed argument list. The output path must be one the save
/// dialog just returned for a Word export (once).
#[tauri::command]
pub async fn export_docx(
    app: AppHandle,
    stores: State<'_, Stores>,
    grants: State<'_, PathGrants>,
    exports: State<'_, ExportTargets>,
    mut request: crate::pandoc::DocxRequest,
) -> PlatformResult<()> {
    let target = PathBuf::from(&request.out_path);
    if !exports.is_allowed(&target) {
        return Err(PlatformError::not_allowed());
    }
    request.doc_path = checked_doc_path(&grants, request.doc_path.take())?;
    let setting = stores.settings().export.pandoc_path;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| PlatformError::io("The home folder could not be found."))?;
    let started = std::time::Instant::now();
    let run_target = target.clone();
    let result = blocking(move || {
        let Some(info) = crate::pandoc::info(setting.as_deref()) else {
            return Err(PlatformError::io("Pandoc was not found."));
        };
        crate::pandoc::export_docx(
            Path::new(&info.path),
            &request,
            &home,
            crate::pandoc::TIMEOUT,
        )?;
        crate::watcher::OwnWrites::global().wrote(&run_target);
        Ok(())
    })
    .await?;
    exports.finish(&target);
    result?;
    app.state::<Trace>().event(
        "export",
        json!({
            "kind": "docx",
            "path": as_text(&target),
            "ms": started.elapsed().as_millis() as u64,
        }),
    );
    Ok(())
}

/// The exact preview: Pandoc turns the document into HTML. A newer request from the
/// same window cancels the one that is running. `--citeproc` is used only when every bibliography
/// file the document names was read by the preview (it holds a read grant).
#[tauri::command]
pub async fn pandoc_preview(
    app: AppHandle,
    window: WebviewWindow,
    stores: State<'_, Stores>,
    grants: State<'_, PathGrants>,
    mut request: crate::pandoc::PreviewRequest,
) -> PlatformResult<String> {
    request.doc_path = checked_doc_path(&grants, request.doc_path.take())?;
    let granted = request.citeproc
        && request.doc_path.is_some()
        && !request.bibliography.is_empty()
        && request
            .bibliography
            .iter()
            .all(|path| grants.check_readable(Path::new(path)).is_ok());
    let setting = stores.settings().export.pandoc_path;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| PlatformError::io("The home folder could not be found."))?;
    let label = window.label().to_owned();
    let flag = crate::pandoc::begin_render(&label);
    let run_flag = std::sync::Arc::clone(&flag);
    let result = blocking(move || {
        let Some(info) = crate::pandoc::info(setting.as_deref()) else {
            return Err(PlatformError::io("Pandoc was not found."));
        };
        crate::pandoc::render_preview(
            Path::new(&info.path),
            &request,
            granted,
            &home,
            crate::pandoc::PREVIEW_TIMEOUT,
            &run_flag,
        )
    })
    .await;
    crate::pandoc::end_render(&label, &flag);
    result?
}

/// Stops the running exact-preview render of this window (the preview was turned off).
#[tauri::command]
pub async fn cancel_pandoc_preview(window: WebviewWindow) -> PlatformResult<()> {
    crate::pandoc::cancel_render(window.label());
    Ok(())
}

/// Writes the page as a PDF to the path the save dialog just returned for it (once), without the
/// print panel (`pdf.rs`). The page has put the document in its print root first.
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    window: WebviewWindow,
    exports: State<'_, ExportTargets>,
    path: String,
) -> PlatformResult<()> {
    let target = PathBuf::from(&path);
    if !exports.is_allowed(&target) {
        return Err(PlatformError::not_allowed());
    }
    let run_target = target.clone();
    let label = window.label().to_owned();
    let trace = *app.state::<Trace>().inner();
    let stage: crate::pdf::Stage = std::sync::Arc::new(move |name: &str| {
        trace.event("pdf-stage", json!({ "stage": name }));
    });
    app.state::<Trace>()
        .event("pdf-stage", json!({ "stage": "requested" }));
    let result = blocking(move || crate::pdf::export(&window, &run_target, stage)).await;
    exports.finish(&target);
    let outcome = result.and_then(|written| {
        written.map_err(|error| {
            app.state::<Trace>()
                .event("pdf-failed", json!({ "message": error.0 }));
            PlatformError::io(&error.0)
        })
    });
    if let Ok(pages) = &outcome {
        crate::watcher::OwnWrites::global().wrote(&target);
        app.state::<Trace>()
            .event("pdf-exported", json!({ "pages": pages }));
    }
    // The PDF benchmark (`BACKTICKLE_BENCH_EXIT=1`) quits through the normal quit path.
    let launch = app.state::<crate::launch::LaunchState>();
    if launch.bench_exit && launch.options.bench_pdf.as_deref() == Some(path.as_str()) {
        match app.try_state::<crate::lifecycle::AppCloseProtocol>() {
            Some(protocol) => protocol.request(&label, crate::lifecycle::CloseReason::Quit),
            None => app.exit(0),
        }
    }
    outcome.map(|_| ())
}

/// Render with Quarto: opens the saved `.qmd` or `.Rmd` document in RStudio, or runs
/// the render in Terminal through a private script. Answers `rstudio` or `terminal`. The document
/// must be a granted file; nothing from the page reaches a shell except through the quoting in
/// `render.rs`.
#[tauri::command]
pub async fn render_with_quarto(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    path: String,
) -> PlatformResult<String> {
    let doc = grants.check_document(Path::new(&path))?;
    if !crate::render::is_renderable(&doc) || !doc.is_file() {
        return Err(PlatformError::io(
            "Only a saved Quarto or R Markdown document can be rendered.",
        ));
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(crate::render::start(&doc));
    })
    .map_err(|_| PlatformError::io("The render could not be started."))?;
    let outcome = blocking(move || receiver.recv().ok())
        .await?
        .ok_or_else(|| PlatformError::io("The render could not be started."))?;
    match outcome {
        Ok(target) => {
            app.state::<Trace>()
                .event("render-handoff", json!({ "target": target.name() }));
            Ok(target.name().to_owned())
        }
        Err(error) => {
            app.state::<Trace>()
                .event("render-handoff", json!({ "target": "none" }));
            Err(PlatformError::io(&error.0))
        }
    }
}

// ---- session (Phase 3) -------------------------------------------------------------------------------

/// The session of the last run, or null. Its folder and files were granted again at launch.
#[tauri::command]
pub async fn get_session(stores: State<'_, Stores>) -> PlatformResult<Option<Session>> {
    Ok(stores.load_session())
}

/// Stores the session. Only tabs, a folder and expanded folders that are granted now are kept.
#[tauri::command]
pub async fn set_session(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    session: Value,
) -> PlatformResult<()> {
    let Some(session) = Session::from_value(&session) else {
        return Err(PlatformError::io("The session is not valid."));
    };
    let session = session.sanitize(&grants);
    let label = window.label();
    let bounds = windows::bounds_of(&app, label).and_then(SessionBounds::from_window);
    stores
        .save_window_session(label, session, bounds)
        .map_err(|e| PlatformError::from_write(&e))
}

// ---- crash recovery (Phase 5) -------------------------------------------------------------------------

/// Keeps the text of a document with unsaved changes under the id the page chose. A path the
/// window is not allowed to use is dropped from the entry. Traces name the count only.
#[tauri::command]
pub async fn recovery_write(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
    id: String,
    entry: Value,
) -> PlatformResult<()> {
    let Some(entry) =
        crate::recovery::Entry::from_value(&id, &entry, |path| grants.is_permitted(path))
    else {
        return Err(PlatformError::io("The recovery entry is not valid."));
    };
    stores
        .recovery()
        .write(&entry)
        .map_err(|e| PlatformError::from_write(&e))?;
    app.state::<Trace>().event(
        "recovery-written",
        json!({ "count": stores.recovery().ids().len() }),
    );
    Ok(())
}

/// Removes the entries (a document was saved, discarded or closed).
#[tauri::command]
pub async fn recovery_remove(stores: State<'_, Stores>, ids: Vec<String>) -> PlatformResult<()> {
    for id in &ids {
        stores.recovery().remove(id);
    }
    Ok(())
}

/// The entries left by a run that did not end cleanly, oldest first. Their paths were granted
/// again at launch; one that is no longer granted is dropped from the answer.
#[tauri::command]
pub async fn recovery_list(
    app: AppHandle,
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
) -> PlatformResult<Vec<crate::recovery::Entry>> {
    let mut entries = stores.recovery().list();
    for entry in &mut entries {
        if let Some(path) = &entry.path
            && !grants.is_permitted(Path::new(path))
        {
            entry.path = None;
        }
    }
    if !entries.is_empty() {
        app.state::<Trace>()
            .event("recovery-restored", json!({ "count": entries.len() }));
    }
    Ok(entries)
}

// ---- several windows (Phase 5) ----------------------------------------------------------------------

/// Move Tab to New Window: opens a document window beside the calling one and keeps the tab's
/// state (a JSON object built by the page: text, editor state with undo history, positions,
/// flavor, view, unsaved flag) for the new page to take. Resolves to the new window's label.
/// The tab leaves the calling window when the page has this answer.
#[tauri::command]
pub async fn move_tab(
    app: AppHandle,
    window: WebviewWindow,
    docs: State<'_, DocWindows>,
    grants: State<'_, PathGrants>,
    payload: Value,
) -> PlatformResult<String> {
    if !payload.is_object() {
        return Err(PlatformError::io("The tab could not be moved."));
    }
    let path = payload
        .get("path")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if let Some(path) = &path
        && !grants.is_permitted(Path::new(path))
    {
        return Err(PlatformError::io("The tab could not be moved."));
    }
    let from = window.label().to_owned();
    let label = docs.next_label();
    docs.put_transfer(&label, payload);
    if let Some(path) = &path {
        docs.set_documents(&label, vec![path.clone()]);
        docs.remove_document(&from, path);
    }
    if let Err(error) = windows::create_document_window(&app, label.clone(), Some(&from), None) {
        docs.forget(&label);
        eprintln!("backtickle: the new window could not be created: {error}");
        return Err(PlatformError::io("The new window could not be opened."));
    }
    app.state::<Trace>()
        .event("tab-moved", json!({ "from": from, "to": label }));
    Ok(label)
}

/// The tab state that waits for this window's page (once), or null.
#[tauri::command]
pub async fn take_transfer(
    window: WebviewWindow,
    docs: State<'_, DocWindows>,
) -> PlatformResult<Option<Value>> {
    Ok(docs.take_transfer(window.label()))
}

/// The window reports the documents (canonical paths) it holds, so a file is never open twice.
#[tauri::command]
pub async fn set_window_documents(
    window: WebviewWindow,
    docs: State<'_, DocWindows>,
    paths: Vec<String>,
) -> PlatformResult<()> {
    docs.set_documents(window.label(), paths);
    Ok(())
}

/// Before the calling window opens a file it does not hold: if another window holds it, that
/// window comes to the front and shows the tab, and the answer is true (the caller opens
/// nothing). False when no other window has it.
#[tauri::command]
pub async fn focus_open_document(
    app: AppHandle,
    window: WebviewWindow,
    docs: State<'_, DocWindows>,
    path: String,
) -> PlatformResult<bool> {
    let existing = windows::document_labels(&app);
    let Some(holder) = docs
        .holder_of(&path, Some(window.label()))
        .filter(|label| existing.contains(label))
    else {
        return Ok(false);
    };
    open_files::deliver_exact(&app, &holder, vec![path]);
    Ok(true)
}

/// At launch, `main` asks for the other windows of the stored session to be opened (once per
/// run). Rust reads the stored session itself and creates a window for each entry, at the place
/// it had; each window's page takes its tabs with `take_transfer`. Resolves to their labels.
#[tauri::command]
pub async fn restore_windows(
    app: AppHandle,
    docs: State<'_, DocWindows>,
    grants: State<'_, PathGrants>,
    stores: State<'_, Stores>,
) -> PlatformResult<Vec<String>> {
    if !docs.begin_restore() {
        return Ok(Vec::new());
    }
    let Some(session) = stores
        .load_session()
        .map(|session| session.sanitize(&grants))
    else {
        return Ok(Vec::new());
    };
    // With more than one window the layout comes back too, main's place included.
    if !session.windows.is_empty()
        && let Some(bounds) = session.bounds
        && let Some(main) = app.get_webview_window(windows::MAIN_LABEL)
    {
        let bounds = bounds.to_window();
        let _ = main.set_size(tauri::LogicalSize::new(bounds.width, bounds.height));
        let _ = main.set_position(tauri::LogicalPosition::new(bounds.x, bounds.y));
    }
    let mut labels = Vec::new();
    for entry in session.windows {
        let label = docs.next_label();
        let tabs: Vec<Value> = entry
            .tabs
            .iter()
            .map(|tab| json!({ "path": tab.path, "view": tab.view }))
            .collect();
        docs.set_documents(
            &label,
            entry.tabs.iter().map(|tab| tab.path.clone()).collect(),
        );
        docs.put_transfer(
            &label,
            json!({ "kind": "session", "tabs": tabs, "active": entry.active }),
        );
        let bounds = entry.bounds.map(SessionBounds::to_window);
        if windows::create_document_window(&app, label.clone(), None, bounds).is_ok() {
            labels.push(label);
        } else {
            docs.forget(&label);
        }
    }
    Ok(labels)
}

// ---- window and lifecycle ------------------------------------------------------------------------

/// The files that were opened before the page was ready. From now on files are sent as
/// `open-files` events.
#[tauri::command]
pub async fn take_pending_open_files(
    window: WebviewWindow,
    pages: State<'_, Pages>,
) -> PlatformResult<Vec<String>> {
    Ok(open_files::dedupe(pages.take_files(window.label())))
}

#[tauri::command]
pub async fn update_menu_state(
    app: AppHandle,
    window: WebviewWindow,
    state: MenuState,
) -> PlatformResult<()> {
    menu::apply_state(&app, window.label(), state);
    Ok(())
}

/// The window's active document has (or no longer has) unsaved changes: the close button's dot.
#[tauri::command]
pub async fn set_document_edited(
    app: AppHandle,
    window: WebviewWindow,
    edited: bool,
) -> PlatformResult<()> {
    crate::native_doc::set_edited(&window, edited);
    app.state::<Trace>().event(
        "document-edited",
        json!({ "label": window.label(), "edited": edited }),
    );
    Ok(())
}

#[tauri::command]
pub async fn set_window_title(window: WebviewWindow, title: String) -> PlatformResult<()> {
    crate::native_doc::set_title(&window, &dialogs::clean_line(&title, 200))
        .map_err(|_| PlatformError::io("The window title could not be set."))
}

/// The Preferences button of the toolbar: the same window as the Settings menu item.
#[tauri::command]
pub async fn open_preferences(app: AppHandle) -> PlatformResult<()> {
    show_preferences(&app)
        .map_err(|_| PlatformError::io("The Preferences window could not be opened."))
}

/// The page has seen `close-requested`; Rust stops waiting to close the window by itself.
#[tauri::command]
pub async fn ack_close(protocol: State<'_, AppCloseProtocol>) -> PlatformResult<()> {
    protocol.ack();
    Ok(())
}

/// The page is done asking about unsaved changes: close the window, or quit.
#[tauri::command]
pub async fn finish_close(
    window: WebviewWindow,
    protocol: State<'_, AppCloseProtocol>,
    reason: CloseReason,
) -> PlatformResult<()> {
    protocol.finish(window.label(), reason);
    Ok(())
}

/// The user chose Cancel in the unsaved-changes question: the close or quit round ends, and a
/// quit that the system asked for (logout, restart) is cancelled.
#[tauri::command]
pub async fn cancel_close(
    window: WebviewWindow,
    protocol: State<'_, AppCloseProtocol>,
    reason: CloseReason,
) -> PlatformResult<()> {
    protocol.cancel(window.label(), reason);
    Ok(())
}

/// The page registered its menu action listener: menu actions that arrived while the window was
/// being created are sent now, and later ones go straight to the page.
#[tauri::command]
pub async fn menu_ready(
    app: AppHandle,
    window: WebviewWindow,
    pages: State<'_, Pages>,
) -> PlatformResult<()> {
    let trace = app.state::<Trace>();
    let label = window.label();
    for action in pages.take_actions(label) {
        let _ = app.emit_to(label, MENU_ACTION_EVENT, &action);
        trace.event(
            "menu-action",
            json!({ "action": action, "queued": false, "afterQueue": true, "window": label }),
        );
        if action == UNDO_ID || action == REDO_ID {
            let _ = app.emit_to(label, EDIT_COMMAND_EVENT, action.as_str());
        }
    }
    Ok(())
}

#[cfg(test)]
mod docx_tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn a_docx_request_with_a_document_path_that_was_not_granted_is_refused() {
        let dir = TempDir::new();
        let granted = dir.write("a.md", b"x");
        let other = dir.write("b.md", b"y");
        let grants = PathGrants::default();
        let canonical = grants.grant(&granted).expect("grants");

        assert_eq!(checked_doc_path(&grants, None), Ok(None));
        assert_eq!(
            checked_doc_path(&grants, Some(as_text(&canonical))),
            Ok(Some(as_text(&canonical)))
        );
        assert!(checked_doc_path(&grants, Some(as_text(&other))).is_err());
        assert!(checked_doc_path(&grants, Some("/etc/hosts".into())).is_err());
    }
}
