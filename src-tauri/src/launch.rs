//! What the app was started with: command-line arguments and measurement switches.
//!
//! Arguments (the memory and latency harness depends on these exact names):
//! - `--open <path>` or `--open=<path>`: show that file at startup (and allow reading it);
//! - `--view editor|split|preview` or `--view=...`: the view mode of the document opened with
//!   `--open` (the measurement harness passes `--view split`); any other value is ignored;
//! - `--folder <path>` or `--folder=<path>`: open that folder in the Files tab at startup (and allow
//!   everything below it, like a folder chosen in the dialog). `--open`, `--folder` and `--welcome`
//!   all mean "start with exactly this": the last session is not restored;
//! - `--prefs`: open the Preferences window at startup;
//! - `--welcome`: start with no document ("No document open" placeholder instead of the panes).
//! - any other argument that does not start with `-`: a file to open, as File Explorer and Linux
//!   file managers pass a double-clicked document (macOS hands those over as an event instead).
//!
//! Environment variables (see `perf.rs` and `trace.rs`):
//! - `WRITEDOWN_PERF=1`: the frontend reports timing marks, printed to stdout;
//! - `WRITEDOWN_BENCH=typing` (only together with `WRITEDOWN_PERF=1`): run the typing benchmark;
//! - `WRITEDOWN_BENCH=search` (only together with `WRITEDOWN_PERF=1`): run the search benchmark in the
//!   open folder, for the term in `WRITEDOWN_BENCH_QUERY` (default `lantern`);
//! - `WRITEDOWN_BENCH_EXIT=1` (only in benchmark mode): quit the app when the benchmark is done;
//! - `WRITEDOWN_TRACE=1`: print one JSON line per backend event (opened files, menu actions,
//!   close requests, saves, changed recents and settings, the folder of the stores at startup).
//! - `WRITEDOWN_CONFIG_DIR=<folder>`: keep all stores (recents, settings, document state) in that
//!   folder instead of the app's own folders, so measurement runs and checks leave the real ones
//!   alone. The folder is created if it is missing. An empty value counts as not set.

use serde::Serialize;
use std::path::PathBuf;

/// The view modes `--view` accepts (`ViewMode` in `src/lib/platform.ts`).
pub const VIEW_MODES: [&str; 3] = ["editor", "split", "preview"];

fn parse_view(value: &str) -> Option<String> {
    VIEW_MODES.contains(&value).then(|| value.to_owned())
}

/// The parsed command line and environment, before any file is looked at.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LaunchConfig {
    /// The path exactly as it was given after `--open`.
    pub open: Option<String>,
    /// The path exactly as it was given after `--folder`.
    pub folder: Option<String>,
    /// The valid value given after `--view`.
    pub view: Option<String>,
    pub prefs: bool,
    pub welcome: bool,
    pub perf: bool,
    pub bench: bool,
    /// The search benchmark's term (`WRITEDOWN_BENCH=search`), `None` for the typing benchmark.
    pub bench_search: Option<String>,
    pub bench_exit: bool,
    /// `WRITEDOWN_BENCH=pdf` with `WRITEDOWN_BENCH_PDF=<absolute .pdf path>`: export the opened
    /// document to that path once it is ready (real-app check of the PDF export).
    pub bench_pdf: Option<String>,
    /// `WRITEDOWN_BENCH=recovery-edit`: the page types a fixed sentence into the open (or a new)
    /// document once ready and waits until its recovery entry is written (real-app check of crash
    /// recovery: the person running it then kills the process).
    pub bench_recovery: bool,
    pub trace: bool,
    /// `WRITEDOWN_CONFIG_DIR`: the folder for all stores, if one was asked for.
    pub config_dir: Option<PathBuf>,
    /// Plain arguments, in order: files to open (see the module comment).
    pub files: Vec<String>,
}

impl LaunchConfig {
    /// Parses arguments (without the program name) and environment variables.
    ///
    /// Unknown arguments are ignored: macOS may add some of its own when it launches an app.
    pub fn parse<I, F>(args: I, env: F) -> Self
    where
        I: IntoIterator<Item = String>,
        F: Fn(&str) -> Option<String>,
    {
        let mut config = LaunchConfig::default();
        let mut args = args.into_iter().peekable();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--prefs" => config.prefs = true,
                "--welcome" => config.welcome = true,
                "--open" => {
                    if let Some(path) = args.next() {
                        config.open = Some(path);
                    }
                }
                "--folder" => {
                    if let Some(path) = args.next() {
                        config.folder = Some(path);
                    }
                }
                "--view" => {
                    // A flag after `--view` is not its value.
                    if args.peek().is_some_and(|next| !next.starts_with("--")) {
                        config.view = args.next().as_deref().and_then(parse_view);
                    }
                }
                other => {
                    if let Some(path) = other.strip_prefix("--open=") {
                        config.open = Some(path.to_string());
                    } else if let Some(path) = other.strip_prefix("--folder=") {
                        config.folder = Some(path.to_string());
                    } else if let Some(value) = other.strip_prefix("--view=") {
                        config.view = parse_view(value);
                    } else if !other.starts_with('-') && !other.is_empty() {
                        config.files.push(other.to_string());
                    }
                }
            }
        }

        let is_one = |name: &str| env(name).as_deref() == Some("1");
        config.perf = is_one("WRITEDOWN_PERF");
        let bench_kind = env("WRITEDOWN_BENCH");
        config.bench = config.perf && matches!(bench_kind.as_deref(), Some("typing" | "search"));
        if config.bench && bench_kind.as_deref() == Some("search") {
            config.bench_search = Some(
                env("WRITEDOWN_BENCH_QUERY")
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "lantern".to_string()),
            );
        }
        if bench_kind.as_deref() == Some("pdf") {
            config.bench_pdf = env("WRITEDOWN_BENCH_PDF").filter(|value| {
                std::path::Path::new(value).is_absolute() && value.to_lowercase().ends_with(".pdf")
            });
        }
        config.bench_recovery = bench_kind.as_deref() == Some("recovery-edit");
        config.bench_exit =
            (config.bench || config.bench_pdf.is_some()) && is_one("WRITEDOWN_BENCH_EXIT");
        config.trace = is_one("WRITEDOWN_TRACE");
        config.config_dir = env("WRITEDOWN_CONFIG_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        config
    }

    /// The arguments and environment of this process.
    pub fn from_process() -> Self {
        Self::parse(std::env::args().skip(1), |name| std::env::var(name).ok())
    }
}

/// What the frontend is told at startup. The camelCase names match `LaunchOptions` in
/// `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    /// The file to show, already allowed for reading. `None` when no usable `--open` was given.
    pub open_path: Option<String>,
    /// The folder given with `--folder`, already allowed. `None` when no usable one was given.
    pub folder_path: Option<String>,
    /// False when the app was started with `--open`, `--folder` or `--welcome` (and for a window
    /// created later): the last session is not restored.
    pub restore_session: bool,
    pub welcome: bool,
    pub perf: bool,
    pub bench: bool,
    /// The term of the search benchmark, or `None` (typing benchmark or no benchmark).
    pub bench_search: Option<String>,
    /// The path of the PDF benchmark, or `None`.
    pub bench_pdf: Option<String>,
    /// True for the crash recovery check (`WRITEDOWN_BENCH=recovery-edit`).
    pub bench_recovery: bool,
    /// `--view`: `editor`, `split` or `preview`.
    pub view: Option<String>,
    /// The label of the window asking: `main`, or `doc-<n>` for a tab moved to a new window.
    pub window_label: String,
}

impl LaunchOptions {
    /// What a main window created later gets (after the first one was closed and the Dock icon
    /// was clicked): no file, the welcome screen, no measurements. `--open`, `--view` and the
    /// measurement switches describe the first window only.
    pub fn for_reopened_window() -> Self {
        LaunchOptions {
            open_path: None,
            folder_path: None,
            restore_session: false,
            welcome: true,
            perf: false,
            bench: false,
            bench_search: None,
            bench_pdf: None,
            bench_recovery: false,
            view: None,
            window_label: "main".to_owned(),
        }
    }

    /// What a document window other than `main` gets: no file, no folder, no session, no
    /// measurements. Its tabs come from the tab state that waits for it (`take_transfer`).
    pub fn for_document_window(label: &str) -> Self {
        LaunchOptions {
            window_label: label.to_owned(),
            ..LaunchOptions::for_reopened_window()
        }
    }
}

/// Application state: the launch options plus the switches only Rust needs.
#[derive(Debug, Clone)]
pub struct LaunchState {
    pub options: LaunchOptions,
    pub prefs: bool,
    pub bench_exit: bool,
    pub trace: bool,
    pub config_dir: Option<PathBuf>,
}

impl LaunchState {
    /// The same state with the folder of `--folder` (already allowed by the caller).
    pub fn with_folder(mut self, folder_path: Option<String>) -> Self {
        self.options.folder_path = folder_path;
        self
    }

    pub fn new(config: &LaunchConfig, open_path: Option<String>) -> Self {
        LaunchState {
            options: LaunchOptions {
                open_path,
                folder_path: None,
                restore_session: config.open.is_none()
                    && config.folder.is_none()
                    && !config.welcome,
                welcome: config.welcome,
                perf: config.perf,
                bench: config.bench,
                bench_search: config.bench_search.clone(),
                bench_pdf: config.bench_pdf.clone(),
                bench_recovery: config.bench_recovery,
                view: config.view.clone(),
                window_label: "main".to_owned(),
            },
            prefs: config.prefs,
            bench_exit: config.bench_exit,
            trace: config.trace,
            config_dir: config.config_dir.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn parse(args: &[&str], env: &[(&str, &str)]) -> LaunchConfig {
        let env: HashMap<String, String> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        LaunchConfig::parse(args.iter().map(|a| a.to_string()), |name| {
            env.get(name).cloned()
        })
    }

    #[test]
    fn no_arguments_means_a_plain_start() {
        assert_eq!(parse(&[], &[]), LaunchConfig::default());
    }

    #[test]
    fn open_takes_the_next_argument_or_an_equals_sign() {
        assert_eq!(
            parse(&["--open", "docs/a.md"], &[]).open.as_deref(),
            Some("docs/a.md")
        );
        assert_eq!(
            parse(&["--open=/tmp/b.md"], &[]).open.as_deref(),
            Some("/tmp/b.md")
        );
    }

    #[test]
    fn open_without_a_path_is_ignored() {
        assert_eq!(parse(&["--open"], &[]).open, None);
    }

    #[test]
    fn a_path_with_spaces_is_one_argument() {
        assert_eq!(
            parse(&["--open", "My Notes/plan one.md"], &[])
                .open
                .as_deref(),
            Some("My Notes/plan one.md")
        );
    }

    #[test]
    fn prefs_and_welcome_are_flags() {
        let config = parse(&["--prefs", "--welcome"], &[]);
        assert!(config.prefs);
        assert!(config.welcome);
        assert_eq!(config.open, None);
    }

    #[test]
    fn unknown_arguments_are_ignored() {
        let config = parse(&["-psn_0_12345", "--unknown", "--open", "a.md"], &[]);
        assert_eq!(config.open.as_deref(), Some("a.md"));
        assert!(!config.prefs && !config.welcome);
    }

    #[test]
    fn view_takes_the_next_argument_or_an_equals_sign() {
        for mode in ["editor", "split", "preview"] {
            assert_eq!(parse(&["--view", mode], &[]).view.as_deref(), Some(mode));
            assert_eq!(
                parse(&[&format!("--view={mode}")], &[]).view.as_deref(),
                Some(mode)
            );
        }
    }

    #[test]
    fn view_works_together_with_open_in_either_order() {
        let first = parse(&["--open", "a.md", "--view", "split"], &[]);
        let second = parse(&["--view=editor", "--open=b.md"], &[]);

        assert_eq!(
            (first.open.as_deref(), first.view.as_deref()),
            (Some("a.md"), Some("split"))
        );
        assert_eq!(
            (second.open.as_deref(), second.view.as_deref()),
            (Some("b.md"), Some("editor"))
        );
    }

    #[test]
    fn an_invalid_view_is_ignored() {
        for args in [
            &["--view", "side-by-side"][..],
            &["--view="],
            &["--view=Split"],
            &["--view"],
            &["--view", ""],
        ] {
            assert_eq!(parse(args, &[]).view, None, "{args:?}");
        }
    }

    #[test]
    fn a_flag_after_view_is_not_taken_as_its_value() {
        let config = parse(&["--view", "--open", "a.md"], &[]);

        assert_eq!(config.view, None);
        assert_eq!(config.open.as_deref(), Some("a.md"));
    }

    #[test]
    fn perf_needs_exactly_one() {
        assert!(parse(&[], &[("WRITEDOWN_PERF", "1")]).perf);
        assert!(!parse(&[], &[("WRITEDOWN_PERF", "0")]).perf);
        assert!(!parse(&[], &[("WRITEDOWN_PERF", "true")]).perf);
        assert!(!parse(&[], &[]).perf);
    }

    #[test]
    fn trace_needs_exactly_one() {
        assert!(parse(&[], &[("WRITEDOWN_TRACE", "1")]).trace);
        assert!(!parse(&[], &[("WRITEDOWN_TRACE", "0")]).trace);
        assert!(!parse(&[], &[("WRITEDOWN_TRACE", "yes")]).trace);
        assert!(!parse(&[], &[]).trace);
        assert!(
            !parse(&[], &[("WRITEDOWN_PERF", "1")]).trace,
            "perf does not switch tracing on"
        );
    }

    #[test]
    fn the_config_folder_comes_from_the_environment_and_empty_means_not_set() {
        assert_eq!(parse(&[], &[]).config_dir, None);
        assert_eq!(
            parse(&[], &[("WRITEDOWN_CONFIG_DIR", "/tmp/wd-measure")]).config_dir,
            Some(PathBuf::from("/tmp/wd-measure"))
        );
        assert_eq!(parse(&[], &[("WRITEDOWN_CONFIG_DIR", "")]).config_dir, None);
    }

    #[test]
    fn the_benchmark_only_runs_together_with_perf() {
        let bench = [("WRITEDOWN_BENCH", "typing")];
        assert!(!parse(&[], &bench).bench);
        assert!(parse(&[], &[("WRITEDOWN_PERF", "1"), bench[0]]).bench);
        assert!(
            !parse(
                &[],
                &[("WRITEDOWN_PERF", "1"), ("WRITEDOWN_BENCH", "other")]
            )
            .bench
        );
    }

    #[test]
    fn the_search_benchmark_takes_its_term_from_the_environment() {
        let perf = ("WRITEDOWN_PERF", "1");
        let search = ("WRITEDOWN_BENCH", "search");
        assert_eq!(parse(&[], &[search]).bench_search, None);
        let default = parse(&[], &[perf, search]);
        assert!(default.bench);
        assert_eq!(default.bench_search.as_deref(), Some("lantern"));
        let named = parse(&[], &[perf, search, ("WRITEDOWN_BENCH_QUERY", "beacon")]);
        assert_eq!(named.bench_search.as_deref(), Some("beacon"));
        let empty = parse(&[], &[perf, search, ("WRITEDOWN_BENCH_QUERY", "")]);
        assert_eq!(empty.bench_search.as_deref(), Some("lantern"));
        // The typing benchmark has no search term, and the exit switch works for both.
        let typing = parse(
            &[],
            &[
                perf,
                ("WRITEDOWN_BENCH", "typing"),
                ("WRITEDOWN_BENCH_QUERY", "x"),
            ],
        );
        assert!(typing.bench && typing.bench_search.is_none());
        assert!(parse(&[], &[perf, search, ("WRITEDOWN_BENCH_EXIT", "1")]).bench_exit);
    }

    #[test]
    fn the_pdf_benchmark_needs_an_absolute_pdf_path_and_no_perf() {
        let kind = ("WRITEDOWN_BENCH", "pdf");
        assert_eq!(parse(&[], &[kind]).bench_pdf, None);
        let path = |value| parse(&[], &[kind, ("WRITEDOWN_BENCH_PDF", value)]).bench_pdf;
        let absolute = if cfg!(windows) {
            "C:/tmp/a.pdf"
        } else {
            "/tmp/a.pdf"
        };
        assert_eq!(path(absolute).as_deref(), Some(absolute));
        assert_eq!(path("a.pdf"), None);
        assert_eq!(path("/tmp/a.txt"), None);
        let other = parse(
            &[],
            &[
                ("WRITEDOWN_BENCH", "typing"),
                ("WRITEDOWN_BENCH_PDF", "/a.pdf"),
            ],
        );
        assert_eq!(other.bench_pdf, None);
        let exit = [
            kind,
            ("WRITEDOWN_BENCH_PDF", absolute),
            ("WRITEDOWN_BENCH_EXIT", "1"),
        ];
        assert!(parse(&[], &exit).bench_exit);
    }

    #[test]
    fn exit_after_the_benchmark_needs_the_benchmark() {
        let exit = ("WRITEDOWN_BENCH_EXIT", "1");
        assert!(!parse(&[], &[exit]).bench_exit);
        assert!(!parse(&[], &[("WRITEDOWN_PERF", "1"), exit]).bench_exit);
        let all = [("WRITEDOWN_PERF", "1"), ("WRITEDOWN_BENCH", "typing"), exit];
        assert!(parse(&[], &all).bench_exit);
    }

    #[test]
    fn e51_a_document_window_gets_a_plain_start_under_its_own_label() {
        let options = LaunchOptions::for_document_window("doc-3");

        assert_eq!(options.window_label, "doc-3");
        assert!(options.welcome && !options.restore_session && !options.perf);
        assert_eq!((options.open_path, options.folder_path), (None, None));
    }

    #[test]
    fn launch_options_serialize_with_the_names_the_frontend_expects() {
        let config = parse(
            &["--welcome", "--view", "split"],
            &[("WRITEDOWN_PERF", "1")],
        );
        let state = LaunchState::new(&config, Some("/a.md".into()));
        let json = serde_json::to_value(&state.options).expect("serializes");

        assert_eq!(
            json,
            serde_json::json!({
                "openPath": "/a.md",
                "folderPath": null,
                "restoreSession": false,
                "welcome": true,
                "perf": true,
                "bench": false,
                "benchSearch": null,
                "benchPdf": null,
                "benchRecovery": false,
                "view": "split",
                "windowLabel": "main"
            })
        );
    }

    #[test]
    fn without_view_the_option_is_null() {
        let state = LaunchState::new(&parse(&[], &[]), None);

        assert_eq!(
            serde_json::to_value(&state.options).expect("serializes")["view"],
            serde_json::Value::Null
        );
    }

    #[test]
    fn the_state_carries_the_switches_only_rust_needs() {
        let state = LaunchState::new(&parse(&["--prefs"], &[("WRITEDOWN_TRACE", "1")]), None);

        assert!(state.prefs && state.trace && !state.bench_exit);
    }

    #[test]
    fn a_window_created_later_starts_on_the_welcome_screen_without_measurements() {
        let options = LaunchOptions::for_reopened_window();

        assert_eq!(options.open_path, None);
        assert!(options.welcome);
        assert!(!options.perf && !options.bench);
        assert_eq!(options.view, None);
    }

    #[test]
    fn folder_takes_the_next_argument_or_an_equals_sign() {
        assert_eq!(
            parse(&["--folder", "/Users/me/My Notes"], &[])
                .folder
                .as_deref(),
            Some("/Users/me/My Notes")
        );
        assert_eq!(
            parse(&["--folder=/tmp/notes"], &[]).folder.as_deref(),
            Some("/tmp/notes")
        );
        assert_eq!(parse(&["--folder"], &[]).folder, None);
        assert_eq!(parse(&[], &[]).folder, None);
    }

    #[test]
    fn a_plain_start_restores_the_session() {
        let state = LaunchState::new(&parse(&[], &[]), None);

        assert!(state.options.restore_session);
        assert_eq!(state.options.folder_path, None);
    }

    #[test]
    fn open_folder_and_welcome_each_skip_the_session_restore() {
        for args in [
            &["--open", "a.md"][..],
            &["--open=a.md"],
            &["--folder", "/notes"],
            &["--folder=/notes"],
            &["--welcome"],
            &["--open", "a.md", "--folder", "/notes"],
        ] {
            let state = LaunchState::new(&parse(args, &[]), None);

            assert!(!state.options.restore_session, "{args:?}");
        }
        // Other switches do not.
        for args in [&["--prefs"][..], &["--view", "split"]] {
            assert!(
                LaunchState::new(&parse(args, &[]), None)
                    .options
                    .restore_session,
                "{args:?}"
            );
        }
    }

    #[test]
    fn the_allowed_folder_is_carried_in_the_options() {
        let state = LaunchState::new(&parse(&["--folder", "/notes"], &[]), None)
            .with_folder(Some("/private/notes".to_owned()));

        assert_eq!(
            serde_json::to_value(&state.options).expect("serializes")["folderPath"],
            serde_json::json!("/private/notes")
        );
    }

    #[test]
    fn a_window_created_later_does_not_restore_a_session_or_open_a_folder() {
        let options = LaunchOptions::for_reopened_window();

        assert!(!options.restore_session);
        assert_eq!(options.folder_path, None);
    }
}
