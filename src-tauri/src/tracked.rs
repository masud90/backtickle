//! What the app remembers about the files it read or saved: their stamp (modification time and
//! size) and whether the document was read with replaced bytes.
//!
//! The frontend only passes the modification time back on a save. The size and the "lossy" flag
//! are kept here, so a save can notice a file that changed size and can refuse to write back a
//! document that lost bytes when it was read (Saving).

use crate::fs_util::FileStamp;
use crate::safe_save::Tracked;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
pub struct TrackedFiles {
    files: Mutex<HashMap<PathBuf, Tracked>>,
}

impl TrackedFiles {
    pub fn get(&self, path: &Path) -> Option<Tracked> {
        self.lock().get(path).copied()
    }

    /// A document was read: remember what the file looked like and whether bytes were lost.
    pub fn record_read(&self, path: &Path, stamp: FileStamp, lossy: bool) {
        self.lock()
            .insert(path.to_path_buf(), Tracked { stamp, lossy });
    }

    /// A document was saved: the file now is what the app wrote, and nothing is lost any more
    /// (the replaced characters are real characters in the new file).
    pub fn record_saved(&self, path: &Path, stamp: FileStamp) {
        self.lock().insert(
            path.to_path_buf(),
            Tracked {
                stamp,
                lossy: false,
            },
        );
    }

    /// A rename or a move: what is known about `from`, and about everything below it when it was
    /// a folder, now belongs to `to`.
    pub fn moved(&self, from: &Path, to: &Path) {
        let mut files = self.lock();
        let moved: Vec<PathBuf> = files
            .keys()
            .filter(|known| known.starts_with(from))
            .cloned()
            .collect();
        for old in moved {
            if let (Some(tracked), Ok(rest)) = (files.remove(&old), old.strip_prefix(from)) {
                files.insert(to.join(rest), tracked);
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Tracked>> {
        self.files.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(modified_ms: u64, size: u64) -> FileStamp {
        FileStamp { modified_ms, size }
    }

    #[test]
    fn nothing_is_known_about_a_path_that_was_never_read() {
        assert_eq!(TrackedFiles::default().get(Path::new("/a.md")), None);
    }

    #[test]
    fn a_read_is_remembered_with_its_lossy_flag() {
        let tracked = TrackedFiles::default();

        tracked.record_read(Path::new("/a.md"), stamp(10, 5), true);

        assert_eq!(
            tracked.get(Path::new("/a.md")),
            Some(Tracked {
                stamp: stamp(10, 5),
                lossy: true
            })
        );
        assert_eq!(tracked.get(Path::new("/b.md")), None);
    }

    #[test]
    fn a_save_replaces_the_stamp_and_clears_the_lossy_flag() {
        let tracked = TrackedFiles::default();
        tracked.record_read(Path::new("/a.md"), stamp(10, 5), true);

        tracked.record_saved(Path::new("/a.md"), stamp(20, 7));

        assert_eq!(
            tracked.get(Path::new("/a.md")),
            Some(Tracked {
                stamp: stamp(20, 7),
                lossy: false
            })
        );
    }

    #[test]
    fn a_new_read_replaces_what_was_known() {
        let tracked = TrackedFiles::default();
        tracked.record_read(Path::new("/a.md"), stamp(10, 5), false);

        tracked.record_read(Path::new("/a.md"), stamp(30, 9), true);

        assert_eq!(
            tracked.get(Path::new("/a.md")).map(|entry| entry.stamp),
            Some(stamp(30, 9))
        );
    }

    #[test]
    fn a_move_takes_what_is_known_to_the_new_path() {
        let files = TrackedFiles::default();
        files.record_read(Path::new("/d/a.md"), stamp(1, 2), true);
        files.record_read(Path::new("/d2/b.md"), stamp(3, 4), false);

        files.moved(Path::new("/d"), Path::new("/e"));

        assert_eq!(files.get(Path::new("/d/a.md")), None);
        assert_eq!(
            files.get(Path::new("/e/a.md")),
            Some(Tracked {
                stamp: stamp(1, 2),
                lossy: true
            })
        );
        assert!(
            files.get(Path::new("/d2/b.md")).is_some(),
            "not a look-alike"
        );
    }
}
