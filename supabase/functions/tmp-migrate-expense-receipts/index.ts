// Temporary migration runner: adds expenses.receipt_url + storage policies.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DDL = `
alter table public.expenses add column if not exists receipt_url text;

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
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "no db url" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql.unsafe(DDL);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end();
  }
});
