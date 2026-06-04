-- =============================================================
-- Phase 8: Migrate expenses from localStorage to Supabase.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  category text not null,
  vendor text,
  notes text,
  date timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists expenses_tenant_date_idx on public.expenses (tenant_id, date desc);

alter table public.expenses enable row level security;

drop policy if exists "tenant read expenses" on public.expenses;
create policy "tenant read expenses" on public.expenses
  for select using (
    (tenant_id = public.current_tenant_id())
    or public.is_platform_admin(auth.uid())
  );

drop policy if exists "tenant write expenses" on public.expenses;
create policy "tenant write expenses" on public.expenses
  for all
  using ((tenant_id = public.current_tenant_id()) and public.tenant_license_active(tenant_id))
  with check ((tenant_id = public.current_tenant_id()) and public.tenant_license_active(tenant_id));

commit;
