-- =============================================================
-- Phase 12: Expense subcategories + plan feature toggles.
-- Adds parent_id to expense_categories (self-reference) so categories
-- can be nested one level (parent = category, child = subcategory),
-- and a subcategory column on expenses for capture.
-- Plan feature toggles use the existing plans.features jsonb column.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

alter table public.expense_categories
  add column if not exists parent_id uuid
    references public.expense_categories(id) on delete cascade;

create index if not exists expense_categories_parent_idx
  on public.expense_categories (tenant_id, parent_id, sort_order);

alter table public.expenses
  add column if not exists subcategory text;

create index if not exists expenses_tenant_subcategory_idx
  on public.expenses (tenant_id, subcategory);

commit;
