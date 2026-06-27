mod database;
mod commands;
mod sync;
mod tray;

use tauri::Manager;

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
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Washflow");
}

#[cfg(desktop)]
async fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    // Try to find an update (retry the *check* a couple times for transient network errors).
    let mut update_opt = None;
    for attempt in 1..=3 {
        println!("[Updater] Check attempt {}/3", attempt);
        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(u)) => { update_opt = Some(u); break; }
                Ok(None) => { println!("[Updater] App is up to date"); return; }
                Err(e) => {
                    println!("[Updater] Check failed on attempt {}: {}", attempt, e);
                    if attempt < 3 { tokio::time::sleep(std::time::Duration::from_secs(3)).await; }
                }
            },
            Err(e) => { println!("[Updater] Not available: {}", e); return; }
        }
    }
    let update = match update_opt {
        Some(u) => u,
        None => return,
    };

    println!("[Updater] New version available: {}", update.version);
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
    if !should_update { println!("[Updater] User declined"); return; }

    // Retry loop: every failure shows the full error and offers a Retry button.
    let mut attempt: u32 = 0;
    loop {
        attempt += 1;
        let title = if attempt == 1 { "Downloading update".to_string() }
                    else { format!("Retrying update (attempt {})", attempt) };
        update_banner(&app, &title, 0, "Starting…", "#0cd4c4", "#0d1b2a");

        println!("[Updater] Starting download (attempt {})...", attempt);
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
                update_banner(&app_handle, &title_clone, pct, &speed, "#0cd4c4", "#0d1b2a");
            },
            || {
                println!("[Updater] Extraction complete, restarting...");
            },
        ).await;

        match result {
            Ok(_) => {
                update_banner(&app, "Installing update — app will restart", 100, "Done", "#0cd4c4", "#0d1b2a");
                println!("[Updater] Update successful! Restarting...");
                app.restart();
            }
            Err(e) => {
                let err_msg = format!("{:?}", e);
                let err_short = format!("{}", e);
                println!("[Updater] Download/install error on attempt {}: {}", attempt, err_msg);

                update_banner(
                    &app,
                    &format!("Update failed (attempt {})", attempt),
                    0,
                    &err_short.replace('\n', " ").chars().take(160).collect::<String>(),
                    "#ef4444",
                    "white",
                );

                // Surface the FULL error and let the user choose Retry vs Save installer to disk.
                let full_msg = format!(
                    "Washflow couldn't install the update on attempt {}.\n\nError details:\n{}\n\nClick Retry to try the install again, or Save Installer to download the installer file so you can run it manually.",
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

                // ---- Save installer to disk fallback ----
                let download_url = format!("{}", update.download_url);
                let filename = download_url
                    .rsplit('/')
                    .next()
                    .map(|s| s.split('?').next().unwrap_or(s).to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("washflow-{}-installer", update.version));

                // Default to Downloads, but let the user pick another folder.
                let default_dir = app.path().download_dir()
                    .or_else(|_| app.path().home_dir())
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));

                let picked = app.dialog()
                    .file()
                    .set_directory(&default_dir)
                    .set_title("Choose where to save the installer")
                    .blocking_pick_folder();

                let target_dir = match picked {
                    Some(fp) => fp.into_path().ok().unwrap_or_else(|| default_dir.clone()),
                    None => default_dir.clone(),
                };
                let target_path = target_dir.join(&filename);
                println!("[Updater] Saving installer to {:?}", target_path);

                update_banner(&app, "Downloading installer", 0, "Starting…", "#0cd4c4", "#0d1b2a");

                let app_handle2 = app.clone();
                let progress2 = std::sync::Arc::new(std::sync::Mutex::new(DownloadProgress::new()));
                let progress2_cb = progress2.clone();
                let bytes_result = update.clone().download(
                    move |chunk, total| {
                        let mut p = progress2_cb.lock().unwrap();
                        p.advance(chunk, total);
                        let pct = p.pct;
                        let speed = p.speed_label();
                        update_banner(&app_handle2, "Downloading installer", pct, &speed, "#0cd4c4", "#0d1b2a");
                    },
                    || { println!("[Updater] Installer download finished"); },
                ).await;

                match bytes_result {
                    Ok(bytes) => {
                        // The updater plugin already verified the minisign signature against the
                        // pubkey configured in tauri.conf.json before returning these bytes.
                        // Also compute SHA-256 so we can show the user a checksum they can confirm.
                        use sha2::{Sha256, Digest};
                        let mut hasher = Sha256::new();
                        hasher.update(&bytes);
                        let digest = hasher.finalize();
                        let sha256_hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();
                        let size_mb = bytes.len() as f64 / 1_048_576.0;

                        match std::fs::write(&target_path, &bytes) {
                            Ok(_) => {
                                println!("[Updater] Installer saved to {:?} ({} bytes, sha256={})", target_path, bytes.len(), sha256_hex);
                                update_banner(&app, "Installer verified & saved", 100, &format!("{:.1} MB · SHA-256 ✓", size_mb), "#0cd4c4", "#0d1b2a");

                                // Only now (after signature pass + write) do we offer Launch / Open folder.
                                let msg = format!(
                                    "Installer downloaded and signature-verified.\n\nLocation: {}\nSize: {:.1} MB\nSHA-256: {}\n\nLaunch the installer now, or just open the folder containing it?",
                                    target_path.display(), size_mb, sha256_hex
                                );
                                let launch = app.dialog()
                                    .message(msg)
                                    .title("Installer Ready")
                                    .kind(MessageDialogKind::Info)
                                    .buttons(MessageDialogButtons::OkCancelCustom("Launch Installer".to_string(), "Open Folder".to_string()))
                                    .blocking_show();

                                if launch {
                                    match open::that(&target_path) {
                                        Ok(_) => println!("[Updater] Launched installer"),
                                        Err(e) => {
                                            println!("[Updater] Failed to launch installer: {}", e);
                                            let _ = app.dialog()
                                                .message(format!("Couldn't launch installer:\n\n{}\n\nOpening the folder instead.", e))
                                                .title("Launch Failed")
                                                .kind(MessageDialogKind::Error)
                                                .buttons(MessageDialogButtons::Ok)
                                                .blocking_show();
                                            let _ = open::that(target_dir.as_path());
                                        }
                                    }
                                } else {
                                    let _ = open::that(target_dir.as_path());
                                }
                                return;
                            }
                            Err(e) => {
                                println!("[Updater] Failed to write installer: {}", e);
                                update_banner(&app, "Save failed", 0, &format!("{}", e), "#ef4444", "white");
                                let _ = app.dialog()
                                    .message(format!("Failed to save installer to {}:\n\n{}\n\nWe'll open the releases page instead.", target_path.display(), e))
                                    .title("Save Failed")
                                    .kind(MessageDialogKind::Error)
                                    .buttons(MessageDialogButtons::Ok)
                                    .blocking_show();
                                let _ = open::that("https://github.com/BebbaApp/washflow-saas/releases/latest");
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        println!("[Updater] Installer download/verify failed: {:?}", e);
                        update_banner(&app, "Download failed", 0, &format!("{}", e), "#ef4444", "white");
                        let _ = app.dialog()
                            .message(format!("Couldn't download or verify installer:\n\n{:?}\n\nThe signature check is mandatory — if verification failed, the file would have been rejected. We'll open the releases page so you can download manually.", e))
                            .title("Download Failed")
                            .kind(MessageDialogKind::Error)
                            .buttons(MessageDialogButtons::Ok)
                            .blocking_show();
                        let _ = open::that("https://github.com/BebbaApp/washflow-saas/releases/latest");
                        return;
                    }
                }
            }
        }
    }
}

/// Tracks download progress and rolling speed.
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

#[cfg(desktop)]
fn update_banner(app: &tauri::AppHandle, title: &str, pct: u64, speed: &str, bg: &str, fg: &str) {
    let Some(win) = app.get_webview_window("main") else { return };
    let title_json = serde_json::to_string(title).unwrap_or_else(|_| "\"Update\"".to_string());
    let speed_json = serde_json::to_string(speed).unwrap_or_else(|_| "\"\"".to_string());
    let bg_json = serde_json::to_string(bg).unwrap_or_else(|_| "\"#0cd4c4\"".to_string());
    let fg_json = serde_json::to_string(fg).unwrap_or_else(|_| "\"#0d1b2a\"".to_string());
    let js = format!(r#"
        (function(){{
          try {{
            var b=document.getElementById('wf-update-banner');
            if(!b){{
              b=document.createElement('div');
              b.id='wf-update-banner';
              b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;font-family:system-ui;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.15)';
              b.innerHTML='<div style="font-weight:600;font-size:14px"><span id=wf-title>Update</span> — <span id=wf-pct>0%</span></div>'
                +'<div style="height:6px;background:rgba(0,0,0,0.18);border-radius:3px;margin:6px auto;max-width:640px;overflow:hidden"><div id=wf-bar style="height:100%;width:0%;background:#0d1b2a;border-radius:3px;transition:width .15s linear"></div></div>'
                +'<div id=wf-speed style="font-size:12px;opacity:0.85">Starting…</div>';
              document.body.appendChild(b);
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
          }} catch(e) {{}}
        }})();
    "#, bg=bg_json, fg=fg_json, title=title_json, speed=speed_json, pct=pct);
    let _ = win.eval(&js);
}

}

