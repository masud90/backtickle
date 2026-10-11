//! One-click PDF export.
//!
//! The page has put the document in its print root (the same view Print shows). This module runs
//! an `NSPrintOperation` of the web view with the job disposition "save" to a temporary file next
//! to the target, with the print panel and the progress panel off, then renames the file onto the
//! target. No process is started. The path is checked by the caller against the export targets
//! (it came from the save dialog); the plain-Rust parts here (target check, temporary name, final
//! rename, clean-up) are unit-tested, the AppKit part is in `imp`.

use std::path::{Path, PathBuf};

/// Why a PDF could not be written. The text is shown to the user.
#[derive(Debug, PartialEq, Eq)]
pub struct PdfError(pub String);

impl PdfError {
    fn new(text: &str) -> Self {
        PdfError(text.to_owned())
    }
}

/// The temporary file next to the target: a hidden name in the same folder (so the rename stays on
/// one volume) that still ends in `.pdf`, because the print system decides the format by it.
pub fn temp_path_for(target: &Path) -> PathBuf {
    let name = target
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let hidden = format!(".{name}.writedown-{}.pdf", std::process::id());
    target.with_file_name(hidden)
}

/// Checks a target before anything is written: a `.pdf` file name in a folder that exists, and not
/// a folder.
pub fn check_target(target: &Path) -> Result<(), PdfError> {
    let is_pdf = target
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf || target.file_name().is_none() {
        return Err(PdfError::new("The PDF needs a file name ending in .pdf."));
    }
    if target.is_dir() {
        return Err(PdfError::new("A folder has that name."));
    }
    match target.parent() {
        Some(parent) if parent.is_dir() => Ok(()),
        _ => Err(PdfError::new("The folder for the PDF does not exist.")),
    }
}

/// Moves the finished temporary file onto the target. On any failure the temporary file is removed
/// and nothing half-written stays behind.
pub fn finish(temp: &Path, target: &Path) -> Result<(), PdfError> {
    let finished = match std::fs::metadata(temp) {
        Ok(meta) if meta.is_file() && meta.len() > 0 => std::fs::rename(temp, target)
            .map_err(|_| PdfError::new("The PDF could not be saved there.")),
        _ => Err(PdfError::new(
            "The PDF could not be created (stage: no file was written).",
        )),
    };
    if finished.is_err() {
        discard(temp);
    }
    finished
}

/// Removes a temporary file, if there is one.
pub fn discard(temp: &Path) {
    crate::fs_util::discard_temp(temp);
}

/// Writes the PDF of the window's page to `target` and returns its page count. The caller has
/// checked that `target` is an export target the save dialog returned.
pub type Stage = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

/// At most one PDF export at a time (a second request while one runs is refused).
static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub fn export(window: &tauri::WebviewWindow, target: &Path, stage: Stage) -> Result<u32, PdfError> {
    check_target(target)?;
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err(PdfError::new("Another PDF is being written."));
    }
    let result = export_one(window, target, stage);
    RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}

#[cfg(target_os = "macos")]
fn export_one(window: &tauri::WebviewWindow, target: &Path, stage: Stage) -> Result<u32, PdfError> {
    let temp = temp_path_for(target);
    discard(&temp);
    let written = imp::run(window, &temp, stage);
    match written {
        Ok(()) => finish(&temp, target).map(|()| imp::page_count(target)),
        Err(error) => {
            discard(&temp);
            Err(error)
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn export(
    _window: &tauri::WebviewWindow,
    _target: &Path,
    _stage: Stage,
) -> Result<u32, PdfError> {
    Err(PdfError::new("PDF export is only available on macOS."))
}

#[cfg(target_os = "macos")]
mod imp {
    use super::PdfError;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{AnyThread, DefinedClass, define_class, msg_send};
    use objc2_app_kit::{
        NSPDFImageRep, NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob,
    };
    use objc2_foundation::{NSData, NSObjectProtocol, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;
    use std::sync::Mutex;
    use std::sync::mpsc;
    use std::time::Duration;

    type Done = Mutex<Option<mpsc::Sender<bool>>>;

    struct Ivars {
        done: Done,
    }

    define_class!(
        // The print operation calls this once, on the main thread, when it has finished.
        #[unsafe(super(NSObject))]
        #[ivars = Ivars]
        struct PdfDelegate;

        impl PdfDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(&self, _operation: &AnyObject, success: bool, _context: *mut c_void) {
                if let Some(sender) = self
                    .ivars()
                    .done
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take())
                {
                    let _ = sender.send(success);
                }
                // The operation is over: let go of this delegate.
                LIVE.with(|live| live.borrow_mut().retain(|kept| !std::ptr::eq(&**kept, self)));
            }
        }
    );

    thread_local! {
        /// Delegates of running operations (the operation does not keep its delegate alive).
        /// Only touched on the main thread.
        static LIVE: RefCell<Vec<Retained<PdfDelegate>>> = const { RefCell::new(Vec::new()) };
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn PMSessionSetDestination(
            session: *mut c_void,
            settings: *mut c_void,
            destination_type: u16,
            format: *const c_void,
            location: *const c_void,
        ) -> i32;
    }

    /// Runs the operation and waits for it (call from a blocking task, never from the main thread). `temp` is where the print system writes.
    pub fn run(
        window: &tauri::WebviewWindow,
        temp: &Path,
        stage: super::Stage,
    ) -> Result<(), PdfError> {
        let (started_tx, started_rx) = mpsc::channel::<Result<(), PdfError>>();
        let (done_tx, done_rx) = mpsc::channel::<bool>();
        let temp_text = temp.to_string_lossy().into_owned();
        window
            .with_webview(move |webview| {
                stage("closure-on-main-thread");
                let result = start(&webview, &temp_text, done_tx, &stage);
                let _ = started_tx.send(result);
            })
            .map_err(|_| PdfError::new("The PDF could not be created (stage: dispatch)."))?;
        started_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| PdfError::new("The PDF could not be created (stage: start timeout)."))??;
        match done_rx.recv_timeout(Duration::from_secs(300)) {
            Ok(true) => Ok(()),
            Ok(false) => Err(PdfError::new(
                "The PDF could not be created (stage: the print operation reported failure).",
            )),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(PdfError::new(
                "The PDF could not be created (stage: the print operation never finished).",
            )),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(PdfError::new(
                "The PDF could not be created (stage: the callback was dropped).",
            )),
        }
    }

    /// Main thread: builds the print info and starts the operation as a sheet-less modal for the
    /// window.
    fn start(
        webview: &tauri::webview::PlatformWebview,
        temp: &str,
        done: mpsc::Sender<bool>,
        stage: &super::Stage,
    ) -> Result<(), PdfError> {
        let failed = || PdfError::new("The PDF could not be created.");
        if objc2::MainThreadMarker::new().is_none() {
            return Err(failed());
        }
        // SAFETY: `inner` is the WKWebView of this window; the closure runs on the main thread
        // while the window is alive.
        let view: &WKWebView =
            unsafe { (webview.inner() as *const WKWebView).as_ref() }.ok_or_else(failed)?;
        let Some(window) = view.window() else {
            return Err(failed());
        };
        let url = NSURL::fileURLWithPath(&NSString::from_str(temp));
        // SAFETY: AppKit calls with valid objects, on the main thread.
        let operation: Retained<NSPrintOperation> = unsafe {
            let shared = NSPrintInfo::sharedPrintInfo();
            let info: Retained<NSPrintInfo> = msg_send![&*shared, copy];
            info.setTopMargin(0.0);
            info.setRightMargin(0.0);
            info.setBottomMargin(0.0);
            info.setLeftMargin(0.0);
            info.setJobDisposition(NSPrintSaveJob);
            {
                // Without a Print Core destination macOS 27 asks for the file in a PDF panel (it
                // ignores NSPrintJobSavingURL alone): a file destination in PDF format is silent.
                let session: *mut c_void = msg_send![&*info, PMPrintSession];
                let settings: *mut c_void = msg_send![&*info, PMPrintSettings];
                let pdf_format = NSString::from_str("application/pdf");
                let code = PMSessionSetDestination(
                    session,
                    settings,
                    2, // kPMDestinationFile
                    &*pdf_format as *const NSString as *const c_void,
                    &*url as *const NSURL as *const c_void,
                );
                if code != 0 {
                    return Err(failed());
                }
                let _: () = msg_send![&*info, updateFromPMPrintSettings];
            }
            info.printSettings()
                .setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));
            if !view.respondsToSelector(objc2::sel!(printOperationWithPrintInfo:)) {
                return Err(failed());
            }
            view.printOperationWithPrintInfo(&info)
        };
        // WebKit prints nothing from a view with an empty frame: give it the web view's size.
        if let Some(print_view) = operation.view() {
            print_view.setFrame(view.bounds());
        }
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        // WebKit paginates a web view on a separate thread; the operation must be allowed to.
        operation.setCanSpawnSeparateThread(true);
        let delegate = PdfDelegate::alloc().set_ivars(Ivars {
            done: Mutex::new(Some(done)),
        });
        let delegate: Retained<PdfDelegate> = unsafe { msg_send![super(delegate), init] };
        LIVE.with(|live| live.borrow_mut().push(delegate.clone()));
        stage("operation-built");
        // SAFETY: the selector has the signature the operation calls.
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                &window,
                Some(&delegate),
                Some(objc2::sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
        }
        stage("operation-running");
        Ok(())
    }

    /// The number of pages of a finished PDF, or 0 if it cannot be read.
    pub fn page_count(path: &Path) -> u32 {
        let Ok(bytes) = std::fs::read(path) else {
            return 0;
        };
        let data = NSData::with_bytes(&bytes);
        NSPDFImageRep::imageRepWithData(&data)
            .map_or(0, |representation| representation.pageCount().max(0) as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("wd-pdf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_temporary_file_is_hidden_next_to_the_target_and_still_a_pdf() {
        let temp = temp_path_for(Path::new("/notes/Guide.pdf"));
        assert_eq!(temp.parent(), Some(Path::new("/notes")));
        let name = temp.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(".Guide.writedown-"), "{name}");
        assert!(name.ends_with(".pdf"), "{name}");
        assert_ne!(temp, Path::new("/notes/Guide.pdf"));
    }

    #[test]
    fn a_target_must_be_a_pdf_in_a_folder_that_exists() {
        let dir = folder("target");
        assert_eq!(check_target(&dir.join("a.pdf")), Ok(()));
        assert_eq!(check_target(&dir.join("a.PDF")), Ok(()));
        assert!(check_target(&dir.join("a.html")).is_err());
        assert!(check_target(&dir.join("a")).is_err());
        assert!(check_target(&dir.join("missing").join("a.pdf")).is_err());
        std::fs::create_dir(dir.join("b.pdf")).unwrap();
        assert!(check_target(&dir.join("b.pdf")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_finished_file_replaces_the_target_and_no_temporary_file_stays() {
        let dir = folder("finish");
        let target = dir.join("a.pdf");
        std::fs::write(&target, b"old").unwrap();
        let temp = temp_path_for(&target);
        std::fs::write(&temp, b"%PDF-new").unwrap();

        assert_eq!(finish(&temp, &target), Ok(()));
        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF-new");
        assert!(!temp.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_or_empty_temporary_file_fails_and_leaves_the_target_alone() {
        let dir = folder("failure");
        let target = dir.join("a.pdf");
        std::fs::write(&target, b"old").unwrap();
        let temp = temp_path_for(&target);

        assert!(finish(&temp, &target).is_err(), "no file was written");
        std::fs::write(&temp, b"").unwrap();
        assert!(
            finish(&temp, &target).is_err(),
            "an empty file is not a PDF"
        );
        assert!(!temp.exists(), "the empty temporary file is removed");
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_rename_that_fails_removes_the_temporary_file() {
        let dir = folder("rename");
        // The target is a non-empty folder: the rename cannot replace it.
        let target = dir.join("a.pdf");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("x"), b"x").unwrap();
        let temp = dir.join(".a.writedown-1.pdf");
        std::fs::write(&temp, b"%PDF").unwrap();

        assert!(finish(&temp, &target).is_err());
        assert!(!temp.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn discard_ignores_a_missing_file() {
        discard(Path::new("/nonexistent-wd/.x.pdf"));
    }
}
