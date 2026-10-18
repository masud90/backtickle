//! `BACKTICKLE_TRACE=1`: one JSON line on stdout per backend event, so the real app can be
//! checked without driving its interface.
//!
//! ```text
//! {"trace":"open-files","paths":["/Users/me/a.md"],"queued":false}
//! {"trace":"menu-action","action":"save","queued":false}
//! {"trace":"close-requested","reason":"window"}
//! {"trace":"save","path":"/Users/me/a.md","bytes":120,"encoding":"utf-8","lineEnding":"lf"}
//! {"trace":"recents-changed","paths":["/Users/me/a.md"]}
//! {"trace":"settings-changed","settings":{...}}
//! ```
//!
//! Besides these, `finish-close` and `close-forced` (the page did not answer in time) are
//! printed. Every line is a JSON object whose first key is `trace`.

use crate::perf;
use serde_json::{Map, Value};

/// The line for an event: `{"trace": name, ...fields}`. `fields` should be a JSON object; any
/// other value is ignored.
pub fn line(name: &str, fields: Value) -> String {
    let mut object = Map::new();
    object.insert("trace".to_owned(), Value::String(name.to_owned()));
    if let Value::Object(fields) = fields {
        for (key, value) in fields {
            if key != "trace" {
                object.insert(key, value);
            }
        }
    }
    Value::Object(object).to_string()
}

/// The managed state that prints the lines, or does nothing when tracing is off.
#[derive(Debug, Clone, Copy, Default)]
pub struct Trace {
    enabled: bool,
}

impl Trace {
    pub fn new(enabled: bool) -> Self {
        Trace { enabled }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Prints the line for `name` and `fields` if tracing is on.
    pub fn event(&self, name: &str, fields: Value) {
        if self.enabled {
            perf::print_line(&line(name, fields));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_line_starts_with_the_event_name_and_has_the_fields_after_it() {
        assert_eq!(
            line(
                "open-files",
                json!({ "paths": ["/a.md", "/b.md"], "queued": false })
            ),
            r#"{"trace":"open-files","paths":["/a.md","/b.md"],"queued":false}"#
        );
    }

    #[test]
    fn a_line_without_fields_is_just_the_name() {
        assert_eq!(line("ack-close", json!(null)), r#"{"trace":"ack-close"}"#);
        assert_eq!(line("ack-close", json!({})), r#"{"trace":"ack-close"}"#);
    }

    #[test]
    fn a_field_cannot_replace_the_event_name() {
        assert_eq!(
            line("save", json!({ "trace": "forged", "bytes": 3 })),
            r#"{"trace":"save","bytes":3}"#
        );
    }

    #[test]
    fn paths_with_quotes_and_line_breaks_stay_on_one_line() {
        let text = line("open-files", json!({ "paths": ["/a \"b\"\n.md"] }));

        assert!(!text.contains('\n'));
        let parsed: Value = serde_json::from_str(&text).expect("valid JSON");
        assert_eq!(parsed["paths"][0], "/a \"b\"\n.md");
    }

    #[test]
    fn every_line_is_valid_json_with_trace_as_the_first_key() {
        let text = line("settings-changed", json!({ "settings": { "version": 1 } }));

        let parsed: Value = serde_json::from_str(&text).expect("valid JSON");
        assert_eq!(parsed["trace"], "settings-changed");
        assert!(text.starts_with(r#"{"trace":"settings-changed""#));
    }

    #[test]
    fn a_disabled_trace_prints_nothing_and_says_so() {
        let trace = Trace::new(false);

        assert!(!trace.enabled());
        trace.event("open-files", json!({ "paths": [] })); // must not panic or print
        assert!(Trace::new(true).enabled());
    }
}
