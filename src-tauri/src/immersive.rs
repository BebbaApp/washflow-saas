// ============================================================
// Immersive / fullscreen mode
//
// Toggles a distraction-free mode on the main window:
//   * fullscreen ON
//   * window decorations (title bar) OFF
//
// Works on desktop (Windows / macOS / Linux) and on Tauri
// mobile targets — on Android this also triggers the OS
// immersive layout because the window is fullscreen.
// ============================================================

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static IMMERSIVE: AtomicBool = AtomicBool::new(false);

fn apply<R: tauri::Runtime>(app: &AppHandle<R>, on: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // Order matters on some platforms: drop decorations first, then fullscreen.
    #[cfg(desktop)]
    let _ = win.set_decorations(!on);

    win.set_fullscreen(on).map_err(|e| e.to_string())?;

    IMMERSIVE.store(on, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn is_immersive() -> bool {
    IMMERSIVE.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn set_immersive<R: tauri::Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
    apply(&app, on)
}

#[tauri::command]
pub fn toggle_immersive<R: tauri::Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let next = !IMMERSIVE.load(Ordering::SeqCst);
    apply(&app, next)?;
    Ok(next)
}
