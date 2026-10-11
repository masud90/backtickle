//! Line endings: normalizing on read, restoring on save.
//!
//! The editor only ever sees `\n`. On read, `\r\n` and a lone `\r` (classic Mac) become `\n`;
//! the file's majority ending is remembered so a save writes it back (Reading).

use serde::{Deserialize, Serialize};
use std::borrow::Cow;

/// `LineEnding` in `src/lib/platform.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// The text with `\n` only, and what the file used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Normalized {
    pub text: String,
    /// The majority ending. A tie, and a file without line breaks, count as `Lf`.
    pub line_ending: LineEnding,
    /// More than one kind of line break occurs, or a lone `\r` occurs. Saving writes
    /// `line_ending` for every break, so a mixed file is changed by a save.
    pub mixed: bool,
}

/// Replaces `\r\n` and a lone `\r` by `\n` and reports the majority ending.
///
/// A lone `\r` counts with `\n` in the vote (the editor treats it as a line break too, so it is
/// written back as whatever the majority is) and always sets `mixed`.
pub fn normalize(text: &str) -> Normalized {
    if !text.contains('\r') {
        return Normalized {
            text: text.to_owned(),
            line_ending: LineEnding::Lf,
            mixed: false,
        };
    }

    let mut out = String::with_capacity(text.len());
    let (mut lf, mut crlf, mut cr) = (0usize, 0usize, 0usize);
    let mut rest = text;
    while let Some(position) = rest.find('\r') {
        let (head, tail) = rest.split_at(position);
        lf += count_newlines(head);
        out.push_str(head);
        out.push('\n');
        let after = &tail[1..];
        if let Some(stripped) = after.strip_prefix('\n') {
            crlf += 1;
            rest = stripped;
        } else {
            cr += 1;
            rest = after;
        }
    }
    lf += count_newlines(rest);
    out.push_str(rest);

    let kinds = [lf, crlf, cr].iter().filter(|count| **count > 0).count();
    Normalized {
        text: out,
        line_ending: if crlf > lf + cr {
            LineEnding::Crlf
        } else {
            LineEnding::Lf
        },
        mixed: kinds > 1 || cr > 0,
    }
}

fn count_newlines(text: &str) -> usize {
    text.bytes().filter(|byte| *byte == b'\n').count()
}

/// The text as it is written to disk: every `\n` becomes the chosen ending.
///
/// The editor text has no `\r`, but a stray `\r\n` is folded first so it can never become
/// `\r\r\n`.
pub fn apply(text: &str, ending: LineEnding) -> Cow<'_, str> {
    match ending {
        LineEnding::Lf => Cow::Borrowed(text),
        LineEnding::Crlf => {
            if !text.contains('\n') {
                return Cow::Borrowed(text);
            }
            let folded = text.replace("\r\n", "\n");
            Cow::Owned(folded.replace('\n', "\r\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_without_carriage_returns_is_lf_and_unchanged() {
        let result = normalize("a\nb\n");

        assert_eq!(result.text, "a\nb\n");
        assert_eq!(result.line_ending, LineEnding::Lf);
        assert!(!result.mixed);
    }

    #[test]
    fn text_without_line_breaks_is_lf() {
        for text in ["", "no breaks at all"] {
            let result = normalize(text);
            assert_eq!(result.text, text);
            assert_eq!(result.line_ending, LineEnding::Lf);
            assert!(!result.mixed);
        }
    }

    #[test]
    fn crlf_text_is_normalized_and_reported_as_crlf() {
        let result = normalize("a\r\nb\r\nc");

        assert_eq!(result.text, "a\nb\nc");
        assert_eq!(result.line_ending, LineEnding::Crlf);
        assert!(!result.mixed);
    }

    #[test]
    fn the_majority_wins_and_mixed_is_set() {
        let mostly_lf = normalize("1\n2\n3\n4\r\n5\r\n6\n");
        assert_eq!(mostly_lf.text, "1\n2\n3\n4\n5\n6\n");
        assert_eq!(mostly_lf.line_ending, LineEnding::Lf);
        assert!(mostly_lf.mixed);

        let mostly_crlf = normalize("1\r\n2\r\n3\r\n4\n");
        assert_eq!(mostly_crlf.line_ending, LineEnding::Crlf);
        assert!(mostly_crlf.mixed);
    }

    #[test]
    fn a_tie_goes_to_lf() {
        let result = normalize("1\r\n2\n");

        assert_eq!(result.line_ending, LineEnding::Lf);
        assert!(result.mixed);
    }

    #[test]
    fn a_lone_carriage_return_is_a_line_break_and_marks_the_file_as_mixed() {
        let result = normalize("a\rb\rc");

        assert_eq!(result.text, "a\nb\nc");
        assert_eq!(result.line_ending, LineEnding::Lf);
        assert!(result.mixed, "a classic Mac file changes when it is saved");
    }

    #[test]
    fn a_lone_carriage_return_counts_against_crlf_in_the_vote() {
        let result = normalize("1\r\n2\r\n3\r4\r5\r6\n");

        assert_eq!(result.line_ending, LineEnding::Lf);
        assert!(result.mixed);
    }

    #[test]
    fn a_carriage_return_before_a_carriage_return_and_line_feed_is_two_breaks() {
        let result = normalize("a\r\r\nb");

        assert_eq!(result.text, "a\n\nb");
    }

    #[test]
    fn a_trailing_carriage_return_becomes_a_line_break() {
        assert_eq!(normalize("a\r").text, "a\n");
        assert_eq!(normalize("a\r\n").text, "a\n");
    }

    #[test]
    fn multibyte_text_survives_normalization() {
        let result = normalize("快速\r\nالثعلب\r\n👨‍👩‍👧‍👦\r\n");

        assert_eq!(result.text, "快速\nالثعلب\n👨‍👩‍👧‍👦\n");
        assert_eq!(result.line_ending, LineEnding::Crlf);
    }

    #[test]
    fn apply_writes_lf_unchanged_and_crlf_for_every_break() {
        assert_eq!(apply("a\nb\n", LineEnding::Lf), "a\nb\n");
        assert_eq!(apply("a\nb\n", LineEnding::Crlf), "a\r\nb\r\n");
        assert_eq!(apply("one line", LineEnding::Crlf), "one line");
        assert_eq!(apply("", LineEnding::Crlf), "");
    }

    #[test]
    fn apply_never_doubles_a_carriage_return() {
        assert_eq!(apply("a\r\nb\n", LineEnding::Crlf), "a\r\nb\r\n");
    }

    #[test]
    fn normalizing_then_applying_the_same_ending_restores_a_consistent_file() {
        for original in ["a\nb\nc\n", "a\r\nb\r\nc\r\n", "no break", "\n\n"] {
            let normalized = normalize(original);
            assert_eq!(
                apply(&normalized.text, normalized.line_ending),
                original,
                "{original:?}"
            );
        }
    }

    #[test]
    fn line_endings_serialize_in_lower_case() {
        assert_eq!(
            serde_json::to_value(LineEnding::Lf).expect("serializes"),
            serde_json::json!("lf")
        );
        assert_eq!(
            serde_json::to_value(LineEnding::Crlf).expect("serializes"),
            serde_json::json!("crlf")
        );
        let parsed: LineEnding = serde_json::from_str("\"crlf\"").expect("parses");
        assert_eq!(parsed, LineEnding::Crlf);
    }
}
