// Super-admin console backend. All actions require the caller to be in
// public.platform_admins. Uses service role for cross-tenant operations.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_tenants") }),
  z.object({ action: z.literal("list_users"), tenant_id: z.string().uuid().optional() }),
  z.object({ action: z.literal("set_tenant_status"),
    tenant_id: z.string().uuid(),
    status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]) }),
  z.object({ action: z.literal("extend_trial"),
    tenant_id: z.string().uuid(), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("change_plan"),
    tenant_id: z.string().uuid(), plan_id: z.string().uuid() }),
  z.object({ action: z.literal("impersonate_tenant"),
    tenant_id: z.string().uuid() }),
  z.object({ action: z.literal("grant_platform_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("revoke_platform_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("grant_super_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("revoke_super_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("add_tenant_member"),
    tenant_id: z.string().uuid(),
    user_id: z.string().uuid(),
    tenant_role: z.enum(["owner", "admin", "member"]).default("member") }),
  z.object({ action: z.literal("remove_tenant_member"),
    tenant_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ action: z.literal("update_tenant"),
    tenant_id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).optional() }),
  z.object({ action: z.literal("create_tenant"),
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
    plan_id: z.string().uuid().optional(),
    trial_days: z.number().int().min(0).max(365).optional() }),
  z.object({ action: z.literal("get_platform_settings") }),
  z.object({ action: z.literal("update_platform_settings"),
    currency: z.string().min(1).max(8).optional(),
    vat_rate: z.number().min(0).max(100).optional(),
    company_name: z.string().max(200).optional(),
    contact_email: z.string().max(200).optional(),
    contact_phone: z.string().max(50).optional(),
    address: z.string().max(500).optional() }),
  z.object({ action: z.literal("platform_overview"),
    from: z.string().optional(),
    to: z.string().optional(),
    tenant_id: z.string().uuid().optional() }),
  z.object({ action: z.literal("list_plans") }),
  z.object({ action: z.literal("upsert_plan"),
    id: z.string().uuid().optional(),
    code: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/),
    name: z.string().min(1).max(120),
    price_monthly_cents: z.number().int().min(0),
    max_users: z.number().int().min(0).nullable().optional(),
    features: z.record(z.any()).optional(),
    stripe_price_id: z.string().max(120).nullable().optional() }),
  z.object({ action: z.literal("delete_plan"), id: z.string().uuid() }),
  z.object({ action: z.literal("clear_tenant_staff"), tenant_id: z.string().uuid() }),
  z.object({ action: z.literal("delete_tenant"), tenant_id: z.string().uuid(), confirm_slug: z.string().min(1) }),
  z.object({ action: z.literal("invite_user_to_tenant"),
    tenant_id: z.string().uuid(),
    email: z.string().email(),
    tenant_role: z.enum(["owner", "admin", "member"]).default("member"),
    redirect_to: z.string().url().optional() }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      console.error("getClaims failed", claimsErr);
      return json({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;
    const callerEmail = (claimsData.claims.email as string | undefined) ?? "";
    const isBootstrapSuperAdmin = callerEmail.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;

    const admin = createClient(supabaseUrl, serviceKey);

    if (isBootstrapSuperAdmin) {
      await Promise.all([
        admin.from("super_admins").upsert({ user_id: callerId }),
        admin.from("platform_admins").upsert({ user_id: callerId }),
      ]);
    }

    const { data: isSuperRow } = await admin
      .from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle();
    const isSuper = !!isSuperRow || isBootstrapSuperAdmin;
    if (!isSuper) return json({ error: "Forbidden: super admin only" }, 403);

    const parsed = ActionSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;

    switch (body.action) {
      case "list_tenants": {
        const { data, error } = await admin
          .from("platform_tenants_overview")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ tenants: data });
      }

      case "list_users": {
        const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (error) return json({ error: error.message }, 500);
        const ids = list.users.map((u) => u.id);
        const [{ data: profiles }, { data: members }, { data: padmins }, { data: sadmins }] = await Promise.all([
          admin.from("profiles").select("user_id,name").in("user_id", ids),
          admin.from("tenant_members").select("user_id,tenant_id,tenant_role").in("user_id", ids),
          admin.from("platform_admins").select("user_id").in("user_id", ids),
          admin.from("super_admins").select("user_id").in("user_id", ids),
        ]);
        const nameMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.name]));
        const padminSet = new Set((padmins ?? []).map((p: any) => p.user_id));
        const sadminSet = new Set((sadmins ?? []).map((p: any) => p.user_id));
        const memberMap = new Map<string, Array<{ tenant_id: string; tenant_role: string }>>();
        (members ?? []).forEach((m: any) => {
          const arr = memberMap.get(m.user_id) ?? [];
          arr.push({ tenant_id: m.tenant_id, tenant_role: m.tenant_role });
          memberMap.set(m.user_id, arr);
        });
        let users = list.users.map((u) => ({
          id: u.id,
          email: u.email ?? "",
          name: nameMap.get(u.id) ?? (u.user_metadata?.name as string) ?? "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          is_platform_admin: padminSet.has(u.id),
          is_super_admin: sadminSet.has(u.id),
          memberships: memberMap.get(u.id) ?? [],
        }));
        if (body.tenant_id) {
          users = users.filter((u) => u.memberships.some((m) => m.tenant_id === body.tenant_id));
        }
        return json({ users });
      }

      case "set_tenant_status": {
        const patch: Record<string, unknown> = { status: body.status };
        if (body.status === "past_due") {
          patch.grace_period_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
        }
        const { error } = await admin.from("tenants").update(patch).eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.status_changed",
          payload: { by: callerId, status: body.status },
        });
        return json({ ok: true });
      }

      case "extend_trial": {
        const { data: t } = await admin.from("tenants")
          .select("trial_ends_at").eq("id", body.tenant_id).single();
        const base = t?.trial_ends_at ? new Date(t.trial_ends_at) : new Date();
        const next = new Date(Math.max(base.getTime(), Date.now()) + body.days * 86_400_000);
        const { error } = await admin.from("tenants")
          .update({ trial_ends_at: next.toISOString(), status: "trialing" })
          .eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.trial_extended",
          payload: { by: callerId, days: body.days, until: next.toISOString() },
        });
        return json({ ok: true, trial_ends_at: next.toISOString() });
      }

      case "change_plan": {
        const { error } = await admin.from("tenants")
          .update({ plan_id: body.plan_id }).eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.plan_changed",
          payload: { by: callerId, plan_id: body.plan_id },
        });
        return json({ ok: true });
      }

      case "impersonate_tenant": {
        // Write the active_tenant_id claim for the calling platform admin
        // so RLS lets them browse the workspace as if they were a member.
        const { data: u } = await admin.auth.admin.getUserById(callerId);
        const newAppMeta = { ...(u?.user?.app_metadata ?? {}), active_tenant_id: body.tenant_id };
        const { error } = await admin.auth.admin.updateUserById(callerId, { app_metadata: newAppMeta });
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.impersonate",
          payload: { by: callerId },
        });
        return json({ ok: true });
      }

      case "grant_platform_admin": {
        const { error } = await admin.from("platform_admins")
          .insert({ user_id: body.user_id });
        if (error && (error as any).code !== "23505") return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "revoke_platform_admin": {
        if (body.user_id === callerId) return json({ error: "Cannot revoke yourself" }, 400);
        const { error } = await admin.from("platform_admins")
          .delete().eq("user_id", body.user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "grant_super_admin": {
        const { error: e1 } = await admin.from("super_admins")
          .insert({ user_id: body.user_id });
        if (e1 && (e1 as any).code !== "23505") return json({ error: e1.message }, 500);
        // Super admins should also be platform admins so they can reach the console.
        const { error: e2 } = await admin.from("platform_admins")
          .insert({ user_id: body.user_id });
        if (e2 && (e2 as any).code !== "23505") return json({ error: e2.message }, 500);
        return json({ ok: true });
      }

      case "revoke_super_admin": {
        if (body.user_id === callerId) return json({ error: "Cannot revoke yourself" }, 400);
        const { error } = await admin.from("super_admins")
          .delete().eq("user_id", body.user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "add_tenant_member": {
        const { error } = await admin.from("tenant_members")
          .upsert({ tenant_id: body.tenant_id, user_id: body.user_id, tenant_role: body.tenant_role });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "remove_tenant_member": {
        const { error } = await admin.from("tenant_members")
          .delete().eq("tenant_id", body.tenant_id).eq("user_id", body.user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "update_tenant": {
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.slug !== undefined) patch.slug = body.slug;
        if (Object.keys(patch).length === 0) return json({ ok: true });
        const { error } = await admin.from("tenants").update(patch).eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.tenant_updated",
          payload: { by: callerId, ...patch },
        });
        return json({ ok: true });
      }

      case "create_tenant": {
        const trialDays = body.trial_days ?? 30;
        const trialEnds = new Date(Date.now() + trialDays * 86_400_000).toISOString();
        const { data: created, error } = await admin.from("tenants").insert({
          name: body.name,
          slug: body.slug,
          plan_id: body.plan_id ?? null,
          status: "trialing",
          trial_ends_at: trialEnds,
        }).select("id, slug, name").single();
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: created.id, kind: "platform.tenant_created",
          payload: { by: callerId, name: body.name, slug: body.slug },
        });
        return json({ ok: true, tenant: created });
      }


      case "get_platform_settings": {
        const { data, error } = await admin.from("platform_settings")
          .select("*").eq("id", true).maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({ settings: data });
      }

      case "update_platform_settings": {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: callerId };
        for (const k of ["currency","vat_rate","company_name","contact_email","contact_phone","address"] as const) {
          if ((body as any)[k] !== undefined) patch[k] = (body as any)[k];
        }
        const { error } = await admin.from("platform_settings").update(patch).eq("id", true);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "platform_overview": {
        const from = body.from ? new Date(body.from).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString();
        const to = body.to ? new Date(body.to).toISOString() : new Date().toISOString();

        let ordersQ = admin.from("orders")
          .select("id, tenant_id, service, service_price, status, created_at, completed_at")
          .gte("created_at", from).lte("created_at", to).limit(10000);
        if (body.tenant_id) ordersQ = ordersQ.eq("tenant_id", body.tenant_id);
        const { data: orders, error: ordersErr } = await ordersQ;
        if (ordersErr) return json({ error: ordersErr.message }, 500);

        let expensesQ = admin.from("expenses")
          .select("tenant_id, amount, category, date")
          .gte("date", from).lte("date", to).limit(10000);
        if (body.tenant_id) expensesQ = expensesQ.eq("tenant_id", body.tenant_id);

        const [{ count: memberCount }, { count: tenantCount }, { data: invoices }, { data: expenses }] = await Promise.all([
          admin.from("tenant_members").select("*", { count: "exact", head: true }),
          admin.from("tenants").select("*", { count: "exact", head: true }),
          admin.from("invoices").select("tenant_id, amount_cents, currency, status, paid_at, created_at")
            .gte("created_at", from).lte("created_at", to).limit(10000),
          expensesQ,
        ]);

        const rows = (orders ?? []) as Array<any>;
        const completed = rows.filter((r) => r.status === "completed");
        const revenue = completed.reduce((s, r) => s + Number(r.service_price ?? 0), 0);
        const serviceMap = new Map<string, { count: number; revenue: number }>();
        for (const r of completed) {
          const k = r.service ?? "Unknown";
          const cur = serviceMap.get(k) ?? { count: 0, revenue: 0 };
          cur.count += 1;
          cur.revenue += Number(r.service_price ?? 0);
          serviceMap.set(k, cur);
        }
        const topServices = Array.from(serviceMap.entries())
          .map(([service, v]) => ({ service, ...v }))
          .sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        const invoiceRows = (invoices ?? []) as Array<any>;
        const invoicePaid = invoiceRows.filter((i) => i.status === "paid")
          .reduce((s, i) => s + Number(i.amount_cents ?? 0), 0) / 100;

        const expenseRows = (expenses ?? []) as Array<any>;
        const totalExpenses = expenseRows.reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const expensesByCat = new Map<string, number>();
        for (const e of expenseRows) {
          const k = e.category ?? "Other";
          expensesByCat.set(k, (expensesByCat.get(k) ?? 0) + Number(e.amount ?? 0));
        }
        const expense_categories = Array.from(expensesByCat.entries())
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount);

        // Daily revenue + expenses series
        const dayMap = new Map<string, { revenue: number; expenses: number }>();
        for (const r of completed) {
          const d = (r.completed_at ?? r.created_at).slice(0, 10);
          const cur = dayMap.get(d) ?? { revenue: 0, expenses: 0 };
          cur.revenue += Number(r.service_price ?? 0);
          dayMap.set(d, cur);
        }
        for (const e of expenseRows) {
          const d = (e.date ?? "").slice(0, 10);
          if (!d) continue;
          const cur = dayMap.get(d) ?? { revenue: 0, expenses: 0 };
          cur.expenses += Number(e.amount ?? 0);
          dayMap.set(d, cur);
        }
        const series = Array.from(dayMap.entries()).sort(([a],[b]) => a < b ? -1 : 1)
          .map(([date, v]) => ({ date, ...v }));

        return json({
          range: { from, to },
          totals: {
            orders: rows.length,
            completed_orders: completed.length,
            revenue,
            invoice_revenue: invoicePaid,
            expenses: totalExpenses,
            net_profit: revenue - totalExpenses,
            tenants: tenantCount ?? 0,
            employees: memberCount ?? 0,
          },
          top_services: topServices,
          expense_categories,
          series,
        });
      }

      case "list_plans": {
        const { data, error } = await admin.from("plans")
          .select("id, code, name, price_monthly_cents, max_users, features, stripe_price_id, created_at")
          .order("price_monthly_cents", { ascending: true });
        if (error) return json({ error: error.message }, 500);
        return json({ plans: data });
      }

      case "upsert_plan": {
        const payload: Record<string, unknown> = {
          code: body.code,
          name: body.name,
          price_monthly_cents: body.price_monthly_cents,
        };
        if (body.max_users !== undefined) payload.max_users = body.max_users;
        if (body.features !== undefined) payload.features = body.features;
        if (body.stripe_price_id !== undefined) payload.stripe_price_id = body.stripe_price_id;
        if (body.id) {
          const { error } = await admin.from("plans").update(payload).eq("id", body.id);
          if (error) return json({ error: error.message }, 500);
          return json({ ok: true, id: body.id });
        } else {
          const { data, error } = await admin.from("plans").insert(payload).select("id").single();
          if (error) return json({ error: error.message }, 500);
          return json({ ok: true, id: data?.id });
        }
      }

      case "delete_plan": {
        const { count } = await admin.from("tenants")
          .select("id", { count: "exact", head: true }).eq("plan_id", body.id);
        if ((count ?? 0) > 0) {
          return json({ error: `Plan is in use by ${count} tenant(s)` }, 400);
        }
        const { error } = await admin.from("plans").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "clear_tenant_staff": {
        const t = body.tenant_id;
        // Preserve the owner so the workspace remains accessible.
        const { data: ownerRow } = await admin.from("tenant_members")
          .select("user_id").eq("tenant_id", t).eq("tenant_role", "owner")
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        const ownerId = (ownerRow as any)?.user_id ?? null;

        const tables = [
          "attendance_audit_log","attendance_records","time_off_requests",
          "shifts","staff_face_enrollments","staff_pins","user_roles",
          "tenant_invitations",
        ];
        for (const tbl of tables) {
          const { error } = await admin.from(tbl).delete().eq("tenant_id", t);
          if (error) return json({ error: `${tbl}: ${error.message}` }, 500);
        }

        let memQuery = admin.from("tenant_members").delete().eq("tenant_id", t);
        if (ownerId) memQuery = memQuery.neq("user_id", ownerId);
        const { error: mErr } = await memQuery;
        if (mErr) return json({ error: `tenant_members: ${mErr.message}` }, 500);

        await admin.from("license_events").insert({
          tenant_id: t, kind: "platform.tenant_staff_cleared",
          payload: { by: callerId, kept_owner: ownerId },
        });
        return json({ ok: true });
      }

      case "delete_tenant": {
        const t = body.tenant_id;
        const { data: tenantRow, error: tErr } = await admin.from("tenants")
          .select("id, slug, name").eq("id", t).maybeSingle();
        if (tErr) return json({ error: tErr.message }, 500);
        if (!tenantRow) return json({ error: "Tenant not found" }, 404);
        if ((tenantRow as any).slug !== body.confirm_slug) {
          return json({ error: "Slug confirmation does not match" }, 400);
        }

        const tables = [
          "attendance_audit_log","attendance_records","time_off_requests",
          "shifts","shift_templates","staff_face_enrollments","staff_pins",
          "user_roles","tenant_invitations","loyalty_transactions",
          "orders","customers","expenses","services","receipt_settings",
          "role_permissions","membership_audit_log","invoices","subscriptions",
          "tenant_members","license_events",
        ];
        for (const tbl of tables) {
          const { error } = await admin.from(tbl).delete().eq("tenant_id", t);
          if (error) return json({ error: `${tbl}: ${error.message}` }, 500);
        }

        const { error: delErr } = await admin.from("tenants").delete().eq("id", t);
        if (delErr) return json({ error: delErr.message }, 500);

        await admin.from("license_events").insert({
          tenant_id: null, kind: "platform.tenant_deleted",
          payload: { by: callerId, tenant_id: t, name: (tenantRow as any).name, slug: (tenantRow as any).slug },
        });
        return json({ ok: true });
      }
    }
  } catch (e) {
    console.error("platform-admin error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
