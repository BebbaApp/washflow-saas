-- =============================================================
-- Phase 7: Platform console settings (singleton row).
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

create table if not exists public.platform_settings (
  id boolean primary key default true,
  currency text not null default 'USD',
  vat_rate numeric not null default 0,
  company_name text not null default 'Platform',
  contact_email text not null default '',
  contact_phone text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_settings_singleton check (id = true)
);

insert into public.platform_settings (id) values (true)
  on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "platform admins read settings" on public.platform_settings;
create policy "platform admins read settings" on public.platform_settings
  for select using (public.is_platform_admin(auth.uid()));

drop policy if exists "platform admins write settings" on public.platform_settings;
create policy "platform admins write settings" on public.platform_settings
  for update using (public.is_platform_admin(auth.uid()))
            with check (public.is_platform_admin(auth.uid()));

commit;
