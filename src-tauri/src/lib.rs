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
        if let Some(win) = app.get_webview_window("main") {
            let msg = if attempt == 1 { "Downloading update… 0%".to_string() }
                      else { format!("Retrying update (attempt {})… 0%", attempt) };
            let js = format!(r#"
                (function(){{
                  try {{
                    var b = document.getElementById('wf-update-banner');
                    if (!b) {{
                      b = document.createElement('div');
                      b.id = 'wf-update-banner';
                      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#0cd4c4;color:#0d1b2a;text-align:center;padding:12px;font-weight:600;font-size:14px;font-family:system-ui;';
                      document.body.appendChild(b);
                    }}
                    b.style.background = '#0cd4c4';
                    b.style.color = '#0d1b2a';
                    b.textContent = {};
                  }} catch(e) {{}}
                }})();
            "#, serde_json::to_string(&msg).unwrap_or_else(|_| "\"Downloading…\"".to_string()));
            let _ = win.eval(&js);
        }

        println!("[Updater] Starting download (attempt {})...", attempt);
        let app_handle = app.clone();
        let mut downloaded_total: usize = 0;

        let result = update.clone().download_and_install(
            |chunk, total| {
                downloaded_total += chunk;
                if let Some(t) = total {
                    let pct = ((downloaded_total as u64 * 100) / t).min(100);
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let js = format!(
                            "(function(){{var b=document.getElementById('wf-update-banner');if(b)b.textContent='Downloading update… {}%';}})();",
                            pct
                        );
                        let _ = win.eval(&js);
                    }
                }
            },
            || {
                println!("[Updater] Extraction complete, restarting...");
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.eval("(function(){var b=document.getElementById('wf-update-banner');if(b)b.textContent='Installing update… app will restart.';})();");
                }
            },
        ).await;

        match result {
            Ok(_) => {
                println!("[Updater] Update successful! Restarting...");
                app.restart();
            }
            Err(e) => {
                let err_msg = format!("{:?}", e);
                let err_short = format!("{}", e);
                println!("[Updater] Download/install error on attempt {}: {}", attempt, err_msg);

                if let Some(win) = app.get_webview_window("main") {
                    let banner = format!(
                        "Update failed (attempt {}): {}",
                        attempt,
                        err_short.replace('\n', " ").chars().take(180).collect::<String>()
                    );
                    let js = format!(r#"
                        (function(){{
                          var b=document.getElementById('wf-update-banner');
                          if(b){{
                            b.style.background='#ef4444';
                            b.style.color='white';
                            b.textContent={};
                          }}
                        }})();
                    "#, serde_json::to_string(&banner).unwrap_or_else(|_| "\"Update failed\"".to_string()));
                    let _ = win.eval(&js);
                }

                // Surface the FULL error and let the user choose Retry vs Save installer to disk.
                let full_msg = format!(
                    "Washflow couldn't install the update on attempt {}.\n\nError details:\n{}\n\nClick Retry to try the install again, or Save Installer to download the installer file to your Downloads folder so you can run it manually.",
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
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.eval("(function(){var b=document.getElementById('wf-update-banner');if(b){b.style.background='#0cd4c4';b.style.color='#0d1b2a';b.textContent='Downloading installer to your Downloads folder… 0%';}})();");
                }

                let download_url = format!("{}", update.download_url);
                let filename = download_url
                    .rsplit('/')
                    .next()
                    .map(|s| s.split('?').next().unwrap_or(s).to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("washflow-{}-installer", update.version));

                let download_dir = app.path().download_dir()
                    .or_else(|_| app.path().home_dir())
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));
                let target_path = download_dir.join(&filename);

                let app_handle2 = app.clone();
                let mut got_bytes: usize = 0;
                let bytes_result = update.clone().download(
                    move |chunk, total| {
                        got_bytes += chunk;
                        if let Some(t) = total {
                            let pct = ((got_bytes as u64 * 100) / t).min(100);
                            if let Some(win) = app_handle2.get_webview_window("main") {
                                let js = format!(
                                    "(function(){{var b=document.getElementById('wf-update-banner');if(b)b.textContent='Downloading installer… {}%';}})();",
                                    pct
                                );
                                let _ = win.eval(&js);
                            }
                        }
                    },
                    || { println!("[Updater] Installer download finished"); },
                ).await;

                match bytes_result {
                    Ok(bytes) => {
                        match std::fs::write(&target_path, &bytes) {
                            Ok(_) => {
                                println!("[Updater] Installer saved to {:?}", target_path);
                                if let Some(win) = app.get_webview_window("main") {
                                    let banner = format!("Installer saved to {}. Opening folder…", target_path.display());
                                    let js = format!(r#"(function(){{var b=document.getElementById('wf-update-banner');if(b){{b.style.background='#0cd4c4';b.style.color='#0d1b2a';b.textContent={};}}}})();"#,
                                        serde_json::to_string(&banner).unwrap_or_else(|_| "\"Installer saved.\"".to_string()));
                                    let _ = win.eval(&js);
                                }
                                // Reveal in OS file manager
                                let _ = open::that(download_dir.as_path());
                                let _ = app.dialog()
                                    .message(format!("Installer saved to:\n{}\n\nOpen the file from your Downloads folder to install the update.", target_path.display()))
                                    .title("Installer Downloaded")
                                    .kind(MessageDialogKind::Info)
                                    .buttons(MessageDialogButtons::Ok)
                                    .blocking_show();
                                return;
                            }
                            Err(e) => {
                                println!("[Updater] Failed to write installer: {}", e);
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
                        println!("[Updater] Installer download failed: {:?}", e);
                        let _ = app.dialog()
                            .message(format!("Couldn't download installer:\n\n{:?}\n\nWe'll open the releases page so you can download manually.", e))
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

