-- The offline mirror's incremental pull orders/filters by `updated_at`, so any
-- row with a NULL updated_at is never synced to the client. Old completed and
-- cancelled orders predate the auto-touch trigger, leaving those tabs empty in
-- the Wash Queue even though the rows still exist in Postgres.
--
-- 1. Make sure `updated_at` exists and defaults to now() on insert.
-- 2. Attach the shared touch trigger so future updates bump it.
-- 3. Backfill historical NULLs from created_at (or now() as a last resort).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_orders_touch_updated_at ON public.orders;
CREATE TRIGGER trg_orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

UPDATE public.orders
   SET updated_at = COALESCE(updated_at, created_at, now())
 WHERE updated_at IS NULL;

-- Same safety net for the other mirrored tables that already have an
-- updated_at column but may still hold NULLs from older inserts. Some tables
-- (e.g. role_permissions) don't carry created_at, so fall back to now().
DO $$
DECLARE
  t text;
  has_created boolean;
  tables text[] := ARRAY[
    'services','customers','expenses','expense_categories',
    'inventory_items','suppliers','loyalty_transactions',
    'shifts','shift_templates','time_off_requests','staff_pins',
    'role_permissions','user_roles','tenant_members','tenants','product_types'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='updated_at'
    ) THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=t AND column_name='created_at'
      ) INTO has_created;
      IF has_created THEN
        EXECUTE format(
          'UPDATE public.%I SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL',
          t
        );
      ELSE
        EXECUTE format(
          'UPDATE public.%I SET updated_at = now() WHERE updated_at IS NULL',
          t
        );
      END IF;
    END IF;
  END LOOP;
END $$;
