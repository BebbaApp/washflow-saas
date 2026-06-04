-- Phase 9: per-tenant expense categories
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists expense_categories_tenant_name_uidx
  on public.expense_categories (tenant_id, lower(name));

alter table public.expense_categories enable row level security;

drop policy if exists "tenant read expense_categories" on public.expense_categories;
create policy "tenant read expense_categories"
on public.expense_categories for select
using (tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));

drop policy if exists "tenant write expense_categories" on public.expense_categories;
create policy "tenant write expense_categories"
on public.expense_categories for all
using (
  (tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
)
with check (
  (tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
);
