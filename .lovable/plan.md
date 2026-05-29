# Inventory → Supabase + Expenses + Suppliers

## 1. Database (new migration)

New tables (all tenant-scoped, RLS + GRANTs):

- `inventory_items` — id, tenant_id, name, category, subtype, preset_id, unit, quantity, threshold, recommended_min, recommended_max, **unit_cost** (numeric), **expense_category** (text, nullable — overrides category default), **supplier_id** (uuid, nullable), created_at, updated_at.
- `inventory_transactions` — id, tenant_id, item_id, item_name, delta, balance, type (`restock|consume|adjust`), source, notes, flow, **unit_cost** (snapshot), **total_cost** (snapshot), **expense_id** (nullable FK to expenses), created_at.
- `suppliers` — id, tenant_id, name, contact_name, phone, email, address, notes, created_at, updated_at.
- `inventory_category_defaults` — id, tenant_id, category (text), expense_category (text). Lets admins say "all 'Chemicals' default to expense category 'Supplies'".

Keep existing localStorage-only state for recipes / vehicle map / processed sets (out of scope — those stay local for now).

## 2. Auto-expense logic

When an item is **added with quantity > 0** OR **stock is adjusted up** (restock):
- `total = unit_cost × delta`
- Resolve expense category: item.expense_category → category default → fallback `"Supplies"`.
- Insert row into `expenses` (description = `Restock: <item name> (<qty> <unit>)`, vendor = supplier name if any).
- Store the new `expense_id` on the transaction row.

Consumption/downward adjustments do NOT create expenses.

## 3. Reorder button

On each inventory row + details modal: **Reorder** button → opens a small dialog prefilled with last restock's qty, unit cost, and supplier. User can tweak qty / new unit cost / supplier, confirm → applies positive stock delta + creates expense (path above) + updates item's `unit_cost` and `supplier_id` to the new values.

## 4. Suppliers UI

- New `useSuppliers` hook (Supabase + realtime).
- Inventory add/edit form: supplier dropdown (+ "New supplier" inline).
- Settings → Workspace tab: new **Suppliers** section directly below Members. CRUD list (name, contact, phone, email).

## 5. Members display fix

Settings → Workspace → Members currently shows UUIDs. Join `tenant_members` with `profiles` (already in `useWorkers` rewrite) and render `profile.name || email` instead of `user_id`.

## 6. Rewrite `useInventory`

Replace the entire localStorage singleton with Supabase-backed hook + realtime subscription on `inventory_items` and `inventory_transactions`. Keep the same public API (`items`, `addItem`, `updateItem`, `adjustStock`, `confirmConsumption`, `consumeForWash`, etc.) so InventoryPage and CompleteWashDialog don't break. Recipes/vehicle-map/water-item stay in localStorage for this pass.

## Files touched

- `supabase/sql/phase20_inventory_suppliers.sql` (new migration via tool)
- `src/hooks/useInventory.ts` (full rewrite, same API surface)
- `src/hooks/useSuppliers.ts` (new)
- `src/hooks/useInventoryCategoryDefaults.ts` (new)
- `src/components/InventoryPage.tsx` (add unit cost, supplier, reorder button, expense-category override field)
- `src/components/InventoryItemDetailsModal.tsx` (show supplier, unit cost, reorder)
- `src/components/ReorderDialog.tsx` (new)
- `src/components/SettingsPage.tsx` (Suppliers section under Members; members render by profile name)

## Out of scope (this pass)

- Recipes, vehicle mappings, water item, idempotency sets — remain localStorage.
- Migrating existing localStorage inventory data — users start fresh in Supabase (will note this in chat).
