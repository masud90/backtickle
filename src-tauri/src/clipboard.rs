//! The system clipboard: `write_clipboard` for Copy as HTML and Copy Path,
//! `read_clipboard_text` for Paste and Match Style. The web view has no clipboard permission;
//! these two functions are the only way it reaches the pasteboard.
//!
//! The general pasteboard of macOS is used through the Objective-C runtime (`objc2`). The
//! functions take the pasteboard as an argument so the tests can use a private one and never
//! touch the user's clipboard. On Windows the clipboard is used through the Win32 calls, with
//! the HTML in the system's "HTML Format" (`cf_html`). On Linux it is GTK's clipboard (X11 and
//! Wayland alike), used on the main thread where GTK runs.

use crate::error::PlatformResult;

/// The most text one write may carry (text and HTML each).
pub const MAX_CLIPBOARD_BYTES: usize = 64 * 1024 * 1024;

/// The pasteboard types: plain text and HTML (`NSPasteboardTypeString`, `NSPasteboardTypeHTML`).
#[cfg(target_os = "macos")]
const TYPE_TEXT: &str = "public.utf8-plain-text";
#[cfg(target_os = "macos")]
const TYPE_HTML: &str = "public.html";

/// HTML in the Windows clipboard format "HTML Format": a header with the byte offsets of the
/// document and of the fragment, then the HTML wrapped in a document with fragment markers. The
/// offsets count UTF-8 bytes from the start.
pub fn cf_html(fragment: &str) -> String {
    const PREFIX: &str = "<html><body>\r\n<!--StartFragment-->";
    const SUFFIX: &str = "<!--EndFragment-->\r\n</body></html>";
    let header = |start_html: usize,
                  end_html: usize,
                  start_fragment: usize,
                  end_fragment: usize| {
        format!(
            "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n"
        )
    };
    let header_len = header(0, 0, 0, 0).len();
    let start_fragment = header_len + PREFIX.len();
    let end_fragment = start_fragment + fragment.len();
    let end_html = end_fragment + SUFFIX.len();
    format!(
        "{}{PREFIX}{fragment}{SUFFIX}",
        header(header_len, end_html, start_fragment, end_fragment)
    )
}

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

#[cfg(windows)]
mod win {
    use super::{MAX_CLIPBOARD_BYTES, Written, cf_html};
    use crate::error::{PlatformError, PlatformResult};
    use ::windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use ::windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use ::windows::Win32::System::Memory::{
        GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
    };
    use ::windows::core::w;

    /// CF_UNICODETEXT.
    const UNICODE_TEXT: u32 = 13;

    /// The clipboard, open until dropped. Another app may hold it for a moment, so opening is
    /// tried a few times.
    struct Open;

    impl Open {
        fn new() -> Option<Open> {
            for _ in 0..10 {
                // SAFETY: no owner window; the clipboard is closed again in `drop`.
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Some(Open);
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            None
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY: this thread opened the clipboard.
            let _ = unsafe { CloseClipboard() };
        }
    }

    /// Hands `bytes` to the clipboard as `format`. The clipboard owns the memory once it is set.
    fn set(format: u32, bytes: &[u8]) -> bool {
        // SAFETY: a movable block of the right size is allocated, filled while locked and given
        // to the clipboard; it is freed here only if the clipboard did not take it.
        unsafe {
            let Ok(memory) = GlobalAlloc(GMEM_MOVEABLE, bytes.len()) else {
                return false;
            };
            let target = GlobalLock(memory).cast::<u8>();
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return false;
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
            let _ = GlobalUnlock(memory);
            if SetClipboardData(format, Some(HANDLE(memory.0))).is_err() {
                let _ = GlobalFree(Some(memory));
                return false;
            }
            true
        }
    }

    pub fn write(text: &str, html: Option<&str>) -> PlatformResult<Written> {
        if text.len() > MAX_CLIPBOARD_BYTES || html.is_some_and(|h| h.len() > MAX_CLIPBOARD_BYTES) {
            return Err(PlatformError::io("This is too large to copy."));
        }
        let failed = || PlatformError::io("The text could not be copied.");
        let _open = Open::new().ok_or_else(failed)?;
        // SAFETY: the clipboard is open on this thread.
        unsafe { EmptyClipboard() }.map_err(|_| failed())?;
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
        if !set(UNICODE_TEXT, &bytes) {
            return Err(failed());
        }
        if let Some(html) = html {
            // SAFETY: a constant, NUL-terminated wide string.
            let format = unsafe { RegisterClipboardFormatW(w!("HTML Format")) };
            let mut data = cf_html(html).into_bytes();
            data.push(0);
            if format == 0 || !set(format, &data) {
                return Err(failed());
            }
        }
        Ok(Written {
            bytes: text.len(),
            html: html.is_some(),
        })
    }

    pub fn read_text() -> String {
        let Some(_open) = Open::new() else {
            return String::new();
        };
        // SAFETY: the clipboard is open; the handle is locked only while it is copied, and the
        // copy stops at the first NUL or at the end of the block.
        unsafe {
            let Ok(handle) = GetClipboardData(UNICODE_TEXT) else {
                return String::new();
            };
            let memory = HGLOBAL(handle.0);
            let source = GlobalLock(memory).cast::<u16>();
            if source.is_null() {
                return String::new();
            }
            let units = GlobalSize(memory) / 2;
            let all = std::slice::from_raw_parts(source, units);
            let end = all.iter().position(|&unit| unit == 0).unwrap_or(units);
            let text = String::from_utf16_lossy(&all[..end]);
            let _ = GlobalUnlock(memory);
            text
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod gtk_board {
    use super::{MAX_CLIPBOARD_BYTES, Written};
    use crate::error::{PlatformError, PlatformResult};
    use gtk::{gdk, glib};
    use std::sync::mpsc;
    use std::time::Duration;

    /// The targets plain text is offered as (what text editors and terminals ask for).
    const TEXT_TARGETS: &[&str] = &[
        "UTF8_STRING",
        "text/plain;charset=utf-8",
        "text/plain",
        "STRING",
        "TEXT",
    ];
    const HTML_TARGET: &str = "text/html";
    /// The `info` number of the HTML target (the text targets have 0).
    const HTML_INFO: u32 = 1;

    /// Runs `task` on the main thread, where GTK runs, and waits for what it sends back (`None`
    /// if it never does).
    fn on_main<T: Send + 'static>(
        task: impl FnOnce(mpsc::Sender<T>) + Send + 'static,
    ) -> Option<T> {
        let (done_tx, done_rx) = mpsc::channel();
        glib::MainContext::default().invoke(move || task(done_tx));
        done_rx.recv_timeout(Duration::from_secs(10)).ok()
    }

    pub fn write(text: &str, html: Option<&str>) -> PlatformResult<Written> {
        if text.len() > MAX_CLIPBOARD_BYTES || html.is_some_and(|h| h.len() > MAX_CLIPBOARD_BYTES) {
            return Err(PlatformError::io("This is too large to copy."));
        }
        let written = Written {
            bytes: text.len(),
            html: html.is_some(),
        };
        let text = text.to_owned();
        let html = html.map(str::to_owned);
        let set = on_main(move |done| {
            let mut targets: Vec<gtk::TargetEntry> = TEXT_TARGETS
                .iter()
                .map(|target| gtk::TargetEntry::new(target, gtk::TargetFlags::empty(), 0))
                .collect();
            if html.is_some() {
                targets.insert(
                    0,
                    gtk::TargetEntry::new(HTML_TARGET, gtk::TargetFlags::empty(), HTML_INFO),
                );
            }
            let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
            // GTK keeps the data and answers other apps from it until something else is copied.
            let set =
                clipboard.set_with_data(&targets, move |_, selection, info| match (&html, info) {
                    (Some(html), HTML_INFO) => {
                        selection.set(&selection.target(), 8, html.as_bytes())
                    }
                    _ => {
                        selection.set_text(&text);
                    }
                });
            // A clipboard manager may keep the text once Writedown has quit.
            if set {
                use glib::translate::ToGlibPtr;
                // SAFETY: the clipboard is alive; no target list means all targets may be stored.
                unsafe {
                    gtk::ffi::gtk_clipboard_set_can_store(
                        clipboard.to_glib_none().0,
                        std::ptr::null(),
                        0,
                    );
                }
            }
            let _ = done.send(set);
        });
        if set == Some(true) {
            Ok(written)
        } else {
            Err(PlatformError::io("The text could not be copied."))
        }
    }

    pub fn read_text() -> String {
        on_main(|done| {
            gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD).request_text(move |_, text| {
                let _ = done.send(text.map(str::to_owned).unwrap_or_default());
            });
        })
        .unwrap_or_default()
    }
}

/// Puts text, and HTML if given, on the general pasteboard (replacing its contents).
pub fn write_clipboard(text: &str, html: Option<&str>) -> PlatformResult<Written> {
    #[cfg(target_os = "macos")]
    {
        imp::write(&imp::Board::general(), text, html)
    }
    #[cfg(windows)]
    {
        win::write(text, html)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        gtk_board::write(text, html)
    }
}

/// The plain text on the general pasteboard (empty if there is none).
pub fn read_clipboard_text() -> PlatformResult<String> {
    #[cfg(target_os = "macos")]
    {
        Ok(imp::read_text(&imp::Board::general()))
    }
    #[cfg(windows)]
    {
        Ok(win::read_text())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Ok(gtk_board::read_text())
    }
}

#[cfg(test)]
mod cf_html_tests {
    use super::cf_html;

    fn offset(text: &str, name: &str) -> usize {
        let start = text.find(&format!("{name}:")).expect(name) + name.len() + 1;
        text[start..start + 10].parse().expect("number")
    }

    #[test]
    fn the_offsets_point_at_the_document_and_the_fragment_in_bytes() {
        let fragment = "<p>Grüße &amp; <b>bold</b></p>";
        let text = cf_html(fragment);
        let start_fragment = offset(&text, "StartFragment");
        let end_fragment = offset(&text, "EndFragment");
        assert_eq!(&text[start_fragment..end_fragment], fragment);
        assert!(text[offset(&text, "StartHTML")..].starts_with("<html>"));
        assert_eq!(offset(&text, "EndHTML"), text.len());
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
