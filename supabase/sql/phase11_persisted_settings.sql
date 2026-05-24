-- Run this once in Supabase SQL Editor to enable DB-backed settings persistence.

-- Tenant-wide settings (currency, vat, logo)
create table if not exists public.tenant_settings (
  tenant_id uuid primary key,
  currency_symbol text not null default 'R',
  currency_code text not null default 'ZAR',
  vat_percent numeric not null default 15,
  vat_enabled boolean not null default false,
  logo_data_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.tenant_settings enable row level security;

drop policy if exists "members read tenant_settings" on public.tenant_settings;
create policy "members read tenant_settings"
on public.tenant_settings for select
using (is_tenant_member(tenant_id) or is_platform_admin(auth.uid()));

drop policy if exists "admins insert tenant_settings" on public.tenant_settings;
create policy "admins insert tenant_settings"
on public.tenant_settings for insert
with check (
  tenant_has_role(tenant_id, 'owner'::tenant_role)
  or tenant_has_role(tenant_id, 'admin'::tenant_role)
  or is_platform_admin(auth.uid())
);

drop policy if exists "admins update tenant_settings" on public.tenant_settings;
create policy "admins update tenant_settings"
on public.tenant_settings for update
using (
  tenant_has_role(tenant_id, 'owner'::tenant_role)
  or tenant_has_role(tenant_id, 'admin'::tenant_role)
  or is_platform_admin(auth.uid())
)
with check (
  tenant_has_role(tenant_id, 'owner'::tenant_role)
  or tenant_has_role(tenant_id, 'admin'::tenant_role)
  or is_platform_admin(auth.uid())
);

drop trigger if exists trg_tenant_settings_updated_at on public.tenant_settings;
create trigger trg_tenant_settings_updated_at
before update on public.tenant_settings
for each row execute function public.update_updated_at_column();

-- Seed for existing tenants
insert into public.tenant_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

-- Auto-seed on new tenant creation
create or replace function public.seed_tenant_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_settings (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_tenant_settings on public.tenants;
create trigger trg_seed_tenant_settings
after insert on public.tenants
for each row execute function public.seed_tenant_settings();

-- Per-user theme preferences on profiles
alter table public.profiles
  add column if not exists theme_id text not null default 'aqua',
  add column if not exists theme_mode text not null default 'light';
