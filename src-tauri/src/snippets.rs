//! Snippets (WP5.5): `snippets.json` in the config folder.
//!
//! Reading is forgiving like the settings: entries of the wrong shape are dropped, over-long
//! text is cut, an invalid trigger is cleared, ids are made unique. A missing file gives the
//! starter set (and writes it, so it can be edited and deleted); a corrupt file is kept aside
//! by `store::read_json` and gives the starter set in memory only. Variables in a body are
//! expanded by the editor, never here.

use crate::store::{self, Loaded};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::path::Path;

pub const MAX_SNIPPETS: usize = 500;
pub const MAX_NAME: usize = 100;
pub const MAX_TRIGGER: usize = 32;
pub const MAX_BODY: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    /// Empty when the snippet has no trigger word.
    pub trigger: String,
    pub body: String,
}

fn cut(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// A trigger is letters, digits, `-` and `_` (ASCII); anything else clears it.
pub fn clean_trigger(raw: &str) -> String {
    let text = raw.trim();
    if text.is_empty()
        || text.chars().count() > MAX_TRIGGER
        || !text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return String::new();
    }
    text.to_owned()
}

/// Cleans a list: drops entries without a name, fixes the rest, makes ids unique.
pub fn sanitize(list: &[Snippet]) -> Vec<Snippet> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for entry in list.iter().take(MAX_SNIPPETS) {
        let name = cut(entry.name.trim(), MAX_NAME);
        if name.is_empty() {
            continue;
        }
        let mut id = cut(entry.id.trim(), 64);
        if id.is_empty() || seen.contains(&id) {
            let mut n = out.len() + 1;
            loop {
                id = format!("s-{}-{n}", crate::fs_util::now_ms());
                if !seen.contains(&id) {
                    break;
                }
                n += 1;
            }
        }
        seen.insert(id.clone());
        out.push(Snippet {
            id,
            name,
            trigger: clean_trigger(&entry.trigger),
            body: cut(&entry.body, MAX_BODY),
        });
    }
    out
}

fn from_value(value: &Value) -> Vec<Snippet> {
    let Some(list) = value.get("snippets").and_then(Value::as_array) else {
        return Vec::new();
    };
    let parsed: Vec<Snippet> = list
        .iter()
        .filter_map(|item| {
            let text = |key: &str| item.get(key).and_then(Value::as_str).map(str::to_owned);
            Some(Snippet {
                id: text("id").unwrap_or_default(),
                name: text("name")?,
                trigger: text("trigger").unwrap_or_default(),
                body: text("body").unwrap_or_default(),
            })
        })
        .collect();
    sanitize(&parsed)
}

/// The five snippets of a first use.
pub fn starter() -> Vec<Snippet> {
    let entry = |id: &str, name: &str, trigger: &str, body: &str| Snippet {
        id: id.into(),
        name: name.into(),
        trigger: trigger.into(),
        body: body.into(),
    };
    vec![
        entry(
            "starter-callout",
            "Callout",
            "callout",
            "> [!NOTE]\n> {{selection}}\n",
        ),
        entry(
            "starter-table",
            "Table",
            "table",
            "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n",
        ),
        entry(
            "starter-tasks",
            "Task list",
            "tasks",
            "- [ ] First task\n- [ ] Second task\n- [ ] Third task\n",
        ),
        entry(
            "starter-footnote",
            "Footnote",
            "footnote",
            "Text with a note.[^1]\n\n[^1]: The note.\n",
        ),
        entry(
            "starter-frontmatter",
            "Frontmatter",
            "frontmatter",
            "---\ntitle: \ndate: {{date}}\n---\n",
        ),
    ]
}

/// Reads the file. See the module notes for a missing or corrupt file.
pub fn load(path: &Path) -> Vec<Snippet> {
    match store::read_json(path) {
        Loaded::Valid(value) => from_value(&value),
        Loaded::Missing => {
            let list = starter();
            let _ = save(path, &list);
            list
        }
        Loaded::Corrupt => starter(),
    }
}

pub fn save(path: &Path, list: &[Snippet]) -> std::io::Result<()> {
    store::write_json(path, &json!({ "version": 1, "snippets": list }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    fn snippet(id: &str, name: &str, trigger: &str, body: &str) -> Snippet {
        Snippet {
            id: id.into(),
            name: name.into(),
            trigger: trigger.into(),
            body: body.into(),
        }
    }

    #[test]
    fn a_missing_file_gives_the_five_starters_and_writes_them() {
        let dir = TempDir::new();
        let path = dir.path().join("snippets.json");

        let list = load(&path);

        let names: Vec<&str> = list.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            ["Callout", "Table", "Task list", "Footnote", "Frontmatter"]
        );
        assert!(path.exists());
        assert_eq!(load(&path), list);
    }

    #[test]
    fn deleting_every_snippet_stays_deleted() {
        let dir = TempDir::new();
        let path = dir.path().join("snippets.json");
        let _ = load(&path);

        save(&path, &[]).expect("saves");

        assert!(load(&path).is_empty());
    }

    #[test]
    fn a_corrupt_file_gives_the_starters_without_overwriting_and_keeps_a_copy() {
        let dir = TempDir::new();
        let path = dir.write("snippets.json", b"{ nope");

        assert_eq!(load(&path).len(), 5);
        assert_eq!(std::fs::read(&path).expect("kept"), b"{ nope");
        assert!(store::corrupt_copy_path(&path).exists());
    }

    #[test]
    fn entries_of_the_wrong_shape_are_dropped_and_the_rest_kept() {
        let dir = TempDir::new();
        let path = dir.write(
            "snippets.json",
            br#"{"snippets":[1,{"name":5},{"name":"Ok","body":"b"},{"name":"  "}]}"#,
        );

        let list = load(&path);

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Ok");
        assert_eq!(list[0].body, "b");
        assert!(!list[0].id.is_empty());
    }

    #[test]
    fn invalid_triggers_are_cleared_and_valid_ones_kept() {
        assert_eq!(clean_trigger("my-snip_1"), "my-snip_1");
        assert_eq!(clean_trigger("has space"), "");
        assert_eq!(clean_trigger("e\u{301}"), "");
        assert_eq!(clean_trigger(&"a".repeat(33)), "");
        assert_eq!(clean_trigger("  ok "), "ok");
    }

    #[test]
    fn duplicate_ids_are_made_unique_and_text_is_cut() {
        let list = sanitize(&[
            snippet("a", "One", "", &"x".repeat(MAX_BODY + 5)),
            snippet("a", "Two", "", ""),
        ]);

        assert_eq!(list.len(), 2);
        assert_ne!(list[0].id, list[1].id);
        assert_eq!(list[0].body.chars().count(), MAX_BODY);
    }

    #[test]
    fn the_file_round_trips_and_is_pretty_printed() {
        let dir = TempDir::new();
        let path = dir.path().join("snippets.json");
        let list = vec![snippet("a", "N", "tr", "line\n{{date}}")];

        save(&path, &list).expect("saves");

        assert_eq!(load(&path), list);
        let text = std::fs::read_to_string(&path).expect("read");
        assert!(text.contains("\n  \"version\": 1"), "{text}");
    }
}
