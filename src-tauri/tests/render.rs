//! Render with Quarto: the quoting and the generated script are checked with a real
//! shell. This file lives outside `src/`, so the process-source scan (`config.rs` B31) does not
//! see it; the app itself starts nothing.

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;
use writedown_lib::render::{script_text, shell_quote, write_command_file};

fn temp(label: &str) -> PathBuf {
    let dir = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "writedown-render-test-{label}-{}",
            std::process::id()
        ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

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
    let status = Command::new("/bin/zsh")
        .arg(&script)
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .status()
        .unwrap();
    assert!(status.success());
    let ran = std::fs::read_to_string(&log).unwrap();
    let mut lines = ran.lines();
    assert_eq!(
        std::fs::canonicalize(lines.next().unwrap()).unwrap(),
        std::fs::canonicalize(&docs).unwrap()
    );
    assert_eq!(lines.next().unwrap(), "render it's a.qmd");
    assert!(
        !script.exists() && !folder.exists(),
        "the script removed itself and its folder"
    );
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn without_quarto_or_rscript_the_script_says_so() {
    let base = temp("none");
    let script = write_command_file(&base, "/", "a.Rmd", true).unwrap();
    let out = Command::new("/bin/zsh")
        .arg(&script)
        .env("PATH", "/usr/bin:/bin")
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
