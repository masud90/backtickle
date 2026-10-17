//! The names of system things in the messages the user reads, which differ between macOS and
//! Windows. The page has its own copy of these words (src/lib/os.ts).

/// The operating system.
#[cfg(not(windows))]
pub const OS: &str = "macOS";
#[cfg(windows)]
pub const OS: &str = "Windows";

/// The file manager.
#[cfg(not(windows))]
pub const FILE_MANAGER: &str = "Finder";
#[cfg(windows)]
pub const FILE_MANAGER: &str = "File Explorer";

/// Where deleted items go.
#[cfg(not(windows))]
pub const TRASH: &str = "Trash";
#[cfg(windows)]
pub const TRASH: &str = "Recycle Bin";

/// The computer, in "a file on this ...".
#[cfg(not(windows))]
pub const COMPUTER: &str = "Mac";
#[cfg(windows)]
pub const COMPUTER: &str = "computer";
