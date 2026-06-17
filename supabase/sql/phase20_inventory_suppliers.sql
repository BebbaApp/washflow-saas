-- Phase 20: Inventory → Supabase, Suppliers, auto-expense on capture/restock.
-- Idempotent so it can be re-run safely.

-- ============================================================================
-- 1. suppliers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read suppliers" ON public.suppliers;
CREATE POLICY "tenant read suppliers" ON public.suppliers
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write suppliers" ON public.suppliers;
CREATE POLICY "tenant write suppliers" ON public.suppliers
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));

DROP TRIGGER IF EXISTS suppliers_set_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. inventory_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  name text NOT NULL,
  category text NOT NULL,
  subtype text,
  preset_id text,
  unit text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  threshold numeric NOT NULL DEFAULT 0,
  recommended_min numeric,
  recommended_max numeric,
  unit_cost numeric NOT NULL DEFAULT 0,
  expense_category text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read inventory_items" ON public.inventory_items;
CREATE POLICY "tenant read inventory_items" ON public.inventory_items
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write inventory_items" ON public.inventory_items;
CREATE POLICY "tenant write inventory_items" ON public.inventory_items
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));

DROP TRIGGER IF EXISTS inventory_items_set_updated_at ON public.inventory_items;
CREATE TRIGGER inventory_items_set_updated_at BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 3. inventory_transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  delta numeric NOT NULL,
  balance numeric NOT NULL,
  type text NOT NULL,        -- restock | consume | adjust
  source text NOT NULL,
  notes text,
  flow text,                  -- confirmed | auto | override | manual | undo
  unit_cost numeric,
  total_cost numeric,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_transactions_tenant_created_idx
  ON public.inventory_transactions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_transactions_item_idx
  ON public.inventory_transactions (item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_transactions TO authenticated;
GRANT ALL ON public.inventory_transactions TO service_role;

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "tenant read inventory_transactions" ON public.inventory_transactions
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write inventory_transactions" ON public.inventory_transactions;
CREATE POLICY "tenant write inventory_transactions" ON public.inventory_transactions
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));

-- ============================================================================
-- 4. inventory_category_defaults — map inventory category -> expense category
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_category_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  category text NOT NULL,
  expense_category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_category_defaults TO authenticated;
GRANT ALL ON public.inventory_category_defaults TO service_role;

ALTER TABLE public.inventory_category_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read inv_cat_defaults" ON public.inventory_category_defaults;
CREATE POLICY "tenant read inv_cat_defaults" ON public.inventory_category_defaults
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write inv_cat_defaults" ON public.inventory_category_defaults;
CREATE POLICY "tenant write inv_cat_defaults" ON public.inventory_category_defaults
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));

-- ============================================================================
-- 5. Realtime
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_category_defaults;
