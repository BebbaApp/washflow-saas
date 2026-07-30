// TEMPORARY maintenance function: ensures global (tenant_id IS NULL) expense &
// inventory categories are readable by every authenticated tenant member.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) return new Response(JSON.stringify({ error: "no db url" }), { status: 500, headers: cors });
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const before = await sql`
      select polname, pg_get_expr(polqual, polrelid) as qual
      from pg_policy where polrelid = 'public.expense_categories'::regclass`;
    const counts = await sql`
      select coalesce(tenant_id::text,'GLOBAL') as scope, count(*)::int as n
      from public.expense_categories group by 1`;

    await sql.unsafe(`
      alter table public.expense_categories alter column tenant_id drop not null;
      alter table public.expense_categories alter column tenant_id drop default;
      grant select, insert, update, delete on public.expense_categories to authenticated;
      grant all on public.expense_categories to service_role;
      drop policy if exists "tenant read expense_categories" on public.expense_categories;
      create policy "tenant read expense_categories"
        on public.expense_categories for select to authenticated
        using (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));
      drop policy if exists "tenant write expense_categories" on public.expense_categories;
      create policy "tenant write expense_categories"
        on public.expense_categories for all to authenticated
        using (
          (tenant_id is null and public.is_platform_admin(auth.uid()))
          or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
          or public.is_platform_admin(auth.uid())
        )
        with check (
          (tenant_id is null and public.is_platform_admin(auth.uid()))
          or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
          or public.is_platform_admin(auth.uid())
        );
    `);

    const after = await sql`
      select polname, pg_get_expr(polqual, polrelid) as qual
      from pg_policy where polrelid = 'public.expense_categories'::regclass`;

    return new Response(JSON.stringify({ before, counts, after }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  } finally {
    await sql.end();
  }
});
