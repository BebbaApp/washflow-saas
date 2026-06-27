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
    use tauri_plugin_dialog::DialogExt;

    // Retry up to 3 times in case of network issues
    for attempt in 1..=3 {
        println!("[Updater] Check attempt {}/3", attempt);
        match app.updater() {
            Ok(updater) => {
                match updater.check().await {
                    Ok(Some(update)) => {
                        println!("[Updater] New version available: {}", update.version);

                        let msg = format!(
                            "Washflow {} is available!\nYou are running {}.\n\nClick OK to download and install. The app will restart automatically.",
                            update.version, update.current_version
                        );

                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.set_focus();
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                        let should_update = app.dialog()
                            .message(msg)
                            .title("Update Available")
                            .blocking_show();

                        if !should_update {
                            println!("[Updater] User declined");
                            return;
                        }

                        // Show progress banner in UI
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.eval(r#"
                                const div = document.createElement('div');
                                div.id = 'wf-update-banner';
                                div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#0cd4c4;color:#0d1b2a;text-align:center;padding:12px;font-weight:bold;font-size:14px;';
                                div.textContent = 'Downloading update... Do not close the app.';
                                document.body.appendChild(div);
                            "#);
                        }

                        println!("[Updater] Starting download (attempt {})...", attempt);
                        let app_handle = app.clone();
                        let mut last_pct = 0u64;

                        let result = update.download_and_install(
                            |downloaded, total| {
                                if let Some(t) = total {
                                    let pct = (downloaded * 100) / t;
                                    if pct != last_pct && pct % 10 == 0 {
                                        last_pct = pct;
                                        println!("[Updater] {}% ({}/{})", pct, downloaded, t);
                                    }
                                }
                            },
                            || {
                                println!("[Updater] Extraction complete, restarting...");
                            },
                        ).await;

                        match result {
                            Ok(_) => {
                                println!("[Updater] Update successful! Restarting...");
                                app_handle.restart();
                            }
                            Err(e) => {
                                println!("[Updater] Download error on attempt {}: {}", attempt, e);
                                if attempt < 3 {
                                    println!("[Updater] Retrying in 5 seconds...");
                                    if let Some(win) = app.get_webview_window("main") {
                                        let _ = win.eval(&format!(r#"
                                            const b = document.getElementById('wf-update-banner');
                                            if (b) b.textContent = 'Download interrupted, retrying... (attempt {}/3)';
                                        "#, attempt + 1));
                                    }
                                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                                    continue;
                                } else {
                                    // All retries failed - show error and open browser
                                    println!("[Updater] All retries failed: {}", e);
                                    if let Some(win) = app.get_webview_window("main") {
                                        let _ = win.eval(r#"
                                            const b = document.getElementById('wf-update-banner');
                                            if (b) { b.style.background='#ef4444'; b.style.color='white'; b.textContent='Update failed. Downloading manually...'; }
                                        "#);
                                    }
                                    // Open GitHub releases in browser as fallback
                                    let _ = open::that("https://github.com/BebbaApp/washflow-saas/releases/latest");
                                }
                            }
                        }
                        return;
                    }
                    Ok(None) => {
                        println!("[Updater] App is up to date");
                        return;
                    }
                    Err(e) => {
                        println!("[Updater] Check failed on attempt {}: {}", attempt, e);
                        if attempt < 3 {
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            continue;
                        }
                    }
                }
            }
            Err(e) => {
                println!("[Updater] Not available: {}", e);
                return;
            }
        }
    }
}
