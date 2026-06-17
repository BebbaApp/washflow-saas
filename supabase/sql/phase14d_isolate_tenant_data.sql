-- Phase 14d: Tenant data isolation
--
-- Previously, SELECT policies on operational tenant-scoped tables included
-- `OR is_platform_admin(auth.uid())`. That meant a platform/super admin saw
-- EVERY tenant's rows merged together in the regular app UI, so switching to a
-- freshly-created tenant (e.g. "Rose Car Wash") still showed data from other
-- tenants (e.g. "Kwabhaca Car Wash").
--
-- Fix: scope SELECT to `tenant_id = current_tenant_id()` only. Platform admins
-- still see any tenant by switching tenant (JWT claim drives current_tenant_id),
-- and cross-tenant Platform Console queries use the service role via edge
-- functions (which bypass RLS), so console screens still work.

-- Helper: rebuild SELECT policy to strict tenant scope
do $$
declare
  t text;
  tables text[] := array[
    'orders','customers','expenses','expense_categories','inventory_categories',
    'loyalty_transactions','services','shifts','shift_templates',
    'staff_face_enrollments','staff_pins','attendance_records',
    'attendance_audit_log','time_off_requests','user_roles','receipt_settings'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists "tenant read %1$s" on public.%1$s', t);
    execute format(
      'create policy "tenant read %1$s" on public.%1$s for select using (tenant_id = public.current_tenant_id())',
      t
    );
  end loop;
end $$;
