-- =============================================================
-- Phase 15: Move expense + inventory categories to platform-global,
-- and add a global product_types catalog (managed in the Platform Console).
--
-- Design:
--   * `tenant_id` becomes nullable on expense_categories and inventory_categories.
--     NULL = global (managed by platform admins, visible to every tenant).
--     non-NULL = tenant-specific (legacy / opt-in custom).
--   * RLS is widened so every authenticated user can READ global rows.
--     Only platform admins can write global rows.
--   * `product_types` is a fully-global catalog seeded with the previously
--     hard-coded INVENTORY_PRESETS list. Same pattern as global categories.
--
-- Idempotent.
-- =============================================================
begin;

-- ---------- Categories: allow global (NULL tenant_id) ----------

alter table public.expense_categories
  alter column tenant_id drop not null,
  alter column tenant_id drop default;

alter table public.inventory_categories
  alter column tenant_id drop not null,
  alter column tenant_id drop default;

-- Replace read policies so global rows are visible everywhere.
drop policy if exists "tenant read expense_categories" on public.expense_categories;
create policy "tenant read expense_categories"
on public.expense_categories for select
to authenticated
using (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));

drop policy if exists "tenant read inventory_categories" on public.inventory_categories;
create policy "tenant read inventory_categories"
on public.inventory_categories for select
to authenticated
using (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));

-- Replace write policies: platform admins manage global rows; tenants still
-- manage their own (when tenant_id is set).
drop policy if exists "tenant write expense_categories" on public.expense_categories;
create policy "tenant write expense_categories"
on public.expense_categories for all
to authenticated
using (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
)
with check (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
);

drop policy if exists "tenant write inventory_categories" on public.inventory_categories;
create policy "tenant write inventory_categories"
on public.inventory_categories for all
to authenticated
using (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
)
with check (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
);

-- Allow a unique global-name index (separate from per-tenant uniqueness).
create unique index if not exists expense_categories_global_name_uidx
  on public.expense_categories (lower(name), coalesce(parent_id::text, ''))
  where tenant_id is null;

create unique index if not exists inventory_categories_global_name_uidx
  on public.inventory_categories (lower(name))
  where tenant_id is null;

-- ---------- Product types (global catalog) ----------

create table if not exists public.product_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  unit text not null,
  recommended_min numeric(12,3) not null default 0,
  recommended_max numeric(12,3) not null default 0,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists product_types_name_uidx
  on public.product_types (lower(name));

grant select on public.product_types to authenticated;
grant all    on public.product_types to service_role;

alter table public.product_types enable row level security;

drop policy if exists "everyone reads product_types" on public.product_types;
create policy "everyone reads product_types"
on public.product_types for select
to authenticated
using (true);

drop policy if exists "platform admins write product_types" on public.product_types;
create policy "platform admins write product_types"
on public.product_types for all
to authenticated
using (public.is_platform_admin(auth.uid()))
with check (public.is_platform_admin(auth.uid()));

-- Seed with the previously hard-coded inventory presets. Idempotent via name uniqueness.
insert into public.product_types (name, category, unit, recommended_min, recommended_max, description, sort_order) values
  ('Car Wash Shampoo / Soap',        'Soap',      'L',   25, 50,  'High-foam wash shampoo', 10),
  ('Tyre Shine / Gloss',             'Chemicals', 'L',   25, 50,  null,                     20),
  ('Dash & Trim Cleaner',            'Chemicals', 'L',    5, 10,  null,                     30),
  ('Window / Glass Cleaner',         'Chemicals', 'L',    5, 10,  null,                     40),
  ('Engine Cleaner / Degreaser',     'Chemicals', 'L',    5, 20,  null,                     50),
  ('Carpet / Upholstery Cleaner',    'Chemicals', 'L',    5, 10,  null,                     60),
  ('Car Wax / Sealant',              'Wax',       'L',    5, 20,  null,                     70),
  ('Microfiber Towels / Drying Cloths','Towels',  'pcs', 50, 100, 'High-quality, varied colors for different jobs', 80),
  ('Wash Mitts / Sponges',           'Tools',     'pcs', 10, 15,  null,                     90),
  ('Buckets (with grit guards)',     'Tools',     'pcs',  5, 10,  null,                    100),
  ('Brushes (Rim & Carpet)',         'Tools',     'pcs',  5, 10,  'Assorted types',        110)
on conflict do nothing;

-- Seed the default inventory categories globally (Soap, Wax, Towels, Chemicals, Tools, Other)
-- so every new tenant starts with a sensible default list.
insert into public.inventory_categories (tenant_id, name, sort_order)
select null, n, ord
from (values ('Soap',10),('Wax',20),('Towels',30),('Chemicals',40),('Tools',50),('Other',60)) as v(n,ord)
where not exists (
  select 1 from public.inventory_categories ic
  where ic.tenant_id is null and lower(ic.name) = lower(v.n)
);

commit;
