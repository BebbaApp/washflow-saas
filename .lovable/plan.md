
# Owner Portal (Multi-Workspace Dashboard)

A new top-level area for users who own/administer more than one car wash workspace. It aggregates data across all tenants they belong to, lets them manage cross-workspace staff, switch into any workspace, and compare businesses side-by-side.

## Scope

Visible only to users whose `tenant_members.tenant_role` is `owner` (or `admin`) in **2+ tenants**, plus super/platform admins. Single-tenant users see nothing new.

## New Route & Entry Points

- Route: `/owner` (rendered by a new `OwnerPortal` page).
- Entry point in `TenantSwitcher` dropdown: a "Owner overview" item at the top when the user qualifies.
- Also linked from `UserMenu` for discoverability.

## Sections (tabs inside `/owner`)

1. **Overview** — grid of workspace cards. Each card shows: name, plan/status badge, today's revenue, today's cars washed, active workers on shift, month-to-date revenue, month-to-date expenses, water/inventory alerts count. Click card → `switchTenant(id)` then navigate to that tenant's dashboard.
2. **Compare** — pick 2–N workspaces + date range + metric set (Revenue, Expenses, Net, Cars washed, Avg wait, Completion rate, Top service). Renders side-by-side table + bar/line charts (recharts, already used in `ReportsDashboard`). Export CSV.
3. **Global Staff** — list all members across all owned tenants, grouped by user (one row per person, columns = tenants with their role). Filter by role (manager/supervisor/cashier/etc.). Actions: change role in a specific tenant, remove from a tenant, invite same person into another tenant (reuses `invite-member` edge function). Only affects tenants where the current user is owner/admin.
4. **Consolidated Reports** — combined P&L across selected workspaces (sum revenue − sum expenses), workforce totals, and an "attention" panel (past-due licenses, expiring trials, low inventory).

## Data Layer

New edge function `owner-overview` (service-role) that:
- Verifies caller via `getClaims`.
- Loads tenants where caller is `owner`/`admin` from `tenant_members` (super-admins get all).
- For each tenant, in parallel, returns aggregates:
  - `orders`: count, sum(service_price), avg wait, completed count — filtered by date range.
  - `expenses`: sum(amount) by date range.
  - `tenant_members`: count of active workers, by role.
  - `staff_active_status`: currently on-shift count.
  - `inventory_items`: count where `current_stock < reorder_point`.
  - `tenants`: plan, status, trial_ends_at, grace_period_ends_at.
- Returns `{ tenants: [...], range }`.

New edge function `owner-staff` for cross-tenant member ops:
- `list`: joins `tenant_members` + `profiles` across caller's owned tenants.
- `update_role`, `remove`, `invite` — each re-verifies caller is owner/admin of the target tenant before mutating.

No schema changes required (all data already exists). No new tables.

## Frontend Files

- `src/pages/OwnerPortal.tsx` — page shell + tab router.
- `src/hooks/useOwnerScope.ts` — derives `ownedTenants` from `useTenant().memberships` and exposes `isOwnerOfMultiple`.
- `src/hooks/useOwnerOverview.ts` — react-query wrapper around `owner-overview`.
- `src/components/owner/OwnerOverviewGrid.tsx`
- `src/components/owner/OwnerCompareReports.tsx`
- `src/components/owner/OwnerGlobalStaff.tsx`
- `src/components/owner/OwnerConsolidatedReports.tsx`
- Update `src/App.tsx` (add `/owner` route).
- Update `src/components/TenantSwitcher.tsx` (add "Owner overview" entry when `isOwnerOfMultiple`).
- Update `src/components/UserMenu.tsx` (link).

## Access Control

- Client hides the route/entry when the user doesn't qualify.
- Edge functions enforce it server-side by re-checking `tenant_members.tenant_role IN ('owner','admin')` per tenant on every call — no reliance on client filtering.
- All mutations go through the edge function; no direct client writes cross-tenant.

## Out of Scope (for this iteration)

- No new billing/plan roll-up screen (existing `BillingSection` per tenant remains).
- No new "global role" concept in the DB — ownership is still per-tenant, the portal just aggregates.
- No editing of tenant settings from `/owner` beyond staff role/remove/invite.

## Open Questions

1. Should the portal be available to **admins** of multiple tenants, or strictly **owners**? (Plan currently says both — say if you want owner-only.)
2. For "Compare", which default date range — Today, This week, This month? (Plan defaults to This month with a picker.)
3. Should we also let owners **create a new workspace** from `/owner`, or keep that in Platform console only?
