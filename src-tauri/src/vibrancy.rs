//! Translucent sidebar (Phase 5, WP5.7): the macOS sidebar material behind the web view.
//!
//! The document windows and the Preferences window are transparent (`transparent` in
//! tauri.conf.json and on the Preferences builder; on macOS this needs `macOSPrivateApi`). When
//! the `vibrancy` setting is on, the window gets an `NSVisualEffectView` with the sidebar
//! material behind the web view (Tauri's window effects); when it is off the effect view is
//! removed, so the window costs nothing beyond being transparent. The page paints everything
//! except the sidebar itself in opaque colors (src/styles/vibrancy.css), so the material shows
//! only there. macOS makes the material opaque by itself under Reduce Transparency.
//!
//! On Windows the material is Mica, which Windows 11 draws behind the window. Windows 10 has no
//! Mica (the request does nothing there), so the page keeps its sidebar opaque on Windows 10
//! (src/shell/appearance.ts).
//!
//! Linux has no material: its windows are opaque, no effect is asked for, and the page keeps the
//! sidebar opaque.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::stores::Stores;
use crate::windows;

/// The material behind the sidebar on this system.
#[cfg(not(windows))]
pub const MATERIAL: Effect = Effect::Sidebar;
#[cfg(windows)]
pub const MATERIAL: Effect = Effect::Mica;

/// The effect for the sidebar: the sidebar material, always shown as active (a background window
/// keeps it, as Finder's sidebar does).
pub fn sidebar_effect() -> WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(MATERIAL)
        .state(EffectState::Active)
        .build()
}

/// Puts the effect on `window`, or takes it off.
pub fn apply_to<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) {
    if cfg!(not(any(target_os = "macos", windows))) {
        return;
    }
    let effects = enabled.then(sidebar_effect);
    if let Err(error) = window.set_effects(effects) {
        eprintln!("backtickle: the sidebar material could not be set ({error}).");
    }
}

/// Applies the current setting to a window that was just created.
pub fn apply<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let enabled = app
        .try_state::<Stores>()
        .is_none_or(|stores| stores.settings().vibrancy);
    apply_to(window, enabled);
}

/// Applies a changed setting to every document window and to Preferences.
pub fn apply_all<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    for (label, window) in app.webview_windows() {
        if windows::is_document_label(&label) || label == windows::PREFERENCES_LABEL {
            apply_to(&window, enabled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_effect_is_the_sidebar_material_and_always_active() {
        let effect = sidebar_effect();
        #[cfg(not(windows))]
        assert_eq!(effect.effects, vec![Effect::Sidebar]);
        #[cfg(windows)]
        assert_eq!(effect.effects, vec![Effect::Mica]);
        assert_eq!(effect.state, Some(EffectState::Active));
    }
}
