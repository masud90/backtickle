//! System-initiated quits: logout, restart, shutdown, Quit in the Dock menu, an
//! AppleScript `quit`. They all end in `[NSApp terminate:]`.
//!
//! The window library (tao 0.37) installs an app delegate that has no `applicationShouldTerminate:`,
//! so AppKit terminates at once and the page never gets to ask about unsaved changes. This module
//! adds that method to tao's delegate class at runtime, after the app has finished launching. The
//! method asks a handler (the close protocol in `lifecycle.rs`) and answers "terminate now" or
//! "terminate later"; with "later" AppKit waits until `reply` is called with the final answer
//! (`replyToApplicationShouldTerminate:`), which is how a Cancel in the Save sheet cancels a
//! logout or restart.
//!
//! All unsafe code of the app that touches AppKit lives in this file. The decisions (what to
//! answer, when to reply) are made by plain code in `lifecycle.rs`, which is unit-tested with a
//! fake host.

use crate::lifecycle::TerminateAnswer;

/// What `install` found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Installed {
    /// System quits now run the close protocol.
    Yes,
    /// They do not: behavior is as without this module. The reason is for the trace line.
    No(&'static str),
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{Installed, TerminateAnswer};
    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use std::panic::{AssertUnwindSafe, catch_unwind};
    use std::sync::OnceLock;

    /// `NSApplicationTerminateReply` values (an `NSUInteger`).
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    type Handler = Box<dyn Fn() -> TerminateAnswer + Send + Sync>;

    /// What the added method asks. Set once, before the method is added.
    static HANDLER: OnceLock<Handler> = OnceLock::new();

    /// The body of `applicationShouldTerminate:`. AppKit calls it on the main thread. A panic must
    /// not unwind into AppKit, so it is caught and answered with "now" (today's behavior).
    extern "C-unwind" fn should_terminate(
        _this: &AnyObject,
        _cmd: Sel,
        _sender: &AnyObject,
    ) -> usize {
        let answer = catch_unwind(AssertUnwindSafe(|| {
            HANDLER
                .get()
                .map_or(TerminateAnswer::Now, |handler| handler())
        }))
        .unwrap_or(TerminateAnswer::Now);
        match answer {
            TerminateAnswer::Now => TERMINATE_NOW,
            TerminateAnswer::Later => TERMINATE_LATER,
        }
    }

    pub fn install(handler: Handler) -> Installed {
        // SAFETY: `NSApplication` exists in every macOS process that links AppKit, which tao
        // does; `sharedApplication` takes no arguments and returns the shared instance (or nil).
        let app: *mut AnyObject = unsafe { msg_send![class!(NSApplication), sharedApplication] };
        if app.is_null() {
            return Installed::No("no application object");
        }
        // SAFETY: `app` is a live NSApplication; `delegate` takes no arguments and returns an
        // object or nil, which is checked right below.
        let delegate: *mut AnyObject = unsafe { msg_send![app, delegate] };
        // SAFETY: a non-null pointer returned by `delegate` points to a live object (the
        // application retains its delegate); it is only borrowed for this function.
        let Some(delegate) = (unsafe { delegate.as_ref() }) else {
            return Installed::No("no app delegate");
        };
        let class: &'static AnyClass = delegate.class();
        let selector = sel!(applicationShouldTerminate:);
        if class.instance_method(selector).is_some() {
            // The delegate already answers: never replace someone else's implementation.
            return Installed::No("the app delegate already implements it");
        }
        if HANDLER.set(handler).is_err() {
            return Installed::No("already installed");
        }
        // SAFETY: `should_terminate` has the signature of `applicationShouldTerminate:` for the
        // type encoding "Q@:@" (returns NSUInteger; takes self, _cmd and the sender object), and
        // is `extern "C-unwind"` like `Imp`; transmuting between function pointer types that
        // differ only in their (erased) argument list is how IMPs are passed to the runtime. The
        // class is a registered class that nothing else mutates at this point, and the method
        // was just checked not to exist, so `class_addMethod` adds rather than replaces.
        let added = unsafe {
            let imp: Imp = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize,
                Imp,
            >(should_terminate);
            ffi::class_addMethod(
                std::ptr::from_ref(class).cast_mut(),
                selector,
                imp,
                c"Q@:@".as_ptr(),
            )
        };
        if added.as_bool() {
            Installed::Yes
        } else {
            Installed::No("the runtime refused to add the method")
        }
    }

    /// Answers a pending "terminate later". Must run on the main thread.
    pub fn reply(allow: bool) {
        // SAFETY: as in `install` for `sharedApplication`; `replyToApplicationShouldTerminate:`
        // takes one BOOL and returns nothing, and is called on the main thread by contract.
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if !app.is_null() {
                let _: () = msg_send![app, replyToApplicationShouldTerminate: allow];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::{Installed, TerminateAnswer};

    pub fn install(_handler: Box<dyn Fn() -> TerminateAnswer + Send + Sync>) -> Installed {
        Installed::No("not macOS")
    }

    pub fn reply(_allow: bool) {}
}

/// Makes system quits ask `handler`. Call once, after the app has finished launching, on the
/// main thread.
pub fn install(handler: impl Fn() -> TerminateAnswer + Send + Sync + 'static) -> Installed {
    imp::install(Box::new(handler))
}

/// Answers a pending "terminate later": `true` lets the app terminate, `false` cancels the quit
/// (and with it a logout or restart). Must run on the main thread.
pub fn reply(allow: bool) {
    imp::reply(allow);
}
