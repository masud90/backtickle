//! The names of system things in the messages the user reads, which differ between macOS,
//! Windows and Linux. The page has its own copy of these words (src/lib/os.ts).

/// The operating system.
#[cfg(target_os = "macos")]
pub const OS: &str = "macOS";
#[cfg(windows)]
pub const OS: &str = "Windows";
#[cfg(not(any(target_os = "macos", windows)))]
pub const OS: &str = "Linux";

/// The file manager.
#[cfg(target_os = "macos")]
pub const FILE_MANAGER: &str = "Finder";
#[cfg(windows)]
pub const FILE_MANAGER: &str = "File Explorer";
#[cfg(not(any(target_os = "macos", windows)))]
pub const FILE_MANAGER: &str = "the file manager";

/// Where deleted items go.
#[cfg(not(windows))]
pub const TRASH: &str = "Trash";
#[cfg(windows)]
pub const TRASH: &str = "Recycle Bin";

/// The computer, in "a file on this ...".
#[cfg(target_os = "macos")]
pub const COMPUTER: &str = "Mac";
#[cfg(not(target_os = "macos"))]
pub const COMPUTER: &str = "computer";
