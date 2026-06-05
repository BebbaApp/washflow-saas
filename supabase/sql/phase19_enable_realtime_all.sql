-- Enable Supabase realtime broadcasts for every user-facing tenant table so
-- changes from the dashboard propagate live to settings inputs and vice versa.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'services',
    'orders',
    'customers',
    'expenses',
    'expense_categories',
    'inventory_categories',
    'product_types',
    'loyalty_transactions',
    'shifts',
    'shift_templates',
    'time_off_requests',
    'staff_pins',
    'staff_face_enrollments',
    'attendance_records',
    'attendance_audit_log',
    'receipt_settings',
    'role_permissions',
    'user_roles',
    'tenant_members',
    'tenant_invitations',
    'tenants',
    'plans',
    'subscriptions',
    'invoices',
    'license_events',
    'platform_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
