-- Fix: "permission denied for function current_tenant_id"
-- RLS policies on orders (and many other tables) call public.current_tenant_id(),
-- but authenticated/anon roles lack EXECUTE on it, so every query fails 401.
-- Grant EXECUTE on the tenant/role helper functions used inside RLS.

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_membership(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_has_role(uuid, public.tenant_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_license_active(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_order_number() TO authenticated;
