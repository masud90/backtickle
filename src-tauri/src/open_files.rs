//! Files that reach the app from outside: a double click in Finder, a file dropped on
//! the Dock icon (`RunEvent::Opened`), a file dropped on the main window, an Open Recent entry.
//!
//! Only documents are taken (the Markdown family, `mdx`, `qmd`, `rmd`, `mmd`, `txt`); anything
//! else, folders and missing files are ignored. Each accepted file is granted (see `grants.rs`)
//! and handed to the frontend by its canonical path.

use crate::file_types;
use crate::grants::PathGrants;
use crate::lifecycle;
use crate::pending::{Pages, Routed};
use crate::trace::Trace;
use crate::windows::{self, DocWindows, MAIN_LABEL};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Wry};
use url::Url;

/// The event that carries opened files (canonical paths, already granted) to the main page.
pub const OPEN_FILES_EVENT: &str = "open-files";

/// The local paths of `file:` URLs. Other URLs (and `file:` URLs of other machines) are ignored.
pub fn urls_to_paths(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect()
}

/// Filters, grants and canonicalizes opened or dropped paths. The result is in the order given,
/// without duplicates.
///
/// A path is taken if it names a document and, after symbolic links are resolved, still is a
/// regular file with a document extension.
pub fn accept_paths(grants: &PathGrants, paths: &[PathBuf]) -> Vec<String> {
    let mut accepted: Vec<String> = Vec::new();
    for path in paths {
        if !file_types::is_document_path(path) {
            continue;
        }
        let Ok(canonical) = std::fs::canonicalize(path) else {
            continue; // missing
        };
        // A folder, or a link named like a document that points to something else, is not
        // taken, and nothing is granted for it.
        if !canonical.is_file() || !file_types::is_document_path(&canonical) {
            continue;
        }
        grants.grant_resolved(&canonical);
        let text = canonical.to_string_lossy().into_owned();
        if !accepted.contains(&text) {
            accepted.push(text);
        }
    }
    accepted
}

/// Removes repeated paths, keeping the first of each.
pub fn dedupe(paths: Vec<String>) -> Vec<String> {
    let mut unique: Vec<String> = Vec::with_capacity(paths.len());
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

/// Which window gets which file: a file that is open in a window goes to that window (so it is
/// never open twice), the others go to `default`. Groups keep the order of the first file of
/// each window.
pub fn group_by_window(
    paths: &[String],
    default: &str,
    holder_of: impl Fn(&str) -> Option<String>,
) -> Vec<(String, Vec<String>)> {
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for path in paths {
        let label = holder_of(path).unwrap_or_else(|| default.to_owned());
        match groups.iter_mut().find(|(existing, _)| *existing == label) {
            Some((_, list)) => list.push(path.clone()),
            None => groups.push((label, vec![path.clone()])),
        }
    }
    groups
}

/// Hands granted files to the document windows as `open-files` events: a file already open in a
/// window goes to that window, the others to the focused document window (else the last focused,
/// else `main`). If no window exists `main` is created first; if a page is not ready for events
/// yet, the files are queued for `takePendingOpenFiles`. The window that got files is brought to
/// the front.
pub fn deliver(app: &AppHandle<Wry>, paths: Vec<String>) {
    route(app, None, paths);
}

/// The same for files dropped on the window `label`: the files that are not open elsewhere go to
/// that window.
pub fn deliver_to(app: &AppHandle<Wry>, label: &str, paths: Vec<String>) {
    route(app, Some(label), paths);
}

fn route(app: &AppHandle<Wry>, preferred: Option<&str>, paths: Vec<String>) {
    let paths = dedupe(paths);
    if paths.is_empty() {
        return;
    }
    // Opened can arrive before Tauri has created the configured windows (a Finder launch).
    // Creating `main` then would make Tauri panic; the files are queued for `main` instead and
    // its page takes them when it starts.
    if lifecycle::should_create_main(
        windows::document_labels(app).is_empty(),
        app.state::<lifecycle::Lifecycle>().is_setup_done(),
    ) && let Err(error) = lifecycle::create_main_window(app)
    {
        eprintln!("writedown: the main window could not be created: {error}");
        return;
    }
    let default = preferred
        .map(str::to_owned)
        .or_else(|| windows::target_label(app))
        .unwrap_or_else(|| MAIN_LABEL.to_owned());
    let docs = app.state::<DocWindows>();
    let existing = windows::document_labels(app);
    let groups = group_by_window(&paths, &default, |path| {
        docs.holder_of(path, None)
            .filter(|label| existing.contains(label))
    });
    let mut front = None;
    for (label, batch) in groups {
        send_to(app, &label, batch);
        front = Some(label);
    }
    if let Some(label) = front {
        lifecycle::focus_window(app, &label);
    }
}

/// Sends files to one window's page (queued until it listens) and brings the window forward.
/// The window is used as given: nothing looks for another window that holds the files.
pub fn deliver_exact(app: &AppHandle<Wry>, label: &str, paths: Vec<String>) {
    let paths = dedupe(paths);
    if paths.is_empty() {
        return;
    }
    send_to(app, label, paths);
    lifecycle::focus_window(app, label);
}

fn send_to(app: &AppHandle<Wry>, label: &str, batch: Vec<String>) {
    let trace = app.state::<Trace>();
    match app.state::<Pages>().route_files(label, batch.clone()) {
        Routed::Deliver(batch) => {
            let _ = app.emit_to(label, OPEN_FILES_EVENT, &batch);
            trace.event(
                "open-files",
                json!({ "paths": batch, "queued": false, "window": label }),
            );
        }
        Routed::Queued => {
            trace.event(
                "open-files",
                json!({ "paths": batch, "queued": true, "window": label }),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use std::os::unix::fs::symlink;

    fn canonical(path: &PathBuf) -> String {
        std::fs::canonicalize(path)
            .expect("canonical")
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn r08_documents_are_accepted_granted_and_returned_by_their_canonical_path() {
        let dir = TempDir::new();
        let a = dir.write("a.md", b"x");
        let b = dir.write("b.txt", b"x");
        let grants = PathGrants::default();

        let accepted = accept_paths(&grants, &[a.clone(), b.clone()]);

        assert_eq!(accepted, [canonical(&a), canonical(&b)]);
        for path in &accepted {
            assert!(
                grants.check(std::path::Path::new(path)).is_ok(),
                "{path} is granted"
            );
        }
    }

    #[test]
    fn r08_every_document_extension_is_accepted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        // Distinct stems: the volume is case-insensitive, so "a.Rmd" and "a.rmd" would collide.
        let paths: Vec<PathBuf> = [
            "md", "markdown", "mdown", "mkd", "mkdn", "mdx", "qmd", "Rmd", "rmd", "mmd", "txt",
            "MD",
        ]
        .iter()
        .enumerate()
        .map(|(index, extension)| dir.write(&format!("doc{index}.{extension}"), b"x"))
        .collect();

        assert_eq!(accept_paths(&grants, &paths).len(), 12);
    }

    #[test]
    fn r08_other_files_are_ignored_and_not_granted() {
        let dir = TempDir::new();
        let grants = PathGrants::default();
        let ignored: Vec<PathBuf> = [
            "a.pdf", "a.docx", "a.sh", "a.png", "a", "a.md.bak", "a.html",
        ]
        .iter()
        .map(|name| dir.write(name, b"x"))
        .collect();

        assert!(accept_paths(&grants, &ignored).is_empty());
        for path in &ignored {
            assert!(!grants.is_granted(&std::fs::canonicalize(path).expect("canonical")));
        }
    }

    #[test]
    fn r08_folders_and_missing_files_are_ignored() {
        let dir = TempDir::new();
        std::fs::create_dir(dir.path().join("folder.md")).expect("mkdir");
        let grants = PathGrants::default();

        let accepted = accept_paths(
            &grants,
            &[
                dir.path().join("folder.md"),
                dir.path().join("missing.md"),
                dir.path().to_path_buf(),
            ],
        );

        assert!(accepted.is_empty());
    }

    #[test]
    fn r08_the_order_is_kept_and_duplicates_are_removed() {
        let dir = TempDir::new();
        let a = dir.write("a.md", b"x");
        let b = dir.write("b.md", b"x");
        let grants = PathGrants::default();

        let accepted = accept_paths(&grants, &[b.clone(), a.clone(), b.clone(), a.clone()]);

        assert_eq!(accepted, [canonical(&b), canonical(&a)]);
    }

    #[test]
    fn r08_two_spellings_of_one_file_are_one_file() {
        let dir = TempDir::new();
        let a = dir.write("a.md", b"x");
        let link = dir.path().join("link.md");
        symlink(&a, &link).expect("symlink");
        let grants = PathGrants::default();

        let accepted = accept_paths(&grants, &[a.clone(), link]);

        assert_eq!(accepted, [canonical(&a)]);
    }

    #[test]
    fn r08_a_link_named_like_a_document_that_points_elsewhere_is_ignored() {
        let dir = TempDir::new();
        symlink("/etc/hosts", dir.path().join("hosts.md")).expect("symlink");
        let grants = PathGrants::default();

        let accepted = accept_paths(&grants, &[dir.path().join("hosts.md")]);

        assert!(accepted.is_empty());
        assert!(!grants.is_granted(std::path::Path::new("/private/etc/hosts")));
    }

    #[test]
    fn r08_a_dropped_batch_with_a_mix_keeps_only_the_documents() {
        let dir = TempDir::new();
        let notes = dir.write("notes.md", b"x");
        let photo = dir.write("photo.png", b"x");
        let report = dir.write("report.qmd", b"x");
        let grants = PathGrants::default();

        let accepted = accept_paths(&grants, &[notes.clone(), photo, report.clone()]);

        assert_eq!(accepted, [canonical(&notes), canonical(&report)]);
    }

    #[test]
    fn r08_nothing_is_accepted_from_an_empty_drop() {
        assert!(accept_paths(&PathGrants::default(), &[]).is_empty());
    }

    #[test]
    fn r08_file_urls_become_paths_and_other_urls_are_ignored() {
        let urls: Vec<Url> = [
            "file:///Users/me/a%20b.md",
            "https://example.org/a.md",
            "file://localhost/Users/me/c.md",
            "writedown://open?file=/etc/hosts",
            "file://example.org/share/d.md",
        ]
        .iter()
        .map(|text| Url::parse(text).expect("url"))
        .collect();

        let paths = urls_to_paths(&urls);

        assert_eq!(
            paths,
            [
                PathBuf::from("/Users/me/a b.md"),
                PathBuf::from("/Users/me/c.md")
            ]
        );
    }

    #[test]
    fn dedupe_keeps_the_first_of_each_path() {
        assert_eq!(
            dedupe(vec![
                "/a".into(),
                "/b".into(),
                "/a".into(),
                "/c".into(),
                "/b".into()
            ]),
            ["/a", "/b", "/c"]
        );
        assert!(dedupe(vec![]).is_empty());
    }

    #[test]
    fn e51_a_file_open_in_a_window_goes_to_that_window_and_the_rest_to_the_default() {
        let held = |path: &str| (path == "/b.md").then(|| "doc-1".to_owned());

        let groups = group_by_window(
            &["/a.md".to_owned(), "/b.md".to_owned(), "/c.md".to_owned()],
            "main",
            held,
        );

        assert_eq!(
            groups,
            [
                (
                    "main".to_owned(),
                    vec!["/a.md".to_owned(), "/c.md".to_owned()]
                ),
                ("doc-1".to_owned(), vec!["/b.md".to_owned()])
            ]
        );
    }

    #[test]
    fn e51_without_any_holder_every_file_goes_to_the_default_window() {
        let groups = group_by_window(&["/a.md".to_owned()], "doc-2", |_| None);
        assert_eq!(groups, [("doc-2".to_owned(), vec!["/a.md".to_owned()])]);
        assert!(group_by_window(&[], "main", |_| None).is_empty());
    }
}
