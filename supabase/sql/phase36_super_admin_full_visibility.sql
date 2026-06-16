-- Phase 36: Super-admin / platform-admin full visibility on tenant tables.
--
-- phase14d scoped SELECT to `tenant_id = current_tenant_id()` only, which
-- accidentally hid all tenant rows from super admins (they often have no
-- active_tenant_id claim yet, so current_tenant_id() returns NULL).
--
-- Restore the platform/super admin override on SELECT so a super admin
-- always sees every tenant's data regardless of the JWT claim, while regular
-- tenant members remain scoped to their own tenant.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'orders','customers','expenses','expense_categories','inventory_categories',
    'inventory_items','inventory_transactions','inventory_vehicle_map',
    'loyalty_transactions','services','shifts','shift_templates',
    'staff_face_enrollments','staff_pins','attendance_records',
    'attendance_audit_log','time_off_requests','user_roles','receipt_settings',
    'staff_active_status','staff_compensation','suppliers','tenant_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant read %1$s" ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY "tenant read %1$s" ON public.%1$s FOR SELECT USING (
         tenant_id = public.current_tenant_id()
         OR public.is_platform_admin(auth.uid())
         OR public.is_super_admin(auth.uid())
       )', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
