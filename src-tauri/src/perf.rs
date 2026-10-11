//! Output for the memory and latency harness (WRITEDOWN_PERF, WRITEDOWN_BENCH).
//!
//! One line per mark, on stdout, for the harness to read:
//!
//! ```text
//! WRITEDOWN_PERF {"mark":"ready","ms":412.3}
//! WRITEDOWN_BENCH {"render_ms":[1.20,...],"e2e_ms":[140.50,...],"doc_bytes":102400}
//! ```
//!
//! `ms` is the time since the process started (the start of `run`, so the few milliseconds the
//! dynamic loader needs before `main` are not included).

use std::io::Write;
use std::sync::OnceLock;
use std::time::Instant;

static START: OnceLock<Instant> = OnceLock::new();

/// Records "process start". Called first thing in `run`; later calls change nothing.
pub fn start_clock() {
    START.get_or_init(Instant::now);
}

/// Milliseconds since `start_clock`.
pub fn elapsed_ms() -> f64 {
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// Mark names are short and plain, so a line can never be broken or forged through them.
fn is_valid_mark_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 40
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The stdout line for a mark, or `None` for a name that is not allowed.
pub fn mark_line(name: &str, ms: f64) -> Option<String> {
    is_valid_mark_name(name)
        .then(|| format!("WRITEDOWN_PERF {{\"mark\":\"{name}\",\"ms\":{ms:.1}}}"))
}

/// A number for a JSON array. JSON has no NaN or infinity, so those become `null`.
fn json_number(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.2}")
    } else {
        "null".to_string()
    }
}

fn json_array(values: &[f64]) -> String {
    let items: Vec<String> = values.iter().copied().map(json_number).collect();
    format!("[{}]", items.join(","))
}

/// The stdout line for the typing benchmark result.
pub fn bench_line(render_ms: &[f64], e2e_ms: &[f64], doc_bytes: u64) -> String {
    format!(
        "WRITEDOWN_BENCH {{\"render_ms\":{},\"e2e_ms\":{},\"doc_bytes\":{doc_bytes}}}",
        json_array(render_ms),
        json_array(e2e_ms)
    )
}

/// One search benchmark run: milliseconds, files, matches, whether the match cap was hit.
pub type SearchRun = (f64, u64, u64, bool);

/// The stdout line for the search benchmark result.
pub fn search_bench_line(query: &str, runs: &[SearchRun], error: Option<&str>) -> String {
    let items: Vec<String> = runs
        .iter()
        .map(|(ms, files, matches, truncated)| {
            format!(
                "{{\"ms\":{},\"files\":{files},\"matches\":{matches},\"truncated\":{truncated}}}",
                json_number(*ms)
            )
        })
        .collect();
    let query = serde_json::to_string(query).unwrap_or_else(|_| "\"\"".to_string());
    let error = error.map_or("null".to_string(), |e| {
        serde_json::to_string(e).unwrap_or_else(|_| "null".to_string())
    });
    format!(
        "WRITEDOWN_BENCH {{\"search\":true,\"query\":{query},\"runs\":[{}],\"error\":{error}}}",
        items.join(",")
    )
}

/// Prints one line and flushes. A closed pipe must not crash the app, so errors are ignored.
pub fn print_line(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mark_line_has_the_exact_format_with_one_decimal() {
        assert_eq!(
            mark_line("ready", 412.34).as_deref(),
            Some(r#"WRITEDOWN_PERF {"mark":"ready","ms":412.3}"#)
        );
        assert_eq!(
            mark_line("frontend-init", 0.0).as_deref(),
            Some(r#"WRITEDOWN_PERF {"mark":"frontend-init","ms":0.0}"#)
        );
        assert_eq!(
            mark_line("first-preview-painted", 1234.56).as_deref(),
            Some(r#"WRITEDOWN_PERF {"mark":"first-preview-painted","ms":1234.6}"#)
        );
    }

    #[test]
    fn the_startup_names_and_the_extra_marks_are_accepted() {
        for name in [
            "frontend-init",
            "doc-loaded",
            "first-preview-painted",
            "ready",
            "prefs-ready",
            "page-hidden",
            "page-visible",
        ] {
            assert!(mark_line(name, 1.0).is_some(), "{name}");
        }
    }

    #[test]
    fn names_that_could_break_the_line_are_refused() {
        for name in [
            "",
            "Ready",
            "with space",
            "quote\"",
            "back\\slash",
            "new\nline",
            "ünï",
            &"a".repeat(41),
        ] {
            assert_eq!(mark_line(name, 1.0), None, "{name:?}");
        }
    }

    #[test]
    fn the_clock_runs_forward() {
        start_clock();
        let first = elapsed_ms();
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(elapsed_ms() > first);
    }

    #[test]
    fn a_bench_line_has_the_exact_format() {
        assert_eq!(
            bench_line(&[1.2, 3.456], &[140.5, 150.0], 102_400),
            r#"WRITEDOWN_BENCH {"render_ms":[1.20,3.46],"e2e_ms":[140.50,150.00],"doc_bytes":102400}"#
        );
    }

    #[test]
    fn a_search_bench_line_has_the_exact_format() {
        assert_eq!(
            search_bench_line("lan\"tern", &[(12.345, 2000, 1000, true)], None),
            r#"WRITEDOWN_BENCH {"search":true,"query":"lan\"tern","runs":[{"ms":12.35,"files":2000,"matches":1000,"truncated":true}],"error":null}"#
        );
        assert_eq!(
            search_bench_line("a", &[], Some("no folder")),
            r#"WRITEDOWN_BENCH {"search":true,"query":"a","runs":[],"error":"no folder"}"#
        );
    }

    #[test]
    fn a_bench_line_with_no_samples_is_valid() {
        assert_eq!(
            bench_line(&[], &[], 0),
            r#"WRITEDOWN_BENCH {"render_ms":[],"e2e_ms":[],"doc_bytes":0}"#
        );
    }

    #[test]
    fn numbers_that_json_cannot_hold_become_null() {
        assert_eq!(
            bench_line(&[f64::NAN, f64::INFINITY], &[1.0], 1),
            r#"WRITEDOWN_BENCH {"render_ms":[null,null],"e2e_ms":[1.00],"doc_bytes":1}"#
        );
    }

    #[test]
    fn the_lines_are_valid_json_after_the_prefix() {
        let mark = mark_line("ready", 12.5).expect("valid name");
        let json: serde_json::Value =
            serde_json::from_str(mark.strip_prefix("WRITEDOWN_PERF ").expect("prefix"))
                .expect("json");
        assert_eq!(json["mark"], "ready");
        assert_eq!(json["ms"], 12.5);

        let bench = bench_line(&[1.0, 2.0], &[3.0], 7);
        let json: serde_json::Value =
            serde_json::from_str(bench.strip_prefix("WRITEDOWN_BENCH ").expect("prefix"))
                .expect("json");
        assert_eq!(json["doc_bytes"], 7);
        assert_eq!(json["render_ms"].as_array().map(Vec::len), Some(2));
    }
}
