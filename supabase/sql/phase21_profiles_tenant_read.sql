-- Allow tenant members to read profiles of other users in the same tenant.
-- Needed so the Workspace → Members list can render real names instead of UUIDs.

CREATE POLICY "Tenant members read peer profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tenant_members me
    JOIN public.tenant_members peer ON peer.tenant_id = me.tenant_id
    WHERE me.user_id = auth.uid()
      AND peer.user_id = profiles.user_id
  )
);
