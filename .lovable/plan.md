## Per-Tenant Backup System

Adds a nightly snapshot + restore + export + health-check system that is fully **additive** — no existing table, hook, edge function, or UI component changes behavior.

### 1. New tables (migration)

```
tenant_backups
  id uuid pk
  tenant_id uuid  (FK tenants)
  created_at timestamptz default now()
  kind text  ('nightly' | 'manual' | 'pre_restore')
  row_counts jsonb              -- {orders: 1234, customers: 88, ...}
  snapshot jsonb                -- {orders: [...], customers: [...], ...}
  size_bytes bigint
  checksum text                 -- sha256 of snapshot
  created_by uuid null

tenant_health_checks
  id uuid pk
  tenant_id uuid
  checked_at timestamptz
  status text  ('ok' | 'warning' | 'critical')
  findings jsonb                -- [{check:'orphan_orders', count:3, sample:[...]}]
```

Both **service_role only** (no anon/authenticated grants, no SELECT policies). RLS enabled and deny-all — accessed exclusively through edge functions.

Retention: keep last 14 nightly + 12 monthly (first-of-month) + all manual/pre_restore. Cleanup runs in the same nightly job.

### 2. Nightly snapshot (`backup-tenants` edge function + pg_cron 02:00)

For each tenant, service-role client selects rows from the mirrored tables (same set the offline sync uses: `orders, customers, services, expenses, expense_categories, inventory_items, inventory_transactions, suppliers, loyalty_transactions, shifts, shift_templates, time_off_requests, staff_pins, staff_compensation, tenant_members, receipt_settings, tenant_settings, user_roles, attendance_records`), writes one `tenant_backups` row with `snapshot` JSONB, row counts, size, sha256 checksum.

Large tenants (>5 MB snapshot): write to Supabase Storage bucket `tenant-backups` (service-role only) and store the path in `snapshot` instead of the inline JSON. Keeps the table lean.

### 3. Health checks (same nightly job)

Runs these queries per tenant and writes to `tenant_health_checks`:
- Orphan orders (customer_id set but no matching customer row)
- Orphan inventory_transactions
- Duplicate `order_number` within tenant
- Negative `current_stock` inventory items
- `service_price < 0` or `discount > service_price` on orders
- Row count deltas vs previous night beyond ±50% (possible mass delete)
- Missing `updated_at` on any mirrored table

`status=critical` triggers a Resend email to the tenant owner + platform admins.

### 4. Restore (`restore-tenant` edge function)

Manual, platform-admin only, requires typing the tenant slug to confirm.

Flow (inside a single Postgres transaction via `service_role`):
1. Take a `pre_restore` snapshot first (safety net).
2. Bump a new `tenants.restored_at` column so clients know to wipe local cache.
3. Delete tenant rows in **reverse FK order**: inventory_transactions → orders → loyalty_transactions → inventory_items → services → customers → expenses → ... → tenant_members (kept).
4. Re-insert snapshot rows in **forward FK order**.
5. Commit. Realtime pushes the changes to any connected clients.

Client side: `useTenant` reads `tenants.restored_at`; if it advanced since local cache timestamp, offline mirror (`src/offline/db.ts`) wipes IndexedDB for that tenant and re-syncs. Only ~15 lines added.

Not restored: `auth.users` (Supabase-reserved), storage objects, `tenant_backups`, `tenant_health_checks`, `platform_admins`, `super_admins`.

### 5. JSON export (`export-tenant` edge function)

Owner or platform-admin only. Returns a downloadable `.json` file: either the latest snapshot or a fresh one built on demand. Also offered as a zipped folder of one JSON file per table for readability.

### 6. UI (new tab in Platform Console)

New file `src/components/platform/ConsoleBackups.tsx` added as a tab in `src/pages/Platform.tsx`. Shows:
- Table of tenants with: last backup time, last backup size, health status badge, "Export JSON" / "Restore…" / "View history" buttons.
- History drawer lists all snapshots for a tenant with download + restore-from-this-snapshot.
- Health findings panel shows current critical/warning items with the affected row IDs.

Owner Portal (`/owner`) gets an "Export my data" button per workspace (calls `export-tenant`), but no restore (platform-admin only).

### 7. Impact on existing code

| Area | Change |
|---|---|
| Existing tables | none |
| RLS policies | none changed |
| `useOrders`, `useTenant`, `useInventory`, etc. | none (except ~15 lines in `useTenant` to react to `restored_at`) |
| Offline mirror (`src/offline/`) | small addition to wipe IndexedDB when `restored_at` advances |
| Realtime subscribers | unaffected (they just see row churn during a restore) |
| Existing edge functions | none |

### 8. Files to add/edit

**New SQL** — `supabase/sql/phase45_tenant_backups.sql` (tables, grants, RLS deny-all, `tenants.restored_at` column, pg_cron schedule)

**New edge functions**
- `supabase/functions/backup-tenants/index.ts` (cron target: snapshot + health + retention)
- `supabase/functions/restore-tenant/index.ts` (platform-admin)
- `supabase/functions/export-tenant/index.ts` (owner or platform-admin)

**New UI**
- `src/components/platform/ConsoleBackups.tsx`
- `src/hooks/useTenantBackups.ts`

**Small edits**
- `src/pages/Platform.tsx` — add "Backups" tab
- `src/components/owner/OwnerOverviewGrid.tsx` — add "Export data" button
- `src/hooks/useTenant.tsx` — watch `restored_at`
- `src/offline/db.ts` — wipe on restored_at change

### 9. Secrets

Reuses existing `RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Nothing new to add.

### 10. Cost / storage note

Estimated snapshot size per active tenant ≈ 200 KB–2 MB compressed JSONB. 14 nightlies + 12 monthlies ≈ 26 snapshots ≈ 5–50 MB per tenant. Storage bucket path used above 5 MB. Well within Supabase free-tier limits for a small number of tenants; monitor and tune retention if it grows.

### 11. Rollout order

1. Migration + grants
2. Deploy `backup-tenants`, run once manually, verify snapshots
3. Deploy `export-tenant`, wire Owner Portal button
4. Deploy `restore-tenant`, add Console UI (behind a confirm dialog)
5. Enable pg_cron nightly schedule
6. Turn on Resend alert for `critical` health checks
