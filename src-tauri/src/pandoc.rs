//! Word export through Pandoc.
//!
//! This is the only file that starts a process (the source scan in `tests/config.rs` allows
//! `Command::new` here and nowhere else). Pandoc runs with a fixed argument list: the input
//! format from a short list of routes, `--citeproc` when asked, `--resource-path` the document
//! folder and `-o` a path the save dialog returned. The document and the page cannot add
//! anything: no filters, no Lua, no templates, no shell.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::PlatformError;

/// After this long Pandoc is killed.
pub const TIMEOUT: Duration = Duration::from_secs(120);

/// A preview render is killed after this long.
pub const PREVIEW_TIMEOUT: Duration = Duration::from_secs(30);

/// The most HTML a preview render may return.
const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;

/// How many lines of Pandoc's error output the banner shows.
const ERROR_LINES: usize = 3;

/// The file name of the Pandoc program.
#[cfg(not(windows))]
pub const PANDOC_FILE: &str = "pandoc";
#[cfg(windows)]
pub const PANDOC_FILE: &str = "pandoc.exe";

#[cfg(not(windows))]
const RSTUDIO_PANDOC: [&str; 2] = [
    "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc",
    "/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/x86_64/pandoc",
];
#[cfg(not(windows))]
const PANDOC_FOLDERS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/// Where Pandoc is installed on Windows, below `Program Files` or the user's local app folder:
/// its own installer, the copy inside RStudio, the copy inside Quarto.
#[cfg(windows)]
const WINDOWS_PANDOC: [&str; 4] = [
    "Pandoc/pandoc.exe",
    "RStudio/resources/app/bin/quarto/bin/tools/pandoc.exe",
    "RStudio/resources/app/quarto/bin/tools/pandoc.exe",
    "Quarto/bin/tools/pandoc.exe",
];

/// The places Pandoc is looked for after the setting, in order.
#[cfg(not(windows))]
fn usual_places() -> Vec<PathBuf> {
    let mut places: Vec<PathBuf> = RSTUDIO_PANDOC.iter().map(PathBuf::from).collect();
    places.extend(
        PANDOC_FOLDERS
            .iter()
            .map(|folder| Path::new(folder).join(PANDOC_FILE)),
    );
    places
}

#[cfg(windows)]
fn usual_places() -> Vec<PathBuf> {
    let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    let mut places: Vec<PathBuf> = Vec::new();
    for relative in WINDOWS_PANDOC {
        for root in &roots {
            places.push(root.join(relative));
            places.push(root.join("Programs").join(relative));
        }
    }
    // Then every folder on PATH (winget and Chocolatey put Pandoc there).
    if let Some(path) = std::env::var_os("PATH") {
        places.extend(std::env::split_paths(&path).map(|folder| folder.join(PANDOC_FILE)));
    }
    places
}

/// The input formats a Word export may use. Anything else is refused.
pub const ROUTES: [&str; 5] = [
    "commonmark",
    "gfm+tex_math_dollars",
    "markdown",
    "markdown_mmd",
    "html",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PandocInfo {
    pub path: String,
    pub version: String,
}

/// What the page asks for (`DocxRequest` in `src/lib/platform.ts`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxRequest {
    pub doc_path: Option<String>,
    pub out_path: String,
    pub input: String,
    pub from: String,
    pub citeproc: bool,
}

/// The first Pandoc found: the setting, the copy inside RStudio, then the usual folders.
pub fn discover(setting: Option<&str>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = setting {
        candidates.push(PathBuf::from(path));
    }
    candidates.extend(usual_places());
    candidates.into_iter().find(|path| path.is_file())
}

/// The version from the first line of `pandoc --version` ("pandoc 3.8.3" gives "3.8.3").
pub fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().next()?.trim();
    let version = line.strip_prefix("pandoc").unwrap_or(line).trim();
    (!version.is_empty()).then(|| version.to_string())
}

#[cfg(not(windows))]
fn clean_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    let path = std::env::var_os("PATH").unwrap_or_else(|| OsString::from("/usr/bin:/bin"));
    let home = std::env::var_os("HOME").unwrap_or_else(|| OsString::from("/"));
    command.env_clear().env("PATH", path).env("HOME", home);
    command
}

/// Windows: the same clean environment, plus the variables a Windows program needs to start
/// (`SystemRoot`) and to find the user's folders. No console window is shown.
#[cfg(windows)]
fn clean_command(program: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    /// CREATE_NO_WINDOW
    const NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.env_clear();
    for name in [
        "PATH",
        "SystemRoot",
        "SystemDrive",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.creation_flags(NO_WINDOW);
    command
}

fn cache() -> &'static Mutex<Option<(PathBuf, String)>> {
    static CACHE: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);
    &CACHE
}

/// The version of the Pandoc at exactly this path (`--version`, fixed arguments), or None if the
/// file does not run as Pandoc. Used when the user picks a Pandoc in Preferences.
pub fn probe(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let output = clean_command(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&output.stdout))
}

/// The Pandoc that would be used, with its version (asked once per path). Null without one.
pub fn info(setting: Option<&str>) -> Option<PandocInfo> {
    let path = discover(setting)?;
    {
        let cached = cache().lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((known, version)) = cached.as_ref()
            && *known == path
        {
            return Some(PandocInfo {
                path: crate::fs_util::path_text(&path),
                version: version.clone(),
            });
        }
    }
    let output = clean_command(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = parse_version(&String::from_utf8_lossy(&output.stdout))?;
    *cache().lock().unwrap_or_else(PoisonError::into_inner) = Some((path.clone(), version.clone()));
    Some(PandocInfo {
        path: crate::fs_util::path_text(&path),
        version,
    })
}

/// The whole argument list. It depends on four values only; nothing else can get in.
pub fn docx_args(
    from: &str,
    citeproc: bool,
    resource_path: &Path,
    out_path: &Path,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-f".into(), from.into()];
    if citeproc {
        args.push("--citeproc".into());
    }
    args.push("--resource-path".into());
    args.push(resource_path.into());
    args.push("-o".into());
    args.push(out_path.into());
    args
}

/// The first lines of Pandoc's error output, for the banner.
pub fn first_lines(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(ERROR_LINES)
        .collect();
    if lines.is_empty() {
        "Pandoc could not export the document.".to_string()
    } else {
        lines.join(" ")
    }
}

/// Runs Pandoc. `out_path` must already be checked against the export targets by the caller.
pub fn export_docx(
    pandoc: &Path,
    request: &DocxRequest,
    home: &Path,
    timeout: Duration,
) -> Result<(), PlatformError> {
    if !ROUTES.contains(&request.from.as_str()) {
        return Err(PlatformError::io("This document type cannot be exported."));
    }
    let out_path = PathBuf::from(&request.out_path);
    let is_docx = out_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("docx"));
    if !is_docx {
        return Err(PlatformError::io("The export must be a .docx file."));
    }
    let folder = request
        .doc_path
        .as_deref()
        .and_then(|path| Path::new(path).parent())
        .filter(|parent| parent.is_dir())
        .map_or_else(|| home.to_path_buf(), Path::to_path_buf);

    let child = clean_command(pandoc)
        .args(docx_args(
            &request.from,
            request.citeproc,
            &folder,
            &out_path,
        ))
        .current_dir(&folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| PlatformError::io("Pandoc could not be started."))?;

    let run = drive(child, request.input.clone().into_bytes(), timeout, None);
    match run.status {
        Some(status) if status.success() => Ok(()),
        Some(_) => Err(PlatformError::io(first_lines(&run.stderr))),
        None => Err(PlatformError::io("Pandoc took too long and was stopped.")),
    }
}

/// What a finished (or stopped) Pandoc run left behind.
struct Run {
    /// None when it was killed (too long, or cancelled).
    status: Option<std::process::ExitStatus>,
    stdout: Vec<u8>,
    stderr: String,
    cancelled: bool,
}

/// Feeds the input, reads the output, and waits until the process ends, `timeout` passes or
/// `cancel` is set (then the process is killed).
fn drive(
    mut child: std::process::Child,
    input: Vec<u8>,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> Run {
    let stdin = child.stdin.take();
    let writer = std::thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            // A broken pipe means Pandoc stopped early; its exit status says why.
            let _ = stdin.write_all(&input);
        }
    });
    let stdout = child.stdout.take();
    let out_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stdout) = stdout {
            let _ = stdout
                .by_ref()
                .take(MAX_PREVIEW_BYTES + 1)
                .read_to_end(&mut bytes);
        }
        bytes
    });
    let stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stderr) = stderr {
            let mut bytes = Vec::new();
            let _ = stderr.by_ref().take(64 * 1024).read_to_end(&mut bytes);
            text = String::from_utf8_lossy(&bytes).into_owned();
        }
        text
    });

    let deadline = Instant::now() + timeout;
    let mut cancelled = false;
    let status = loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            cancelled = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    // After a kill a grandchild could still hold the pipes, so nothing waits for the threads.
    if status.is_some() {
        let _ = writer.join();
        Run {
            status,
            stdout: out_reader.join().unwrap_or_default(),
            stderr: reader.join().unwrap_or_default(),
            cancelled,
        }
    } else {
        Run {
            status,
            stdout: Vec::new(),
            stderr: String::new(),
            cancelled,
        }
    }
}

/// The flavors the exact preview may use, and the Pandoc input format of each.
pub const PREVIEW_ROUTES: [&str; 3] = ["markdown", "gfm", "commonmark"];

/// The whole argument list of a preview render. Input comes on stdin and HTML leaves on stdout.
/// No `--embed-resources` (so nothing is fetched), no filters, no Lua, no templates.
pub fn preview_args(from: &str, citeproc: bool, resource_path: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        "--from".into(),
        from.into(),
        "--to".into(),
        "html5".into(),
        "--mathml".into(),
    ];
    if citeproc {
        args.push("--citeproc".into());
    }
    args.push("--resource-path".into());
    args.push(resource_path.into());
    args
}

/// What the page asks for (`PandocPreviewRequest` in `src/lib/platform.ts`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub doc_path: Option<String>,
    pub input: String,
    pub from: String,
    pub citeproc: bool,
    /// The bibliography files the document names, as the preview read them (granted by then).
    #[serde(default)]
    pub bibliography: Vec<String>,
}

/// The running render of each window: a newer request sets the flag of the older one.
fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registers a render for a window and cancels the one that was running for it.
pub fn begin_render(label: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut map = running().lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(older) = map.insert(label.to_owned(), Arc::clone(&flag)) {
        older.store(true, Ordering::SeqCst);
    }
    flag
}

/// Cancels the render of a window, if any (the preview was turned off).
pub fn cancel_render(label: &str) {
    let map = running().lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(flag) = map.get(label) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Forgets a finished render unless a newer one replaced it.
pub fn end_render(label: &str, flag: &Arc<AtomicBool>) {
    let mut map = running().lock().unwrap_or_else(PoisonError::into_inner);
    if map.get(label).is_some_and(|known| Arc::ptr_eq(known, flag)) {
        map.remove(label);
    }
}

/// Renders the document to HTML. `citeproc` has been checked by the caller (the bibliography
/// files are granted); `resource_folder` is the document's folder, already checked.
pub fn render_preview(
    pandoc: &Path,
    request: &PreviewRequest,
    citeproc: bool,
    home: &Path,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<String, PlatformError> {
    if !PREVIEW_ROUTES.contains(&request.from.as_str()) {
        return Err(PlatformError::io(
            "This document type has no exact preview.",
        ));
    }
    let folder = request
        .doc_path
        .as_deref()
        .and_then(|path| Path::new(path).parent())
        .filter(|parent| parent.is_dir())
        .map_or_else(|| home.to_path_buf(), Path::to_path_buf);
    let child = clean_command(pandoc)
        .args(preview_args(&request.from, citeproc, &folder))
        .current_dir(&folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| PlatformError::io("Pandoc could not be started."))?;
    let run = drive(
        child,
        request.input.clone().into_bytes(),
        timeout,
        Some(cancel),
    );
    if run.cancelled {
        return Err(PlatformError::io("cancelled"));
    }
    match run.status {
        Some(status) if status.success() => {
            if run.stdout.len() as u64 > MAX_PREVIEW_BYTES {
                return Err(PlatformError::io("The Pandoc preview is too large."));
            }
            Ok(String::from_utf8_lossy(&run.stdout).into_owned())
        }
        Some(_) => Err(PlatformError::io(first_lines(&run.stderr))),
        None => Err(PlatformError::io("Pandoc took too long and was stopped.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_read_from_the_first_line() {
        assert_eq!(
            parse_version("pandoc 3.8.3\nFeatures: +server\n").as_deref(),
            Some("3.8.3")
        );
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("pandoc \n"), None);
    }

    #[test]
    fn the_argument_list_is_fixed_whatever_the_request_holds() {
        // A request cannot add anything: even hostile text in the fields lands in one slot.
        let args = docx_args(
            "markdown",
            false,
            Path::new("/notes"),
            Path::new("/notes/out.docx"),
        );
        let text: Vec<String> = args
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            text,
            [
                "-f",
                "markdown",
                "--resource-path",
                "/notes",
                "-o",
                "/notes/out.docx"
            ]
        );

        let with = docx_args(
            "html",
            true,
            Path::new("/n"),
            Path::new("--lua-filter=/x.docx"),
        );
        let text: Vec<String> = with
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            text,
            [
                "-f",
                "html",
                "--citeproc",
                "--resource-path",
                "/n",
                "-o",
                "--lua-filter=/x.docx"
            ]
        );
    }

    #[test]
    fn a_route_outside_the_list_is_refused_before_anything_starts() {
        let request = DocxRequest {
            doc_path: None,
            out_path: "/tmp/out.docx".into(),
            input: String::new(),
            from: "markdown --lua-filter=/x.lua".into(),
            citeproc: false,
        };
        let result = export_docx(
            Path::new("/nonexistent/pandoc"),
            &request,
            Path::new("/"),
            Duration::from_secs(1),
        );
        assert!(result.is_err());
        let message = result.unwrap_err().message;
        assert!(message.contains("cannot be exported"), "{message}");
    }

    #[test]
    fn only_a_docx_path_is_accepted() {
        let request = DocxRequest {
            doc_path: None,
            out_path: "/tmp/out.txt".into(),
            input: String::new(),
            from: "markdown".into(),
            citeproc: false,
        };
        let result = export_docx(
            Path::new("/nonexistent/pandoc"),
            &request,
            Path::new("/"),
            Duration::from_secs(1),
        );
        assert!(result.unwrap_err().message.contains(".docx"));
    }

    #[test]
    fn error_text_is_cut_to_the_first_lines() {
        assert_eq!(first_lines("\n a \n b \n c \n d\n"), "a b c");
        assert_eq!(first_lines(""), "Pandoc could not export the document.");
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_runs_too_long_is_killed() {
        use std::os::unix::fs::PermissionsExt;
        let folder = std::env::temp_dir().join(format!("wd-pandoc-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let script = folder.join("pandoc");
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let request = DocxRequest {
            doc_path: None,
            out_path: folder.join("out.docx").to_string_lossy().into_owned(),
            input: "x".into(),
            from: "markdown".into(),
            citeproc: false,
        };
        let started = Instant::now();
        let result = export_docx(&script, &request, &folder, Duration::from_millis(300));
        let _ = std::fs::remove_dir_all(&folder);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(result.unwrap_err().message.contains("too long"));
    }

    #[test]
    fn the_real_pandoc_writes_a_docx_when_rstudio_is_installed() {
        let Some(pandoc) = discover(None).filter(|p| p.starts_with("/Applications/RStudio.app"))
        else {
            eprintln!("pandoc: RStudio Pandoc not found; the real export test is skipped");
            return;
        };
        let folder = std::env::temp_dir().join(format!("wd-pandoc-real-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let out = folder.join("out.docx");
        let request = DocxRequest {
            doc_path: Some(folder.join("note.md").to_string_lossy().into_owned()),
            out_path: out.to_string_lossy().into_owned(),
            input: "# Heading one\n\nBody text.\n".into(),
            from: "markdown".into(),
            citeproc: false,
        };
        let result = export_docx(&pandoc, &request, &folder, TIMEOUT);
        let bytes = std::fs::read(&out).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&folder);
        result.expect("pandoc exports");
        // A .docx is a zip file.
        assert!(bytes.starts_with(b"PK"), "the output is a zip file");

        let failing = DocxRequest {
            from: "html".into(),
            out_path: "/nonexistent-folder/out.docx".into(),
            ..request
        };
        let message = export_docx(&pandoc, &failing, Path::new("/"), TIMEOUT)
            .unwrap_err()
            .message;
        assert!(!message.is_empty());
    }

    fn preview_request(from: &str, input: &str) -> PreviewRequest {
        PreviewRequest {
            doc_path: None,
            input: input.into(),
            from: from.into(),
            citeproc: false,
            bibliography: Vec::new(),
        }
    }

    fn texts(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn the_preview_argument_list_is_fixed_for_every_flavor() {
        for from in PREVIEW_ROUTES {
            assert_eq!(
                texts(&preview_args(from, false, Path::new("/notes"))),
                [
                    "--from",
                    from,
                    "--to",
                    "html5",
                    "--mathml",
                    "--resource-path",
                    "/notes"
                ]
            );
            assert_eq!(
                texts(&preview_args(from, true, Path::new("/notes"))),
                [
                    "--from",
                    from,
                    "--to",
                    "html5",
                    "--mathml",
                    "--citeproc",
                    "--resource-path",
                    "/notes"
                ]
            );
        }
        // Nothing that fetches, embeds, filters or runs code can be in the list.
        let all = texts(&preview_args("markdown", true, Path::new("/n"))).join(" ");
        for banned in ["embed-resources", "self-contained", "filter", "lua", "-o"] {
            assert!(!all.contains(banned), "{banned}");
        }
    }

    #[test]
    fn a_preview_route_outside_the_list_is_refused_before_anything_starts() {
        let result = render_preview(
            Path::new("/nonexistent/pandoc"),
            &preview_request("markdown --lua-filter=/x.lua", ""),
            false,
            Path::new("/"),
            Duration::from_secs(1),
            &AtomicBool::new(false),
        );
        assert!(result.unwrap_err().message.contains("no exact preview"));
    }

    #[cfg(unix)]
    fn slow_pandoc(name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let folder = std::env::temp_dir().join(format!("wd-pandoc-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let script = folder.join("pandoc");
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[cfg(unix)]
    #[test]
    fn a_preview_that_runs_too_long_is_killed() {
        let script = slow_pandoc("preview-timeout");
        let started = Instant::now();
        let result = render_preview(
            &script,
            &preview_request("markdown", "x"),
            false,
            script.parent().unwrap(),
            Duration::from_millis(300),
            &AtomicBool::new(false),
        );
        let _ = std::fs::remove_dir_all(script.parent().unwrap());
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(result.unwrap_err().message.contains("too long"));
        assert_eq!(PREVIEW_TIMEOUT, Duration::from_secs(30));
    }

    #[cfg(unix)]
    #[test]
    fn a_newer_render_cancels_the_running_one() {
        let script = slow_pandoc("preview-cancel");
        let older = begin_render("cancel-test");
        let flag = Arc::clone(&older);
        let folder = script.parent().unwrap().to_path_buf();
        let handle = std::thread::spawn({
            let script = script.clone();
            move || {
                render_preview(
                    &script,
                    &preview_request("gfm", "x"),
                    false,
                    &folder,
                    Duration::from_secs(20),
                    &flag,
                )
            }
        });
        std::thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        let newer = begin_render("cancel-test");
        assert!(older.load(Ordering::SeqCst));
        assert!(!newer.load(Ordering::SeqCst));
        let result = handle.join().unwrap();
        end_render("cancel-test", &newer);
        let _ = std::fs::remove_dir_all(script.parent().unwrap());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(result.unwrap_err().message, "cancelled");
    }

    #[test]
    fn the_real_pandoc_renders_each_flavor_as_html_with_mathml() {
        let Some(pandoc) = discover(None).filter(|p| p.starts_with("/Applications/RStudio.app"))
        else {
            eprintln!("pandoc: RStudio Pandoc not found; the real preview test is skipped");
            return;
        };
        let no_cancel = AtomicBool::new(false);
        for from in PREVIEW_ROUTES {
            let html = render_preview(
                &pandoc,
                &preview_request(from, "# Heading one\n\nBody *text* with $x^2$.\n"),
                false,
                Path::new("/"),
                PREVIEW_TIMEOUT,
                &no_cancel,
            )
            .expect(from);
            assert!(html.contains("<h1"), "{from}: {html}");
            assert!(html.contains("<em>text</em>"), "{from}: {html}");
        }
        let math = render_preview(
            &pandoc,
            &preview_request("markdown", "$x^2$\n"),
            false,
            Path::new("/"),
            PREVIEW_TIMEOUT,
            &no_cancel,
        )
        .unwrap();
        assert!(math.contains("<math"), "{math}");
        assert!(
            render_preview(
                &pandoc,
                &preview_request("markdown", "```{=html}\n<p>raw</p>\n```\n"),
                false,
                Path::new("/"),
                PREVIEW_TIMEOUT,
                &no_cancel,
            )
            .is_ok()
        );
    }
}
