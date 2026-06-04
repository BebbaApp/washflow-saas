-- Ensure only postfastbiz@gmail.com is a super admin.
DELETE FROM public.super_admins
WHERE user_id NOT IN (SELECT id FROM auth.users WHERE email = 'postfastbiz@gmail.com');

INSERT INTO public.super_admins (user_id)
SELECT id FROM auth.users WHERE email = 'postfastbiz@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
