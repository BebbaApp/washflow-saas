-- Auto-assign a default staff role ('washer') the first time a user's email
-- is confirmed, so newly verified users can sign in without manual setup.
CREATE OR REPLACE FUNCTION public.assign_default_role_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND (OLD.email_confirmed_at IS NULL OR OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'washer'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_role_on_confirm();

-- Backfill: any already-confirmed users without a role get the default.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'washer'::app_role
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE u.email_confirmed_at IS NOT NULL
  AND r.id IS NULL
ON CONFLICT (user_id, role) DO NOTHING;
