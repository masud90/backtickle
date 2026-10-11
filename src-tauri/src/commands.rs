//! Commands the web view can call. Each command is a thin wrapper around a plain function so
//! the logic can be unit-tested without a running app.
//!
//! The TypeScript side of every command lives in `src/lib/platform.ts` and nowhere else.
//! Every command must also be listed in `build.rs` and granted in a capability file.
//!
//! File access rule: the web view never supplies a path that Rust trusts. Rust shows the open
//! dialog itself (`pick_file`) and remembers what the user chose; `read_text_file` serves only
//! those files (see `grants.rs`).

use crate::grants::PathGrants;
use crate::launch::{LaunchOptions, LaunchState};
use crate::lifecycle::Lifecycle;
use crate::perf;
use crate::text_file::{self, TextFile};
use std::path::Path;
use tauri::{AppHandle, PackageInfo, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// The answer to the bridge round-trip check.
pub fn ping_reply() -> String {
    "pong".to_string()
}

/// The version as shown to the user, taken from the package info (tauri.conf.json).
pub fn version_label(info: &PackageInfo) -> String {
    info.version.to_string()
}

#[tauri::command]
pub fn ping() -> String {
    ping_reply()
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    version_label(app.package_info())
}

/// What the app was started with. The file given with `--open` is already allowed for reading.
/// A main window that is created after the first one was closed (a click on the Dock icon)
/// gets the options of a plain start instead: the welcome screen, no file, no measurements.
#[tauri::command]
pub fn launch_options(
    window: WebviewWindow,
    state: State<'_, LaunchState>,
    lifecycle: State<'_, Lifecycle>,
) -> LaunchOptions {
    if window.label() != crate::windows::MAIN_LABEL {
        LaunchOptions::for_document_window(window.label())
    } else if lifecycle.main_has_been_closed() {
        LaunchOptions::for_reopened_window()
    } else {
        state.options.clone()
    }
}

/// Shows the native open dialog, as a sheet on the calling window. Resolves to the canonical
/// path of the chosen file, which is now allowed for `read_text_file`, or null if the user
/// cancelled.
#[tauri::command]
pub async fn pick_file(
    app: AppHandle,
    window: WebviewWindow,
    grants: State<'_, PathGrants>,
) -> Result<Option<String>, String> {
    // The dialog blocks until the user answers, so it must not run on the main thread or on the
    // async runtime's own threads.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open")
            .add_filter(
                "Markdown and text",
                &[
                    "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "qmd", "rmd", "txt",
                ],
            )
            .set_parent(&window)
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "The open dialog could not be shown.".to_string())?;

    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| "The chosen item is not a file on this Mac.".to_string())?;
    let canonical = grants.grant(&path)?;
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

/// Reads a file chosen with `pick_file` or given with `--open`. Any other path is refused.
#[tauri::command]
pub async fn read_text_file(
    grants: State<'_, PathGrants>,
    path: String,
) -> Result<TextFile, String> {
    let allowed = grants.check(Path::new(&path))?;
    tauri::async_runtime::spawn_blocking(move || text_file::read_text_file(&allowed))
        .await
        .map_err(|_| "The file could not be read.".to_string())?
}

/// Prints a timing mark when the app runs with `WRITEDOWN_PERF=1`. Does nothing otherwise.
#[tauri::command]
pub fn perf_mark(state: State<'_, LaunchState>, name: String) {
    if !state.options.perf {
        return;
    }
    if let Some(line) = perf::mark_line(&name, perf::elapsed_ms()) {
        perf::print_line(&line);
    }
}

/// Prints the typing benchmark result and, with `WRITEDOWN_BENCH_EXIT=1`, quits the app.
/// Does nothing unless the app runs in benchmark mode (`WRITEDOWN_PERF=1 WRITEDOWN_BENCH=typing`).
#[tauri::command]
pub fn bench_report(
    app: AppHandle,
    state: State<'_, LaunchState>,
    render_ms: Vec<f64>,
    e2e_ms: Vec<f64>,
    doc_bytes: u64,
) {
    if !state.options.bench {
        return;
    }
    perf::print_line(&perf::bench_line(&render_ms, &e2e_ms, doc_bytes));
    if state.bench_exit {
        app.exit(0);
    }
}

/// One run of the search benchmark as the frontend reports it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchBenchRun {
    pub ms: f64,
    pub files: u64,
    pub matches: u64,
    pub truncated: bool,
}

/// Prints the search benchmark result and, with `WRITEDOWN_BENCH_EXIT=1`, quits the app.
/// Does nothing unless the app runs in benchmark mode.
#[tauri::command]
pub fn bench_search_report(
    app: AppHandle,
    state: State<'_, LaunchState>,
    query: String,
    runs: Vec<SearchBenchRun>,
    error: Option<String>,
) {
    if !state.options.bench {
        return;
    }
    let runs: Vec<perf::SearchRun> = runs
        .iter()
        .map(|r| (r.ms, r.files, r.matches, r.truncated))
        .collect();
    perf::print_line(&perf::search_bench_line(&query, &runs, error.as_deref()));
    if state.bench_exit {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package_info(version: &str) -> PackageInfo {
        PackageInfo {
            name: "Writedown".into(),
            version: version.parse().expect("valid semver"),
            authors: "",
            description: "",
            crate_name: "writedown",
        }
    }

    #[test]
    fn ping_answers_pong() {
        assert_eq!(ping_reply(), "pong");
        assert_eq!(ping(), "pong");
    }

    #[test]
    fn version_label_is_the_plain_version() {
        assert_eq!(version_label(&package_info("0.0.1")), "0.0.1");
        assert_eq!(version_label(&package_info("1.2.3")), "1.2.3");
    }

    #[test]
    fn version_label_keeps_prerelease_and_build_parts() {
        assert_eq!(
            version_label(&package_info("1.0.0-beta.2+7")),
            "1.0.0-beta.2+7"
        );
    }
}
