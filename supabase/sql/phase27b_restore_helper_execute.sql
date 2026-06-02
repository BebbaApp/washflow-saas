-- Phase 27b: Restore EXECUTE on SECURITY DEFINER helpers.
-- Phase 27 revoked EXECUTE from authenticated on helpers like
-- current_tenant_id(), is_tenant_member(), tenant_has_role(),
-- tenant_license_active(), is_platform_admin(), is_super_admin(),
-- has_role(), has_membership(), get_user_role(). Those functions are
-- referenced inside RLS policies and must be callable by the querying
-- role; otherwise every tenant-scoped read returns zero rows and the
-- app shows "No workspace found". Restore the grants.

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.tenant_has_role(uuid, tenant_role) to authenticated;
grant execute on function public.tenant_license_active(uuid) to authenticated;
grant execute on function public.is_platform_admin(uuid) to authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;
grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.has_membership(uuid, uuid) to authenticated;
grant execute on function public.get_user_role(uuid) to authenticated;
