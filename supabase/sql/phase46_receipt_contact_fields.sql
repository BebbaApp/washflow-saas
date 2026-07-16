-- Adds contact fields to receipt_settings so shops can print phone,
-- email, and physical address on every receipt.

ALTER TABLE public.receipt_settings
  ADD COLUMN IF NOT EXISTS phone   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
