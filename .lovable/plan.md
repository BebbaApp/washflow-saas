## Goal
Only admins and managers can authorize a discount on a wash order. A cashier/washer/driver/supervisor entering a discount must either (a) get inline PIN authorization from a manager/admin on the same screen, or (b) submit the order at full price with a "discount requested" flag showing their name. Admins/managers can also approve the pending discount later from the order card before completion. If the order completes without approval, it is recorded at full amount.

## Changes

### 1. New permission
`src/lib/permissions.ts`
- Add `queue.approveDiscount` ("Authorize Discount") to the "Wash Queue" group.
- Default: admin + manager = true; supervisor/cashier/washer/driver = false.

### 2. Data model
Migration `phase47_orders_pending_discount.sql`
- `ALTER TABLE public.orders ADD COLUMN pending_discount jsonb NULL` — stores `{ amount, requested_by_id, requested_by_name, requested_at }`. Existing grants cover the new column.

`src/hooks/useOrders.ts`
- Extend `WashOrder` with `pendingDiscount?: { amount; requestedById; requestedByName; requestedAt }`.
- `mapRow` reads `row.pending_discount`.
- `addOrder` accepts `pendingDiscount?`; when set, stores full base `service_price` with `discount = 0` and `pending_discount = {...}`.
- New `approveDiscount(orderId)`: moves `pending_discount.amount` into `discount`, subtracts from `service_price`, clears `pending_discount`.
- New `rejectDiscount(orderId)`: clears `pending_discount`.
- `updateStatus`: when completing, if `pending_discount` still set, clear it (record stays at full amount).

### 3. Inline PIN gate (same screen)
New edge function `supabase/functions/verify-authorizer-pin/index.ts`
- Reuses the same hashing/lookup logic as `pin-login` but does NOT mint a session.
- Input: `{ identifier, pin, requiredRoles: ["admin","manager"] }`.
- Output: `{ ok: true, user: { id, name, role } }` on success, 401 otherwise.
- Uses service role to read `staff_pins` + `user_roles` + `profiles` and confirm the PIN owner has one of the required roles in the caller's tenant.

New component `src/components/DiscountAuthorizeDialog.tsx`
- Small modal launched from the "Override" button in `NewOrderDialog`.
- Fields: identifier (phone or email) + 4–6 digit PIN.
- Calls `verify-authorizer-pin` with `requiredRoles: ["admin","manager"]`.
- On success, returns the authorizing user (id/name/role) to the parent — no session change, current cashier stays logged in.

### 4. New Order dialog
`src/components/NewOrderDialog.tsx`
- Import `usePermissions`, `useAuth`, and the new `DiscountAuthorizeDialog`.
- Compute `canAuthorize = can("queue.approveDiscount")`.
- Next to the Discount input, render an "Override" button:
  - Hidden if `canAuthorize` (their discount already applies immediately).
  - Otherwise visible; disabled until `discount > 0`.
  - Clicking opens `DiscountAuthorizeDialog`. On success, store `authorizedBy = { id, name, role }` in local state and show a green "Authorized by {name}" chip; discount will now apply immediately on submit.
- Submit behaviour:
  - `canAuthorize` or `authorizedBy` set → submit with discount applied (current behaviour), pass `authorizedBy` through so we can record it in notes/audit (optional; minimal version just applies).
  - Discount > 0 and no authorization → submit with `pendingDiscount: { amount, requestedById: user.id, requestedByName: user.name, requestedAt: now }`, servicePrice = full base, discount = 0.

### 5. Wash queue card + details
`src/components/WashQueue.tsx`
- On rows/cards with `order.pendingDiscount`, show a warning chip: "Discount requested by {name} — {amount}".

`src/components/OrderDetailsModal.tsx`
- When `pendingDiscount` is set and status is not `completed`/`cancelled`:
  - Banner in the price block: "Discount requested by {name}: −{amount}. Final would be {computedFinal}."
  - If current viewer `can("queue.approveDiscount")` → "Approve discount" and "Reject" buttons wired to `approveDiscount` / `rejectDiscount`.
  - Otherwise, offer an "Authorize with manager PIN" button that opens the same `DiscountAuthorizeDialog`; on success, immediately calls `approveDiscount(orderId)`. This lets a cashier get inline approval on the card too.

### 6. Wiring
`src/pages/Index.tsx` — pass new `approveDiscount`/`rejectDiscount` from `useOrders` down through `WashQueue` to `OrderDetailsModal`. Widen `NewOrderDialog` `onSubmit` to include `pendingDiscount?`.

## Out of scope
- Auditing every authorization event to a dedicated table (we rely on the notes/pending_discount trail). Can be added later.
- Server-side RLS enforcement of the "only admin/manager can set discount" rule — the PIN verification is server-side, but the final `orders` update runs as the cashier. If you want DB-enforced authorization, add a trigger that rejects `discount > 0` writes from non-privileged roles unless a signed authorizer token is attached; flagged but not included.

## Technical notes
- The PIN verification endpoint never mints a session, so the cashier remains signed in throughout the flow.
- `pending_discount` is nullable JSON so offline writes and existing rows stay valid; approve/reject use the same offline outbox path as `updateStatus`.
- `DiscountAuthorizeDialog` is reused in both the New Order dialog and the Order Details modal, keeping one PIN UX.
