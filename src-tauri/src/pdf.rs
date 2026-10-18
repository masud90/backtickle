//! One-click PDF export.
//!
//! The page has put the document in its print root (the same view Print shows). This module runs
//! an `NSPrintOperation` of the web view with the job disposition "save" to a temporary file next
//! to the target, with the print panel and the progress panel off, then renames the file onto the
//! target. No process is started. The path is checked by the caller against the export targets
//! (it came from the save dialog); the plain-Rust parts here (target check, temporary name, final
//! rename, clean-up) are unit-tested, the AppKit part is in `imp`.
//!
//! On Windows the web view itself writes the file (WebView2's `PrintToPdf`, no print dialog),
//! with the same temporary file and rename; that part is in `win`. On Linux WebKitGTK prints the
//! page to GTK's "Print to File" printer with no dialog, again to the temporary file; that part is
//! in `gtk_print`.

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
    let hidden = format!(".{name}.backtickle-{}.pdf", std::process::id());
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

pub fn export(window: &tauri::WebviewWindow, target: &Path, stage: Stage) -> Result<u32, PdfError> {
    check_target(target)?;
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err(PdfError::new("Another PDF is being written."));
    }
    let result = export_one(window, target, stage);
    RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}

fn export_one(window: &tauri::WebviewWindow, target: &Path, stage: Stage) -> Result<u32, PdfError> {
    #[cfg(not(any(target_os = "macos", windows)))]
    use gtk_print as imp;
    #[cfg(windows)]
    use win as imp;
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

/// The number of pages of a PDF, counted from its page objects (`/Type /Page`, not `/Pages`), as
/// WebView2 writes them; 0 if there are none.
pub fn count_pages(bytes: &[u8]) -> u32 {
    let mut count = 0;
    let mut rest = bytes;
    while let Some(at) = rest.windows(5).position(|window| window == b"/Type") {
        rest = &rest[at + 5..];
        let after = rest
            .iter()
            .position(|byte| !byte.is_ascii_whitespace())
            .map_or(&[][..], |start| &rest[start..]);
        if after.starts_with(b"/Page") && !after[5..].first().is_some_and(u8::is_ascii_alphanumeric)
        {
            count += 1;
        }
    }
    count
}

#[cfg(windows)]
mod win {
    use super::PdfError;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_7, ICoreWebView2Environment6,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{HSTRING, Interface};

    /// Asks the web view for the PDF and waits for it (call from a blocking task, never from the
    /// main thread). `temp` is where WebView2 writes.
    pub fn run(
        window: &tauri::WebviewWindow,
        temp: &Path,
        stage: super::Stage,
    ) -> Result<(), PdfError> {
        let (done_tx, done_rx) = mpsc::channel::<Result<(), PdfError>>();
        let temp = HSTRING::from(temp);
        window
            .with_webview(move |webview| {
                stage("closure-on-main-thread");
                let started_tx = done_tx.clone();
                let started = start(&webview, &temp, done_tx);
                stage("operation-running");
                if let Err(error) = started {
                    let _ = started_tx.send(Err(error));
                }
            })
            .map_err(|_| PdfError::new("The PDF could not be created (stage: dispatch)."))?;
        match done_rx.recv_timeout(Duration::from_secs(300)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(PdfError::new(
                "The PDF could not be created (stage: the web view never finished).",
            )),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(PdfError::new(
                "The PDF could not be created (stage: the callback was dropped).",
            )),
        }
    }

    /// Main thread: starts `PrintToPdf` with no margins (the page sets its own, as on macOS) and
    /// no header or footer.
    fn start(
        webview: &tauri::webview::PlatformWebview,
        temp: &HSTRING,
        done: mpsc::Sender<Result<(), PdfError>>,
    ) -> Result<(), PdfError> {
        let failed = || PdfError::new("The PDF could not be created.");
        // SAFETY: COM calls on the web view's own thread, with objects the web view owns.
        unsafe {
            let core = webview.controller().CoreWebView2().map_err(|_| failed())?;
            let core: ICoreWebView2_7 = core.cast().map_err(|_| {
                PdfError::new("The PDF could not be created: this WebView2 runtime is too old.")
            })?;
            let settings = match webview.environment().cast::<ICoreWebView2Environment6>() {
                Ok(environment) => {
                    let settings = environment.CreatePrintSettings().map_err(|_| failed())?;
                    let _ = settings.SetMarginTop(0.0);
                    let _ = settings.SetMarginBottom(0.0);
                    let _ = settings.SetMarginLeft(0.0);
                    let _ = settings.SetMarginRight(0.0);
                    let _ = settings.SetShouldPrintHeaderAndFooter(false);
                    Some(settings)
                }
                Err(_) => None,
            };
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                let _ = done.send(if result.is_ok() && success {
                    Ok(())
                } else {
                    Err(PdfError::new(
                        "The PDF could not be created (stage: the web view reported failure).",
                    ))
                });
                Ok(())
            }));
            core.PrintToPdf(temp, settings.as_ref(), &handler)
                .map_err(|_| failed())
        }
    }

    /// The number of pages of a finished PDF, or 0 if it cannot be read.
    pub fn page_count(path: &Path) -> u32 {
        std::fs::read(path).map_or(0, |bytes| super::count_pages(&bytes))
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod gtk_print {
    use super::PdfError;
    use std::path::Path;
    use std::sync::{Arc, Mutex, mpsc};
    use std::time::Duration;
    use webkit2gtk::PrintOperationExt;

    type Done = Arc<Mutex<Option<mpsc::Sender<Result<(), PdfError>>>>>;

    /// Prints the page to `temp` and waits for it (call from a blocking task, never from the main
    /// thread).
    pub fn run(
        window: &tauri::WebviewWindow,
        temp: &Path,
        stage: super::Stage,
    ) -> Result<(), PdfError> {
        let (done_tx, done_rx) = mpsc::channel::<Result<(), PdfError>>();
        let uri = url::Url::from_file_path(temp)
            .map_err(|()| PdfError::new("The PDF could not be created (stage: file name)."))?
            .to_string();
        window
            .with_webview(move |webview| {
                stage("closure-on-main-thread");
                start(&webview.inner(), &uri, Arc::new(Mutex::new(Some(done_tx))));
                stage("operation-running");
            })
            .map_err(|_| PdfError::new("The PDF could not be created (stage: dispatch)."))?;
        match done_rx.recv_timeout(Duration::from_secs(300)) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(PdfError::new(
                "The PDF could not be created (stage: the web view never finished).",
            )),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(PdfError::new(
                "The PDF could not be created (stage: the callback was dropped).",
            )),
        }
    }

    /// Sends the outcome once (a failed print also reports that it finished).
    fn report(done: &Done, result: Result<(), PdfError>) {
        if let Some(sender) = done.lock().ok().and_then(|mut done| done.take()) {
            let _ = sender.send(result);
        }
    }

    /// The page margins of src/styles/print.css (`@page { margin: 18mm 16mm }`), top and bottom
    /// then left and right. WebKitGTK takes the margins from the page setup, not from `@page`.
    const PAGE_MARGIN_MM: (f64, f64) = (18.0, 16.0);

    /// Main thread: prints to a PDF file on the system's default paper with the page's margins
    /// and no dialog.
    fn start(webview: &webkit2gtk::WebView, uri: &str, done: Done) {
        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));
        settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri));
        let paper = gtk::PaperSize::new(None);
        settings.set_paper_size(&paper);
        let page = gtk::PageSetup::new();
        page.set_paper_size(&paper);
        page.set_top_margin(PAGE_MARGIN_MM.0, gtk::Unit::Mm);
        page.set_bottom_margin(PAGE_MARGIN_MM.0, gtk::Unit::Mm);
        page.set_left_margin(PAGE_MARGIN_MM.1, gtk::Unit::Mm);
        page.set_right_margin(PAGE_MARGIN_MM.1, gtk::Unit::Mm);
        let operation = webkit2gtk::PrintOperation::new(webview);
        operation.set_print_settings(&settings);
        operation.set_page_setup(&page);
        let failed = done.clone();
        operation.connect_failed(move |_, _| {
            report(
                &failed,
                Err(PdfError::new(
                    "The PDF could not be created (stage: the web view reported failure).",
                )),
            );
        });
        operation.connect_finished(move |_| report(&done, Ok(())));
        operation.print();
    }

    /// The number of pages of a finished PDF, or 0 if it cannot be read.
    pub fn page_count(path: &Path) -> u32 {
        std::fs::read(path).map_or(0, |bytes| super::count_pages(&bytes))
    }
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

    #[test]
    fn pages_are_counted_from_the_page_objects_not_the_page_tree() {
        let pdf = b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n\
            2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n\
            3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n\
            4 0 obj <</Type/Page/Parent 2 0 R>> endobj\n";
        assert_eq!(count_pages(pdf), 2);
        assert_eq!(count_pages(b"not a pdf"), 0);
        assert_eq!(count_pages(b"/Type"), 0, "a truncated file");
    }

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
        assert!(name.starts_with(".Guide.backtickle-"), "{name}");
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
        let temp = dir.join(".a.backtickle-1.pdf");
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
