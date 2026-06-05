-- Keep global admins from being shown or reassigned as tenant workers.
CREATE OR REPLACE FUNCTION public.assign_default_role_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_tenant uuid;
  is_global_admin boolean;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  THEN
    SELECT EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = NEW.id)
        OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = NEW.id)
        OR lower(COALESCE(NEW.email, '')) = 'postfastbiz@gmail.com'
    INTO is_global_admin;

    IF is_global_admin THEN
      RETURN NEW;
    END IF;

    BEGIN
      target_tenant := COALESCE(
        NULLIF(NEW.raw_app_meta_data->>'active_tenant_id', '')::uuid,
        NULLIF(NEW.raw_app_meta_data->>'invited_to_tenant', '')::uuid
      );
    EXCEPTION WHEN others THEN
      target_tenant := NULL;
    END;

    IF target_tenant IS NULL THEN
      SELECT tm.tenant_id
      INTO target_tenant
      FROM public.tenant_members tm
      WHERE tm.user_id = NEW.id
      ORDER BY tm.created_at ASC
      LIMIT 1;
    END IF;

    IF target_tenant IS NOT NULL THEN
      BEGIN
        INSERT INTO public.user_roles (user_id, tenant_id, role)
        SELECT NEW.id, target_tenant, 'washer'::public.app_role
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = NEW.id
            AND ur.tenant_id = target_tenant
        )
        ON CONFLICT (user_id, role) DO NOTHING;
      EXCEPTION WHEN others THEN
        RAISE WARNING 'Skipping default role assignment for confirmed user %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DELETE FROM public.user_roles ur
USING auth.users au
WHERE ur.user_id = au.id
  AND ur.role = 'washer'::public.app_role
  AND (
    EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.user_id = ur.user_id)
    OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = ur.user_id)
    OR lower(COALESCE(au.email, '')) = 'postfastbiz@gmail.com'
  );