//! Files the user chose for an export.
//!
//! The save dialog of an export (`kind` html or docx) does not grant the chosen path as a
//! document. It only remembers it here, and `write_export` (HTML) and the Pandoc export (DOCX,
//! `pandoc.rs`) write to a path that is on this short list, once. So the page cannot make Rust
//! write anywhere except where the user just said it may.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// How many chosen paths are remembered; the oldest is forgotten first.
const MAX_REMEMBERED: usize = 8;

#[derive(Default)]
pub struct ExportTargets {
    allowed: Mutex<Vec<PathBuf>>,
}

impl ExportTargets {
    /// Remembers a path the save dialog just returned (canonical spelling).
    pub fn allow(&self, path: &Path) {
        let mut allowed = self.lock();
        allowed.retain(|known| known != path);
        allowed.push(path.to_path_buf());
        if allowed.len() > MAX_REMEMBERED {
            allowed.remove(0);
        }
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        self.lock().iter().any(|known| known == path)
    }

    /// Forgets the path once the export is done. Returns true if it was on the list.
    pub fn finish(&self, path: &Path) -> bool {
        let mut allowed = self.lock();
        let before = allowed.len();
        allowed.retain(|known| known != path);
        allowed.len() != before
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<PathBuf>> {
        self.allowed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_path_that_was_chosen_is_allowed_and_only_until_the_export_is_done() {
        let targets = ExportTargets::default();
        let path = Path::new("/notes/out.html");

        assert!(!targets.is_allowed(path));
        targets.allow(path);
        assert!(targets.is_allowed(path));
        assert!(!targets.is_allowed(Path::new("/notes/other.html")));

        assert!(targets.finish(path));
        assert!(!targets.is_allowed(path));
        assert!(!targets.finish(path), "already finished");
    }

    #[test]
    fn the_list_is_short_and_forgets_the_oldest() {
        let targets = ExportTargets::default();
        for index in 0..(MAX_REMEMBERED + 2) {
            targets.allow(Path::new(&format!("/out{index}.html")));
        }

        assert!(!targets.is_allowed(Path::new("/out0.html")));
        assert!(!targets.is_allowed(Path::new("/out1.html")));
        assert!(targets.is_allowed(Path::new("/out2.html")));
        assert!(targets.is_allowed(Path::new(&format!("/out{}.html", MAX_REMEMBERED + 1))));
    }

    #[test]
    fn choosing_the_same_path_twice_keeps_one_entry() {
        let targets = ExportTargets::default();
        targets.allow(Path::new("/a.html"));
        targets.allow(Path::new("/a.html"));

        assert!(targets.finish(Path::new("/a.html")));
        assert!(!targets.is_allowed(Path::new("/a.html")));
    }
}
