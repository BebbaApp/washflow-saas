-- phase28_staff_comp_busy_quiet.sql
-- Adds busy-day / quiet-day rate fields to staff_compensation.
-- Replaces the per-vehicle-category bonus model with a simpler
-- day-volume bonus that applies to salary, wage, and hourly pay types.
--
-- busy_day_rate:  amount added per worked day where >= 20 vehicles were washed
-- quiet_day_rate: amount added (or deducted, if negative) per worked day
--                 where < 10 vehicles were washed
-- Days with 10-19 vehicles are "normal" and receive no adjustment.

ALTER TABLE public.staff_compensation
  ADD COLUMN IF NOT EXISTS busy_day_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiet_day_rate numeric NOT NULL DEFAULT 0;
