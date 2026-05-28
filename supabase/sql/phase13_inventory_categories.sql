-- =============================================================
-- Phase 13: Tenant-scoped inventory categories (managed in console)
-- Mirrors phase 9/12 expense_categories. Idempotent.
-- =============================================================
begin;

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_categories_tenant_name_uidx
  on public.inventory_categories (tenant_id, lower(name));

grant select, insert, update, delete on public.inventory_categories to authenticated;
grant all on public.inventory_categories to service_role;

alter table public.inventory_categories enable row level security;

drop policy if exists "tenant read inventory_categories" on public.inventory_categories;
create policy "tenant read inventory_categories"
on public.inventory_categories for select
using (tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));

drop policy if exists "tenant write inventory_categories" on public.inventory_categories;
create policy "tenant write inventory_categories"
on public.inventory_categories for all
using (
  (tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
)
with check (
  (tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
);

commit;
