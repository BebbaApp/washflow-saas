-- Phase 30: Fix RLS on staff_face_enrollments so platform/super admins and
-- tenant members can enroll faces even when JWT active_tenant_id is missing.
-- Mirrors the phase29 fix used for staff_compensation.

drop policy if exists "tenant read staff_face_enrollments" on public.staff_face_enrollments;
drop policy if exists "tenant write staff_face_enrollments" on public.staff_face_enrollments;

-- Read: any member of the tenant, or a platform admin.
create policy "tenant read staff_face_enrollments"
on public.staff_face_enrollments
for select
to authenticated
using (
  public.is_tenant_member(tenant_id)
  or public.is_platform_admin(auth.uid())
);

-- Insert: member of the tenant (or platform admin) with an active license.
create policy "tenant insert staff_face_enrollments"
on public.staff_face_enrollments
for insert
to authenticated
with check (
  (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()))
  and public.tenant_license_active(tenant_id)
);

-- Update: same scope.
create policy "tenant update staff_face_enrollments"
on public.staff_face_enrollments
for update
to authenticated
using (
  public.is_tenant_member(tenant_id)
  or public.is_platform_admin(auth.uid())
)
with check (
  (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()))
  and public.tenant_license_active(tenant_id)
);

-- Delete: same scope.
create policy "tenant delete staff_face_enrollments"
on public.staff_face_enrollments
for delete
to authenticated
using (
  public.is_tenant_member(tenant_id)
  or public.is_platform_admin(auth.uid())
);

-- Ensure tenant_id is auto-filled from JWT when caller is a tenant member
-- (already the default from phase1, but re-assert in case it was dropped).
alter table public.staff_face_enrollments
  alter column tenant_id set default public.current_tenant_id();
