//! Searching the open folder, with ripgrep's crates.
//!
//! - The files are the ones the Files tab and Quick Open list (`folders.rs` skip rules: hidden
//!   entries, ignored names, the Markdown family, no link out of the folder, links to folders
//!   never followed).
//! - Binary files (a NUL byte) and files over 5 MiB are skipped. Text is read as UTF-8 with
//!   invalid bytes replaced (a UTF-16 byte order mark is honored by the searcher).
//! - The query is a plain string unless `regex` is set (Rust regex syntax); an invalid pattern
//!   comes back in `error`, not as a failure of the call.
//! - A line is cut to 240 UTF-16 units around its first match; ranges are in UTF-16 units of the
//!   cut text.
//! - At most 1,000 matches (lines) and 500 files with matches; then `truncated` is set.
//! - Cancellation is checked between files and between matches. A newer request with a higher id
//!   cancels every older one that is still running.
//!
//! "Match" in the caps and in `matchCount` is one matching line (`SearchMatch`), the row the
//! results list shows; the ranges inside it can be several.

use crate::error::PlatformResult;
use crate::folders;
use crate::grants::PathGrants;
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{
    BinaryDetection, Searcher, SearcherBuilder, Sink, SinkError, SinkFinish, SinkMatch,
};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

pub const MAX_MATCHES: usize = 1_000;
pub const MAX_FILES: usize = 500;
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_LINE_UNITS: usize = 240;
/// How many UTF-16 units of context are kept before the first match when a line is cut.
const CONTEXT_BEFORE: usize = 40;
/// How many cancels that arrive before their search are remembered.
const MAX_EARLY_CANCELS: usize = 64;

/// `SearchRequest` in `src/lib/platform.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub id: u64,
    pub folder: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchMatch {
    pub line: u64,
    pub text: String,
    pub ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: u64,
    pub files: Vec<SearchFileResult>,
    pub match_count: usize,
    pub file_count: usize,
    pub truncated: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

impl SearchResult {
    fn empty(id: u64) -> Self {
        SearchResult {
            id,
            files: Vec::new(),
            match_count: 0,
            file_count: 0,
            truncated: false,
            cancelled: false,
            error: None,
        }
    }
}

// ---- cancellation -------------------------------------------------------------------------------

#[derive(Default)]
struct Registry {
    running: HashMap<u64, Arc<AtomicBool>>,
    early: VecDeque<u64>,
}

/// The searches that are running, so that one can be cancelled by its id.
#[derive(Default)]
pub struct SearchRegistry {
    inner: Mutex<Registry>,
}

impl SearchRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, Registry> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers a search. Every older search still running is cancelled; the new one starts
    /// cancelled if a newer one is running already or a cancel for it came first.
    fn begin(&self, id: u64) -> Arc<AtomicBool> {
        let mut registry = self.lock();
        let flag = Arc::new(AtomicBool::new(false));
        if let Some(position) = registry.early.iter().position(|early| *early == id) {
            registry.early.remove(position);
            flag.store(true, Ordering::SeqCst);
        }
        if registry.running.keys().any(|running| *running > id) {
            flag.store(true, Ordering::SeqCst);
        }
        for (running, other) in &registry.running {
            if *running < id {
                other.store(true, Ordering::SeqCst);
            }
        }
        registry.running.insert(id, Arc::clone(&flag));
        flag
    }

    fn end(&self, id: u64, flag: &Arc<AtomicBool>) {
        let mut registry = self.lock();
        if registry
            .running
            .get(&id)
            .is_some_and(|current| Arc::ptr_eq(current, flag))
        {
            registry.running.remove(&id);
        }
    }

    /// Cancels the search with this id, whether it is running or about to start.
    pub fn cancel(&self, id: u64) {
        let mut registry = self.lock();
        if let Some(flag) = registry.running.get(&id) {
            flag.store(true, Ordering::SeqCst);
        } else {
            registry.early.push_back(id);
            if registry.early.len() > MAX_EARLY_CANCELS {
                registry.early.pop_front();
            }
        }
    }
}

// ---- the search --------------------------------------------------------------------------------------

fn build_matcher(request: &SearchRequest) -> Result<RegexMatcher, String> {
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(!request.case_sensitive)
        .word(request.whole_word)
        .fixed_strings(!request.regex);
    builder.build(&request.query).map_err(|error| {
        let text = error.to_string();
        // The regex crate's message is several lines; the last "error:" line says what is wrong.
        let reason = text
            .lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix("error: "))
            .map(str::to_owned)
            .unwrap_or_else(|| text.split_whitespace().collect::<Vec<_>>().join(" "));
        let mut chars = reason.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().chain(chars).collect(),
            None => "The pattern is not valid.".to_owned(),
        }
    })
}

/// Turns ascending byte offsets of a line into UTF-16 offsets in one forward pass.
#[derive(Default)]
struct Cursor {
    byte: usize,
    units: usize,
}

impl Cursor {
    fn units_at(&mut self, line: &str, byte: usize) -> usize {
        self.units += line[self.byte..byte].encode_utf16().count();
        self.byte = byte;
        self.units
    }
}

/// The line cut to `MAX_LINE_UNITS` units around the first match, and the matched byte ranges
/// as UTF-16 ranges of the cut text. Ranges that fall outside the cut are dropped; one that
/// crosses its edge is clipped.
fn cut_line(line: &str, matched: &[(usize, usize)]) -> (String, Vec<(u32, u32)>) {
    let mut ranges = Vec::new();
    let mut cursor = Cursor::default();

    if line.len() <= MAX_LINE_UNITS {
        // Every unit takes at least one byte, so a line this short fits.
        for (start, end) in matched {
            let (start, end) = (cursor.units_at(line, *start), cursor.units_at(line, *end));
            if end > start {
                ranges.push((start as u32, end as u32));
            }
        }
        return (line.to_owned(), ranges);
    }

    let units: Vec<u16> = line.encode_utf16().collect();
    let length = units.len();
    let first = matched
        .first()
        .map(|(start, _)| line[..*start].encode_utf16().count())
        .unwrap_or(0);
    let mut start = first.saturating_sub(CONTEXT_BEFORE);
    if start + MAX_LINE_UNITS > length {
        start = length.saturating_sub(MAX_LINE_UNITS);
    }
    let mut end = (start + MAX_LINE_UNITS).min(length);
    // Never split a surrogate pair.
    if start < length && (0xDC00..0xE000).contains(&units[start]) {
        start += 1;
    }
    if end < length && (0xDC00..0xE000).contains(&units[end]) {
        end -= 1;
    }
    let text = String::from_utf16_lossy(&units[start..end]);

    cursor = Cursor::default();
    for (match_start, match_end) in matched {
        let (from, to) = (
            cursor.units_at(line, *match_start),
            cursor.units_at(line, *match_end),
        );
        if from >= end {
            break;
        }
        let (from, to) = (from.max(start), to.min(end));
        if to > from {
            ranges.push(((from - start) as u32, (to - start) as u32));
        }
    }
    (text, ranges)
}

/// Collects the matching lines of one file.
struct Collector<'a> {
    matcher: &'a RegexMatcher,
    cancel: &'a AtomicBool,
    /// How many more lines may be collected before the global cap.
    room: usize,
    rows: Vec<SearchMatch>,
    capped: bool,
    binary: bool,
}

impl Sink for Collector<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self.cancel.load(Ordering::SeqCst) {
            return Ok(false);
        }
        if self.rows.len() >= self.room {
            self.capped = true;
            return Ok(false);
        }
        let lossy = String::from_utf8_lossy(mat.bytes());
        let line = lossy.trim_end_matches(['\n', '\r']);
        let mut found = Vec::new();
        let searched = self.matcher.find_iter(line.as_bytes(), |m| {
            found.push((m.start(), m.end()));
            found.len() < 10_000
        });
        if searched.is_err() {
            return Err(SinkError::error_message("search failed"));
        }
        let (text, ranges) = cut_line(line, &found);
        self.rows.push(SearchMatch {
            line: mat.line_number().unwrap_or(0),
            text,
            ranges,
        });
        Ok(true)
    }

    fn finish(&mut self, _searcher: &Searcher, finish: &SinkFinish) -> Result<(), Self::Error> {
        self.binary = finish.binary_byte_offset().is_some();
        Ok(())
    }
}

fn walker(folder: &Path, ignore: &[String]) -> ignore::Walk {
    let skip = ignore.to_vec();
    WalkBuilder::new(folder)
        .standard_filters(false)
        .hidden(true)
        .follow_links(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            entry.depth() == 0
                || !entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| folders::skipped_name(name, &skip))
        })
        .build()
}

/// The file to read for a walked entry: the file itself, or the target of a link that stays
/// inside the folder. None for everything that is not searched.
fn searched_target(entry: &ignore::DirEntry, root: &Path) -> Option<PathBuf> {
    let kind = entry.file_type()?;
    let name = entry.file_name().to_string_lossy();
    if !folders::is_listed_file(&name) {
        return None;
    }
    if kind.is_file() {
        Some(entry.path().to_path_buf())
    } else if kind.is_symlink() {
        folders::inside_file_target(entry.path(), root).map(|(target, _)| target)
    } else {
        None
    }
}

/// Runs a search in a granted folder. Blocking: call it off the main thread.
pub fn search_folder(
    grants: &PathGrants,
    registry: &SearchRegistry,
    ignore: &[String],
    request: &SearchRequest,
) -> PlatformResult<SearchResult> {
    let folder = grants.check_folder(Path::new(&request.folder))?;
    let root = grants
        .folder_root_of(&folder)
        .unwrap_or_else(|| folder.clone());
    let cancel = registry.begin(request.id);
    let result = run(&folder, &root, ignore, request, &cancel);
    registry.end(request.id, &cancel);
    Ok(result)
}

fn run(
    folder: &Path,
    root: &Path,
    ignore: &[String],
    request: &SearchRequest,
    cancel: &AtomicBool,
) -> SearchResult {
    let mut result = SearchResult::empty(request.id);
    if request.query.is_empty() {
        return result;
    }
    let matcher = match build_matcher(request) {
        Ok(matcher) => matcher,
        Err(message) => {
            result.error = Some(message);
            return result;
        }
    };
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();

    let mut total = 0usize;
    for entry in walker(folder, ignore).flatten() {
        if cancel.load(Ordering::SeqCst) {
            result.cancelled = true;
            break;
        }
        let Some(target) = searched_target(&entry, root) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&target) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
            continue;
        }
        let mut collector = Collector {
            matcher: &matcher,
            cancel,
            room: MAX_MATCHES - total,
            rows: Vec::new(),
            capped: false,
            binary: false,
        };
        if searcher
            .search_path(&matcher, &target, &mut collector)
            .is_err()
            || collector.binary
        {
            continue;
        }
        if cancel.load(Ordering::SeqCst) {
            result.cancelled = true;
        }
        if !collector.rows.is_empty() {
            if result.files.len() >= MAX_FILES {
                result.truncated = true;
                break;
            }
            total += collector.rows.len();
            result.files.push(SearchFileResult {
                path: entry.path().to_string_lossy().into_owned(),
                matches: collector.rows,
            });
        }
        if collector.capped {
            result.truncated = true;
            break;
        }
        if result.cancelled {
            break;
        }
    }
    result.match_count = total;
    result.file_count = result.files.len();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;
    use serde_json::Value;

    fn request(id: u64, folder: &Path, query: &str) -> SearchRequest {
        SearchRequest {
            id,
            folder: folder.to_string_lossy().into_owned(),
            query: query.to_owned(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
        }
    }

    fn granted(dir: &TempDir) -> (PathGrants, PathBuf) {
        let grants = PathGrants::default();
        let root = grants.grant_folder(dir.path()).expect("grant");
        (grants, root)
    }

    fn run_search(grants: &PathGrants, request: &SearchRequest) -> SearchResult {
        let ignore: Vec<String> = [
            "node_modules",
            "_site",
            "_freeze",
            "renv",
            "venv",
            "__pycache__",
        ]
        .map(str::to_owned)
        .to_vec();
        search_folder(grants, &SearchRegistry::default(), &ignore, request).expect("searches")
    }

    fn relative(result: &SearchResult, root: &Path) -> Vec<(String, Vec<u64>)> {
        result
            .files
            .iter()
            .map(|file| {
                (
                    Path::new(&file.path)
                        .strip_prefix(root)
                        .expect("inside")
                        .to_string_lossy()
                        .into_owned(),
                    file.matches.iter().map(|m| m.line).collect(),
                )
            })
            .collect()
    }

    // ---- the fixture folder (tests/fixtures/folder, expected-search.json from grep) ----------

    fn fixture() -> (PathBuf, Value) {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/folder");
        let folder = std::fs::canonicalize(folder).expect("fixture folder");
        let expected: Value = serde_json::from_slice(
            &std::fs::read(folder.join("expected-search.json")).expect("expected file"),
        )
        .expect("json");
        (folder, expected)
    }

    #[test]
    fn the_fixture_folder_gives_the_expected_files_lines_and_ranges() {
        let (folder, expected) = fixture();
        let grants = PathGrants::default();
        grants.grant_folder(&folder).expect("grant");
        let searches = expected["searches"].as_array().expect("searches");
        assert!(searches.len() >= 4);

        for search in searches {
            let options = &search["options"];
            let mut asked = request(1, &folder, search["query"].as_str().expect("query"));
            asked.case_sensitive = options["matchCase"].as_bool().expect("flag");
            asked.whole_word = options["wholeWord"].as_bool().expect("flag");
            asked.regex = options["regex"].as_bool().expect("flag");

            let result = run_search(&grants, &asked);

            let label = format!("{} {options}", asked.query);
            assert_eq!(result.error, None, "{label}");
            assert!(!result.truncated && !result.cancelled, "{label}");
            let expected_files = search["files"].as_object().expect("files");
            assert_eq!(result.file_count, expected_files.len(), "{label}");
            assert_eq!(
                result.match_count,
                search["totalLines"].as_u64().expect("lines") as usize,
                "{label}"
            );
            let mut occurrences = 0usize;
            for file in &result.files {
                let key = Path::new(&file.path)
                    .strip_prefix(&folder)
                    .expect("inside the fixture")
                    .to_string_lossy()
                    .into_owned();
                let want = expected_files
                    .get(&key)
                    .unwrap_or_else(|| panic!("unexpected file {key} for {label}"))
                    .as_array()
                    .expect("lines");
                assert_eq!(file.matches.len(), want.len(), "{key} {label}");
                for (found, want) in file.matches.iter().zip(want) {
                    assert_eq!(found.line, want["line"].as_u64().expect("line"), "{key}");
                    assert_eq!(found.text, want["text"].as_str().expect("text"), "{key}");
                    assert_eq!(
                        found.ranges.len() as u64,
                        want["matches"].as_u64().expect("count"),
                        "{key} line {}",
                        found.line
                    );
                    // Each range, in UTF-16 units of the text, is the searched word.
                    let units: Vec<u16> = found.text.encode_utf16().collect();
                    for (from, to) in &found.ranges {
                        let marked = String::from_utf16_lossy(&units[*from as usize..*to as usize]);
                        assert!(
                            marked.to_lowercase().starts_with("lan")
                                || marked.to_lowercase().starts_with("lamp"),
                            "{marked:?} in {:?}",
                            found.text
                        );
                    }
                    occurrences += found.ranges.len();
                }
            }
            assert_eq!(
                occurrences as u64,
                search["totalMatches"].as_u64().expect("matches"),
                "{label}"
            );
        }
    }

    // ---- rules, in temporary folders ---------------------------------------------------------

    #[test]
    fn hidden_ignored_binary_oversized_and_other_files_are_skipped() {
        let dir = TempDir::new();
        for (name, body) in [
            ("a.md", "needle here\n"),
            (".hidden/b.md", "needle\n"),
            (".c.md", "needle\n"),
            ("node_modules/pkg/d.md", "needle\n"),
            ("_site/e.md", "needle\n"),
            ("f.csv", "needle\n"),
            ("sub/g.txt", "a needle\n"),
        ] {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
            std::fs::write(path, body).expect("write");
        }
        dir.write("binary.md", b"needle\0\0\x01more\n");
        // Matches first, a NUL late in the file: the file is binary and counts as nothing.
        let mut late = b"needle\n".to_vec();
        late.extend(std::iter::repeat_n(b'x', 100_000));
        late.push(0);
        dir.write("late-binary.md", &late);
        let mut big = b"needle\n".to_vec();
        big.resize(MAX_FILE_BYTES as usize + 1, b'a');
        dir.write("big.md", &big);
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "needle"));

        assert_eq!(
            relative(&result, &root),
            [
                ("a.md".to_owned(), vec![1]),
                ("sub/g.txt".to_owned(), vec![1])
            ]
        );
    }

    #[test]
    fn case_whole_word_and_regex_options_are_honored() {
        let dir = TempDir::new();
        dir.write("a.md", b"Lantern\nlantern\nlanterns\nxlantern y\n");
        let (grants, root) = granted(&dir);

        let mut asked = request(1, &root, "lantern");
        let lines = |result: &SearchResult| -> Vec<u64> {
            result
                .files
                .first()
                .map_or(Vec::new(), |f| f.matches.iter().map(|m| m.line).collect())
        };
        assert_eq!(lines(&run_search(&grants, &asked)), [1, 2, 3, 4]);
        asked.case_sensitive = true;
        assert_eq!(lines(&run_search(&grants, &asked)), [2, 3, 4]);
        asked.whole_word = true;
        assert_eq!(lines(&run_search(&grants, &asked)), [2]);

        let mut pattern = request(2, &root, "^l.n+tern$");
        pattern.regex = true;
        pattern.case_sensitive = true;
        assert_eq!(lines(&run_search(&grants, &pattern)), [2]);
        // The same text as a plain string has no special characters.
        pattern.regex = false;
        pattern.query = "l.n".to_owned();
        assert!(run_search(&grants, &pattern).files.is_empty());
    }

    #[test]
    fn an_invalid_pattern_is_an_error_in_the_result_not_a_failure() {
        let dir = TempDir::new();
        dir.write("a.md", b"text (\n");
        let (grants, root) = granted(&dir);
        let mut asked = request(1, &root, "(");
        asked.regex = true;

        let result = run_search(&grants, &asked);

        let message = result.error.expect("an error message");
        assert!(
            message.to_lowercase().contains("unclosed group"),
            "{message}"
        );
        assert!(result.files.is_empty());
        assert!(!message.contains('\n'));
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        let dir = TempDir::new();
        dir.write("a.md", b"text\n");
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, ""));

        assert!(result.files.is_empty() && result.error.is_none());
    }

    #[test]
    fn a_search_outside_the_grants_is_refused() {
        let dir = TempDir::new();
        let other = TempDir::new();
        let (grants, _) = granted(&dir);

        let refused = search_folder(
            &grants,
            &SearchRegistry::default(),
            &[],
            &request(1, other.path(), "x"),
        );

        assert!(refused.is_err());
    }

    #[test]
    fn the_match_cap_is_a_thousand_lines_and_sets_truncated() {
        let dir = TempDir::new();
        let body: String = (0..1_500).map(|n| format!("hit {n}\n")).collect();
        dir.write("a.md", body.as_bytes());
        dir.write("b.md", b"hit again\n");
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "hit"));

        assert_eq!(result.match_count, MAX_MATCHES);
        assert_eq!(result.file_count, 1);
        assert!(result.truncated);
        assert_eq!(result.files[0].matches.len(), MAX_MATCHES);
        assert_eq!(result.files[0].matches[999].line, 1_000);
    }

    #[test]
    fn exactly_the_cap_is_not_truncated() {
        let dir = TempDir::new();
        let body: String = (0..MAX_MATCHES).map(|n| format!("hit {n}\n")).collect();
        dir.write("a.md", body.as_bytes());
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "hit"));

        assert_eq!(result.match_count, MAX_MATCHES);
        assert!(!result.truncated);
    }

    #[test]
    fn the_file_cap_is_five_hundred_files() {
        let dir = TempDir::new();
        for n in 0..(MAX_FILES + 5) {
            dir.write(&format!("f{n:04}.md"), b"hit\n");
        }
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "hit"));

        assert_eq!(result.file_count, MAX_FILES);
        assert_eq!(result.match_count, MAX_FILES);
        assert!(result.truncated);
    }

    #[test]
    fn a_cancelled_search_stops_and_says_so() {
        let dir = TempDir::new();
        for n in 0..50 {
            dir.write(&format!("f{n:02}.md"), b"hit\n");
        }
        let (grants, root) = granted(&dir);
        let registry = SearchRegistry::default();

        // The cancel arrives before the search starts.
        registry.cancel(7);
        let early =
            search_folder(&grants, &registry, &[], &request(7, &root, "hit")).expect("searches");
        assert!(early.cancelled);
        assert!(early.files.is_empty());

        // A newer search cancels an older one that is running.
        let older = registry.begin(1);
        let newer = registry.begin(2);
        assert!(older.load(Ordering::SeqCst));
        assert!(!newer.load(Ordering::SeqCst));
        // An older request that arrives late is cancelled by the newer one running.
        assert!(registry.begin(0).load(Ordering::SeqCst));

        // A cancel of a running search is seen between files.
        let flag = registry.begin(9);
        registry.cancel(9);
        let result = run(&root, &root, &[], &request(9, &root, "hit"), &flag);
        assert!(result.cancelled);
        assert!(result.files.is_empty());

        // After a search ends its id can be used again.
        registry.end(9, &flag);
        let again =
            search_folder(&grants, &registry, &[], &request(10, &root, "hit")).expect("searches");
        assert!(!again.cancelled);
        assert_eq!(again.file_count, 50);
    }

    #[test]
    fn a_link_out_of_the_folder_is_not_followed_but_one_inside_is() {
        let outer = TempDir::new();
        let root = outer.path().join("open");
        std::fs::create_dir_all(root.join("real")).expect("mkdir");
        std::fs::write(root.join("real/inside.md"), b"needle in\n").expect("write");
        std::fs::write(outer.path().join("secret.md"), b"needle out\n").expect("write");
        std::fs::create_dir_all(outer.path().join("elsewhere")).expect("mkdir");
        std::fs::write(outer.path().join("elsewhere/more.md"), b"needle far\n").expect("write");
        std::os::unix::fs::symlink(outer.path().join("secret.md"), root.join("out-link.md"))
            .expect("link");
        std::os::unix::fs::symlink(root.join("real/inside.md"), root.join("in-link.md"))
            .expect("link");
        std::os::unix::fs::symlink(outer.path().join("elsewhere"), root.join("dir-link"))
            .expect("link");
        std::os::unix::fs::symlink(&root, root.join("real/loop")).expect("link");
        let grants = PathGrants::default();
        let root = grants.grant_folder(&root).expect("grant");

        let result = run_search(&grants, &request(1, &root, "needle"));

        assert_eq!(
            relative(&result, &root),
            [
                ("in-link.md".to_owned(), vec![1]),
                ("real/inside.md".to_owned(), vec![1]),
            ]
        );
    }

    #[test]
    fn invalid_utf8_is_read_with_replacement_characters() {
        let dir = TempDir::new();
        dir.write("a.md", b"caf\xE9 needle\nplain needle\n");
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "needle"));

        let matches = &result.files[0].matches;
        assert_eq!(matches[0].text, "caf\u{FFFD} needle");
        assert_eq!(matches[0].ranges, [(5, 11)]);
        assert_eq!(matches[1].ranges, [(6, 12)]);
    }

    #[test]
    fn ranges_count_utf16_units_for_text_outside_the_basic_plane() {
        let dir = TempDir::new();
        // Each emoji is two UTF-16 units and four bytes.
        dir.write(
            "a.md",
            "\u{1F600}\u{1F600} needle \u{1F600} needle\n".as_bytes(),
        );
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "needle"));

        let row = &result.files[0].matches[0];
        assert_eq!(row.ranges, [(5, 11), (15, 21)]);
    }

    #[test]
    fn a_long_line_is_cut_to_240_units_around_the_first_match() {
        let dir = TempDir::new();
        let long = format!(
            "{}needle{}needle{}",
            "a".repeat(500),
            "b".repeat(300),
            "c".repeat(100)
        );
        dir.write("a.md", format!("{long}\n").as_bytes());
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "needle"));

        let row = &result.files[0].matches[0];
        assert_eq!(row.text.encode_utf16().count(), MAX_LINE_UNITS);
        // 40 units of context before the first match; the second match is past the cut.
        assert_eq!(row.ranges, [(40, 46)]);
        assert!(row.text.starts_with(&"a".repeat(40)));
        assert_eq!(&row.text[40..46], "needle");
    }

    #[test]
    fn a_match_near_the_end_of_a_long_line_keeps_a_full_window() {
        let long = format!("{}needle", "a".repeat(600));
        let (text, ranges) = cut_line(&long, &[(600, 606)]);

        assert_eq!(text.encode_utf16().count(), MAX_LINE_UNITS);
        assert_eq!(ranges, [(234, 240)]);
    }

    #[test]
    fn a_cut_never_splits_a_surrogate_pair() {
        // The window would start inside an emoji.
        let long = format!(
            "{}{}needle{}",
            "a".repeat(20),
            "\u{1F600}".repeat(60),
            "b".repeat(300)
        );
        let first = 20 + 4 * 60;
        let (text, ranges) = cut_line(&long, &[(first, first + 6)]);

        assert!(!text.contains('\u{FFFD}'));
        assert!(text.encode_utf16().count() <= MAX_LINE_UNITS);
        let units: Vec<u16> = text.encode_utf16().collect();
        let (from, to) = ranges[0];
        assert_eq!(
            String::from_utf16_lossy(&units[from as usize..to as usize]),
            "needle"
        );
    }

    #[test]
    fn a_range_that_crosses_the_cut_is_clipped() {
        let long = format!("{}{}", "a".repeat(100), "n".repeat(400));
        let (text, ranges) = cut_line(&long, &[(100, 500)]);

        assert_eq!(text.encode_utf16().count(), MAX_LINE_UNITS);
        assert_eq!(ranges, [(40, 240)]);
    }

    #[test]
    fn a_utf16_file_with_a_byte_order_mark_is_searched() {
        let dir = TempDir::new();
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "first\nthe needle\n".encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        dir.write("a.md", &bytes);
        let (grants, root) = granted(&dir);

        let result = run_search(&grants, &request(1, &root, "needle"));

        assert_eq!(relative(&result, &root), [("a.md".to_owned(), vec![2])]);
        assert_eq!(result.files[0].matches[0].text, "the needle");
    }
}
