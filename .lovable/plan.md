# Installable PWA + Offline-First with Sync

Make Washflow installable on Windows / Android / iOS, and have it work fully offline with automatic background sync against Supabase across all tenant data.

This is a sizable build. I'll ship it in phases so you can use each milestone immediately and we can validate before moving on.

---

## Phase 1 — Installable PWA (Windows / Android / iOS)

Goal: users can install the app to the desktop / home screen, with proper icons and splash.

- Add `public/manifest.webmanifest` with `name`, `short_name`, `display: "standalone"`, `theme_color`, `background_color`, `start_url: "/"`, `scope: "/"`.
- Generate icon set (192, 512, maskable 512, apple-touch-icon 180) into `public/icons/`.
- Update `index.html` head: `<link rel="manifest">`, `<link rel="apple-touch-icon">`, theme-color (already present), `apple-mobile-web-app-title`.
- Add `vite-plugin-pwa` with `generateSW`, `registerType: "autoUpdate"`, `injectRegister: null`, `devOptions.enabled: false`.
- Single guarded registration wrapper (`src/pwa/register.ts`) that refuses to register in dev, iframe, Lovable preview hosts (`*.lovableproject.com`, `*.lovableproject-dev.com`, `*.beta.lovable.dev`), or when `?sw=off`. Unregisters stale `/sw.js` in those contexts.
- Workbox config: `NetworkFirst` for HTML navigations, `CacheFirst` for same-origin hashed assets, exclude `/~oauth` from navigation fallback.

Outcome: install button on Chrome/Edge (Windows + Android), "Add to Home Screen" on iOS Safari. App shell loads offline.

---

## Phase 2 — Local data mirror (IndexedDB)

Goal: every screen reads from a local DB first, so the app is instant and works offline.

- Add **Dexie** (`dexie`, `dexie-react-hooks`) as the local store.
- Schema (`src/offline/db.ts`) mirrors tenant tables: `orders`, `customers`, `services`, `expenses`, `expense_categories`, `inventory_items`, `inventory_transactions`, `inventory_categories`, `product_types`, `suppliers`, `shifts`, `shift_templates`, `time_off_requests`, `staff_pins`, `staff_face_enrollments`, `attendance_records`, `loyalty_transactions`, `receipt_settings`, `role_permissions`, `user_roles`, `tenant_members`, `tenants`. Each row stores `tenant_id`, `updated_at`, and a local `_dirty` / `_op` flag.
- Indexes per table on `[tenant_id+updated_at]` and primary key `id` for fast queries.
- Add a `useLiveTable(tenantId, table, filter?)` hook returning live Dexie results via `useLiveQuery`.

---

## Phase 3 — Sync engine

Goal: keep local DB in sync with Supabase in both directions; queue writes when offline.

- `src/offline/sync.ts` engine with three loops:
  1. **Initial pull** per tenant on login/switch: paginated `select * where tenant_id=? order by updated_at` into Dexie.
  2. **Realtime pull**: subscribe to `postgres_changes` per table (we already enable realtime in `phase19_enable_realtime_all.sql`); upsert into Dexie on INSERT/UPDATE, delete on DELETE.
  3. **Push queue**: an `outbox` table records local mutations `{table, op, payload, baseUpdatedAt, attempts}`. A worker drains it when `navigator.onLine`, applying INSERT/UPDATE/DELETE via Supabase. On 409/constraint errors it surfaces a conflict toast and keeps the row for review.
- Conflict policy: **server-wins for reads, last-write-wins for pushes** (Supabase `updated_at` decides). Hard conflicts (constraint, RLS denial) get flagged in a small "Sync issues" panel under Settings.
- Connection state hook `useOnline()` + a status pill in the header ("Online", "Offline — N pending").

---

## Phase 4 — Refactor hooks to offline-first

Rewrite the data hooks to read from Dexie and write through the outbox instead of calling Supabase directly:

- `useOrders`, `useCustomers`, `useServices`, `useExpenses`, `useExpenseCategories`, `useInventory`, `useInventoryCategories`, `useProductTypes`, `useSuppliers`, `useScheduling` (shifts/templates/time off), `useAttendance`, `useLoyalty`, `useWorkers` (staff_pins / face enrollments), `useReceiptSettings`, `useAppLogo`.
- Each hook keeps the same external API so components don't change.
- Edge-function-only operations (face verification, invite-member, pin-login, Stripe) stay online-only and show a clear "requires internet" message when offline.

---

## Phase 5 — Edge cases & polish

- Login while offline: cache last session + tenant; allow read-only browsing of last-synced data; block writes that require server validation (e.g. face check-in) with explanatory toast.
- Tenant switch invalidates the local cache scope and pulls the new tenant's data.
- Storage quota guard: prune oldest `attendance_records` and `inventory_transactions` beyond 90 days locally (server keeps full history).
- "Force resync" button in Settings → Sync.
- Sync issues review panel.
- Replace the existing "Live updates are unavailable" toast with the new connection-status pill (kept as fallback).

---

## Technical notes

- **Stack additions**: `vite-plugin-pwa`, `workbox-window`, `dexie`, `dexie-react-hooks`.
- **No DB schema changes required** — every table already has `tenant_id` + `updated_at` and realtime is enabled.
- **RLS unchanged** — sync uses the user's session, so all reads/writes remain tenant-scoped.
- **Service worker scope**: app shell only. Supabase API calls bypass the SW (they go to a different origin) so auth and realtime are unaffected.
- **iOS caveats**: realtime websockets pause when the PWA is backgrounded; sync resumes on focus via a `visibilitychange` listener.
- **Preview safety**: SW never registers inside the Lovable editor preview; you'll only see install/offline behavior on the published `.lovable.app` URL or your custom domain.

---

## Suggested rollout

I'd ship and verify **Phase 1** first (installable, no behavior change), then **Phase 2 + 3** together (mirror + sync running in the background, hooks still hit Supabase), then **Phase 4** table-by-table starting with Orders. Phase 5 last.

Reply with **"go"** to start with Phase 1, or tell me to bundle more phases into the first pass.
