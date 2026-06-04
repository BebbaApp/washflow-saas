-- phase28_staff_busy_quiet_rates.sql
-- Replace per-vehicle-category bonuses with two simple bonuses:
--   busy_day_rate  -- added per day where >= 20 vehicles were washed (tenant-wide)
--   quiet_day_rate -- added per day where < 10 vehicles were washed (tenant-wide)
-- Applies on top of salary/wage/hourly base remuneration.

ALTER TABLE public.staff_compensation
  ADD COLUMN IF NOT EXISTS busy_day_rate  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiet_day_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE public.staff_compensation
  DROP COLUMN IF EXISTS category_rates;
