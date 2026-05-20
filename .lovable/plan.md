# Phase 6 hardening — per-tenant receipts + extended audit log

## Goals
1. Make `receipt_settings` per-tenant instead of a global singleton row.
2. Extend `membership_audit_log` to capture more sensitive actions:
   tenant settings updates, billing changes, platform-admin changes,
   receipt-settings edits.

## 1. Per-tenant receipt settings

### Schema change (`supabase/sql/phase6_hardening.sql`)
- Drop the `id BOOLEAN PRIMARY KEY` singleton constraint.
- Add `tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE`.
- Make `tenant_id` the primary key (one row per tenant).
- Backfill: for every existing tenant, insert a default row if missing.
  Existing singleton row content is preserved by copying it to the
  current_tenant_id() owner if exactly one tenant exists, otherwise just
  used as the default template for new rows.
- Rewrite RLS:
  - SELECT: any member of the tenant.
  - INSERT/UPDATE: owners/admins/managers of that tenant.
- Keep realtime publication.

### App changes
- `src/hooks/useReceiptSettings.ts`
  - Pull `tenant_id` from `useTenant()` and scope every query
    (`eq("tenant_id", tenant.id)`) and upsert (`onConflict: "tenant_id"`).
  - Reset and re-fetch when the active tenant changes.
  - LocalStorage cache key becomes per-tenant
    (`aquawash-receipt-settings:<tenant_id>`).
  - Realtime channel filters on `tenant_id=eq.<id>`.
- No UI changes to `SettingsPage` / `ReceiptPreview` needed — they read
  through the hook.

## 2. Extended audit logging

### Schema change (same migration)
- Loosen the `action` check constraint on `public.membership_audit_log`
  to accept the new action codes:
  - `tenant.settings_updated`
  - `tenant.billing_updated`
  - `platform_admin.granted`
  - `platform_admin.revoked`
  - `receipt_settings.updated`
- Add triggers (all `security definer`, write via service-role bypass):
  - `trg_log_tenant_update` on `public.tenants` (AFTER UPDATE) — diff
    name/slug/plan_id/status and log `tenant.settings_updated` or
    `tenant.billing_updated` (when plan/status changes).
  - `trg_log_platform_admin` on `public.platform_admins`
    (AFTER INSERT/DELETE) — log granted/revoked. `tenant_id` is set to
    `current_tenant_id()` when present, else null-skipped (the table
    requires non-null tenant_id, so platform_admin events are written
    only when the actor has an active tenant; otherwise inserted via the
    edge function which always sets one).
  - `trg_log_receipt_settings` on `public.receipt_settings`
    (AFTER UPDATE) — log `receipt_settings.updated` with a payload of
    changed fields.
- Adjust the `tenant_id` column on `membership_audit_log` to allow
  cross-tenant platform actions if necessary (we'll only emit when a
  tenant scope exists, so leave NOT NULL).

### Edge function tweaks
- None required for triggers to fire; the existing `accept-invite` /
  `invite-member` functions already emit explicit audit rows and remain
  the source of truth for invite lifecycle.

### UI
- `MembershipAuditLog.tsx` — add the new action codes to the `ACTIONS`
  filter list and `LABEL` map so they render nicely.

## Files touched
- `supabase/sql/phase6_hardening.sql` (new)
- `src/hooks/useReceiptSettings.ts`
- `src/components/MembershipAuditLog.tsx`

## Out of scope
- Renaming/relabelling receipt UI copy.
- Adding per-tenant overrides for currency/VAT (already tenant-scoped
  elsewhere or planned for a later phase).
