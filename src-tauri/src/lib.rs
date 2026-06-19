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
        .plugin(tauri_plugin_notification::init());

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
