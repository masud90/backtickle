//! Per-document state (Doc state;): what the app should remember
//! about one file: the flavor picked from the flavor pill, the cursor and the top visible line.
//!
//! Entries are keyed by canonical path, at most 500 are kept (the least recently used is
//! dropped, and both reading and writing count as use) and the store is a JSON file in the app
//! data folder: `{"version": 1, "entries": [{"path": "...", "flavor": "obsidian", "cursor":
//! {"line": 3, "column": 5}, "scrollLine": 1}]}`, most recently used first (`cursor` and
//! `scrollLine` are left out when not set). A store that cannot be parsed is replaced by an
//! empty one (see `store.rs`).

use crate::settings::FLAVORS;
use crate::store::{self, Loaded};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::io;
use std::path::PathBuf;

pub const MAX_ENTRIES: usize = 500;
/// Larger numbers in a stored cursor or scroll line are not believed.
const MAX_LINE: u64 = 100_000_000;
const MAX_COLUMN: u64 = 10_000_000;

/// The cursor of a document: a 1-based line and the column in that line (counted from 0, in
/// UTF-16 units like the editor does).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Cursor {
    pub line: u32,
    pub column: u32,
}

/// `DocState` in `src/lib/platform.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocState {
    /// A `FlavorId`, or null if the user has not chosen one for this file.
    pub flavor: Option<String>,
    /// Where the cursor was when the document was last closed or left.
    pub cursor: Option<Cursor>,
    /// The top visible source line (1-based) at that time.
    pub scroll_line: Option<u32>,
}

pub struct DocStates {
    /// Most recently used first.
    entries: Vec<(String, DocState)>,
    file: PathBuf,
}

/// A whole number from a JSON number within `min..=max`, or `None`.
fn whole(value: &Value, min: u64, max: u64) -> Option<u32> {
    let number = value.as_f64()?;
    if !number.is_finite() || number.fract() != 0.0 || number < min as f64 || number > max as f64 {
        return None;
    }
    Some(number as u32)
}

fn cursor_of(value: &Value) -> Option<Cursor> {
    Some(Cursor {
        line: whole(value.get("line")?, 1, MAX_LINE)?,
        column: whole(value.get("column")?, 0, MAX_COLUMN)?,
    })
}

impl DocStates {
    pub fn load(file: PathBuf) -> Self {
        let entries = match store::read_json(&file) {
            Loaded::Valid(value) => parse(&value).unwrap_or_else(|| {
                store::quarantine(&file);
                Vec::new()
            }),
            Loaded::Missing | Loaded::Corrupt => Vec::new(),
        };
        DocStates { entries, file }
    }

    /// The state of one document (the default state if nothing is stored). Reading counts as
    /// use: the entry moves to the front. The flag says whether the order changed, that is,
    /// whether the store should be written.
    pub fn get(&mut self, path: &str) -> (DocState, bool) {
        let Some(position) = self.entries.iter().position(|(stored, _)| stored == path) else {
            return (DocState::default(), false);
        };
        let entry = self.entries.remove(position);
        let state = entry.1.clone();
        self.entries.insert(0, entry);
        (state, position != 0)
    }

    /// Applies a partial update. `flavor` takes a `FlavorId` or null (which clears it); `cursor`
    /// takes `{line, column}` (line from 1, column from 0) or null; `scrollLine` takes a whole
    /// number from 1 or null. A value of any other type or range is ignored. A document left
    /// with nothing to remember has no entry. Returns true if the stored state changed.
    pub fn set(&mut self, path: &str, patch: &Value) -> bool {
        let before = self
            .entries
            .iter()
            .position(|(stored, _)| stored == path)
            .map(|position| self.entries.remove(position));
        let mut state = before
            .as_ref()
            .map(|(_, state)| state.clone())
            .unwrap_or_default();

        match patch.get("flavor") {
            Some(Value::Null) => state.flavor = None,
            Some(Value::String(flavor)) if FLAVORS.contains(&flavor.as_str()) => {
                state.flavor = Some(flavor.clone());
            }
            _ => {}
        }
        match patch.get("cursor") {
            Some(Value::Null) => state.cursor = None,
            Some(value) => {
                if let Some(cursor) = cursor_of(value) {
                    state.cursor = Some(cursor);
                }
            }
            None => {}
        }
        match patch.get("scrollLine") {
            Some(Value::Null) => state.scroll_line = None,
            Some(value) => {
                if let Some(line) = whole(value, 1, MAX_LINE) {
                    state.scroll_line = Some(line);
                }
            }
            None => {}
        }

        let changed = before.as_ref().map(|(_, old)| old) != Some(&state)
            && !(before.is_none() && state == DocState::default());
        if state != DocState::default() {
            self.entries.insert(0, (path.to_owned(), state));
            self.entries.truncate(MAX_ENTRIES);
        }
        changed
    }

    /// A rename or a move: the entry of `from`, and the entries of everything below it when it
    /// was a folder, now belong to `to`. An entry that already exists at the new path is
    /// replaced. Returns true if anything changed.
    pub fn moved(&mut self, from: &str, to: &str) -> bool {
        let below = format!("{}/", from.trim_end_matches('/'));
        let new_path = |stored: &str| -> Option<String> {
            if stored == from {
                Some(to.to_owned())
            } else {
                stored
                    .strip_prefix(&below)
                    .map(|rest| format!("{}/{rest}", to.trim_end_matches('/')))
            }
        };
        let new_paths: Vec<String> = self
            .entries
            .iter()
            .filter_map(|(stored, _)| new_path(stored))
            .collect();
        if new_paths.is_empty() {
            return false;
        }
        let mut result: Vec<(String, DocState)> = Vec::new();
        for (path, state) in std::mem::take(&mut self.entries) {
            match new_path(&path) {
                Some(renamed) => result.push((renamed, state)),
                // An entry that already had a new path is replaced by the moved one.
                None if new_paths.contains(&path) => {}
                None => result.push((path, state)),
            }
        }
        self.entries = result;
        true
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn save(&self) -> io::Result<()> {
        let entries: Vec<Value> = self
            .entries
            .iter()
            .map(|(path, state)| {
                let mut entry = Map::new();
                entry.insert("path".to_owned(), json!(path));
                entry.insert("flavor".to_owned(), json!(state.flavor));
                if let Some(cursor) = state.cursor {
                    entry.insert(
                        "cursor".to_owned(),
                        json!({ "line": cursor.line, "column": cursor.column }),
                    );
                }
                if let Some(line) = state.scroll_line {
                    entry.insert("scrollLine".to_owned(), json!(line));
                }
                Value::Object(entry)
            })
            .collect();
        store::write_json(&self.file, &json!({ "version": 1, "entries": entries }))
    }
}

/// The entries of a parsed store, or `None` if it does not have the shape of a document state
/// file. Entries without a path or without anything to remember are dropped.
fn parse(value: &Value) -> Option<Vec<(String, DocState)>> {
    let list = value.as_object()?.get("entries")?.as_array()?;
    let mut entries: Vec<(String, DocState)> = Vec::new();
    for item in list {
        let Some(path) = item.get("path").and_then(Value::as_str) else {
            continue;
        };
        let flavor = item
            .get("flavor")
            .and_then(Value::as_str)
            .filter(|flavor| FLAVORS.contains(flavor))
            .map(str::to_owned);
        let cursor = item.get("cursor").and_then(cursor_of);
        let scroll_line = item
            .get("scrollLine")
            .and_then(|value| whole(value, 1, MAX_LINE));
        let state = DocState {
            flavor,
            cursor,
            scroll_line,
        };
        if path.is_empty()
            || state == DocState::default()
            || entries.iter().any(|(stored, _)| stored == path)
        {
            continue;
        }
        entries.push((path.to_owned(), state));
    }
    entries.truncate(MAX_ENTRIES);
    Some(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn empty(dir: &TempDir) -> DocStates {
        DocStates::load(dir.path().join("doc-state.json"))
    }

    fn flavor(states: &mut DocStates, path: &str) -> Option<String> {
        states.get(path).0.flavor
    }

    #[test]
    fn a_document_without_a_stored_state_has_no_flavor() {
        let dir = TempDir::new();
        let mut states = empty(&dir);

        assert_eq!(states.get("/a.md"), (DocState::default(), false));
        assert!(states.is_empty(), "reading does not create entries");
    }

    #[test]
    fn the_chosen_flavor_is_stored_per_path() {
        let dir = TempDir::new();
        let mut states = empty(&dir);

        assert!(states.set("/a.md", &json!({ "flavor": "obsidian" })));
        assert!(states.set("/b.md", &json!({ "flavor": "commonmark" })));

        assert_eq!(flavor(&mut states, "/a.md").as_deref(), Some("obsidian"));
        assert_eq!(flavor(&mut states, "/b.md").as_deref(), Some("commonmark"));
        assert_eq!(flavor(&mut states, "/c.md"), None);
    }

    #[test]
    fn setting_the_same_flavor_again_changes_nothing() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "gfm" }));

        assert!(!states.set("/a.md", &json!({ "flavor": "gfm" })));
        assert!(!states.set("/a.md", &json!({})));
    }

    #[test]
    fn a_null_flavor_clears_the_choice_and_the_entry_goes_away() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "gfm" }));

        assert!(states.set("/a.md", &json!({ "flavor": null })));

        assert_eq!(flavor(&mut states, "/a.md"), None);
        assert!(states.is_empty());
        assert!(
            !states.set("/a.md", &json!({ "flavor": null })),
            "nothing to clear"
        );
    }

    #[test]
    fn an_unknown_flavor_or_a_value_of_the_wrong_type_is_ignored() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "gfm" }));

        for bad in [
            json!("markdown-extra"),
            json!(7),
            json!(true),
            json!(["gfm"]),
        ] {
            assert!(!states.set("/a.md", &json!({ "flavor": bad })), "{bad}");
        }
        assert_eq!(flavor(&mut states, "/a.md").as_deref(), Some("gfm"));
        assert!(!states.set("/new.md", &json!({ "flavor": "nonsense" })));
        assert_eq!(states.len(), 1, "an ignored value creates no entry");
    }

    #[test]
    fn every_flavor_id_is_accepted() {
        let dir = TempDir::new();
        let mut states = empty(&dir);

        for id in FLAVORS {
            states.set("/a.md", &json!({ "flavor": id }));
            assert_eq!(flavor(&mut states, "/a.md").as_deref(), Some(id));
        }
    }

    #[test]
    fn r05_at_most_500_entries_are_kept_and_the_least_recently_used_goes() {
        let dir = TempDir::new();
        let mut states = empty(&dir);

        for index in 0..MAX_ENTRIES {
            states.set(&format!("/{index}.md"), &json!({ "flavor": "gfm" }));
        }
        assert_eq!(states.len(), 500);
        // /0.md is the oldest. Use it, so /1.md becomes the oldest.
        assert!(flavor(&mut states, "/0.md").is_some());
        states.set("/new.md", &json!({ "flavor": "mdx" }));

        assert_eq!(states.len(), 500);
        assert!(
            flavor(&mut states, "/0.md").is_some(),
            "used recently, kept"
        );
        assert_eq!(
            flavor(&mut states, "/1.md"),
            None,
            "the least recently used was dropped"
        );
        assert!(flavor(&mut states, "/new.md").is_some());
    }

    #[test]
    fn reading_moves_the_entry_to_the_front_and_says_so() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "gfm" }));
        states.set("/b.md", &json!({ "flavor": "gfm" }));

        let (_, moved) = states.get("/a.md");
        let (_, moved_again) = states.get("/a.md");

        assert!(moved);
        assert!(!moved_again, "already first");
    }

    #[test]
    fn the_state_survives_a_restart_in_most_recently_used_order() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "pandoc" }));
        states.set("/b é.md", &json!({ "flavor": "quarto" }));
        states.save().expect("saves");

        let mut reloaded = empty(&dir);

        assert_eq!(flavor(&mut reloaded, "/a.md").as_deref(), Some("pandoc"));
        assert_eq!(flavor(&mut reloaded, "/b é.md").as_deref(), Some("quarto"));
        let text = std::fs::read_to_string(dir.path().join("doc-state.json")).expect("read");
        let value: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(
            value,
            json!({ "version": 1, "entries": [
                { "path": "/b é.md", "flavor": "quarto" },
                { "path": "/a.md", "flavor": "pandoc" }
            ] })
        );
    }

    #[test]
    fn a_corrupt_store_is_replaced_by_an_empty_one_and_a_copy_is_kept() {
        let dir = TempDir::new();
        let file = dir.write("doc-state.json", b"<<<");

        let states = DocStates::load(file.clone());

        assert!(states.is_empty());
        assert_eq!(
            std::fs::read(store::corrupt_copy_path(&file)).expect("copy"),
            b"<<<"
        );
    }

    #[test]
    fn a_store_with_the_wrong_shape_is_corrupt_too() {
        for text in [&b"[]"[..], b"{}", br#"{"entries": {}}"#, b"3"] {
            let dir = TempDir::new();
            let file = dir.write("doc-state.json", text);

            assert!(DocStates::load(file.clone()).is_empty());
            assert!(store::corrupt_copy_path(&file).exists());
        }
    }

    #[test]
    fn bad_entries_are_dropped_and_good_ones_kept() {
        let dir = TempDir::new();
        let file = dir.write(
            "doc-state.json",
            br#"{"version": 1, "entries": [
                {"path": "/good.md", "flavor": "mdx"},
                {"path": "/no-flavor.md"},
                {"path": "/bad-flavor.md", "flavor": "nonsense"},
                {"path": "/bad-cursor.md", "cursor": {"line": 0, "column": 1}},
                {"path": "/bad-scroll.md", "scrollLine": "x"},
                {"flavor": "gfm"},
                {"path": "", "flavor": "gfm"},
                {"path": "/good.md", "flavor": "gfm"},
                7
            ]}"#,
        );

        let mut states = DocStates::load(file);

        assert_eq!(states.len(), 1);
        assert_eq!(flavor(&mut states, "/good.md").as_deref(), Some("mdx"));
    }

    #[test]
    fn a_hand_made_store_with_too_many_entries_is_cut_at_500() {
        let dir = TempDir::new();
        let entries: Vec<Value> = (0..800)
            .map(|index| json!({ "path": format!("/{index}.md"), "flavor": "gfm" }))
            .collect();
        let file = dir.write(
            "doc-state.json",
            json!({ "version": 1, "entries": entries })
                .to_string()
                .as_bytes(),
        );

        assert_eq!(DocStates::load(file).len(), MAX_ENTRIES);
    }

    #[test]
    fn a_doc_state_serializes_with_the_names_of_the_frontend_type() {
        assert_eq!(
            serde_json::to_value(DocState::default()).expect("serializes"),
            json!({ "flavor": null, "cursor": null, "scrollLine": null })
        );
        assert_eq!(
            serde_json::to_value(DocState {
                flavor: Some("gfm".into()),
                cursor: Some(Cursor { line: 3, column: 5 }),
                scroll_line: Some(2),
            })
            .expect("serializes"),
            json!({ "flavor": "gfm", "cursor": { "line": 3, "column": 5 }, "scrollLine": 2 })
        );
    }

    // ---- Phase 3: cursor and scroll -------------------------------------------------------

    fn full(states: &mut DocStates, path: &str) -> DocState {
        states.get(path).0
    }

    #[test]
    fn the_cursor_and_the_scroll_line_are_stored_per_path() {
        let dir = TempDir::new();
        let mut states = empty(&dir);

        assert!(states.set(
            "/a.md",
            &json!({ "cursor": { "line": 12, "column": 0 }, "scrollLine": 7 })
        ));

        assert_eq!(
            full(&mut states, "/a.md"),
            DocState {
                flavor: None,
                cursor: Some(Cursor {
                    line: 12,
                    column: 0
                }),
                scroll_line: Some(7)
            }
        );
        assert_eq!(full(&mut states, "/b.md"), DocState::default());
    }

    #[test]
    fn a_patch_changes_only_the_keys_it_names() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set(
            "/a.md",
            &json!({ "flavor": "quarto", "cursor": { "line": 2, "column": 3 }, "scrollLine": 1 }),
        );

        states.set("/a.md", &json!({ "scrollLine": 9 }));

        let state = full(&mut states, "/a.md");
        assert_eq!(state.flavor.as_deref(), Some("quarto"));
        assert_eq!(state.cursor, Some(Cursor { line: 2, column: 3 }));
        assert_eq!(state.scroll_line, Some(9));
        assert!(
            !states.set("/a.md", &json!({ "scrollLine": 9 })),
            "no change"
        );
    }

    #[test]
    fn null_clears_a_key_and_an_entry_with_nothing_left_goes_away() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set(
            "/a.md",
            &json!({ "cursor": { "line": 2, "column": 3 }, "scrollLine": 1 }),
        );

        assert!(states.set("/a.md", &json!({ "cursor": null })));
        assert_eq!(full(&mut states, "/a.md").scroll_line, Some(1));
        assert!(states.set("/a.md", &json!({ "scrollLine": null })));

        assert!(states.is_empty());
    }

    #[test]
    fn a_cursor_or_scroll_line_that_does_not_fit_is_ignored() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set(
            "/a.md",
            &json!({ "cursor": { "line": 4, "column": 1 }, "scrollLine": 3 }),
        );

        for bad in [
            json!({ "cursor": { "line": 0, "column": 1 } }),
            json!({ "cursor": { "line": -1, "column": 1 } }),
            json!({ "cursor": { "line": 1.5, "column": 1 } }),
            json!({ "cursor": { "line": 1, "column": -1 } }),
            json!({ "cursor": { "line": 1 } }),
            json!({ "cursor": "start" }),
            json!({ "cursor": { "line": 1e12, "column": 0 } }),
            json!({ "scrollLine": 0 }),
            json!({ "scrollLine": "7" }),
            json!({ "scrollLine": 2.5 }),
            json!({ "scrollLine": true }),
        ] {
            assert!(!states.set("/a.md", &bad), "{bad}");
        }
        let state = full(&mut states, "/a.md");
        assert_eq!(state.cursor, Some(Cursor { line: 4, column: 1 }));
        assert_eq!(state.scroll_line, Some(3));
        assert!(!states.set("/new.md", &json!({ "scrollLine": 0 })));
        assert_eq!(states.len(), 1);
    }

    #[test]
    fn c26_cursor_and_scroll_survive_a_restart() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set(
            "/a.md",
            &json!({ "cursor": { "line": 8, "column": 2 }, "scrollLine": 5 }),
        );
        states.set("/b.md", &json!({ "flavor": "mdx" }));
        states.save().expect("saves");

        let mut reloaded = empty(&dir);

        assert_eq!(
            full(&mut reloaded, "/a.md").cursor,
            Some(Cursor { line: 8, column: 2 })
        );
        assert_eq!(full(&mut reloaded, "/a.md").scroll_line, Some(5));
        let text = std::fs::read_to_string(dir.path().join("doc-state.json")).expect("read");
        let value: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(
            value,
            json!({ "version": 1, "entries": [
                { "path": "/b.md", "flavor": "mdx" },
                { "path": "/a.md", "flavor": null, "cursor": { "line": 8, "column": 2 }, "scrollLine": 5 }
            ] })
        );
    }

    #[test]
    fn c26_a_store_with_bad_cursor_values_keeps_what_is_valid() {
        let dir = TempDir::new();
        let file = dir.write(
            "doc-state.json",
            br#"{"version": 1, "entries": [
                {"path": "/a.md", "cursor": {"line": 0, "column": 0}, "scrollLine": 4},
                {"path": "/b.md", "cursor": {"line": 3}, "scrollLine": -2}
            ]}"#,
        );

        let mut states = DocStates::load(file);

        assert_eq!(states.len(), 1, "/b.md has nothing valid left");
        let state = full(&mut states, "/a.md");
        assert_eq!(state.cursor, None);
        assert_eq!(state.scroll_line, Some(4));
    }

    #[test]
    fn a_move_takes_the_entry_to_the_new_path() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/old.md", &json!({ "flavor": "gfm", "scrollLine": 3 }));
        states.set("/other.md", &json!({ "flavor": "mdx" }));

        assert!(states.moved("/old.md", "/new.md"));

        assert_eq!(full(&mut states, "/old.md"), DocState::default());
        let state = full(&mut states, "/new.md");
        assert_eq!(state.flavor.as_deref(), Some("gfm"));
        assert_eq!(state.scroll_line, Some(3));
        assert_eq!(states.len(), 2);
        assert!(!states.moved("/nothing.md", "/x.md"));
    }

    #[test]
    fn moving_a_folder_moves_the_entries_below_it_and_not_look_alikes() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/d/a.md", &json!({ "flavor": "gfm" }));
        states.set("/d/sub/b.md", &json!({ "flavor": "mdx" }));
        states.set("/d2/c.md", &json!({ "flavor": "quarto" }));

        assert!(states.moved("/d", "/e"));

        assert_eq!(full(&mut states, "/e/a.md").flavor.as_deref(), Some("gfm"));
        assert_eq!(
            full(&mut states, "/e/sub/b.md").flavor.as_deref(),
            Some("mdx")
        );
        assert_eq!(
            full(&mut states, "/d2/c.md").flavor.as_deref(),
            Some("quarto")
        );
        assert_eq!(full(&mut states, "/d/a.md"), DocState::default());
    }

    #[test]
    fn a_move_onto_a_path_with_an_entry_replaces_that_entry() {
        let dir = TempDir::new();
        let mut states = empty(&dir);
        states.set("/a.md", &json!({ "flavor": "gfm" }));
        states.set("/b.md", &json!({ "flavor": "mdx" }));

        states.moved("/a.md", "/b.md");

        assert_eq!(states.len(), 1);
        assert_eq!(full(&mut states, "/b.md").flavor.as_deref(), Some("gfm"));
    }
}
