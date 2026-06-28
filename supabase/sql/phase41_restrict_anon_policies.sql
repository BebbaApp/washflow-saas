-- Phase 41: Restrict tenant-scoped RLS policies to the `authenticated` role.
--
-- The scanner flagged several SELECT policies (and one ALL policy on
-- attendance_audit_log) that applied to the implicit `public` role, which
-- includes the anon Supabase key. This migration rebuilds those policies
-- scoped to `authenticated` only, preserving the existing tenant_id checks.
--
-- Idempotent.

do $$
declare
  t text;
  read_tables text[] := array[
    'expenses','expense_categories',
    'inventory_items','inventory_transactions','inventory_categories','inventory_vehicle_map',
    'loyalty_transactions','services','shifts','shift_templates',
    'staff_active_status','suppliers','tenant_settings','time_off_requests','user_roles'
  ];
begin
  foreach t in array read_tables loop
    execute format('drop policy if exists "tenant read %1$s" on public.%1$s', t);
    execute format(
      'create policy "tenant read %1$s" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()))',
      t
    );
  end loop;
end $$;

-- attendance_audit_log: tighten the overly permissive ALL policy.
drop policy if exists "tenant write attendance_audit_log" on public.attendance_audit_log;
create policy "tenant write attendance_audit_log"
  on public.attendance_audit_log
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id))
  with check (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));
