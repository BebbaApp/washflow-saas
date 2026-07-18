## Goal

Let Admin/Manager log **advances** (money paid to a worker early) and **penalties** (charges/fines) against a staff member from the Attendance/Staff page, then have those amounts auto-deduct from the calculated pay in the Employee Expense dialog for whichever weeks are ticked. Once the payout expense is submitted, the deducted adjustments are marked settled and disappear from future payouts.

## Data model

New table `staff_pay_adjustments`:

- `id uuid pk`
- `tenant_id uuid` (default `current_tenant_id()`)
- `worker_id uuid` — the staff member (user_id)
- `kind text` — `'advance' | 'penalty'`
- `amount numeric(12,2)` — always positive; deduction direction is implied by `kind` (both reduce net pay)
- `date date` — the date it applies to (drives which week it belongs to)
- `reason text`
- `status text` — `'pending' | 'settled'` (default `pending`)
- `settled_at timestamptz null`, `settled_by uuid null`, `settled_expense_id uuid null` (link back to the expense that consumed it)
- `created_by uuid`, `created_at`, `updated_at`

RLS + grants:
- `SELECT/INSERT/UPDATE/DELETE` for `authenticated` scoped to `tenant_id = current_tenant_id()`.
- Write policy additionally gated to Admin/Manager via `has_role`.
- `GRANT`s to `authenticated` and `service_role`; add to `MIRRORED_TABLES` in `src/offline/db.ts` so it syncs offline like other tables and add to the realtime publication.

## Capture UI (Attendance page)

On each staff row on `AttendancePage.tsx`, add an "Adjustments" action (Admin/Manager only) that opens a small dialog:

- List of existing pending adjustments for that worker (kind, date, amount, reason, delete).
- Form to add a new one: kind (Advance / Penalty), amount, date (default today), reason.
- Writes go through the existing `offlineInsert`/`offlineUpdate`/`offlineDelete` helpers so the change is offline-safe.

## Consume in Employee Expense dialog

In `EmployeeExpenseDialog.tsx`:

1. Load pending adjustments for the selected worker via `useLiveTable('staff_pay_adjustments')`.
2. Filter to adjustments whose `date` falls inside the currently ticked calendar weeks (same week-key logic already used for `selectedWorkedDays`).
3. Show a new "Adjustments" section under the per-day breakdown listing each included advance/penalty with date, reason, and signed amount.
4. Compute:
   - `advancesTotal` = sum of `advance` amounts in scope
   - `penaltiesTotal` = sum of `penalty` amounts in scope
   - `netAmount = baseAmount + workBonus - advancesTotal - penaltiesTotal`
5. Show a summary block: Base, Bonus, − Advances, − Penalties, **Net Payable**.
6. On submit:
   - Record the expense using `netAmount` (unchanged flow otherwise) and include the breakdown in the expense `notes` so it's auditable.
   - Mark each included adjustment `status='settled'`, `settled_at=now()`, `settled_by=auth.uid()`, `settled_expense_id=<new expense id>` via `offlineUpdate`.
   - Settled rows are excluded from future dialog opens (query filters `status='pending'`).

Weeks that aren't ticked leave their adjustments untouched — they remain pending and will appear next time those weeks are selected, matching the current week-checkbox behaviour.

## Permissions

- Attendance-page "Adjustments" button visible only when `has_role('admin')` or `has_role('manager')` (client check) — backed by RLS write policy on the table.
- Deletion of an already-settled adjustment is blocked in UI; admins can still edit via the same dialog only while `status='pending'`.

## Files

- New migration `supabase/sql/phase48_staff_pay_adjustments.sql` — table, grants, RLS, realtime publication.
- `src/offline/db.ts` — add `staff_pay_adjustments` to `MIRRORED_TABLES` and Dexie schema (version bump).
- New `src/components/StaffAdjustmentsDialog.tsx` — capture UI.
- `src/components/AttendancePage.tsx` — wire the new dialog button per staff row (Admin/Manager only).
- `src/components/EmployeeExpenseDialog.tsx` — load, filter by selected weeks, display, deduct from total, settle on submit.

## Out of scope

- No reporting page for historical adjustments in this pass (settled rows are still queryable but not surfaced beyond the expense's notes). Can add later if you want a dedicated history view.
