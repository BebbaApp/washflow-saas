-- Super admins: a tier above platform_admins. Bypasses plan-feature gating
-- entirely. Platform admins (without super) are now subject to whatever plan
-- the tenant they're viewing is on.

CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.super_admins TO authenticated;
GRANT ALL ON public.super_admins TO service_role;

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage" ON public.super_admins;
CREATE POLICY "super admins manage"
ON public.super_admins
FOR ALL
USING (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.super_admins s WHERE s.user_id = auth.uid()));

-- Each user may also read their own row (so the app can detect super status).
DROP POLICY IF EXISTS "self read super_admins" ON public.super_admins;
CREATE POLICY "self read super_admins"
ON public.super_admins
FOR SELECT
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.super_admins WHERE user_id = _uid) $$;

-- Seed: elevate postfastbiz@gmail.com to super admin.
INSERT INTO public.super_admins (user_id)
SELECT id FROM auth.users WHERE email = 'postfastbiz@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Also ensure they're a platform admin (so cross-tenant switch + console still work).
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'postfastbiz@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
