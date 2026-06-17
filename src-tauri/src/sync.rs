// src-tauri/src/sync.rs
// Sync engine: flushes local SQLite queue to Supabase when online

use crate::database::get_db;
use rusqlite::params;
use serde_json::{json, Value};

#[tauri::command]
pub async fn trigger_sync(supabase_url: String, supabase_key: String) -> Result<Value, String> {
    let queue = get_queue_items()?;

    if queue.is_empty() {
        return Ok(json!({ "synced": 0, "failed": 0, "remaining": 0 }));
    }

    println!("[Sync] Processing {} queued mutations", queue.len());

    let client = reqwest::Client::new();
    let mut synced = 0;
    let mut failed = 0;

    for item in &queue {
        let table = item["table_name"].as_str().unwrap_or("");
        let operation = item["operation"].as_str().unwrap_or("");
        let queue_id = item["id"].as_str().unwrap_or("");
        let payload: Value = serde_json::from_str(
            item["payload"].as_str().unwrap_or("{}")
        ).unwrap_or(json!({}));

        let url = format!("{}/rest/v1/{}", supabase_url, table);

        let result = match operation {
            "INSERT" => {
                client.post(&url)
                    .header("apikey", &supabase_key)
                    .header("Authorization", format!("Bearer {}", supabase_key))
                    .header("Content-Type", "application/json")
                    .header("Prefer", "resolution=merge-duplicates")
                    .json(&payload)
                    .send()
                    .await
            }
            "UPDATE" => {
                let record_id = payload["id"].as_str().unwrap_or("");
                let update_url = format!("{}?id=eq.{}", url, record_id);
                client.patch(&update_url)
                    .header("apikey", &supabase_key)
                    .header("Authorization", format!("Bearer {}", supabase_key))
                    .header("Content-Type", "application/json")
                    .json(&payload)
                    .send()
                    .await
            }
            "DELETE" => {
                let record_id = payload["id"].as_str().unwrap_or("");
                let delete_url = format!("{}?id=eq.{}", url, record_id);
                client.delete(&delete_url)
                    .header("apikey", &supabase_key)
                    .header("Authorization", format!("Bearer {}", supabase_key))
                    .send()
                    .await
            }
            _ => {
                println!("[Sync] Unknown operation: {}", operation);
                continue;
            }
        };

        match result {
            Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 409 => {
                remove_queue_item(queue_id)?;
                synced += 1;
                println!("[Sync] ✓ {} {} {}", operation, table, queue_id);
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                println!("[Sync] ✗ {} {} - HTTP {}: {}", operation, table, status, body);
                increment_retries(queue_id, &body)?;
                failed += 1;
            }
            Err(e) => {
                println!("[Sync] ✗ {} {} - Error: {}", operation, table, e);
                increment_retries(queue_id, &e.to_string())?;
                failed += 1;
            }
        }
    }

    let remaining = get_queue_count()?;
    println!("[Sync] Done — synced: {}, failed: {}, remaining: {}", synced, failed, remaining);

    Ok(json!({ "synced": synced, "failed": failed, "remaining": remaining }))
}

fn get_queue_items() -> Result<Vec<Value>, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT * FROM sync_queue WHERE retries < 5 ORDER BY created_at ASC LIMIT 100"
    ).map_err(|e| e.to_string())?;

    let items = stmt.query_map([], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "table_name": row.get::<_, String>(1)?,
            "operation": row.get::<_, String>(2)?,
            "record_id": row.get::<_, String>(3)?,
            "payload": row.get::<_, String>(4)?,
            "created_at": row.get::<_, String>(5)?,
            "retries": row.get::<_, i64>(6)?,
        }))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    Ok(items)
}

fn remove_queue_item(id: &str) -> Result<(), String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM sync_queue WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn increment_retries(id: &str, error: &str) -> Result<(), String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE sync_queue SET retries = retries + 1, last_error = ?1 WHERE id = ?2",
        params![error, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_queue_count() -> Result<i64, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.query_row("SELECT COUNT(*) FROM sync_queue", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}
