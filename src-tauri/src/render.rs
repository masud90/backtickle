//! Render with Quarto.
//!
//! Writedown never runs the document's code and never starts a process itself. With RStudio
//! installed the document is opened in RStudio (the user presses Render there). Without it a
//! `.command` file is written to a private temporary folder and opened with Terminal through
//! `NSWorkspace`; the script runs `quarto render` (or `rmarkdown::render` for `.Rmd`) and removes
//! itself. The pure parts (quoting, template, target choice, file writing) are unit-tested; the
//! AppKit calls are in `imp` and run on the main thread.
//!
//! On Windows the same choice is made: RStudio when it is installed, otherwise a `.cmd` file in a
//! private temporary folder, opened by the shell (so it runs in a Command Prompt window); it runs
//! `quarto render` (or `Rscript` for `.Rmd`), waits for a key and removes itself.

use std::path::{Path, PathBuf};

/// The bundle id that identifies RStudio.
pub const RSTUDIO_BUNDLE_ID: &str = "com.rstudio.desktop";
/// The bundle id of Terminal.
pub const TERMINAL_BUNDLE_ID: &str = "com.apple.Terminal";

/// Where a render request goes. The trace and the page use the lowercase names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Rstudio,
    Terminal,
    None,
}

impl Target {
    pub fn name(self) -> &'static str {
        match self {
            Target::Rstudio => "rstudio",
            Target::Terminal => "terminal",
            Target::None => "none",
        }
    }
}

/// RStudio wins when the lookup by bundle id found it; otherwise Terminal does.
pub fn choose_target(rstudio: Option<&Path>) -> Target {
    if rstudio.is_some() {
        Target::Rstudio
    } else {
        Target::Terminal
    }
}

/// Only Quarto and R Markdown files can be rendered.
pub fn is_renderable(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("qmd") || extension.eq_ignore_ascii_case("rmd")
        })
}

/// `.Rmd` (any case) can fall back to `rmarkdown::render`; `.qmd` cannot.
pub fn is_rmd(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("rmd"))
}

/// Quotes text for a POSIX shell: single quotes, each embedded single quote written as `'\''`.
/// Nothing inside single quotes is interpreted (spaces, `$`, backticks, newlines stay literal).
pub fn shell_quote(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len() + 2);
    quoted.push('\'');
    for ch in text.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    quoted
}

/// The script. `folder` and `name` are the document's folder and file name, `script` the path of
/// the script itself and `script_dir` its private folder (both removed when it ends). The
/// document name reaches `Rscript` as an argument, never inside the R expression.
pub fn script_text(folder: &str, name: &str, rmd: bool, script: &str, script_dir: &str) -> String {
    // A name that starts with a dash would be read as an option.
    let arg = if name.starts_with('-') {
        format!("./{name}")
    } else {
        name.to_owned()
    };
    let folder = shell_quote(folder);
    let arg = shell_quote(&arg);
    let script = shell_quote(script);
    let script_dir = shell_quote(script_dir);
    let fallback = if rmd {
        format!(
            "elif command -v Rscript >/dev/null 2>&1; then\n  Rscript -e 'rmarkdown::render(commandArgs(trailingOnly = TRUE)[1])' {arg}\n"
        )
    } else {
        String::new()
    };
    format!(
        "#!/bin/zsh -l\n\
         cleanup() {{ rm -f -- {script}; rmdir -- {script_dir} 2>/dev/null; }}\n\
         trap cleanup EXIT\n\
         cd -- {folder} || exit 1\n\
         if command -v quarto >/dev/null 2>&1; then\n  quarto render {arg}\n\
         {fallback}else\n  echo 'Writedown could not render this document: neither quarto nor Rscript was found.'\n  echo 'Install Quarto from quarto.org, or open the document in RStudio.'\nfi\n"
    )
}

/// Quotes text for a Windows batch file: in double quotes (a Windows name cannot contain one), with
/// every `%` doubled so it is not read as a variable. Inside the quotes `&`, `|`, `<`, `>` and `^`
/// are literal.
pub fn cmd_quote(text: &str) -> String {
    format!("\"{}\"", text.replace('%', "%%"))
}

/// The Windows script (CRLF line ends, UTF-8: `chcp 65001` makes cmd read the lines after it so). `call` lets the script go on after `quarto` (a batch file
/// in some installs). It waits for a key so the output can be read, then removes itself and its
/// folder: the last line is read whole before it runs, so `%~f0` still names the script.
pub fn cmd_script_text(folder: &str, name: &str, rmd: bool) -> String {
    // A name that starts with a dash would be read as an option.
    let arg = if name.starts_with('-') {
        format!(".\\{name}")
    } else {
        name.to_owned()
    };
    let folder = cmd_quote(folder);
    let arg = cmd_quote(&arg);
    let fallback = if rmd {
        format!(
            "where Rscript >nul 2>nul && (call Rscript -e \"rmarkdown::render(commandArgs(trailingOnly = TRUE)[1])\" {arg} & goto end)\r\n"
        )
    } else {
        String::new()
    };
    format!(
        "@echo off\r\n\
         chcp 65001 >nul\r\n\
         cd /d {folder} || goto end\r\n\
         where quarto >nul 2>nul && (call quarto render {arg} & goto end)\r\n\
         {fallback}\
         echo Writedown could not render this document: neither quarto nor Rscript was found.\r\n\
         echo Install Quarto from quarto.org, or open the document in RStudio.\r\n\
         :end\r\n\
         pause\r\n\
         (goto) 2>nul & del \"%~f0\" & rmdir \"%~dp0.\"\r\n"
    )
}

/// Why a render could not start. The text is shown to the user.
#[derive(Debug, PartialEq, Eq)]
pub struct RenderError(pub String);

/// Writes the script into a new private folder (0700, the file 0700) under `base` and returns
/// the script path. The folder name is unique; an existing folder is never reused.
pub fn write_command_file(
    base: &Path,
    folder: &str,
    name: &str,
    rmd: bool,
) -> Result<PathBuf, RenderError> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let failed = || RenderError("The render script could not be written.".to_owned());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = base.join(format!(
        "writedown-render-{}-{stamp}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(&dir).map_err(|_| failed())?;
    #[cfg(not(windows))]
    let (script, text) = {
        let script = dir.join("render.command");
        let text = script_text(
            folder,
            name,
            rmd,
            &script.to_string_lossy(),
            &dir.to_string_lossy(),
        );
        (script, text)
    };
    // The temporary folder of a Windows user is private to that user already.
    #[cfg(windows)]
    let (script, text) = (dir.join("render.cmd"), cmd_script_text(folder, name, rmd));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o700);
    let written = options
        .open(&script)
        .and_then(|mut file| file.write_all(text.as_bytes()));
    if written.is_err() {
        crate::fs_util::discard_temp(&script);
        crate::fs_util::discard_temp_dir(&dir);
        return Err(failed());
    }
    Ok(script)
}

/// Starts the render for `doc` (a granted `.qmd` or `.Rmd` file) and says where it went. Must run
/// on the main thread.
#[cfg(target_os = "macos")]
pub fn start(doc: &Path) -> Result<Target, RenderError> {
    imp::start(doc)
}

#[cfg(windows)]
pub fn start(doc: &Path) -> Result<Target, RenderError> {
    win::start(doc)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn start(_doc: &Path) -> Result<Target, RenderError> {
    Err(RenderError(
        "Render with Quarto is not available on this system.".to_owned(),
    ))
}

/// Where RStudio is installed on Windows (for all users, or for this user only), if it is.
#[cfg(windows)]
pub fn rstudio_exe() -> Option<PathBuf> {
    let roots = ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from);
    roots
        .flat_map(|root| {
            [
                root.join("RStudio").join("rstudio.exe"),
                root.join("RStudio").join("bin").join("rstudio.exe"),
                root.join("Programs").join("RStudio").join("rstudio.exe"),
            ]
        })
        .find(|exe| exe.is_file())
}

#[cfg(windows)]
mod win {
    use super::{RenderError, Target, choose_target, is_rmd, rstudio_exe, write_command_file};
    use std::path::Path;

    pub fn start(doc: &Path) -> Result<Target, RenderError> {
        let rstudio = rstudio_exe();
        if choose_target(rstudio.as_deref()) == Target::Rstudio
            && let Some(exe) = rstudio
        {
            tauri_plugin_opener::open_path(doc, Some(exe.to_string_lossy()))
                .map_err(|_| RenderError("RStudio could not open the document.".to_owned()))?;
            return Ok(Target::Rstudio);
        }
        let folder = doc
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .ok_or_else(|| RenderError("The document has no folder.".to_owned()))?;
        let name = doc
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| RenderError("The document has no name.".to_owned()))?;
        let base = crate::fs_util::canonicalize(std::env::temp_dir())
            .map_err(|_| RenderError("The render script could not be written.".to_owned()))?;
        let script = write_command_file(&base, &folder, &name, is_rmd(doc))?;
        let opened = tauri_plugin_opener::open_path(&script, None::<&str>)
            .map_err(|_| RenderError("The render script could not be started.".to_owned()));
        if opened.is_err()
            && let Some(dir) = script.parent()
        {
            crate::fs_util::discard_temp(&script);
            crate::fs_util::discard_temp_dir(dir);
        }
        opened.map(|()| Target::Terminal)
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{
        RSTUDIO_BUNDLE_ID, RenderError, TERMINAL_BUNDLE_ID, Target, choose_target, is_rmd,
        write_command_file,
    };
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};
    use std::path::{Path, PathBuf};

    fn app_url(workspace: &NSWorkspace, bundle_id: &str) -> Option<Retained<NSURL>> {
        let id = NSString::from_str(bundle_id);
        // SAFETY: the answer is an application URL or nil.
        unsafe { msg_send![workspace, URLForApplicationWithBundleIdentifier: &*id] }
    }

    fn url_path(url: &NSURL) -> Option<PathBuf> {
        url.path().map(|path| PathBuf::from(path.to_string()))
    }

    /// Opens `file` with the application at `app`. The completion block runs on a system queue.
    fn open_with(
        workspace: &NSWorkspace,
        file: &Path,
        app: &NSURL,
        failure: &'static str,
    ) -> Result<(), RenderError> {
        let fail = || RenderError(failure.to_owned());
        let path = NSString::from_str(&file.to_string_lossy());
        let file_url = NSURL::fileURLWithPath(&path);
        let urls = NSArray::from_slice(&[&*file_url]);
        let class = AnyClass::get(c"NSWorkspaceOpenConfiguration").ok_or_else(fail)?;
        // SAFETY: `configuration` is a class method that returns a new configuration object.
        let configuration: Retained<AnyObject> = unsafe { msg_send![class, configuration] };
        let handler = block2::RcBlock::new(|_app: *mut AnyObject, _error: *mut AnyObject| {});
        // SAFETY: the arguments are an array of URLs, an application URL, a configuration and a
        // completion block with the Objective-C signature (`NSRunningApplication *`, `NSError *`).
        unsafe {
            let _: () = msg_send![
                workspace,
                openURLs: &*urls,
                withApplicationAtURL: app,
                configuration: &*configuration,
                completionHandler: &*handler
            ];
        }
        Ok(())
    }

    pub fn start(doc: &Path) -> Result<Target, RenderError> {
        let workspace = NSWorkspace::sharedWorkspace();
        let rstudio = app_url(&workspace, RSTUDIO_BUNDLE_ID);
        let rstudio_path = rstudio.as_deref().and_then(url_path);
        match choose_target(rstudio_path.as_deref()) {
            Target::Rstudio => {
                if let Some(rstudio) = rstudio {
                    open_with(
                        &workspace,
                        doc,
                        &rstudio,
                        "RStudio could not open the document.",
                    )?;
                    return Ok(Target::Rstudio);
                }
                Ok(Target::None)
            }
            _ => {
                let Some(terminal) = app_url(&workspace, TERMINAL_BUNDLE_ID) else {
                    return Err(RenderError("Terminal could not be found.".to_owned()));
                };
                let folder = doc
                    .parent()
                    .map(|p| p.to_string_lossy().into_owned())
                    .ok_or_else(|| RenderError("The document has no folder.".to_owned()))?;
                let name = doc
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .ok_or_else(|| RenderError("The document has no name.".to_owned()))?;
                let base = crate::fs_util::canonicalize(std::env::temp_dir()).map_err(|_| {
                    RenderError("The render script could not be written.".to_owned())
                })?;
                let script = write_command_file(&base, &folder, &name, is_rmd(doc))?;
                let opened = open_with(
                    &workspace,
                    &script,
                    &terminal,
                    "Terminal could not open the render script.",
                );
                if opened.is_err()
                    && let Some(dir) = script.parent()
                {
                    crate::fs_util::discard_temp(&script);
                    crate::fs_util::discard_temp_dir(dir);
                }
                opened.map(|()| Target::Terminal)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_keeps_every_special_character_literal() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(shell_quote("'"), r"''\'''");
        assert_eq!(shell_quote("$HOME `id` $(id)"), "'$HOME `id` $(id)'");
        assert_eq!(shell_quote("a\nb"), "'a\nb'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn the_windows_script_quotes_the_paths_and_keeps_percent_signs_literal() {
        assert_eq!(cmd_quote("C:/My Notes"), "\"C:/My Notes\"");
        assert_eq!(cmd_quote("100% & more"), "\"100%% & more\"");
        let text = cmd_script_text("C:/Users/me/My Notes", "report 100%.qmd", false);
        assert!(text.starts_with("@echo off\r\nchcp 65001 >nul\r\n"));
        assert!(text.contains("cd /d \"C:/Users/me/My Notes\" || goto end"));
        assert!(text.contains("call quarto render \"report 100%%.qmd\""));
        assert!(!text.contains("Rscript -e"), "no R fallback for .qmd");
        assert!(text.contains("del \"%~f0\""), "the script removes itself");
        assert!(
            text.lines()
                .all(|line| !line.ends_with('\r') || text.contains("\r\n"))
        );
    }

    #[test]
    fn the_windows_script_of_an_rmd_has_the_rscript_fallback_and_a_dash_name_is_not_an_option() {
        let text = cmd_script_text("C:/x", "-a.Rmd", true);
        assert!(text.contains("call Rscript -e"));
        assert!(text.contains("\".\\-a.Rmd\""));
    }

    #[test]
    fn the_target_follows_the_lookup_result() {
        assert_eq!(
            choose_target(Some(Path::new("/Applications/RStudio.app"))),
            Target::Rstudio
        );
        assert_eq!(choose_target(None), Target::Terminal);
        assert_eq!(Target::Rstudio.name(), "rstudio");
        assert_eq!(Target::Terminal.name(), "terminal");
        assert_eq!(Target::None.name(), "none");
    }

    #[test]
    fn only_qmd_and_rmd_files_render() {
        assert!(is_renderable(Path::new("/a/b.qmd")));
        assert!(is_renderable(Path::new("/a/b.Rmd")));
        assert!(is_renderable(Path::new("/a/b.RMD")));
        assert!(!is_renderable(Path::new("/a/b.md")));
        assert!(!is_renderable(Path::new("/a/b")));
        assert!(is_rmd(Path::new("/a/b.Rmd")));
        assert!(!is_rmd(Path::new("/a/b.qmd")));
    }

    #[test]
    fn the_template_quotes_the_paths_and_removes_itself() {
        let text = script_text(
            "/Users/x/My Docs/it's",
            "a b.qmd",
            false,
            "/tmp/d/render.command",
            "/tmp/d",
        );
        assert!(text.starts_with("#!/bin/zsh -l\n"));
        assert!(text.contains(r"cd -- '/Users/x/My Docs/it'\''s' || exit 1"));
        assert!(text.contains("quarto render 'a b.qmd'"));
        assert!(text.contains("rm -f -- '/tmp/d/render.command'"));
        assert!(!text.contains("Rscript -e"), "a .qmd has no R fallback");
        assert!(text.contains("neither quarto nor Rscript was found"));
    }

    #[test]
    fn an_rmd_gets_the_rscript_fallback_with_the_name_as_an_argument() {
        let text = script_text("/d", "r.Rmd", true, "/t/render.command", "/t");
        assert!(text.contains(
            "Rscript -e 'rmarkdown::render(commandArgs(trailingOnly = TRUE)[1])' 'r.Rmd'"
        ));
    }

    #[test]
    fn a_name_that_starts_with_a_dash_is_not_an_option() {
        let text = script_text("/d", "-x.qmd", false, "/t/s", "/t");
        assert!(text.contains("quarto render './-x.qmd'"));
    }

    #[cfg(unix)]
    #[test]
    fn the_script_file_and_its_folder_are_private() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        let base = crate::test_support::TempDir::new();
        let script = write_command_file(base.path(), "/d", "a.qmd", false).expect("written");
        let dir = script.parent().expect("folder");
        assert_eq!(
            std::fs::metadata(dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&script).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(
            std::fs::read_to_string(&script)
                .unwrap()
                .contains("quarto render 'a.qmd'")
        );
        let again = write_command_file(base.path(), "/d", "a.qmd", false).expect("written");
        assert_ne!(again.parent(), script.parent(), "never reused");
    }
}
