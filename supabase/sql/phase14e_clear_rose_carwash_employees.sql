-- Clear all employee/staff data for the "Rose Car Wash" tenant so the new
-- workspace starts blank for onboarding. Keeps the owner membership intact.

do $$
declare
  rose_id uuid;
  owner_uid uuid;
begin
  select id into rose_id from public.tenants
   where lower(name) like 'rose car wash%' or slug like 'rose-car-wash%'
   order by created_at desc limit 1;

  if rose_id is null then
    raise notice 'Rose Car Wash tenant not found — nothing to clear.';
    return;
  end if;

  -- Preserve the owner so the super admin / owner can still access the workspace.
  select user_id into owner_uid from public.tenant_members
   where tenant_id = rose_id and tenant_role = 'owner'
   order by created_at asc limit 1;

  delete from public.attendance_audit_log where tenant_id = rose_id;
  delete from public.attendance_records   where tenant_id = rose_id;
  delete from public.time_off_requests    where tenant_id = rose_id;
  delete from public.shifts               where tenant_id = rose_id;
  delete from public.staff_face_enrollments where tenant_id = rose_id;
  delete from public.staff_pins           where tenant_id = rose_id;
  delete from public.user_roles           where tenant_id = rose_id;

  delete from public.tenant_invitations   where tenant_id = rose_id;

  -- Remove every member except the owner (so new employees can be onboarded).
  delete from public.tenant_members
   where tenant_id = rose_id
     and (owner_uid is null or user_id <> owner_uid);
end $$;
