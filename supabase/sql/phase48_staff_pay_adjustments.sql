-- =============================================================
-- Phase 48: Staff pay adjustments (advances & penalties).
-- Admin/Manager capture ad-hoc advances or penalty charges per
-- worker; the Employee Expense dialog deducts pending rows for
-- the payout period and marks them settled.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

create table if not exists public.staff_pay_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  worker_id uuid not null,
  kind text not null check (kind in ('advance','penalty')),
  amount numeric(12,2) not null check (amount > 0),
  date date not null default (now() at time zone 'utc')::date,
  reason text,
  status text not null default 'pending' check (status in ('pending','settled')),
  settled_at timestamptz,
  settled_by uuid,
  settled_expense_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_pay_adjustments_tenant_worker_idx
  on public.staff_pay_adjustments (tenant_id, worker_id, date desc);
create index if not exists staff_pay_adjustments_status_idx
  on public.staff_pay_adjustments (tenant_id, status);

-- Grants (RLS still enforces row scoping)
grant select, insert, update, delete on public.staff_pay_adjustments to authenticated;
grant all on public.staff_pay_adjustments to service_role;

alter table public.staff_pay_adjustments enable row level security;

drop policy if exists "tenant read staff_pay_adjustments" on public.staff_pay_adjustments;
create policy "tenant read staff_pay_adjustments" on public.staff_pay_adjustments
  for select using (
    tenant_id = public.current_tenant_id()
    or public.is_platform_admin(auth.uid())
  );

-- Only admin or manager may write.
drop policy if exists "admin/manager write staff_pay_adjustments" on public.staff_pay_adjustments;
create policy "admin/manager write staff_pay_adjustments" on public.staff_pay_adjustments
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager'))
  );

-- updated_at trigger (reuses the shared helper)
drop trigger if exists trg_staff_pay_adjustments_updated_at on public.staff_pay_adjustments;
create trigger trg_staff_pay_adjustments_updated_at
  before update on public.staff_pay_adjustments
  for each row execute function public.update_updated_at_column();

-- Enable realtime so the offline mirror picks up changes instantly.
do $$ begin
  alter publication supabase_realtime add table public.staff_pay_adjustments;
exception when duplicate_object then null; end $$;

commit;
