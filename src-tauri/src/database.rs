// src-tauri/src/database.rs
// Local SQLite database for Washflow — offline-first storage

use anyhow::Result;
use once_cell::sync::OnceCell;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

/// Initialize the SQLite database, creating all tables if they don't exist.
pub fn init(app: &tauri::App) -> Result<()> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("washflow.db");
    println!("[DB] Opening database at: {:?}", db_path);

    let conn = Connection::open(&db_path)?;

    // Enable WAL mode for better concurrent performance
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    create_schema(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| anyhow::anyhow!("DB already initialized"))?;

    println!("[DB] Database initialized successfully");
    Ok(())
}

fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        -- =====================================================
        -- WASHFLOW LOCAL SQLITE SCHEMA
        -- Mirrors Supabase schema for offline-first operation
        -- =====================================================

        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            plan_id TEXT,
            trial_ends_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            user_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            theme_id TEXT,
            theme_mode TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        CREATE TABLE IF NOT EXISTS tenant_settings (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL UNIQUE,
            currency TEXT DEFAULT 'ZAR',
            vat_rate REAL DEFAULT 15.0,
            vat_enabled INTEGER DEFAULT 1,
            loyalty_enabled INTEGER DEFAULT 1,
            receipt_footer TEXT,
            business_name TEXT,
            business_phone TEXT,
            business_address TEXT,
            logo_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Orders (wash jobs)
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            order_number TEXT NOT NULL,
            customer TEXT NOT NULL,
            customer_id TEXT,
            customer_phone TEXT,
            vehicle TEXT NOT NULL,
            plate TEXT NOT NULL,
            service TEXT NOT NULL,
            service_price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'waiting',
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            wait_minutes INTEGER,
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

        -- Customers
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            loyalty_points INTEGER NOT NULL DEFAULT 0,
            total_washes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

        -- Services / Wash packages
        CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            duration TEXT NOT NULL DEFAULT '30 min',
            features TEXT NOT NULL DEFAULT '[]',
            popular INTEGER NOT NULL DEFAULT 0,
            vat_exempt INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Expenses
        CREATE TABLE IF NOT EXISTS expenses (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT,
            vendor TEXT,
            notes TEXT,
            date TEXT NOT NULL DEFAULT (date('now')),
            created_by TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC);

        -- Expense categories
        CREATE TABLE IF NOT EXISTS expense_categories (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Inventory items
        CREATE TABLE IF NOT EXISTS inventory_items (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            unit TEXT NOT NULL DEFAULT 'units',
            unit_cost REAL NOT NULL DEFAULT 0,
            threshold REAL NOT NULL DEFAULT 5,
            recommended_min REAL,
            recommended_max REAL,
            supplier_id TEXT,
            pack_size REAL,
            preset_id TEXT,
            subtype TEXT,
            expense_category TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory_items(tenant_id);

        -- Inventory transactions
        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            type TEXT NOT NULL,
            quantity REAL NOT NULL,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (item_id) REFERENCES inventory_items(id)
        );

        -- Suppliers
        CREATE TABLE IF NOT EXISTS suppliers (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Staff shifts
        CREATE TABLE IF NOT EXISTS shifts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            staff_user_id TEXT NOT NULL,
            shift_date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            template_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            _deleted INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_shifts_tenant ON shifts(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);

        -- Shift templates
        CREATE TABLE IF NOT EXISTS shift_templates (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            name TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            days_of_week TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Attendance records
        CREATE TABLE IF NOT EXISTS attendance_records (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'present',
            match_score REAL,
            notes TEXT,
            selfie_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );
        CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance_records(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_records(user_id);

        -- Loyalty transactions
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            customer_id TEXT NOT NULL,
            order_id TEXT,
            type TEXT NOT NULL,
            points INTEGER NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            _dirty INTEGER DEFAULT 0,
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id),
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        );

        -- Staff PINs
        CREATE TABLE IF NOT EXISTS staff_pins (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL,
            pin_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Product types
        CREATE TABLE IF NOT EXISTS product_types (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        );

        -- Inventory categories
        CREATE TABLE IF NOT EXISTS inventory_categories (
            id TEXT PRIMARY KEY,
            tenant_id TEXT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        );

        -- Role permissions
        CREATE TABLE IF NOT EXISTS role_permissions (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            role TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        );

        -- Sync queue — mutations made offline waiting to push to Supabase
        CREATE TABLE IF NOT EXISTS sync_queue (
            id TEXT PRIMARY KEY,
            table_name TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
            record_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            retries INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

        -- App metadata
        CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ")?;

    println!("[DB] Schema created/verified");
    Ok(())
}

pub fn get_db() -> &'static Mutex<Connection> {
    DB.get().expect("Database not initialized")
}
