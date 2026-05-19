# Multi-tenant SaaS + Licensing Plan

Goal: turn the current single-business app into a product you can sell to many companies, with Stripe-billed subscriptions, a 30-day trial, a 14-day grace period after failed payment, and automatic suspension.

Decisions already made:
- Isolation: shared database, `tenant_id` on every row, enforced by RLS.
- Billing: Stripe Billing (subscriptions + customer portal + webhooks).
- Trial 30 days, grace 14 days.
- Existing data migrates into a single "Default Tenant".

---

## Phase 1 — Tenant foundation (schema + RLS)

New tables:
- `tenants(id, name, slug unique, status, trial_ends_at, current_period_end, grace_period_ends_at, stripe_customer_id, plan_id, created_at)`
- `tenant_members(tenant_id, user_id, tenant_role, created_at)` — `tenant_role` enum: `owner | admin | member`.
- `plans(id, code, name, price_monthly_cents, max_users, features jsonb, stripe_price_id)`
- `subscriptions(id, tenant_id, plan_id, stripe_sub_id, status, current_period_end, cancel_at)`
- `invoices(id, tenant_id, stripe_invoice_id, amount_cents, status, due_date, paid_at, hosted_url)`
- `license_events(id, tenant_id, kind, payload jsonb, created_at)` — audit log.
- `platform_admins(user_id)` — super-admin (you), outside any tenant.

Helpers (SECURITY DEFINER, avoid RLS recursion):
- `public.current_tenant_id() returns uuid` — reads from JWT claim or `tenant_members` for the calling user; if user belongs to multiple tenants, uses `app_metadata.active_tenant_id`.
- `public.is_tenant_member(_tenant uuid) returns boolean`
- `public.tenant_has_role(_tenant uuid, _role tenant_role) returns boolean`
- `public.tenant_license_active(_tenant uuid) returns boolean` — true when status in `(trialing, active)` OR `(past_due AND now() < grace_period_ends_at)`.
- `public.is_platform_admin(_uid uuid) returns boolean`.

Migration of existing tables (orders, services, inventory_items, expenses, attendance, profiles, user_roles, receipt_settings, schedules, loyalty, workers, …):
1. Add `tenant_id uuid` nullable.
2. Create one default tenant; backfill `tenant_id` on every row.
3. Set `tenant_id NOT NULL`, add FK to `tenants(id)`, add index.
4. Drop old RLS policies, recreate as:
   - `SELECT`: `tenant_id = current_tenant_id()`
   - `INSERT/UPDATE/DELETE`: `tenant_id = current_tenant_id() AND tenant_license_active(tenant_id)`
5. `user_roles` becomes per-tenant: `(user_id, tenant_id, role)` unique.

Auth hook: on first signup, create a tenant, add the user as `owner`, start a 30-day trial, set their `active_tenant_id` in `app_metadata`.

## Phase 2 — Frontend tenant awareness

- `useTenant()` hook → loads current tenant, status, plan, members, license flag. Realtime subscribed.
- `TenantProvider` at the root; gate routes on it.
- `useAuth` extended with `activeTenantId` + `switchTenant(id)` (calls an edge function that updates the JWT claim and refreshes session).
- Every existing `supabase.from(...)` call: no code change needed — RLS does the scoping. But every `insert` adds `tenant_id: current`.
- `<LicenseGate>` component wraps the app shell:
  - `trialing` / `active` → render normally, show trial countdown banner when <7 days left.
  - `past_due` → render normally, red banner "Payment failed, X days left to update billing".
  - `suspended` / `cancelled` → block the app, show a Billing page (only Settings → Billing and Logout accessible).

## Phase 3 — Stripe Billing

Use the seamless Stripe integration (`enable_stripe_payments`).

- Edge functions:
  - `create-checkout` — owner picks a plan → Stripe Checkout in subscription mode.
  - `create-billing-portal` — opens Stripe customer portal.
  - `stripe-webhook` — handles `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid`, `invoice.payment_failed`. Updates `subscriptions`, `invoices`, and `tenants.status` + `current_period_end` + `grace_period_ends_at`.
- A daily `pg_cron` job calls `enforce_licenses()`:
  - `past_due` with `grace_period_ends_at < now()` → `suspended`.
  - `trialing` with `trial_ends_at < now()` and no active sub → `suspended`.

New UI: Settings → Billing tab. Shows current plan, next invoice, trial countdown, "Manage billing" (portal), invoice history, "Upgrade/Change plan".

## Phase 4 — Tenant management UI

- Settings → Workspace: rename tenant, slug, logo (reuses existing appearance).
- Settings → Members: list members, invite by email (edge function generates invite token → email → `/accept-invite/:token`), change role, remove.
- Tenant switcher in top bar (only if user belongs to multiple tenants).

## Phase 5 — Super-admin console

- New `/platform` route, gated by `is_platform_admin`.
- Tenants list (status, plan, MRR, signups, last login).
- Per-tenant: extend trial, suspend/reactivate, change plan, view license events, impersonate (issues a short-lived `active_tenant_id` override).
- Global metrics: active tenants, trial→paid conversion, churn, MRR.

## Phase 6 — Hardening

- Backfill test: every existing table denies cross-tenant reads (automated test).
- Edge function unit tests for webhook idempotency (`stripe_event_id` unique).
- Audit log on tenant role/billing changes.
- Update receipt VAT/business name to be per-tenant (already in `receipt_settings`, just add `tenant_id`).

---

## Technical notes

- **JWT claim**: store `active_tenant_id` in `auth.users.app_metadata` (writable only by service role / edge functions). RLS reads it via `(auth.jwt() -> 'app_metadata' ->> 'active_tenant_id')::uuid`. Fallback to single membership lookup if missing.
- **Roles**: keep the existing `app_role` (admin/manager/cashier/…) but scope it per tenant in `user_roles(user_id, tenant_id, role)`. The role-permissions matrix stays global per role.
- **License check on writes**: enforced both by RLS (`tenant_license_active`) and by edge functions, so a suspended tenant truly cannot mutate.
- **Stripe price IDs**: stored in `plans.stripe_price_id`, seeded via a one-time SQL after you create products in Stripe (or via `batch_create_product`).
- **Existing single-user assumptions**: a few hooks assume "the workshop" globally — they'll auto-scope once `tenant_id` filtering is in RLS. No code change needed in most places.
- **Realtime channels**: already use random suffixes — fine. Add tenant filter where used heavily.
- **Edge function secrets needed**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (handled by `enable_stripe_payments`).

---

## Suggested execution order

1. Phase 1 schema + RLS migration (biggest risk, do alone, verify nothing breaks).
2. Phase 2 frontend tenant context + license gate (no billing yet — trial only).
3. Phase 3 Stripe integration.
4. Phase 4 members/invites.
5. Phase 5 super-admin.
6. Phase 6 hardening.

I'd ship Phase 1+2 first so you have a working multi-tenant trial product, then layer billing on top. Each phase is a separate prompt — do not try to do all six at once.

Reply "start phase 1" (or with adjustments) and I'll begin the migration.
