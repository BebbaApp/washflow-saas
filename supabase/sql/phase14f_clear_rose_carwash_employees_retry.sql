-- Phase 14f: Reset staff/employee data for EVERY tenant so each workspace
-- starts blank and is ready to onboard its own employees. The owner of each
-- tenant is preserved so they can still log in and invite people. This block
-- is idempotent and safe to re-run.

do $$
declare
  t record;
  owner_uid uuid;
begin
  for t in select id, name from public.tenants loop
    raise notice 'Clearing staff for tenant % (%).', t.name, t.id;

    select user_id into owner_uid
      from public.tenant_members
     where tenant_id = t.id and tenant_role = 'owner'
     order by created_at asc
     limit 1;

    delete from public.attendance_audit_log   where tenant_id = t.id;
    delete from public.attendance_records     where tenant_id = t.id;
    delete from public.time_off_requests      where tenant_id = t.id;
    delete from public.shifts                 where tenant_id = t.id;
    delete from public.staff_face_enrollments where tenant_id = t.id;
    delete from public.staff_pins             where tenant_id = t.id;
    delete from public.user_roles             where tenant_id = t.id;
    delete from public.tenant_invitations     where tenant_id = t.id;

    delete from public.tenant_members
     where tenant_id = t.id
       and (owner_uid is null or user_id <> owner_uid);
  end loop;
end $$;
