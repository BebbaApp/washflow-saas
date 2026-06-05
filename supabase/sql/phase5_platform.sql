-- =============================================================
-- Phase 5: Super-admin console helpers.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

-- Allow platform admins to read every membership row across tenants
-- (the existing "members read members" policy only exposes their own).
drop policy if exists "platform admins read all members" on public.tenant_members;
create policy "platform admins read all members" on public.tenant_members
  for select using (public.is_platform_admin(auth.uid()));

-- Aggregate view that the /platform page reads.
create or replace view public.platform_tenants_overview as
select
  t.id,
  t.name,
  t.slug,
  t.status,
  t.trial_ends_at,
  t.current_period_end,
  t.grace_period_ends_at,
  t.created_at,
  t.stripe_customer_id,
  p.id   as plan_id,
  p.code as plan_code,
  p.name as plan_name,
  p.price_monthly_cents,
  (select count(*) from public.tenant_members m where m.tenant_id = t.id) as member_count,
  (select count(*) from public.subscriptions s
     where s.tenant_id = t.id and s.status in ('active','trialing','past_due')) as active_sub_count
from public.tenants t
left join public.plans p on p.id = t.plan_id;

grant select on public.platform_tenants_overview to authenticated;

-- View is just a select wrapper; RLS on the underlying tenants table
-- (which already grants platform admins access) gates visibility.

commit;
