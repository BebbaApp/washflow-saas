// Local IndexedDB mirror of every tenant-scoped table, powered by Dexie.
// All rows carry `tenant_id` and `updated_at` so the sync engine can pull
// incrementally and so queries stay tenant-scoped without server hops.
//
// Local-only metadata:
//   _dirty:    1 when the row has unsynced local changes
//   _op:       'insert' | 'update' | 'delete' on dirty rows (for diagnostics)
//
// The `outbox` table records mutations that must be replayed against
// Supabase when connectivity returns.

import Dexie, { type Table } from "dexie";

export interface BaseRow {
  id: string;
  tenant_id: string;
  updated_at?: string;
  _dirty?: 0 | 1;
  _op?: "insert" | "update" | "delete";
}

export interface OutboxItem {
  id?: number;
  tenant_id: string;
  table: string;
  op: "insert" | "update" | "delete";
  payload: any;            // row body for insert/update, { id } for delete
  base_updated_at?: string | null;
  attempts: number;
  last_error?: string | null;
  created_at: number;
}

export interface SyncMeta {
  // key format: `${tenant_id}:${table}` -> ISO timestamp of last successful pull cursor
  key: string;
  last_pulled_at: string;
}

// Tables that the sync engine mirrors locally. Order matches phase19_enable_realtime_all.sql
// so we can keep them in lockstep.
export const MIRRORED_TABLES = [
  "services",
  "orders",
  "customers",
  "expenses",
  "expense_categories",
  "inventory_items",
  "inventory_transactions",
  "inventory_categories",
  "product_types",
  "suppliers",
  "loyalty_transactions",
  "shifts",
  "shift_templates",
  "time_off_requests",
  "staff_pins",
  "staff_face_enrollments",
  "attendance_records",
  "receipt_settings",
  "role_permissions",
  "user_roles",
  "tenant_members",
  "tenants",
] as const;
export type MirroredTable = (typeof MIRRORED_TABLES)[number];

class OfflineDB extends Dexie {
  services!: Table<BaseRow>;
  orders!: Table<BaseRow>;
  customers!: Table<BaseRow>;
  expenses!: Table<BaseRow>;
  expense_categories!: Table<BaseRow>;
  inventory_items!: Table<BaseRow>;
  inventory_transactions!: Table<BaseRow>;
  inventory_categories!: Table<BaseRow>;
  product_types!: Table<BaseRow>;
  suppliers!: Table<BaseRow>;
  loyalty_transactions!: Table<BaseRow>;
  shifts!: Table<BaseRow>;
  shift_templates!: Table<BaseRow>;
  time_off_requests!: Table<BaseRow>;
  staff_pins!: Table<BaseRow>;
  staff_face_enrollments!: Table<BaseRow>;
  attendance_records!: Table<BaseRow>;
  receipt_settings!: Table<BaseRow>;
  role_permissions!: Table<BaseRow>;
  user_roles!: Table<BaseRow>;
  tenant_members!: Table<BaseRow>;
  tenants!: Table<BaseRow>;

  outbox!: Table<OutboxItem, number>;
  sync_meta!: Table<SyncMeta, string>;

  constructor() {
    super("washflow_offline");
    const rowSchema = "id, tenant_id, updated_at, [tenant_id+updated_at], _dirty";
    const schemas: Record<string, string> = {
      outbox: "++id, tenant_id, table, created_at",
      sync_meta: "key",
    };
    for (const t of MIRRORED_TABLES) schemas[t] = rowSchema;
    this.version(1).stores(schemas);
  }
}

export const db = new OfflineDB();

export function metaKey(tenantId: string, table: string) {
  return `${tenantId}:${table}`;
}
