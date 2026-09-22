// Monthly tax invoicing for tenants. Super-admin only.
// Generates one invoice per tenant per month at the tenant's plan price,
// emails them via Resend and exposes automation settings (auto email + SMS).
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

const MONTH = /^\d{4}-\d{2}$/;

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_settings") }),
  z.object({
    action: z.literal("update_settings"),
    auto_email_enabled: z.boolean().optional(),
    send_day: z.number().int().min(1).max(28).optional(),
    due_days: z.number().int().min(0).max(120).optional(),
    from_name: z.string().max(120).optional(),
    from_email: z.string().max(200).optional(),
    email_subject: z.string().max(300).optional(),
    email_body: z.string().max(8000).optional(),
    sms_reminders_enabled: z.boolean().optional(),
    sms_reminder_days: z.number().int().min(0).max(60).optional(),
    sms_template: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("list_invoices"),
    month: z.string().regex(MONTH).optional(),
    tenant_id: z.string().uuid().optional(),
    status: z.enum(["all", "draft", "sent", "paid", "void"]).default("all"),
  }),
  z.object({
    action: z.literal("generate"),
    month: z.string().regex(MONTH),
    tenant_id: z.string().uuid().optional(),
  }),
  z.object({ action: z.literal("send_email"), invoice_id: z.string().uuid() }),
  z.object({ action: z.literal("send_month"), month: z.string().regex(MONTH) }),
  z.object({
    action: z.literal("set_status"),
    invoice_id: z.string().uuid(),
    status: z.enum(["draft", "sent", "paid", "void"]),
  }),
  z.object({ action: z.literal("delete_invoice"), invoice_id: z.string().uuid() }),
  z.object({ action: z.literal("send_sms_reminders"), month: z.string().regex(MONTH) }),
  z.object({ action: z.literal("run_automation") }),
]);

const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

const fmtMoney = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toFixed(2)}`;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "UTC",
  });

const fillTemplate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => vars[k] ?? "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const raw = await req.json().catch(() => ({}));
    const parsed = ActionSchema.safeParse(raw);
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;

    // run_automation may be invoked by a scheduler with the service role key.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let callerId: string | null = null;

    if (body.action === "run_automation" && token === serviceKey) {
      callerId = null;
    } else {
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
      callerId = claimsData.claims.sub as string;
      const email = ((claimsData.claims.email as string | undefined) ?? "").toLowerCase();
      const { data: isSuperRow } = await admin
        .from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle();
      if (!isSuperRow && email !== BOOTSTRAP_SUPER_ADMIN_EMAIL) {
        return json({ error: "Forbidden: super admin only" }, 403);
      }
    }

    const loadSettings = async () => {
      const { data } = await admin
        .from("billing_notification_settings").select("*").maybeSingle();
      if (data) return data;
      const { data: created, error } = await admin
        .from("billing_notification_settings").insert({ id: true }).select("*").single();
      if (error) throw new Error(error.message);
      return created;
    };

    const loadPlatform = async () => {
      const { data } = await admin.from("platform_settings").select("*").maybeSingle();
      return data ?? {
        currency: "R", vat_rate: 15, company_name: "Washflow",
        contact_email: "", contact_phone: "", address: "",
      };
    };

    /** Owner (or first member) email for a tenant. */
    const tenantContacts = async (tenantIds: string[]) => {
      const map = new Map<string, { email: string; phone: string; name: string }>();
      if (tenantIds.length === 0) return map;
      const { data: members } = await admin
        .from("tenant_members").select("tenant_id,user_id,tenant_role")
        .in("tenant_id", tenantIds);
      const byTenant = new Map<string, { user_id: string; tenant_role: string }[]>();
      (members ?? []).forEach((m: any) => {
        const arr = byTenant.get(m.tenant_id) ?? [];
        arr.push({ user_id: m.user_id, tenant_role: m.tenant_role });
        byTenant.set(m.tenant_id, arr);
      });
      for (const [tid, arr] of byTenant) {
        const pick = arr.find((a) => a.tenant_role === "owner")
          ?? arr.find((a) => a.tenant_role === "admin") ?? arr[0];
        if (!pick) continue;
        const { data: u } = await admin.auth.admin.getUserById(pick.user_id);
        const user = u?.user;
        map.set(tid, {
          email: user?.email ?? "",
          phone: (user?.phone as string) || (user?.user_metadata?.phone as string) || "",
          name: (user?.user_metadata?.name as string) || user?.email || "",
        });
      }
      return map;
    };

    const decorate = async (rows: any[]) => {
      const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
      const [{ data: tenants }, contacts] = await Promise.all([
        tenantIds.length
          ? admin.from("tenants").select("id,name,slug,status").in("id", tenantIds)
          : Promise.resolve({ data: [] as any[] }),
        tenantContacts(tenantIds),
      ]);
      const tmap = new Map((tenants ?? []).map((t: any) => [t.id, t]));
      return rows.map((r) => ({
        ...r,
        tenant_name: tmap.get(r.tenant_id)?.name ?? "Unknown workspace",
        tenant_slug: tmap.get(r.tenant_id)?.slug ?? "",
        tenant_status: tmap.get(r.tenant_id)?.status ?? "",
        contact_email: contacts.get(r.tenant_id)?.email ?? "",
        contact_phone: contacts.get(r.tenant_id)?.phone ?? "",
        contact_name: contacts.get(r.tenant_id)?.name ?? "",
      }));
    };

    const generateForMonth = async (month: string, onlyTenant?: string) => {
      const { start, end } = monthBounds(month);
      const settings = await loadSettings();
      const platform = await loadPlatform();
      const vatRate = Number(platform.vat_rate ?? 0);
      const currency = String(platform.currency ?? "R");

      let q = admin.from("tenants").select("id,name,slug,status,plan_id");
      if (onlyTenant) q = q.eq("id", onlyTenant);
      const { data: tenants, error: tErr } = await q;
      if (tErr) throw new Error(tErr.message);

      const { data: plans } = await admin.from("plans").select("id,name,price_monthly_cents");
      const planMap = new Map((plans ?? []).map((p: any) => [p.id, p]));

      const { data: existing } = await admin
        .from("tenant_tax_invoices").select("id,tenant_id,invoice_number")
        .eq("period_start", start);
      const existingSet = new Set((existing ?? []).map((e: any) => e.tenant_id));

      const { count: monthCount } = await admin
        .from("tenant_tax_invoices")
        .select("id", { count: "exact", head: true })
        .eq("period_start", start);
      let seq = monthCount ?? 0;

      const issue = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + (settings.due_days ?? 7) * 86_400_000)
        .toISOString().slice(0, 10);

      const inserts: any[] = [];
      const skipped: string[] = [];
      for (const t of tenants ?? []) {
        if (existingSet.has(t.id)) { skipped.push(`${t.name}: already invoiced`); continue; }
        if (["cancelled"].includes(t.status)) { skipped.push(`${t.name}: cancelled`); continue; }
        const plan = t.plan_id ? planMap.get(t.plan_id) : null;
        if (!plan) { skipped.push(`${t.name}: no plan assigned`); continue; }
        const subtotal = Number(plan.price_monthly_cents ?? 0);
        if (subtotal <= 0) { skipped.push(`${t.name}: plan is free`); continue; }
        const vat = Math.round(subtotal * (vatRate / 100));
        seq += 1;
        inserts.push({
          tenant_id: t.id,
          invoice_number: `INV-${month.replace("-", "")}-${String(seq).padStart(3, "0")}`,
          period_start: start,
          period_end: end,
          issue_date: issue,
          due_date: due,
          plan_name: plan.name,
          currency,
          subtotal_cents: subtotal,
          vat_cents: vat,
          total_cents: subtotal + vat,
          status: "draft",
        });
      }

      let created: any[] = [];
      if (inserts.length) {
        const { data, error } = await admin
          .from("tenant_tax_invoices").insert(inserts).select("*");
        if (error) throw new Error(error.message);
        created = data ?? [];
      }
      return { created: created.length, skipped, invoices: created };
    };

    const sendInvoiceEmail = async (invoiceId: string) => {
      const { data: inv, error } = await admin
        .from("tenant_tax_invoices").select("*").eq("id", invoiceId).single();
      if (error || !inv) throw new Error(error?.message ?? "Invoice not found");
      const [settings, platform, contacts] = await Promise.all([
        loadSettings(), loadPlatform(), tenantContacts([inv.tenant_id]),
      ]);
      const { data: tenant } = await admin
        .from("tenants").select("name").eq("id", inv.tenant_id).single();
      const to = contacts.get(inv.tenant_id)?.email ?? "";
      if (!to) {
        const result = { ok: false, error: "No owner email on this workspace" };
        await admin.from("tenant_tax_invoices")
          .update({ email_result: result }).eq("id", inv.id);
        return result;
      }
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) {
        const result = { ok: false, error: "RESEND_API_KEY not configured" };
        await admin.from("tenant_tax_invoices")
          .update({ email_result: result }).eq("id", inv.id);
        return result;
      }

      const vars = {
        tenant_name: tenant?.name ?? "",
        invoice_number: inv.invoice_number,
        plan_name: inv.plan_name,
        period: `${fmtDate(inv.period_start)} - ${fmtDate(inv.period_end)}`,
        issue_date: fmtDate(inv.issue_date),
        due_date: inv.due_date ? fmtDate(inv.due_date) : "",
        subtotal: fmtMoney(inv.subtotal_cents, inv.currency),
        vat: fmtMoney(inv.vat_cents, inv.currency),
        total: fmtMoney(inv.total_cents, inv.currency),
        company_name: platform.company_name ?? "",
        contact_email: platform.contact_email ?? "",
        contact_phone: platform.contact_phone ?? "",
        address: platform.address ?? "",
      };

      const subject = fillTemplate(settings.email_subject ?? "Tax invoice {{invoice_number}}", vars);
      const bodyText = fillTemplate(settings.email_body ?? "", vars);
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;color:#111">
          <h2 style="margin:0 0 4px">${vars.company_name}</h2>
          <div style="font-size:12px;color:#555;white-space:pre-line">${vars.address}
${vars.contact_phone} ${vars.contact_email}</div>
          <hr style="margin:16px 0;border:none;border-top:1px solid #ddd" />
          <h3 style="margin:0 0 12px">Tax Invoice ${vars.invoice_number}</h3>
          <p style="white-space:pre-line">${bodyText}</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
            <tr><td style="padding:6px 0;color:#555">Billed to</td><td style="text-align:right">${vars.tenant_name}</td></tr>
            <tr><td style="padding:6px 0;color:#555">Billing period</td><td style="text-align:right">${vars.period}</td></tr>
            <tr><td style="padding:6px 0;color:#555">Issue date</td><td style="text-align:right">${vars.issue_date}</td></tr>
            <tr><td style="padding:6px 0;color:#555">Due date</td><td style="text-align:right">${vars.due_date}</td></tr>
            <tr><td style="padding:6px 0;color:#555">Plan</td><td style="text-align:right">${vars.plan_name}</td></tr>
            <tr><td style="padding:6px 0;color:#555">Subtotal</td><td style="text-align:right">${vars.subtotal}</td></tr>
            <tr><td style="padding:6px 0;color:#555">VAT</td><td style="text-align:right">${vars.vat}</td></tr>
            <tr><td style="padding:10px 0;font-weight:bold;border-top:1px solid #ddd">Total due</td>
                <td style="text-align:right;font-weight:bold;border-top:1px solid #ddd">${vars.total}</td></tr>
          </table>
        </div>`;

      const from = `${settings.from_name ?? "Washflow"} <${settings.from_email ?? "onboarding@resend.dev"}>`;
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const result = { ok: false, error: payload?.message ?? `Resend error ${resp.status}`, to };
        await admin.from("tenant_tax_invoices")
          .update({ email_result: result }).eq("id", inv.id);
        return result;
      }
      const result = { ok: true, to, id: payload?.id ?? null };
      await admin.from("tenant_tax_invoices").update({
        email_result: result,
        email_sent_at: new Date().toISOString(),
        status: inv.status === "draft" ? "sent" : inv.status,
      }).eq("id", inv.id);
      return result;
    };

    switch (body.action) {
      case "get_settings": {
        const [settings, platform] = await Promise.all([loadSettings(), loadPlatform()]);
        return json({
          settings,
          platform,
          email_configured: !!Deno.env.get("RESEND_API_KEY"),
          sms_configured: !!(Deno.env.get("TWILIO_ACCOUNT_SID") && Deno.env.get("TWILIO_AUTH_TOKEN")),
        });
      }

      case "update_settings": {
        const { action: _a, ...patch } = body as Record<string, unknown>;
        const { data, error } = await admin
          .from("billing_notification_settings")
          .upsert({ id: true, ...patch, updated_by: callerId, updated_at: new Date().toISOString() })
          .select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ settings: data });
      }

      case "list_invoices": {
        let q = admin.from("tenant_tax_invoices").select("*")
          .order("period_start", { ascending: false })
          .order("invoice_number", { ascending: true })
          .limit(500);
        if (body.month) q = q.eq("period_start", monthBounds(body.month).start);
        if (body.tenant_id) q = q.eq("tenant_id", body.tenant_id);
        if (body.status !== "all") q = q.eq("status", body.status);
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ invoices: await decorate(data ?? []) });
      }

      case "generate": {
        const res = await generateForMonth(body.month, body.tenant_id);
        return json(res);
      }

      case "send_email": {
        const result = await sendInvoiceEmail(body.invoice_id);
        return json({ result });
      }

      case "send_month": {
        const { start } = monthBounds(body.month);
        const { data: invs } = await admin.from("tenant_tax_invoices")
          .select("id").eq("period_start", start).is("email_sent_at", null)
          .neq("status", "void");
        const results = [];
        for (const i of invs ?? []) {
          try { results.push({ id: i.id, ...(await sendInvoiceEmail(i.id)) }); }
          catch (e) { results.push({ id: i.id, ok: false, error: String(e) }); }
        }
        return json({
          sent: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok),
        });
      }

      case "set_status": {
        const { error } = await admin.from("tenant_tax_invoices")
          .update({ status: body.status, updated_at: new Date().toISOString() })
          .eq("id", body.invoice_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "delete_invoice": {
        const { error } = await admin.from("tenant_tax_invoices")
          .delete().eq("id", body.invoice_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "send_sms_reminders": {
        const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const tokenTw = Deno.env.get("TWILIO_AUTH_TOKEN");
        const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
        if (!sid || !tokenTw || !fromNumber) {
          return json({
            sms_configured: false,
            error: "SMS is not configured. Add the Twilio account SID, auth token and phone number to enable reminders.",
          }, 200);
        }
        const settings = await loadSettings();
        const { start } = monthBounds(body.month);
        const { data: invs } = await admin.from("tenant_tax_invoices")
          .select("*").eq("period_start", start).in("status", ["draft", "sent"]);
        const decorated = await decorate(invs ?? []);
        const results = [];
        for (const inv of decorated) {
          if (!inv.contact_phone) {
            results.push({ id: inv.id, ok: false, error: "No phone number" });
            continue;
          }
          const msg = fillTemplate(settings.sms_template ?? "", {
            tenant_name: inv.tenant_name,
            invoice_number: inv.invoice_number,
            total: fmtMoney(inv.total_cents, inv.currency),
            due_date: inv.due_date ? fmtDate(inv.due_date) : "",
          });
          const resp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${btoa(`${sid}:${tokenTw}`)}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({ To: inv.contact_phone, From: fromNumber, Body: msg }),
            },
          );
          const ok = resp.ok;
          const payload = await resp.json().catch(() => ({}));
          const result = { ok, error: ok ? null : (payload?.message ?? `Twilio ${resp.status}`) };
          await admin.from("tenant_tax_invoices").update({
            sms_result: result,
            sms_sent_at: ok ? new Date().toISOString() : null,
          }).eq("id", inv.id);
          results.push({ id: inv.id, ...result });
        }
        return json({
          sms_configured: true,
          sent: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok),
        });
      }

      case "run_automation": {
        const settings = await loadSettings();
        const now = new Date();
        const month = now.toISOString().slice(0, 7);
        if (!settings.auto_email_enabled) return json({ skipped: "automatic emailing is off" });
        if (now.getUTCDate() !== (settings.send_day ?? 1)) {
          return json({ skipped: `not the configured send day (${settings.send_day})` });
        }
        const gen = await generateForMonth(month);
        const { start } = monthBounds(month);
        const { data: invs } = await admin.from("tenant_tax_invoices")
          .select("id").eq("period_start", start).is("email_sent_at", null).neq("status", "void");
        let sent = 0;
        for (const i of invs ?? []) {
          try { if ((await sendInvoiceEmail(i.id)).ok) sent += 1; } catch { /* keep going */ }
        }
        return json({ generated: gen.created, sent });
      }
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("tax-invoices error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
