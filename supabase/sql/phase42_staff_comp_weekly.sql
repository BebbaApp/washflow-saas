-- phase42_staff_comp_weekly.sql
-- Replace the 'hourly' pay type with 'weekly' (flat weekly wage, like salary
-- but paid per week). Existing 'hourly' rows are migrated to 'weekly' and
-- keep their base_rate value.

UPDATE public.staff_compensation SET pay_type = 'weekly' WHERE pay_type = 'hourly';

ALTER TABLE public.staff_compensation DROP CONSTRAINT IF EXISTS staff_compensation_pay_type_check;
ALTER TABLE public.staff_compensation
  ADD CONSTRAINT staff_compensation_pay_type_check
  CHECK (pay_type IN ('salary','wage','weekly'));
