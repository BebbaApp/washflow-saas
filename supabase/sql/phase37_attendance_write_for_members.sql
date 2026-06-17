-- Phase 37: Allow attendance writes by tenant members and platform/super admins
-- regardless of whether the JWT carries an active_tenant_id claim.
--
-- Symptom: a super admin / platform admin (or any user with multiple
-- memberships and no active_tenant_id claim) could pass face verification but
-- the subsequent INSERT into attendance_records was rejected by RLS because
-- the previous WITH CHECK required `tenant_id = current_tenant_id()` and
-- `current_tenant_id()` returned NULL. Result: check-in (or check-out) silently
-- failed even though the camera captured a verified selfie.
--
-- Fix: keep the read scoping from phase36, but widen the write policy on
-- attendance_records and attendance_audit_log so it accepts any of:
--   (a) tenant_id matches the JWT-derived current tenant, OR
--   (b) the caller is a member of the row's tenant, OR
--   (c) the caller is a platform/super admin.
-- License must still be active in all cases.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['attendance_records','attendance_audit_log'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant write %1$s" ON public.%1$s', t);
    EXECUTE format($f$
      CREATE POLICY "tenant write %1$s" ON public.%1$s
      FOR ALL
      USING (
        public.tenant_license_active(tenant_id)
        AND (
          tenant_id = public.current_tenant_id()
          OR public.has_membership(tenant_id, auth.uid())
          OR public.is_platform_admin(auth.uid())
          OR public.is_super_admin(auth.uid())
        )
      )
      WITH CHECK (
        public.tenant_license_active(tenant_id)
        AND (
          tenant_id = public.current_tenant_id()
          OR public.has_membership(tenant_id, auth.uid())
          OR public.is_platform_admin(auth.uid())
          OR public.is_super_admin(auth.uid())
        )
      )
    $f$, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
