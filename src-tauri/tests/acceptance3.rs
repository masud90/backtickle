//! Phase 3 acceptance C18 (and later cases), through the public API of the backend. C18: the
//! folder search finds the expected matches in `tests/fixtures/folder` (expected values from
//! `expected-search.json`, computed with grep), skips binary, oversized, hidden and ignored files,
//! honors case, whole word and regex, caps at 1,000 matches and 500 files, stops when cancelled
//! and never leaves the folder through a symlink. Every test writes only inside its own temporary
//! folder.

use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use writedown_lib::grants::PathGrants;
use writedown_lib::search::{
    MAX_FILES, MAX_MATCHES, SearchRegistry, SearchRequest, SearchResult, search_folder,
};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

fn temp() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let base = fs::canonicalize(std::env::temp_dir()).unwrap();
    let dir = base.join(format!("wd-acc3-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn ignore_names() -> Vec<String> {
    [
        "node_modules",
        "_site",
        "_freeze",
        "renv",
        "venv",
        "__pycache__",
    ]
    .map(str::to_owned)
    .to_vec()
}

fn request(
    id: u64,
    folder: &Path,
    query: &str,
    case: bool,
    word: bool,
    regex: bool,
) -> SearchRequest {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "folder": folder.to_string_lossy(),
        "query": query,
        "caseSensitive": case,
        "wholeWord": word,
        "regex": regex,
    }))
    .unwrap()
}

fn run(folder: &Path, req: &SearchRequest) -> SearchResult {
    let grants = PathGrants::default();
    grants.grant_folder(folder).expect("grant");
    search_folder(&grants, &SearchRegistry::default(), &ignore_names(), req).expect("search")
}

fn relative_paths(result: &SearchResult, root: &Path) -> Vec<String> {
    let mut out: Vec<String> = result
        .files
        .iter()
        .map(|f| {
            Path::new(&f.path)
                .strip_prefix(root)
                .unwrap_or_else(|_| panic!("outside the folder: {}", f.path))
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    out.sort();
    out
}

fn fixture_folder() -> PathBuf {
    fs::canonicalize(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("fixtures")
            .join("folder"),
    )
    .unwrap()
}

fn units(text: &str, range: (u32, u32)) -> String {
    let all: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&all[range.0 as usize..range.1 as usize]).unwrap()
}

#[test]
fn c18_fixture_folder_matches_expected_search_json() {
    let root = fixture_folder();
    let expected: Value =
        serde_json::from_str(&fs::read_to_string(root.join("expected-search.json")).unwrap())
            .unwrap();
    let searches = expected["searches"].as_array().unwrap();
    assert_eq!(searches.len(), 4);
    for (index, search) in searches.iter().enumerate() {
        let query = search["query"].as_str().unwrap();
        let options = &search["options"];
        let case = options["matchCase"].as_bool().unwrap();
        let word = options["wholeWord"].as_bool().unwrap();
        let regex = options["regex"].as_bool().unwrap();
        let result = run(
            &root,
            &request(index as u64 + 1, &root, query, case, word, regex),
        );
        let label = format!("{query} case={case} word={word} regex={regex}");
        assert_eq!(result.error, None, "{label}");
        assert!(!result.truncated && !result.cancelled, "{label}");

        let want_files: BTreeMap<String, Vec<(u64, String, usize)>> = search["files"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(path, rows)| {
                (
                    path.clone(),
                    rows.as_array()
                        .unwrap()
                        .iter()
                        .map(|r| {
                            (
                                r["line"].as_u64().unwrap(),
                                r["text"].as_str().unwrap().to_owned(),
                                r["matches"].as_u64().unwrap() as usize,
                            )
                        })
                        .collect(),
                )
            })
            .collect();
        let got_files: BTreeMap<String, Vec<(u64, String, usize)>> = result
            .files
            .iter()
            .map(|f| {
                (
                    Path::new(&f.path)
                        .strip_prefix(&root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    f.matches
                        .iter()
                        .map(|m| (m.line, m.text.clone(), m.ranges.len()))
                        .collect(),
                )
            })
            .collect();
        assert_eq!(got_files, want_files, "{label}");
        assert_eq!(
            result.file_count,
            search["fileCount"].as_u64().unwrap() as usize,
            "{label}"
        );
        assert_eq!(
            result.match_count,
            search["totalLines"].as_u64().unwrap() as usize,
            "{label}"
        );
        let ranges: usize = result
            .files
            .iter()
            .flat_map(|f| f.matches.iter())
            .map(|m| m.ranges.len())
            .sum();
        assert_eq!(
            ranges,
            search["totalMatches"].as_u64().unwrap() as usize,
            "{label}"
        );

        // Every range covers a hit: the query (any case unless matching case) or the regex words.
        for file in &result.files {
            for m in &file.matches {
                for r in &m.ranges {
                    let hit = units(&m.text, *r);
                    let lower = hit.to_lowercase();
                    if regex {
                        assert!(
                            lower.starts_with("lamp")
                                || (lower.starts_with("lan") && lower.ends_with("tern")),
                            "{label}: {hit:?}"
                        );
                    } else if case {
                        assert_eq!(hit, "lantern", "{label}");
                    } else {
                        assert_eq!(lower, "lantern", "{label}");
                    }
                }
            }
        }
    }
}

#[test]
fn c18_skips_binary_hidden_ignored_and_non_markdown_files() {
    let root = fixture_folder();
    let result = run(&root, &request(1, &root, "lantern", false, false, false));
    let paths = relative_paths(&result, &root);
    for skipped in [
        "binary.md",
        ".config.md",
        ".hidden/secret.md",
        "node_modules/pkg/readme.md",
        "_site/index.md",
        "data.csv",
        "README",
    ] {
        assert!(
            !paths.iter().any(|p| p == skipped),
            "{skipped} was searched: {paths:?}"
        );
    }
}

#[test]
fn c18_binary_oversized_and_lossy_files() {
    let dir = temp();
    write(&dir.join("good.md"), "a lantern\n");
    // A NUL byte anywhere before the match makes the file binary.
    fs::write(dir.join("bin.md"), b"head\0\0lantern\n").unwrap();
    // Over 5 MiB: skipped. Just under: searched.
    let mut big = "x".repeat(5 * 1024 * 1024 + 10);
    big.push_str("\nlantern\n");
    write(&dir.join("big.md"), &big);
    let mut ok = "x".repeat(5 * 1024 * 1024 - 100);
    ok.push_str("\nlantern\n");
    write(&dir.join("ok.md"), &ok);
    // Invalid UTF-8 is decoded lossily; the file is still searched.
    fs::write(dir.join("lossy.md"), b"bad \xFF byte lantern\n").unwrap();
    let result = run(&dir, &request(1, &dir, "lantern", false, false, false));
    assert_eq!(result.error, None);
    assert_eq!(
        relative_paths(&result, &dir),
        ["good.md", "lossy.md", "ok.md"]
    );
    let lossy = result
        .files
        .iter()
        .find(|f| f.path.ends_with("lossy.md"))
        .unwrap();
    let m = &lossy.matches[0];
    assert_eq!(units(&m.text, m.ranges[0]), "lantern");
}

#[test]
fn c18_invalid_regex_reports_an_error() {
    let dir = temp();
    write(&dir.join("a.md"), "x (\n");
    let result = run(&dir, &request(1, &dir, "(", false, false, true));
    assert!(result.error.is_some());
    assert!(result.files.is_empty());
    // As a plain string the same text is searched.
    let plain = run(&dir, &request(2, &dir, "(", false, false, false));
    assert_eq!(plain.error, None);
    assert_eq!(plain.file_count, 1);
}

#[test]
fn c18_caps_at_1000_matches_and_500_files() {
    let dir = temp();
    // One file with 1,500 matching lines: 1,000 matches, truncated.
    let lines: String = (0..1500).map(|i| format!("hit {i}\n")).collect();
    write(&dir.join("many.md"), &lines);
    let result = run(&dir, &request(1, &dir, "hit", false, false, false));
    assert_eq!(result.match_count, MAX_MATCHES);
    assert_eq!(MAX_MATCHES, 1_000);
    assert!(result.truncated);
    let rows: usize = result.files.iter().map(|f| f.matches.len()).sum();
    assert_eq!(rows, 1_000);

    // 600 files with one match each: 500 files, truncated.
    let dir = temp();
    for i in 0..600 {
        write(&dir.join(format!("f{i:03}.md")), "needle\n");
    }
    let result = run(&dir, &request(1, &dir, "needle", false, false, false));
    assert_eq!(MAX_FILES, 500);
    assert_eq!(result.files.len(), 500);
    assert_eq!(result.file_count, 500);
    assert!(result.truncated);

    // Under the caps nothing is flagged.
    let dir = temp();
    for i in 0..10 {
        write(&dir.join(format!("f{i}.md")), "needle\n");
    }
    let result = run(&dir, &request(1, &dir, "needle", false, false, false));
    assert_eq!(result.file_count, 10);
    assert!(!result.truncated);
}

#[test]
fn c18_a_cancelled_search_stops() {
    let dir = temp();
    for i in 0..200 {
        write(&dir.join(format!("f{i:03}.md")), "needle\n");
    }
    let grants = PathGrants::default();
    grants.grant_folder(&dir).unwrap();

    // The cancel arrives before the search: it stops at once, flagged cancelled.
    let registry = SearchRegistry::default();
    registry.cancel(7);
    let result = search_folder(
        &grants,
        &registry,
        &ignore_names(),
        &request(7, &dir, "needle", false, false, false),
    )
    .unwrap();
    assert!(result.cancelled);
    assert!(result.files.len() < 200);
    assert_eq!(result.id, 7);

    // A cancel for another id does not touch it.
    let registry = SearchRegistry::default();
    registry.cancel(8);
    let result = search_folder(
        &grants,
        &registry,
        &ignore_names(),
        &request(9, &dir, "needle", false, false, false),
    )
    .unwrap();
    assert!(!result.cancelled);
    assert_eq!(result.file_count, 200);
}

#[test]
fn c18_never_leaves_the_folder_through_a_symlink() {
    let base = temp();
    let root = base.join("root");
    let outside = base.join("outside");
    write(&root.join("inside.md"), "a lantern\n");
    write(&outside.join("secret.md"), "outside lantern\n");
    symlink(outside.join("secret.md"), root.join("link.md")).unwrap();
    symlink(&outside, root.join("linkdir")).unwrap();
    symlink("../outside/secret.md", root.join("relative.md")).unwrap();
    let result = run(&root, &request(1, &root, "lantern", false, false, false));
    let root = fs::canonicalize(&root).unwrap();
    let paths = relative_paths(&result, &root);
    assert!(paths.contains(&"inside.md".to_owned()), "{paths:?}");
    for path in &paths {
        assert!(
            !path.contains("secret")
                && !path.starts_with("linkdir")
                && path != "link.md"
                && path != "relative.md",
            "followed a symlink out of the folder: {path}"
        );
    }
    assert_eq!(result.file_count, 1, "{paths:?}");
}

#[test]
fn c18_a_search_outside_a_granted_folder_is_refused() {
    let dir = temp();
    write(&dir.join("a.md"), "needle\n");
    let grants = PathGrants::default();
    let outcome = search_folder(
        &grants,
        &SearchRegistry::default(),
        &ignore_names(),
        &request(1, &dir, "needle", false, false, false),
    );
    assert!(outcome.is_err());
}
