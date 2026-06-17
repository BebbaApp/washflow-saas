-- Run this once in the Supabase SQL editor (or via `supabase db push`)
-- Creates a singleton table that stores the thermal-receipt content.

CREATE TABLE IF NOT EXISTS public.receipt_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE,
  business_name  TEXT NOT NULL DEFAULT 'AquaWash',
  business_line2 TEXT NOT NULL DEFAULT 'Premium Car Wash',
  footer         TEXT NOT NULL DEFAULT 'Thank you for your business!',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT receipt_settings_singleton CHECK (id = TRUE)
);

INSERT INTO public.receipt_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.receipt_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read receipt settings" ON public.receipt_settings;
CREATE POLICY "Authenticated can read receipt settings"
  ON public.receipt_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins/managers can update receipt settings" ON public.receipt_settings;
CREATE POLICY "Admins/managers can update receipt settings"
  ON public.receipt_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "Admins/managers can insert receipt settings" ON public.receipt_settings;
CREATE POLICY "Admins/managers can insert receipt settings"
  ON public.receipt_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Realtime: broadcast changes to all connected clients
ALTER TABLE public.receipt_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'receipt_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_settings';
  END IF;
END $$;
