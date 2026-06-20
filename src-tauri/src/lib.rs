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

    match app.updater() {
        Ok(updater) => {
            match updater.check().await {
                Ok(Some(update)) => {
                    println!("[Updater] New version available: {}", update.version);

                    let msg = format!(
                        "Washflow {} is available!\nYou are running {}.\nWould you like to update now?",
                        update.version,
                        update.current_version
                    );

                    // Use confirm dialog (returns bool)
                    let should_update = app.dialog()
                        .message(msg)
                        .title("Update Available")
                        .blocking_show();

                    if should_update {
                        println!("[Updater] Downloading update...");
                        match update.download_and_install(
                            |downloaded, total| {
                                if let Some(t) = total {
                                    println!("[Updater] {}/{} bytes", downloaded, t);
                                }
                            },
                            || println!("[Updater] Update installed, restarting..."),
                        ).await {
                            Ok(_) => println!("[Updater] Done"),
                            Err(e) => println!("[Updater] Install error: {}", e),
                        }
                    } else {
                        println!("[Updater] User postponed update");
                    }
                }
                Ok(None) => println!("[Updater] App is up to date"),
                Err(e) => println!("[Updater] Check failed: {}", e),
            }
        }
        Err(e) => println!("[Updater] Not available: {}", e),
    }
}
