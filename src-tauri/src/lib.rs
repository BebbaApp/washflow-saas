mod database;
mod commands;
mod sync;
mod tray;
mod immersive;

use tauri::Manager;
use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use futures_util::StreamExt;

// ============================================================
// Updater logging
// ============================================================
#[derive(Clone, serde::Serialize)]
struct LogEntry {
    ts: String,
    level: String,
    msg: String,
}

static UPDATER_LOG: Lazy<Mutex<Vec<LogEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn log(level: &str, msg: impl Into<String>) {
    let m = msg.into();
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    println!("[Updater {} {}] {}", ts, level, m);
    if let Ok(mut g) = UPDATER_LOG.lock() {
        g.push(LogEntry { ts, level: level.into(), msg: m });
        let max = 5000usize;
        if g.len() > max {
            let drop = g.len() - max;
            g.drain(0..drop);
        }
    }
}

// ============================================================
// Cancel flag (set from JS via updater_cancel_download)
// ============================================================
static CANCEL: Lazy<Arc<AtomicBool>> = Lazy::new(|| Arc::new(AtomicBool::new(false)));

fn reset_cancel() { CANCEL.store(false, Ordering::SeqCst); }
fn is_cancelled() -> bool { CANCEL.load(Ordering::SeqCst) }

// ============================================================
// Updater settings (persisted to app config dir)
// ============================================================
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
#[serde(default)]
struct UpdaterSettings {
    /// "launch" | "open_folder" | "prompt"
    post_install_action: String,
    /// If true, after SHA-256/signature verification automatically apply post_install_action.
    auto_launch_after_verify: bool,
    /// Remembered save folder for installer downloads.
    last_save_dir: Option<String>,
}

impl Default for UpdaterSettings {
    fn default() -> Self {
        Self {
            post_install_action: "prompt".to_string(),
            auto_launch_after_verify: false,
            last_save_dir: None,
        }
    }
}

#[cfg(desktop)]
fn settings_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("updater_settings.json"))
}

#[cfg(desktop)]
fn load_settings(app: &tauri::AppHandle) -> UpdaterSettings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[cfg(desktop)]
fn save_settings(app: &tauri::AppHandle, s: &UpdaterSettings) {
    if let Some(p) = settings_path(app) {
        let _ = std::fs::write(p, serde_json::to_string_pretty(s).unwrap_or_default());
    }
}

// ============================================================
// Tauri commands exposed to JS
// ============================================================
#[tauri::command]
fn updater_get_logs() -> Vec<LogEntry> {
    UPDATER_LOG.lock().map(|g| g.clone()).unwrap_or_default()
}

#[tauri::command]
fn updater_clear_logs() {
    if let Ok(mut g) = UPDATER_LOG.lock() { g.clear(); }
    log("info", "Logs cleared by user");
}

#[tauri::command]
fn updater_export_logs(app: tauri::AppHandle) -> Result<String, String> {
    let logs = updater_get_logs();
    let text = logs.iter()
        .map(|l| format!("[{} {}] {}", l.ts, l.level, l.msg))
        .collect::<Vec<_>>()
        .join("\n");
    let dir = app.path().download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "washflow-updater-{}.log",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    let _ = open::that(&dir);
    log("info", format!("Logs exported to {}", path.display()));
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn updater_cancel_download() {
    CANCEL.store(true, Ordering::SeqCst);
    log("warn", "Download cancel requested by user");
}

#[cfg(desktop)]
#[tauri::command]
fn updater_get_settings(app: tauri::AppHandle) -> UpdaterSettings { load_settings(&app) }

#[cfg(desktop)]
#[tauri::command]
fn updater_set_settings(app: tauri::AppHandle, settings: UpdaterSettings) {
    save_settings(&app, &settings);
    log("info", format!("Settings updated: {:?}", settings));
}

#[cfg(not(desktop))]
#[tauri::command]
fn updater_get_settings() -> UpdaterSettings { UpdaterSettings::default() }
#[cfg(not(desktop))]
#[tauri::command]
fn updater_set_settings(_settings: UpdaterSettings) {}

// ============================================================
// Run
// ============================================================
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec![]),
    ));

    builder
        .setup(|app| {
            database::init(app).expect("Failed to initialize database");
            tray::setup_tray(app)?;

            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
            }

            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    check_for_updates(handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_query,
            commands::db_execute,
            commands::get_orders,
            commands::create_order,
            commands::update_order_status,
            commands::get_customers,
            commands::upsert_customer,
            commands::get_services,
            commands::upsert_service,
            commands::get_expenses,
            commands::create_expense,
            commands::get_sync_queue,
            commands::remove_from_sync_queue,
            commands::get_pending_sync_count,
            commands::bulk_upsert,
            commands::get_meta,
            commands::set_meta,
            commands::get_db_info,
            sync::trigger_sync,
            updater_get_logs,
            updater_clear_logs,
            updater_export_logs,
            updater_cancel_download,
            updater_get_settings,
            updater_set_settings,
            immersive::is_immersive,
            immersive::set_immersive,
            immersive::toggle_immersive,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Washflow");
}

// ============================================================
// Updater main flow
// ============================================================
#[cfg(desktop)]
async fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    log("info", "=== Updater session started ===");
    let mut update_opt = None;
    for attempt in 1..=3 {
        log("info", format!("Check attempt {}/3", attempt));
        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(u)) => { update_opt = Some(u); break; }
                Ok(None) => { log("info", "App is up to date"); return; }
                Err(e) => {
                    log("error", format!("Check failed on attempt {}: {:?}", attempt, e));
                    if attempt < 3 { tokio::time::sleep(std::time::Duration::from_secs(3)).await; }
                }
            },
            Err(e) => { log("error", format!("Updater not available: {:?}", e)); return; }
        }
    }
    let update = match update_opt { Some(u) => u, None => return };

    log("info", format!("New version available: {} (current {})", update.version, update.current_version));
    let prompt = format!(
        "Washflow {} is available!\nYou are running {}.\n\nClick Yes to download and install. The app will restart automatically.",
        update.version, update.current_version
    );
    if let Some(win) = app.get_webview_window("main") { let _ = win.set_focus(); }
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let should_update = app.dialog()
        .message(prompt)
        .title("Update Available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Yes, update".to_string(), "Not now".to_string()))
        .blocking_show();
    if !should_update { log("info", "User declined update"); return; }

    let mut attempt: u32 = 0;
    loop {
        attempt += 1;
        let title = if attempt == 1 { "Downloading update".to_string() }
                    else { format!("Retrying update (attempt {})", attempt) };
        reset_cancel();
        update_banner(&app, &title, 0, "Starting…", "#0cd4c4", "#0d1b2a", true);
        log("info", format!("Starting plugin download_and_install (attempt {})", attempt));

        let app_handle = app.clone();
        let title_clone = title.clone();
        let progress = std::sync::Arc::new(std::sync::Mutex::new(DownloadProgress::new()));
        let progress_cb = progress.clone();

        let result = update.clone().download_and_install(
            move |chunk, total| {
                let mut p = progress_cb.lock().unwrap();
                p.advance(chunk, total);
                let pct = p.pct;
                let speed = p.speed_label();
                update_banner(&app_handle, &title_clone, pct, &speed, "#0cd4c4", "#0d1b2a", true);
            },
            || { log("info", "Plugin extraction complete; restarting"); },
        ).await;

        match result {
            Ok(_) => {
                update_banner(&app, "Installing update — app will restart", 100, "Done", "#0cd4c4", "#0d1b2a", false);
                log("info", "Update successful; calling restart()");
                // On Windows, NSIS installer runs async — wait for it to finish
                // before restarting, otherwise old binary restarts instead of new one
                #[cfg(target_os = "windows")]
                {
                    log("info", "Windows: looking for uninstaller...");
                    // Run the existing uninstaller silently first so NSIS can replace files cleanly
                    let install_dir = format!(
                        "{}\\AppData\\Local\\Washflow",
                        std::env::var("USERPROFILE").unwrap_or_default()
                    );
                    let uninst = format!("{}\\Uninstall Washflow.exe", install_dir);
                    if std::path::Path::new(&uninst).exists() {
                        log("info", format!("Windows: running uninstaller: {}", uninst));
                        let _ = std::process::Command::new(&uninst)
                            .arg("/S")
                            .spawn();
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        log("info", "Windows: uninstall complete, exiting for installer");
                    } else {
                        log("warn", format!("Windows: uninstaller not found at {}", uninst));
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                    std::process::exit(0);
                }
                #[cfg(not(target_os = "windows"))]
                app.restart();
            }
            Err(e) => {
                let err_msg = format!("{:?}", e);
                log("error", format!("Plugin install failed (attempt {}): {}", attempt, err_msg));
                update_banner(
                    &app,
                    &format!("Update failed (attempt {})", attempt),
                    0,
                    &err_msg.replace('\n', " ").chars().take(160).collect::<String>(),
                    "#ef4444",
                    "white",
                    false,
                );

                let full_msg = format!(
                    "Washflow couldn't install the update on attempt {}.\n\nError details:\n{}\n\nRetry the install, or Save Installer to download to disk (supports cancel + resume).",
                    attempt, err_msg
                );
                let retry = app.dialog()
                    .message(full_msg)
                    .title("Update Error")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::OkCancelCustom("Retry".to_string(), "Save Installer".to_string()))
                    .blocking_show();

                if retry {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }

                // ---- Save installer to disk fallback (cancel + resume capable) ----
                save_installer_flow(&app, &update).await;
                return;
            }
        }
    }
}

// ============================================================
// Save-installer flow: reuse existing valid file, otherwise
// custom reqwest download with cancel + resume + SHA-256.
// ============================================================
#[cfg(desktop)]
async fn save_installer_flow(app: &tauri::AppHandle, update: &tauri_plugin_updater::Update) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let settings = load_settings(app);
    let download_url = format!("{}", update.download_url);
    let filename = download_url
        .rsplit('/')
        .next()
        .map(|s| s.split('?').next().unwrap_or(s).to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("washflow-{}-installer", update.version));

    let default_dir = settings.last_save_dir.as_ref()
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .or_else(|| app.path().download_dir().ok())
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let picked = app.dialog()
        .file()
        .set_directory(&default_dir)
        .set_title("Choose where to save the installer")
        .blocking_pick_folder();

    let target_dir = match picked {
        Some(fp) => fp.into_path().ok().unwrap_or_else(|| default_dir.clone()),
        None => default_dir.clone(),
    };
    let mut new_settings = settings.clone();
    new_settings.last_save_dir = Some(target_dir.to_string_lossy().to_string());
    save_settings(app, &new_settings);

    let target_path = target_dir.join(&filename);
    let sha_sidecar = target_dir.join(format!("{}.sha256", &filename));
    let part_path = target_dir.join(format!("{}.part", &filename));
    log("info", format!("Save path: {}", target_path.display()));

    // ---- Reuse existing valid installer ----
    if target_path.exists() && sha_sidecar.exists() {
        log("info", "Found existing installer + sidecar; verifying SHA-256");
        update_banner(app, "Verifying existing installer", 0, "Hashing…", "#0cd4c4", "#0d1b2a", false);
        if let (Ok(expected), Ok(bytes)) = (std::fs::read_to_string(&sha_sidecar), std::fs::read(&target_path)) {
            let expected = expected.trim().to_lowercase();
            let actual = sha256_hex(&bytes);
            if actual == expected && !expected.is_empty() {
                let size_mb = bytes.len() as f64 / 1_048_576.0;
                log("info", format!("Existing installer SHA-256 OK ({})", actual));
                update_banner(app, "Existing installer verified", 100,
                    &format!("{:.1} MB · SHA-256 ✓", size_mb), "#0cd4c4", "#0d1b2a", false);
                post_verify_action(app, &target_path, &target_dir, size_mb, &actual, &new_settings, true).await;
                return;
            } else {
                log("warn", format!("Existing installer SHA mismatch (expected {}, got {})", expected, actual));
            }
        }
    }

    // ---- Custom download with cancel + resume ----
    update_banner(app, "Downloading installer", 0, "Connecting…", "#0cd4c4", "#0d1b2a", true);
    match streaming_download(app, &download_url, &part_path).await {
        Ok(DownloadOutcome::Done) => {
            // Finalise: rename .part -> target
            if let Err(e) = std::fs::rename(&part_path, &target_path) {
                log("error", format!("Rename failed: {}", e));
                let _ = std::fs::copy(&part_path, &target_path);
                let _ = std::fs::remove_file(&part_path);
            }
            match std::fs::read(&target_path) {
                Ok(bytes) => {
                    let sha = sha256_hex(&bytes);
                    let size_mb = bytes.len() as f64 / 1_048_576.0;
                    let _ = std::fs::write(&sha_sidecar, &sha);
                    log("info", format!("Installer saved ({} bytes, sha256={})", bytes.len(), sha));
                    update_banner(app, "Installer verified & saved", 100,
                        &format!("{:.1} MB · SHA-256 ✓", size_mb), "#0cd4c4", "#0d1b2a", false);
                    post_verify_action(app, &target_path, &target_dir, size_mb, &sha, &new_settings, false).await;
                }
                Err(e) => {
                    log("error", format!("Could not read saved installer: {}", e));
                    let _ = app.dialog()
                        .message(format!("Saved installer can't be read:\n{}", e))
                        .title("Verification Failed")
                        .kind(MessageDialogKind::Error)
                        .buttons(MessageDialogButtons::Ok)
                        .blocking_show();
                }
            }
        }
        Ok(DownloadOutcome::Cancelled) => {
            log("warn", "Download cancelled by user");
            update_banner(app, "Download cancelled", 0, "Partial file kept for resume", "#f59e0b", "#0d1b2a", false);
            let keep = app.dialog()
                .message(format!(
                    "Download cancelled.\n\nPartial file: {}\n\nKeep it for resume next time, or delete it now?",
                    part_path.display()
                ))
                .title("Cancelled")
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::OkCancelCustom("Keep for resume".to_string(), "Delete".to_string()))
                .blocking_show();
            if !keep {
                let _ = std::fs::remove_file(&part_path);
                log("info", "Partial file deleted");
            } else {
                log("info", format!("Partial file kept at {}", part_path.display()));
            }
        }
        Err(e) => {
            log("error", format!("Streaming download failed: {}", e));
            update_banner(app, "Download failed", 0, &e, "#ef4444", "white", false);
            let _ = app.dialog()
                .message(format!(
                    "Download failed:\n\n{}\n\nThe partial file (if any) at {} is preserved for resume.",
                    e, part_path.display()
                ))
                .title("Download Failed")
                .kind(MessageDialogKind::Error)
                .buttons(MessageDialogButtons::Ok)
                .blocking_show();
        }
    }
}

#[cfg(desktop)]
enum DownloadOutcome { Done, Cancelled }

#[cfg(desktop)]
async fn streaming_download(
    app: &tauri::AppHandle,
    url: &str,
    part_path: &std::path::Path,
) -> Result<DownloadOutcome, String> {
    use tokio::io::AsyncWriteExt;
    use futures_util::StreamExt;

    reset_cancel();

    let existing_bytes: u64 = std::fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
    if existing_bytes > 0 {
        log("info", format!("Resuming from byte {}", existing_bytes));
    }

    let client = reqwest::Client::builder()
        .user_agent("Washflow-Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(url);
    if existing_bytes > 0 {
        req = req.header("Range", format!("bytes={}-", existing_bytes));
    }
    let resp = req.send().await.map_err(|e| format!("HTTP error: {}", e))?;
    let status = resp.status();
    let supports_resume = status.as_u16() == 206;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), status.canonical_reason().unwrap_or("")));
    }

    // Determine total size
    let total: Option<u64> = resp.content_length().map(|cl| {
        if supports_resume { existing_bytes + cl } else { cl }
    });

    // If server didn't honour Range, restart from scratch
    let mut file = if supports_resume && existing_bytes > 0 {
        log("info", "Server accepted Range — appending to .part");
        tokio::fs::OpenOptions::new().append(true).open(part_path).await
    } else {
        if existing_bytes > 0 {
            log("warn", "Server ignored Range; restarting download");
        }
        tokio::fs::OpenOptions::new().create(true).write(true).truncate(true).open(part_path).await
    }.map_err(|e| format!("Cannot open part file: {}", e))?;

    let mut written: u64 = if supports_resume { existing_bytes } else { 0 };
    let mut progress = DownloadProgress::new();
    progress.bytes = written as usize;
    progress.total = total;

    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        if is_cancelled() {
            let _ = file.flush().await;
            return Ok(DownloadOutcome::Cancelled);
        }
        let chunk = chunk.map_err(|e| format!("Network error: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("Write error: {}", e))?;
        written += chunk.len() as u64;
        progress.advance(chunk.len(), total);

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() > 150 {
            last_emit = now;
            let pct = progress.pct;
            let speed = progress.speed_label();
            update_banner(app, "Downloading installer", pct, &speed, "#0cd4c4", "#0d1b2a", true);
        }
    }
    let _ = file.flush().await;
    log("info", format!("Download complete: {} bytes written", written));
    Ok(DownloadOutcome::Done)
}

#[cfg(desktop)]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Sha256, Digest};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(desktop)]
async fn post_verify_action(
    app: &tauri::AppHandle,
    target_path: &std::path::Path,
    target_dir: &std::path::Path,
    size_mb: f64,
    sha256_hex: &str,
    settings: &UpdaterSettings,
    reused: bool,
) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let auto = settings.auto_launch_after_verify;
    let action = settings.post_install_action.as_str();
    let header = if reused { "Existing installer reused (SHA-256 verified)." }
                 else { "Installer downloaded and SHA-256 verified.\nNote: the Tauri updater plugin also performs minisign signature verification on its native install path." };

    if auto && action != "prompt" {
        log("info", format!("Auto post-verify action: {}", action));
        match action {
            "launch" => { let _ = open::that(target_path); }
            "open_folder" => { let _ = open::that(target_dir); }
            _ => {}
        }
        return;
    }

    let msg = format!(
        "{}\n\nLocation: {}\nSize: {:.1} MB\nSHA-256: {}\n\nWhat would you like to do?",
        header, target_path.display(), size_mb, sha256_hex
    );
    let launch = app.dialog()
        .message(msg)
        .title("Installer Ready")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Launch Installer".to_string(), "Open Folder".to_string()))
        .blocking_show();

    if launch {
        match open::that(target_path) {
            Ok(_) => log("info", "Launched installer"),
            Err(e) => {
                log("error", format!("Launch failed: {}", e));
                let _ = open::that(target_dir);
            }
        }
    } else {
        let _ = open::that(target_dir);
    }
}

// ============================================================
// Progress + formatting helpers
// ============================================================
#[cfg(desktop)]
struct DownloadProgress {
    started: std::time::Instant,
    last_emit: std::time::Instant,
    bytes: usize,
    total: Option<u64>,
    pct: u64,
    last_speed_bps: f64,
}

#[cfg(desktop)]
impl DownloadProgress {
    fn new() -> Self {
        let now = std::time::Instant::now();
        Self { started: now, last_emit: now, bytes: 0, total: None, pct: 0, last_speed_bps: 0.0 }
    }
    fn advance(&mut self, chunk: usize, total: Option<u64>) {
        self.bytes += chunk;
        if total.is_some() { self.total = total; }
        if let Some(t) = self.total {
            self.pct = ((self.bytes as u64 * 100) / t.max(1)).min(100);
        }
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(self.started).as_secs_f64().max(0.001);
        self.last_speed_bps = self.bytes as f64 / elapsed;
        self.last_emit = now;
    }
    fn speed_label(&self) -> String {
        let bps = self.last_speed_bps;
        let speed = format_speed(bps);
        match self.total {
            Some(t) => {
                let remaining = (t as i64 - self.bytes as i64).max(0) as f64;
                let eta_s = if bps > 0.0 { (remaining / bps) as u64 } else { 0 };
                format!("{} · {} of {} · ETA {}", speed, format_bytes(self.bytes as u64), format_bytes(t), format_eta(eta_s))
            }
            None => format!("{} · {}", speed, format_bytes(self.bytes as u64)),
        }
    }
}

#[cfg(desktop)]
fn format_bytes(b: u64) -> String {
    let bf = b as f64;
    if bf >= 1_048_576.0 { format!("{:.1} MB", bf / 1_048_576.0) }
    else if bf >= 1024.0 { format!("{:.1} KB", bf / 1024.0) }
    else { format!("{} B", b) }
}

#[cfg(desktop)]
fn format_speed(bps: f64) -> String {
    if bps >= 1_048_576.0 { format!("{:.2} MB/s", bps / 1_048_576.0) }
    else if bps >= 1024.0 { format!("{:.1} KB/s", bps / 1024.0) }
    else { format!("{:.0} B/s", bps) }
}

#[cfg(desktop)]
fn format_eta(seconds: u64) -> String {
    if seconds >= 3600 { format!("{}h {}m", seconds / 3600, (seconds % 3600) / 60) }
    else if seconds >= 60 { format!("{}m {}s", seconds / 60, seconds % 60) }
    else { format!("{}s", seconds) }
}

// ============================================================
// In-app banner UI (injected into the main webview)
// ============================================================
#[cfg(desktop)]
fn update_banner(app: &tauri::AppHandle, title: &str, pct: u64, speed: &str, bg: &str, fg: &str, show_cancel: bool) {
    let Some(win) = app.get_webview_window("main") else { return };
    let title_json = serde_json::to_string(title).unwrap_or_else(|_| "\"Update\"".to_string());
    let speed_json = serde_json::to_string(speed).unwrap_or_else(|_| "\"\"".to_string());
    let bg_json = serde_json::to_string(bg).unwrap_or_else(|_| "\"#0cd4c4\"".to_string());
    let fg_json = serde_json::to_string(fg).unwrap_or_else(|_| "\"#0d1b2a\"".to_string());
    let cancel_display = if show_cancel { "inline-block" } else { "none" };
    let js = format!(r#"
        (function(){{
          try {{
            var inv = (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) || (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
            var b=document.getElementById('wf-update-banner');
            if(!b){{
              b=document.createElement('div');
              b.id='wf-update-banner';
              b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;font-family:system-ui;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.15)';
              b.innerHTML=
                '<div style="font-weight:600;font-size:14px"><span id=wf-title>Update</span> — <span id=wf-pct>0%</span></div>'
                +'<div style="height:6px;background:rgba(0,0,0,0.18);border-radius:3px;margin:6px auto;max-width:640px;overflow:hidden"><div id=wf-bar style="height:100%;width:0%;background:#0d1b2a;border-radius:3px;transition:width .15s linear"></div></div>'
                +'<div id=wf-speed style="font-size:12px;opacity:0.85">Starting…</div>'
                +'<div style="margin-top:6px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
                +'  <button id=wf-cancel style="cursor:pointer;border:0;border-radius:6px;padding:4px 10px;font-size:12px;background:rgba(239,68,68,0.9);color:white">Cancel download</button>'
                +'  <button id=wf-logs style="cursor:pointer;border:0;border-radius:6px;padding:4px 10px;font-size:12px;background:rgba(0,0,0,0.25);color:inherit">View logs</button>'
                +'  <button id=wf-export style="cursor:pointer;border:0;border-radius:6px;padding:4px 10px;font-size:12px;background:rgba(0,0,0,0.25);color:inherit">Export logs</button>'
                +'  <button id=wf-settings style="cursor:pointer;border:0;border-radius:6px;padding:4px 10px;font-size:12px;background:rgba(0,0,0,0.25);color:inherit">Settings</button>'
                +'</div>'
                +'<div id=wf-logs-panel style="display:none;text-align:left;margin:8px auto;max-width:760px;max-height:240px;overflow:auto;background:rgba(0,0,0,0.65);color:#e2e8f0;font-family:ui-monospace,monospace;font-size:11px;padding:8px;border-radius:6px"></div>';
              document.body.appendChild(b);

              document.getElementById('wf-cancel').onclick=function(){{
                if(inv) inv('updater_cancel_download');
                this.disabled=true; this.textContent='Cancelling…';
              }};
              document.getElementById('wf-logs').onclick=async function(){{
                var panel=document.getElementById('wf-logs-panel');
                if(panel.style.display==='block'){{ panel.style.display='none'; return; }}
                panel.style.display='block'; panel.textContent='Loading…';
                try {{
                  var logs = inv ? await inv('updater_get_logs') : [];
                  panel.textContent = (logs||[]).map(function(l){{return '['+l.ts+' '+l.level+'] '+l.msg;}}).join('\n') || '(no logs)';
                  panel.scrollTop = panel.scrollHeight;
                }} catch(e) {{ panel.textContent = 'Error: '+e; }}
              }};
              document.getElementById('wf-export').onclick=async function(){{
                try {{
                  var path = inv ? await inv('updater_export_logs') : null;
                  this.textContent = path ? 'Exported ✓' : 'Export failed';
                  var btn=this; setTimeout(function(){{btn.textContent='Export logs';}},2500);
                }} catch(e) {{ this.textContent='Failed'; }}
              }};
              document.getElementById('wf-settings').onclick=async function(){{
                if(!inv) return;
                var cur = await inv('updater_get_settings');
                var act = prompt('Post-verify action: launch | open_folder | prompt', cur.post_install_action || 'prompt');
                if(act===null) return;
                var autoStr = prompt('Auto-apply after verification? (yes/no)', cur.auto_launch_after_verify ? 'yes' : 'no');
                if(autoStr===null) return;
                var next = {{
                  post_install_action: (['launch','open_folder','prompt'].indexOf(act)>=0 ? act : 'prompt'),
                  auto_launch_after_verify: /^y/i.test(autoStr||''),
                  last_save_dir: cur.last_save_dir || null
                }};
                await inv('updater_set_settings', {{ settings: next }});
                alert('Saved: action='+next.post_install_action+', auto='+next.auto_launch_after_verify);
              }};
            }}
            b.style.background={bg};
            b.style.color={fg};
            var bar=document.getElementById('wf-bar');
            if(bar) bar.style.background={fg};
            var t=document.getElementById('wf-title'); if(t) t.textContent={title};
            var pct={pct};
            var pe=document.getElementById('wf-pct'); if(pe) pe.textContent=pct+'%';
            if(bar) bar.style.width=pct+'%';
            var s=document.getElementById('wf-speed'); if(s) s.textContent={speed};
            var cb=document.getElementById('wf-cancel'); if(cb) cb.style.display='{cancel_display}';
          }} catch(e) {{}}
        }})();
    "#, bg=bg_json, fg=fg_json, title=title_json, speed=speed_json, pct=pct, cancel_display=cancel_display);
    let _ = win.eval(&js);
}
