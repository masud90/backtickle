//! The system clipboard: `write_clipboard` for Copy as HTML and Copy Path,
//! `read_clipboard_text` for Paste and Match Style. The web view has no clipboard permission;
//! these two functions are the only way it reaches the pasteboard.
//!
//! The general pasteboard of macOS is used through the Objective-C runtime (`objc2`). The
//! functions take the pasteboard as an argument so the tests can use a private one and never
//! touch the user's clipboard.

use crate::error::PlatformResult;

/// The most text one write may carry (text and HTML each).
pub const MAX_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;

/// The pasteboard types: plain text and HTML (`NSPasteboardTypeString`, `NSPasteboardTypeHTML`).
const TYPE_TEXT: &str = "public.utf8-plain-text";
const TYPE_HTML: &str = "public.html";

/// What a write put on the pasteboard, for the trace line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Written {
    /// Bytes of the plain text.
    pub bytes: usize,
    pub html: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{MAX_CLIPBOARD_BYTES, TYPE_HTML, TYPE_TEXT, Written};
    use crate::error::{PlatformError, PlatformResult};
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    use std::ffi::{CStr, CString};

    /// A pasteboard object (`NSPasteboard`); a raw pointer because the objects are only used
    /// inside one autorelease pool.
    pub struct Board(pub *mut AnyObject);

    // SAFETY: NSPasteboard is documented as safe to use from any thread.
    unsafe impl Send for Board {}
    unsafe impl Sync for Board {}

    impl Board {
        /// The general pasteboard.
        pub fn general() -> Board {
            // SAFETY: `generalPasteboard` is a class method without arguments that returns the
            // shared pasteboard object (never nil on macOS).
            Board(unsafe { msg_send![class!(NSPasteboard), generalPasteboard] })
        }
    }

    /// An autoreleased `NSString` with the text (NUL characters dropped: C strings end at them).
    fn ns_string(text: &str) -> Option<*mut AnyObject> {
        let c_text = CString::new(text.replace('\0', "")).ok()?;
        // SAFETY: `stringWithUTF8String:` reads a valid NUL-terminated UTF-8 string.
        let string: *mut AnyObject =
            unsafe { msg_send![class!(NSString), stringWithUTF8String: c_text.as_ptr()] };
        (!string.is_null()).then_some(string)
    }

    fn set_string(board: &Board, text: &str, kind: &str) -> bool {
        let (Some(value), Some(kind)) = (ns_string(text), ns_string(kind)) else {
            return false;
        };
        // SAFETY: the board and both strings are live objects; `setString:forType:` returns BOOL.
        let ok: Bool = unsafe { msg_send![board.0, setString: value, forType: kind] };
        ok.as_bool()
    }

    pub fn write(board: &Board, text: &str, html: Option<&str>) -> PlatformResult<Written> {
        if text.len() > MAX_CLIPBOARD_BYTES || html.is_some_and(|h| h.len() > MAX_CLIPBOARD_BYTES) {
            return Err(PlatformError::io("This is too large to copy."));
        }
        autoreleasepool(|_| {
            // SAFETY: `clearContents` takes no arguments; it returns the change count.
            let _: isize = unsafe { msg_send![board.0, clearContents] };
            if !set_string(board, text, TYPE_TEXT) {
                return Err(PlatformError::io("The text could not be copied."));
            }
            if let Some(html) = html
                && !set_string(board, html, TYPE_HTML)
            {
                return Err(PlatformError::io("The text could not be copied."));
            }
            Ok(Written {
                bytes: text.len(),
                html: html.is_some(),
            })
        })
    }

    pub fn read_text(board: &Board) -> String {
        autoreleasepool(|_| {
            let Some(kind) = ns_string(TYPE_TEXT) else {
                return String::new();
            };
            // SAFETY: `stringForType:` returns an NSString or nil.
            let value: *mut AnyObject = unsafe { msg_send![board.0, stringForType: kind] };
            if value.is_null() {
                return String::new();
            }
            // SAFETY: a non-nil NSString; `UTF8String` returns a NUL-terminated buffer owned
            // by the string that stays valid inside this autorelease pool; it is copied now.
            let bytes: *const std::ffi::c_char = unsafe { msg_send![value, UTF8String] };
            if bytes.is_null() {
                return String::new();
            }
            unsafe { CStr::from_ptr(bytes) }
                .to_string_lossy()
                .into_owned()
        })
    }

    /// A pasteboard of its own, not the user's (for tests).
    #[cfg(test)]
    pub fn private_board() -> Board {
        // SAFETY: class method without arguments that returns a new, uniquely named pasteboard.
        Board(unsafe { msg_send![class!(NSPasteboard), pasteboardWithUniqueName] })
    }

    /// The data of another type on the pasteboard (for tests).
    #[cfg(test)]
    pub fn read_type(board: &Board, kind: &str) -> Option<String> {
        autoreleasepool(|_| {
            let kind = ns_string(kind)?;
            // SAFETY: as in `read_text`.
            let value: *mut AnyObject = unsafe { msg_send![board.0, stringForType: kind] };
            if value.is_null() {
                return None;
            }
            let bytes: *const std::ffi::c_char = unsafe { msg_send![value, UTF8String] };
            (!bytes.is_null()).then(|| {
                unsafe { CStr::from_ptr(bytes) }
                    .to_string_lossy()
                    .into_owned()
            })
        })
    }
}

/// Puts text, and HTML if given, on the general pasteboard (replacing its contents).
pub fn write_clipboard(text: &str, html: Option<&str>) -> PlatformResult<Written> {
    #[cfg(target_os = "macos")]
    {
        imp::write(&imp::Board::general(), text, html)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, html);
        Err(crate::error::PlatformError::io(
            "The clipboard is not available here.",
        ))
    }
}

/// The plain text on the general pasteboard (empty if there is none).
pub fn read_clipboard_text() -> PlatformResult<String> {
    #[cfg(target_os = "macos")]
    {
        Ok(imp::read_text(&imp::Board::general()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(crate::error::PlatformError::io(
            "The clipboard is not available here.",
        ))
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::imp::*;
    use super::*;

    #[test]
    fn text_and_html_are_written_and_read_back_from_a_private_pasteboard() {
        let board = private_board();

        let written = write(&board, "plain \u{e9} text", Some("<p>rich</p>")).expect("writes");

        assert_eq!(
            written,
            Written {
                bytes: "plain \u{e9} text".len(),
                html: true
            }
        );
        assert_eq!(read_text(&board), "plain \u{e9} text");
        assert_eq!(
            read_type(&board, "public.html").as_deref(),
            Some("<p>rich</p>")
        );
    }

    #[test]
    fn a_write_without_html_leaves_no_html_and_replaces_the_old_contents() {
        let board = private_board();
        write(&board, "first", Some("<b>first</b>")).expect("writes");

        let written = write(&board, "second", None).expect("writes");

        assert!(!written.html);
        assert_eq!(read_text(&board), "second");
        assert_eq!(read_type(&board, "public.html"), None);
    }

    #[test]
    fn an_empty_pasteboard_reads_as_empty_text() {
        let board = private_board();

        assert_eq!(read_text(&board), "");
    }

    #[test]
    fn multi_line_text_and_nul_characters_are_handled() {
        let board = private_board();

        write(&board, "a\nb\r\nc\0d", None).expect("writes");

        assert_eq!(read_text(&board), "a\nb\r\ncd");
    }
}
