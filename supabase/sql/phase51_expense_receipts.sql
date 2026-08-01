-- =============================================================
-- Phase 51: Optional receipt attachment on expenses.
-- Adds expenses.receipt_url (storage path in the private
-- `expense-receipts` bucket) and tenant-scoped storage policies.
-- Idempotent — safe to re-run.
-- =============================================================
begin;

alter table public.expenses add column if not exists receipt_url text;

-- Storage policies: files live at `<tenant_id>/<expense_id>-<ts>.<ext>`
drop policy if exists "tenant read expense receipts" on storage.objects;
create policy "tenant read expense receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (
      (storage.foldername(name))[1] = public.current_tenant_id()::text
      or public.is_platform_admin(auth.uid())
    )
  );

drop policy if exists "tenant upload expense receipts" on storage.objects;
create policy "tenant upload expense receipts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists "tenant update expense receipts" on storage.objects;
create policy "tenant update expense receipts" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
  with check (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists "tenant delete expense receipts" on storage.objects;
create policy "tenant delete expense receipts" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expense-receipts'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

commit;
