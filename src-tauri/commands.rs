// src-tauri/src/commands.rs
use crate::database::get_db;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;
use chrono::Utc;

fn now() -> String { Utc::now().to_rfc3339() }
fn new_id() -> String { Uuid::new_v4().to_string() }

fn json_to_sql(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() { rusqlite::types::Value::Integer(i) }
            else { rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0)) }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        _ => rusqlite::types::Value::Text(serde_json::to_string(v).unwrap_or_default()),
    }
}

fn rows_to_json(db: &rusqlite::Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> Result<Value, String> {
    let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows: Vec<Value> = stmt
        .query_map(p, |row| {
            let mut map = serde_json::Map::new();
            for (i, col) in cols.iter().enumerate() {
                let val: Value = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
                    Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                    Ok(rusqlite::types::ValueRef::Text(s)) => json!(String::from_utf8_lossy(s).to_string()),
                    _ => Value::Null,
                };
                map.insert(col.clone(), val);
            }
            Ok(Value::Object(map))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(json!(rows))
}

fn first_row(db: &rusqlite::Connection, sql: &str, id: &str) -> Result<Value, String> {
    let result = rows_to_json(db, sql, &[&id])?;
    if let Value::Array(mut arr) = result { Ok(arr.pop().unwrap_or(Value::Null)) }
    else { Ok(Value::Null) }
}

fn queue_sync_inner(db: &rusqlite::Connection, table: &str, operation: &str, record_id: &str, payload: &Value) -> Result<(), String> {
    let id = new_id();
    let created_at = now();
    let payload_str = serde_json::to_string(payload).unwrap_or_default();
    db.execute(
        "INSERT INTO sync_queue (id,table_name,operation,record_id,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, table, operation, record_id, payload_str, created_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Generic ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_query(sql: String, params: Vec<Value>) -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows: Vec<Value> = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(json_to_sql)), |row| {
            let mut map = serde_json::Map::new();
            for (i, col) in cols.iter().enumerate() {
                let val: Value = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => json!(n),
                    Ok(rusqlite::types::ValueRef::Real(f)) => json!(f),
                    Ok(rusqlite::types::ValueRef::Text(s)) => json!(String::from_utf8_lossy(s).to_string()),
                    _ => Value::Null,
                };
                map.insert(col.clone(), val);
            }
            Ok(Value::Object(map))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(json!(rows))
}

#[tauri::command]
pub fn db_execute(sql: String, params: Vec<Value>) -> Result<usize, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(&sql, rusqlite::params_from_iter(params.iter().map(json_to_sql))).map_err(|e| e.to_string())
}

// ── Orders ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_orders(tenant_id: String) -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    rows_to_json(&db, "SELECT * FROM orders WHERE tenant_id = ?1 AND _deleted = 0 ORDER BY created_at DESC", &[&tenant_id])
}

#[tauri::command]
pub fn create_order(tenant_id: String, customer: String, customer_phone: Option<String>, customer_id: Option<String>, vehicle: String, plate: String, service: String, service_price: f64, created_by: Option<String>) -> Result<Value, String> {
    let id = new_id();
    let created_at = now();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    let count: i64 = db.query_row("SELECT COUNT(*) FROM orders WHERE tenant_id = ?1", params![tenant_id], |r| r.get(0)).unwrap_or(0);
    let order_number = format!("W-{:04}", count + 1);
    db.execute(
        "INSERT INTO orders (id,tenant_id,order_number,customer,customer_id,customer_phone,vehicle,plate,service,service_price,status,created_by,created_at,updated_at,_dirty) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'waiting',?11,?12,?12,1)",
        params![id, tenant_id, order_number, customer, customer_id, customer_phone, vehicle, plate, service, service_price, created_by, created_at],
    ).map_err(|e| e.to_string())?;
    queue_sync_inner(&db, "orders", "INSERT", &id, &json!({"id": id, "tenant_id": tenant_id, "order_number": order_number, "customer": customer, "vehicle": vehicle, "plate": plate, "service": service, "service_price": service_price, "status": "waiting", "created_at": created_at}))?;
    first_row(&db, "SELECT * FROM orders WHERE id = ?1", &id)
}

#[tauri::command]
pub fn update_order_status(id: String, status: String, tenant_id: String) -> Result<(), String> {
    let updated_at = now();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    if status == "completed" {
        let created_at: String = db.query_row("SELECT created_at FROM orders WHERE id = ?1", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
        let completed_at = updated_at.clone();
        let start = chrono::DateTime::parse_from_rfc3339(&created_at).map_err(|e| e.to_string())?;
        let end = chrono::DateTime::parse_from_rfc3339(&completed_at).map_err(|e| e.to_string())?;
        let wait_minutes = (end - start).num_minutes();
        db.execute("UPDATE orders SET status=?1,completed_at=?2,wait_minutes=?3,updated_at=?4,_dirty=1 WHERE id=?5", params![status, completed_at, wait_minutes, updated_at, id]).map_err(|e| e.to_string())?;
        queue_sync_inner(&db, "orders", "UPDATE", &id, &json!({"id": id, "status": status, "completed_at": completed_at, "wait_minutes": wait_minutes}))?;
    } else {
        db.execute("UPDATE orders SET status=?1,updated_at=?2,_dirty=1 WHERE id=?3", params![status, updated_at, id]).map_err(|e| e.to_string())?;
        queue_sync_inner(&db, "orders", "UPDATE", &id, &json!({"id": id, "status": status, "updated_at": updated_at}))?;
    }
    let _ = tenant_id;
    Ok(())
}

// ── Customers ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_customers(tenant_id: String) -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    rows_to_json(&db, "SELECT * FROM customers WHERE tenant_id = ?1 AND _deleted = 0 ORDER BY name ASC", &[&tenant_id])
}

#[tauri::command]
pub fn upsert_customer(tenant_id: String, id: Option<String>, name: String, phone: Option<String>, email: Option<String>) -> Result<Value, String> {
    let record_id = id.unwrap_or_else(new_id);
    let created_at = now();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO customers (id,tenant_id,name,phone,email,created_at,_dirty) VALUES (?1,?2,?3,?4,?5,?6,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,email=excluded.email,_dirty=1",
        params![record_id, tenant_id, name, phone, email, created_at],
    ).map_err(|e| e.to_string())?;
    queue_sync_inner(&db, "customers", "INSERT", &record_id, &json!({"id": record_id, "tenant_id": tenant_id, "name": name, "phone": phone, "email": email}))?;
    first_row(&db, "SELECT * FROM customers WHERE id = ?1", &record_id)
}

// ── Services ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_services(tenant_id: String) -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    rows_to_json(&db, "SELECT * FROM services WHERE tenant_id = ?1 AND _deleted = 0 ORDER BY sort_order ASC", &[&tenant_id])
}

#[tauri::command]
pub fn upsert_service(tenant_id: String, service: Value) -> Result<Value, String> {
    let id = service["id"].as_str().map(|s| s.to_string()).unwrap_or_else(new_id);
    let name = service["name"].as_str().unwrap_or("").to_string();
    let price = service["price"].as_f64().unwrap_or(0.0);
    let duration = service["duration"].as_str().unwrap_or("30 min").to_string();
    let features = serde_json::to_string(&service["features"]).unwrap_or_else(|_| "[]".into());
    let popular = service["popular"].as_bool().unwrap_or(false) as i64;
    let vat_exempt = service["vatExempt"].as_bool().unwrap_or(false) as i64;
    let sort_order = service["sort_order"].as_i64().unwrap_or(0);
    let updated_at = now();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO services (id,tenant_id,name,price,duration,features,popular,vat_exempt,sort_order,created_at,updated_at,_dirty) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,duration=excluded.duration,features=excluded.features,popular=excluded.popular,vat_exempt=excluded.vat_exempt,sort_order=excluded.sort_order,updated_at=excluded.updated_at,_dirty=1",
        params![id, tenant_id, name, price, duration, features, popular, vat_exempt, sort_order, updated_at],
    ).map_err(|e| e.to_string())?;
    queue_sync_inner(&db, "services", "INSERT", &id, &json!({"id": id, "tenant_id": tenant_id, "name": name, "price": price, "duration": duration}))?;
    first_row(&db, "SELECT * FROM services WHERE id = ?1", &id)
}

// ── Expenses ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_expenses(tenant_id: String) -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    rows_to_json(&db, "SELECT * FROM expenses WHERE tenant_id = ?1 AND _deleted = 0 ORDER BY date DESC, created_at DESC", &[&tenant_id])
}

#[tauri::command]
pub fn create_expense(tenant_id: String, expense: Value) -> Result<Value, String> {
    let id = new_id();
    let created_at = now();
    let description = expense["description"].as_str().unwrap_or("").to_string();
    let amount = expense["amount"].as_f64().unwrap_or(0.0);
    let category = expense["category"].as_str().unwrap_or("").to_string();
    let subcategory = expense["subcategory"].as_str().map(|s| s.to_string());
    let vendor = expense["vendor"].as_str().map(|s| s.to_string());
    let notes = expense["notes"].as_str().map(|s| s.to_string());
    let date = expense["date"].as_str().unwrap_or(&created_at[..10]).to_string();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO expenses (id,tenant_id,description,amount,category,subcategory,vendor,notes,date,created_at,_dirty) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1)",
        params![id, tenant_id, description, amount, category, subcategory, vendor, notes, date, created_at],
    ).map_err(|e| e.to_string())?;
    queue_sync_inner(&db, "expenses", "INSERT", &id, &json!({"id": id, "tenant_id": tenant_id, "description": description, "amount": amount, "category": category, "date": date}))?;
    first_row(&db, "SELECT * FROM expenses WHERE id = ?1", &id)
}

// ── Sync Queue ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_sync_queue() -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    rows_to_json(&db, "SELECT * FROM sync_queue ORDER BY created_at ASC", &[])
}

#[tauri::command]
pub fn remove_from_sync_queue(id: String) -> Result<(), String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM sync_queue WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_pending_sync_count() -> Result<i64, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.query_row("SELECT COUNT(*) FROM sync_queue", [], |r| r.get(0)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bulk_upsert(table: String, records: Vec<Value>) -> Result<usize, String> {
    if records.is_empty() { return Ok(0); }
    let db = get_db().lock().map_err(|e| e.to_string())?;
    let mut count = 0;
    if let Some(Value::Object(first)) = records.first() {
        let cols: Vec<String> = first.keys().filter(|k| k.as_str() != "_dirty" && k.as_str() != "_deleted").cloned().collect();
        let col_list = cols.join(", ");
        let placeholders = cols.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect::<Vec<_>>().join(", ");
        let sql = format!("INSERT OR REPLACE INTO {} ({}, synced_at) VALUES ({}, datetime('now'))", table, col_list, placeholders);
        for record in &records {
            if let Value::Object(obj) = record {
                let vals: Vec<rusqlite::types::Value> = cols.iter().map(|k| json_to_sql(obj.get(k).unwrap_or(&Value::Null))).collect();
                if db.execute(&sql, rusqlite::params_from_iter(vals.iter())).is_ok() { count += 1; }
            }
        }
    }
    Ok(count)
}

// ── Metadata ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_meta(key: String) -> Result<Option<String>, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.query_row("SELECT value FROM app_metadata WHERE key = ?1", params![key], |r| r.get(0))
        .optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_meta(key: String, value: String) -> Result<(), String> {
    let updated_at = now();
    let db = get_db().lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO app_metadata (key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        params![key, value, updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_db_info() -> Result<Value, String> {
    let db = get_db().lock().map_err(|e| e.to_string())?;
    let tables: Vec<String> = {
        let mut stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map_err(|e| e.to_string())?;
        let result: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        result
    };
    let mut counts = serde_json::Map::new();
    for t in &tables {
        let c: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {}", t), [], |r| r.get(0)).unwrap_or(0);
        counts.insert(t.clone(), json!(c));
    }
    Ok(json!({ "tables": tables, "record_counts": counts }))
}
