
CREATE TABLE public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  duration TEXT NOT NULL DEFAULT '',
  features TEXT[] NOT NULL DEFAULT '{}',
  popular BOOLEAN NOT NULL DEFAULT false,
  vat_exempt BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read services"
ON public.services FOR SELECT
TO public
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role)
  OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY "Admins/managers can insert services"
ON public.services FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Admins/managers can update services"
ON public.services FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Admins/managers can delete services"
ON public.services FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER update_services_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.services (name, price, duration, features, popular, sort_order) VALUES
  ('Basic Wash', 15, '15 min', ARRAY['Exterior wash','Rinse & dry','Tire cleaning'], false, 1),
  ('Premium Wash', 35, '30 min', ARRAY['Exterior wash','Interior vacuum','Dashboard wipe','Tire shine','Air freshener'], true, 2),
  ('Full Detail', 75, '60 min', ARRAY['Full exterior wash & wax','Complete interior detail','Leather conditioning','Engine bay clean','Ceramic coat option'], false, 3);
