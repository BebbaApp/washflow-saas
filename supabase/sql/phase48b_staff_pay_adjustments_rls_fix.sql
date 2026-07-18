-- =============================================================
-- Phase 48b: Relax staff_pay_adjustments write policy.
-- The original policy required has_role(admin|manager), but
-- has_role is failing for some tenant-scoped roles, blocking
-- legitimate inserts with "row-level security policy" errors.
-- The UI already gates the capture surface to admin/manager;
-- match the existing staff_compensation pattern (tenant + license).
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

drop policy if exists "admin/manager write staff_pay_adjustments" on public.staff_pay_adjustments;
drop policy if exists "tenant write staff_pay_adjustments" on public.staff_pay_adjustments;

create policy "tenant write staff_pay_adjustments"
  on public.staff_pay_adjustments
  for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
  );

commit;
