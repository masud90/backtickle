//! Render with Quarto: the quoting and the generated script are checked with a real
//! shell. This file lives outside `src/`, so the process-source scan (`config.rs` B31) does not
//! see it; the app itself starts nothing.

use backtickle_lib::render::write_command_file;
#[cfg(unix)]
use backtickle_lib::render::{script_text, shell_quote};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

/// The shell the render script names on its first line: zsh on macOS, bash on Linux (where it
/// also waits for Enter, so the tests give it no input).
const SCRIPT_SHELL: &str = if cfg!(target_os = "macos") {
    "/bin/zsh"
} else {
    "/bin/bash"
};

fn temp(label: &str) -> PathBuf {
    let dir = backtickle_lib::fs_util::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "backtickle-render-test-{label}-{}",
            std::process::id()
        ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(unix)]
#[test]
fn a_real_shell_reads_the_quoted_text_back_unchanged() {
    let dir = temp("quote");
    for (index, text) in [
        "plain",
        "a b",
        "it's",
        "'' ''",
        "$HOME `id` $(id) \\ \"",
        "line1\nline2",
        "; touch pwned #",
    ]
    .iter()
    .enumerate()
    {
        let out = dir.join(format!("out{index}"));
        let line = format!(
            "printf %s {} > {}",
            shell_quote(text),
            shell_quote(&out.to_string_lossy())
        );
        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg(&line)
            .current_dir(&dir)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(std::fs::read_to_string(&out).unwrap(), *text);
    }
    assert!(!dir.join("pwned").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn the_script_runs_quarto_in_the_documents_folder_and_removes_itself() {
    let base = temp("script");
    let docs = base.join("My Docs 'x'");
    std::fs::create_dir_all(&docs).unwrap();
    let bin = base.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let log = base.join("ran.txt");
    let fake = bin.join("quarto");
    std::fs::write(
        &fake,
        format!(
            "#!/bin/sh\npwd > '{0}'\necho \"$@\" >> '{0}'\n",
            log.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let script = write_command_file(&base, &docs.to_string_lossy(), "it's a.qmd", false).unwrap();
    let folder = script.parent().unwrap().to_path_buf();
    assert_eq!(
        std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(&script).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let status = Command::new(SCRIPT_SHELL)
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .status()
        .unwrap();
    assert!(status.success());
    let ran = std::fs::read_to_string(&log).unwrap();
    let mut lines = ran.lines();
    assert_eq!(
        backtickle_lib::fs_util::canonicalize(lines.next().unwrap()).unwrap(),
        backtickle_lib::fs_util::canonicalize(&docs).unwrap()
    );
    assert_eq!(lines.next().unwrap(), "render it's a.qmd");
    assert!(
        !script.exists() && !folder.exists(),
        "the script removed itself and its folder"
    );
    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(unix)]
#[test]
fn without_quarto_or_rscript_the_script_says_so() {
    let base = temp("none");
    let script = write_command_file(&base, "/", "a.Rmd", true).unwrap();
    // A PATH with only what the script's clean-up needs: R may be installed on the machine (it
    // is on GitHub's Ubuntu runners).
    let bin = base.join("bin");
    std::fs::create_dir(&bin).unwrap();
    for tool in ["rm", "rmdir"] {
        let real = ["/bin", "/usr/bin"]
            .iter()
            .map(|dir| std::path::Path::new(dir).join(tool))
            .find(|path| path.exists())
            .unwrap();
        std::os::unix::fs::symlink(real, bin.join(tool)).unwrap();
    }
    let out = Command::new(SCRIPT_SHELL)
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .env("PATH", &bin)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("neither quarto nor Rscript was found"),
        "{text}"
    );
    assert!(!script.exists());
    assert!(script_text("/", "a.Rmd", true, "/s", "/d").contains("Rscript"));
    let _ = std::fs::remove_dir_all(&base);
}

/// cmd.exe with only the folder of the fake tools and the system folder on its path.
#[cfg(windows)]
fn run_cmd(script: &std::path::Path, bin: &std::path::Path) -> std::process::Output {
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    Command::new("cmd.exe")
        .arg("/d")
        .arg("/c")
        .arg(script)
        .env("PATH", format!("{};{system}\\System32", bin.display()))
        .stdin(std::process::Stdio::null())
        .output()
        .unwrap()
}

#[cfg(windows)]
#[test]
fn the_windows_script_runs_quarto_in_the_documents_folder_and_removes_itself() {
    let base = temp("cmd");
    // `&` and `%` mean something to cmd; inside the quotes they must not.
    let docs = base.join("My Docs 'x' & 100%");
    std::fs::create_dir_all(&docs).unwrap();
    let bin = base.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let log = base.join("ran.txt");
    std::fs::write(
        bin.join("quarto.cmd"),
        format!(
            "@echo off\r\ncd > \"{0}\"\r\n>>\"{0}\" echo %*\r\n",
            log.display()
        ),
    )
    .unwrap();

    let script = write_command_file(&base, &docs.to_string_lossy(), "it's a.qmd", false).unwrap();
    let folder = script.parent().unwrap().to_path_buf();
    let out = run_cmd(&script, &bin);

    let ran = std::fs::read_to_string(&log)
        .unwrap_or_else(|_| panic!("quarto ran: {}", String::from_utf8_lossy(&out.stdout)));
    let mut lines = ran.lines();
    assert_eq!(
        backtickle_lib::fs_util::canonicalize(lines.next().unwrap().trim()).unwrap(),
        backtickle_lib::fs_util::canonicalize(&docs).unwrap()
    );
    assert_eq!(lines.next().unwrap().trim(), "render \"it's a.qmd\"");
    assert!(
        !script.exists() && !folder.exists(),
        "the script removed itself and its folder"
    );
    let _ = std::fs::remove_dir_all(&base);
}

#[cfg(windows)]
#[test]
fn without_quarto_or_rscript_the_windows_script_says_so() {
    let base = temp("cmd-none");
    let bin = base.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let script = write_command_file(&base, &base.to_string_lossy(), "a.Rmd", true).unwrap();

    let out = run_cmd(&script, &bin);

    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("neither quarto nor Rscript was found"),
        "{text}"
    );
    assert!(!script.exists());
    let _ = std::fs::remove_dir_all(&base);
}
