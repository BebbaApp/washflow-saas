-- Phase 35: Create tenant_settings table and add theme columns to profiles.
-- Without these, useCurrency / useAppLogo / useTheme fire 404/400 against
-- PostgREST on every page load and the super-admin dashboard fails to refresh.

BEGIN;

-- 1) tenant_settings ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  currency_symbol text,
  currency_code text,
  vat_percent numeric,
  vat_enabled boolean DEFAULT false,
  logo_data_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read settings" ON public.tenant_settings;
CREATE POLICY "tenant members read settings"
ON public.tenant_settings
FOR SELECT TO authenticated
USING (
  public.is_tenant_member(tenant_id)
  OR public.is_platform_admin(auth.uid())
  OR public.is_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "tenant members write settings" ON public.tenant_settings;
CREATE POLICY "tenant members write settings"
ON public.tenant_settings
FOR ALL TO authenticated
USING (
  public.is_tenant_member(tenant_id)
  OR public.is_platform_admin(auth.uid())
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  public.is_tenant_member(tenant_id)
  OR public.is_platform_admin(auth.uid())
  OR public.is_super_admin(auth.uid())
);

DROP TRIGGER IF EXISTS tenant_settings_set_updated_at ON public.tenant_settings;
CREATE TRIGGER tenant_settings_set_updated_at
BEFORE UPDATE ON public.tenant_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) profiles: theme columns ------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_id text,
  ADD COLUMN IF NOT EXISTS theme_mode text;

-- Refresh PostgREST schema cache so the new table/columns are visible.
NOTIFY pgrst, 'reload schema';

COMMIT;
