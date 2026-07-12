/**
 * offlineWrite.ts
 * 
 * Universal offline-first write helper.
 * 
 * Instead of rewriting every hook, this wraps any Supabase write operation:
 * 1. Writes to Dexie immediately (instant UI update)
 * 2. Queues to outbox for Supabase sync
 * 3. If online, also tries Supabase directly for immediate consistency
 * 
 * Usage:
 *   // Instead of: await supabase.from('services').insert(payload)
 *   // Use:        await offlineInsert('services', tenantId, payload)
 */

import { db, type MirroredTable } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";

// Tables that need a synthetic id when the table uses composite keys
const COMPOSITE_ID_TABLES: Record<string, (row: any) => string> = {
  tenant_members: (row) => `${row.tenant_id}:${row.user_id}`,
  receipt_settings: (row) => row.tenant_id,
  role_permissions: (row) => row.tenant_id,
};

const TABLES_WITHOUT_UPDATED_AT = new Set<string>([
  "loyalty_transactions",
  "shifts",
  "shift_templates",
  "time_off_requests",
  "attendance_records",
  "staff_face_enrollments",
  "staff_pins",
  "user_roles",
  "tenant_members",
  "customers",
  "expenses",
  "expense_categories",
  "inventory_categories",
  "inventory_transactions",
]);

function ensureId(table: string, row: any): any {
  if (row.id) return row;
  const synth = COMPOSITE_ID_TABLES[table];
  if (synth) return { ...row, id: synth(row) };
  return { ...row, id: crypto.randomUUID() };
}

/**
 * Write a new record to local Dexie + queue for Supabase sync
 */
export async function offlineInsert(
  table: MirroredTable,
  tenantId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const timestamps = TABLES_WITHOUT_UPDATED_AT.has(table)
    ? { created_at: now }
    : { created_at: now, updated_at: now };
  const row = ensureId(table, {
    tenant_id: tenantId,
    ...timestamps,
    ...payload,
  });

  await (db as any)[table].put({ ...row, _dirty: 1, _op: "insert" });
  await enqueueOutbox({ tenant_id: tenantId, table, op: "insert", payload: row });
  return row;
}

/**
 * Update a record in local Dexie + queue for Supabase sync
 */
export async function offlineUpdate(
  table: MirroredTable,
  tenantId: string,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const existing = await (db as any)[table].get(id);
  const now = new Date().toISOString();
  const hasUpdatedAt = !TABLES_WITHOUT_UPDATED_AT.has(table);
  const updated = { ...(existing ?? { id, tenant_id: tenantId }), ...patch, id, ...(hasUpdatedAt ? { updated_at: now } : {}) };
  await (db as any)[table].put({ ...updated, _dirty: 1, _op: "update" });
  await enqueueOutbox({ tenant_id: tenantId, table, op: "update", payload: { id, ...patch, ...(hasUpdatedAt ? { updated_at: now } : {}) } });
}

/**
 * Delete a record from local Dexie + queue for Supabase sync
 */
export async function offlineDelete(
  table: MirroredTable,
  tenantId: string,
  id: string
): Promise<void> {
  await (db as any)[table].delete(id);
  await enqueueOutbox({ tenant_id: tenantId, table, op: "delete", payload: { id } });
}

/**
 * Upsert a record in local Dexie + queue for Supabase sync
 */
export async function offlineUpsert(
  table: MirroredTable,
  tenantId: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const row = ensureId(table, { tenant_id: tenantId, ...(TABLES_WITHOUT_UPDATED_AT.has(table) ? {} : { updated_at: now }), ...payload });
  const existing = await (db as any)[table].get(row.id);
  const merged = { ...(existing ?? {}), ...row };
  await (db as any)[table].put({ ...merged, _dirty: 1, _op: existing ? "update" : "insert" });
  await enqueueOutbox({ tenant_id: tenantId, table, op: existing ? "update" : "insert", payload: merged });
  return merged;
}
