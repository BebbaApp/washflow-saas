-- Phase 14f: Retry of the Rose Car Wash cleanup. The previous phase14e
-- migration was reported as not having taken effect — Andre Mazombe Umba and
-- other Kwabhaca staff are still surfacing in Rose Car Wash's Attendance page.
-- This pass is intentionally written as an idempotent block so it can be
-- re-run safely, and it strips ALL non-owner membership/role rows from every
-- tenant whose name matches "Rose Car Wash" (in case duplicates exist).

do $$
declare
  rose record;
  owner_uid uuid;
begin
  for rose in
    select id, name
      from public.tenants
     where lower(name) like 'rose car wash%'
        or slug like 'rose-car-wash%'
  loop
    raise notice 'Clearing staff for tenant % (%).', rose.name, rose.id;

    select user_id into owner_uid
      from public.tenant_members
     where tenant_id = rose.id and tenant_role = 'owner'
     order by created_at asc
     limit 1;

    delete from public.attendance_audit_log   where tenant_id = rose.id;
    delete from public.attendance_records     where tenant_id = rose.id;
    delete from public.time_off_requests      where tenant_id = rose.id;
    delete from public.shifts                 where tenant_id = rose.id;
    delete from public.staff_face_enrollments where tenant_id = rose.id;
    delete from public.staff_pins             where tenant_id = rose.id;
    delete from public.user_roles             where tenant_id = rose.id;
    delete from public.tenant_invitations     where tenant_id = rose.id;

    delete from public.tenant_members
     where tenant_id = rose.id
       and (owner_uid is null or user_id <> owner_uid);
  end loop;
end $$;
