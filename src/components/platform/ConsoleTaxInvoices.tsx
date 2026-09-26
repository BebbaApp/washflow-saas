import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, FileText, Mail, MessageSquare, Plus, RefreshCw, Download, Trash2,
  CheckCircle2, AlertTriangle, Settings2,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Invoice {
  id: string;
  tenant_id: string;
  tenant_name: string;
  contact_email: string;
  contact_phone: string;
  billing_address?: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string | null;
  plan_name: string;
  currency: string;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  status: string;
  email_sent_at: string | null;
  email_result: { ok?: boolean; error?: string } | null;
  sms_sent_at: string | null;
  sms_result: { ok?: boolean; error?: string } | null;
}

interface Settings {
  auto_email_enabled: boolean;
  send_day: number;
  due_days: number;
  from_name: string;
  from_email: string;
  email_subject: string;
  email_body: string;
  sms_reminders_enabled: boolean;
  sms_reminder_days: number;
  sms_template: string;
}

interface PlatformInfo {
  currency: string; vat_rate: number; company_name: string;
  contact_email: string; contact_phone: string; address: string;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
};

const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
};

const monthOptions = () => {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
};

const money = (cents: number, currency: string) => `${currency === "ZAR" ? "R" : currency === "USD" ? "$" : currency === "R" ? "R" : `${currency} `}${(cents / 100).toFixed(2)}`;

const statusVariant = (s: string) =>
  s === "paid" ? "default" : s === "sent" ? "secondary" : s === "void" ? "destructive" : "outline";

export function ConsoleTaxInvoices() {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [smsConfigured, setSmsConfigured] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("tax-invoices", { body: payload });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
    return data;
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await call({ action: "get_settings" });
      setSettings(data.settings);
      setPlatform(data.platform);
      setEmailConfigured(!!data.email_configured);
      setSmsConfigured(!!data.sms_configured);
    } catch (e) {
      toast({ title: "Could not load billing settings", description: String(e), variant: "destructive" });
    }
  }, [call, toast]);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list_invoices", month, status });
      setInvoices(data.invoices ?? []);
    } catch (e) {
      toast({ title: "Could not load invoices", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [call, month, status, toast]);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const totals = useMemo(() => {
    const cur = invoices[0]?.currency ?? platform?.currency ?? "R";
    const sum = (k: keyof Invoice) => invoices.reduce((a, i) => a + Number(i[k] ?? 0), 0);
    return {
      currency: cur,
      count: invoices.length,
      total: sum("total_cents"),
      paid: invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.total_cents, 0),
      outstanding: invoices.filter((i) => i.status !== "paid" && i.status !== "void")
        .reduce((a, i) => a + i.total_cents, 0),
    };
  }, [invoices, platform]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); }
    catch (e) { toast({ title: "Action failed", description: String(e), variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const generate = () => run("generate", async () => {
    const res = await call({ action: "generate", month });
    toast({
      title: `${res.created} invoice${res.created === 1 ? "" : "s"} generated`,
      description: res.skipped?.length ? `Skipped: ${res.skipped.join("; ")}` : undefined,
    });
    await loadInvoices();
  });

  const sendAll = () => run("sendAll", async () => {
    const res = await call({ action: "send_month", month });
    toast({
      title: `${res.sent} invoice${res.sent === 1 ? "" : "s"} emailed`,
      description: res.failed?.length ? `${res.failed.length} could not be sent` : undefined,
      variant: res.failed?.length ? "destructive" : undefined,
    });
    await loadInvoices();
  });

  const sendOne = (inv: Invoice) => run(`send-${inv.id}`, async () => {
    const { result } = await call({ action: "send_email", invoice_id: inv.id });
    toast({
      title: result.ok ? `Emailed to ${result.to}` : "Email failed",
      description: result.ok ? undefined : result.error,
      variant: result.ok ? undefined : "destructive",
    });
    await loadInvoices();
  });

  const changeStatus = (inv: Invoice, next: string) => run(`status-${inv.id}`, async () => {
    await call({ action: "set_status", invoice_id: inv.id, status: next });
    await loadInvoices();
  });

  const remove = (inv: Invoice) => run(`del-${inv.id}`, async () => {
    await call({ action: "delete_invoice", invoice_id: inv.id });
    toast({ title: "Invoice removed" });
    await loadInvoices();
  });

  const sendSms = () => run("sms", async () => {
    const res = await call({ action: "send_sms_reminders", month });
    if (res.sms_configured === false) {
      toast({ title: "SMS not set up yet", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${res.sent} reminder${res.sent === 1 ? "" : "s"} sent` });
    await loadInvoices();
  });

  const saveSettings = (patch: Partial<Settings>) => run("settings", async () => {
    const data = await call({ action: "update_settings", ...patch });
    setSettings(data.settings);
  });

  const downloadPdf = (inv: Invoice) => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const m = 42;
    const right = width - m;
    const middle = width / 2 + 8;
    const vatRate = inv.subtotal_cents > 0
      ? Math.round((inv.vat_cents / inv.subtotal_cents) * 10000) / 100 : 0;
    const writeBlock = (lines: string[], x: number, start: number, maxWidth: number) => {
      let cursor = start;
      doc.setFont("helvetica", "normal").setFontSize(9);
      for (const line of lines.filter(Boolean)) {
        for (const part of doc.splitTextToSize(line, maxWidth) as string[]) {
          doc.text(part, x, cursor);
          cursor += 12;
        }
      }
      return cursor;
    };

    doc.setTextColor(24, 28, 33);
    doc.setFont("helvetica", "bold").setFontSize(20).text("Invoice", m, 55);
    const metadata: [string, string][] = [
      ["Invoice number", inv.invoice_number],
      ["Date of issue", fmtDate(inv.issue_date)],
      ["Date due", fmtDate(inv.due_date)],
    ];
    metadata.forEach(([label, value], index) => {
      const row = 82 + index * 17;
      doc.setFont("helvetica", "normal").setFontSize(9).text(label, m, row);
      doc.setFont("helvetica", "bold").text(value, m + 96, row);
    });

    const blockTop = 164;
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text(platform?.company_name || "Washflow", m, blockTop);
    doc.text("Bill to", middle, blockTop);
    const senderEnd = writeBlock([
      platform?.address ?? "", platform?.contact_phone ?? "", platform?.contact_email ?? "",
    ], m, blockTop + 17, middle - m - 28);
    const recipientEnd = writeBlock([
      inv.tenant_name, inv.billing_address ?? "", inv.contact_email,
    ], middle, blockTop + 17, right - middle);

    const dueY = Math.max(senderEnd, recipientEnd) + 28;
    doc.setFont("helvetica", "bold").setFontSize(16);
    doc.text(`${money(inv.total_cents, inv.currency)} due ${fmtDate(inv.due_date)}`, m, dueY);

    const tableY = dueY + 38;
    autoTable(doc, {
      startY: tableY,
      head: [["Description", "Qty", "Unit price", "Tax", "Amount"]],
      body: [[
        `${inv.plan_name} subscription\n${fmtDate(inv.period_start)} - ${fmtDate(inv.period_end)}`,
        "1",
        money(inv.subtotal_cents, inv.currency),
        `${vatRate}%`,
        money(inv.subtotal_cents, inv.currency),
      ]],
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9, textColor: [24, 28, 33], cellPadding: { top: 9, bottom: 9, left: 2, right: 2 } },
      headStyles: { fontStyle: "normal", lineColor: [24, 28, 33], lineWidth: { bottom: 0.7 } },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 32, halign: "right" },
        2: { cellWidth: 72, halign: "right" },
        3: { cellWidth: 42, halign: "right" },
        4: { cellWidth: 80, halign: "right" },
      },
      margin: { left: m, right: m, bottom: 110 },
    });

    let summaryY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    const summaryLeft = middle + 28;
    const summary: [string, string, boolean][] = [
      ["Subtotal", money(inv.subtotal_cents, inv.currency), false],
      ["Total excluding tax", money(inv.subtotal_cents, inv.currency), false],
      [`VAT (${vatRate}%)`, money(inv.vat_cents, inv.currency), false],
      ["Total", money(inv.total_cents, inv.currency), false],
      ["Amount due", money(inv.total_cents, inv.currency), true],
    ];
    summary.forEach(([label, amount, emphatic]) => {
      doc.setDrawColor(218, 221, 225).setLineWidth(0.5).line(summaryLeft, summaryY - 12, right, summaryY - 12);
      doc.setFont("helvetica", emphatic ? "bold" : "normal").setFontSize(9);
      doc.text(label, summaryLeft + 2, summaryY);
      doc.text(amount, right - 2, summaryY, { align: "right" });
      summaryY += 19;
    });

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      doc.setDrawColor(218, 221, 225).line(m, height - 55, right, height - 55);
      doc.setFont("helvetica", "normal").setFontSize(8).text(`Page ${page} of ${pages}`, right, height - 38, { align: "right" });
    }
    doc.save(`${inv.invoice_number}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-xl font-semibold">Tax invoices</h2>
          <p className="text-sm text-muted-foreground">
            Monthly subscription invoices for every workspace.
          </p>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {monthOptions().map((m) => (
              <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["all", "draft", "sent", "paid", "void"].map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={loadInvoices} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button onClick={generate} disabled={busy === "generate"}>
          {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
          Generate invoices
        </Button>
        <Button variant="secondary" onClick={sendAll} disabled={busy === "sendAll"}>
          {busy === "sendAll" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
          Email unsent
        </Button>
        <Button variant="outline" onClick={() => setShowSettings((v) => !v)}>
          <Settings2 className="h-4 w-4 mr-2" /> Automation
        </Button>
      </div>

      {!emailConfigured && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Email sending is not configured yet, so invoices can only be downloaded.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Invoices", value: String(totals.count) },
          { label: "Invoiced", value: money(totals.total, totals.currency) },
          { label: "Paid", value: money(totals.paid, totals.currency) },
          { label: "Outstanding", value: money(totals.outstanding, totals.currency) },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {showSettings && settings && (
        <Card>
          <CardHeader><CardTitle className="text-base">Automation</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="font-medium">Send invoices automatically</p>
                <p className="text-sm text-muted-foreground">
                  Generate and email every workspace invoice on day {settings.send_day} of each month.
                </p>
              </div>
              <Switch
                checked={settings.auto_email_enabled}
                onCheckedChange={(v) => saveSettings({ auto_email_enabled: v })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Send day of month</Label>
                <Input
                  type="number" min={1} max={28} defaultValue={settings.send_day}
                  onBlur={(e) => saveSettings({ send_day: Number(e.target.value) || 1 })}
                />
              </div>
              <div className="space-y-1">
                <Label>Payment due in (days)</Label>
                <Input
                  type="number" min={0} max={120} defaultValue={settings.due_days}
                  onBlur={(e) => saveSettings({ due_days: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label>Sender name</Label>
                <Input
                  defaultValue={settings.from_name}
                  onBlur={(e) => saveSettings({ from_name: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Sender email</Label>
                <Input
                  data-no-capitalize defaultValue={settings.from_email}
                  onBlur={(e) => saveSettings({ from_email: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label>Email subject</Label>
                <Input
                  defaultValue={settings.email_subject}
                  onBlur={(e) => saveSettings({ email_subject: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label>Email message</Label>
                <Textarea
                  rows={5} defaultValue={settings.email_body}
                  onBlur={(e) => saveSettings({ email_body: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  You can use {"{{tenant_name}}"}, {"{{invoice_number}}"}, {"{{total}}"}, {"{{due_date}}"}, {"{{period}}"}.
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" /> SMS reminders
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {smsConfigured
                      ? "Remind workspaces before their invoice is due."
                      : "Not configured yet — add your SMS account details to switch this on."}
                  </p>
                </div>
                <Switch
                  checked={settings.sms_reminders_enabled}
                  disabled={!smsConfigured}
                  onCheckedChange={(v) => saveSettings({ sms_reminders_enabled: v })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Remind days before due</Label>
                  <Input
                    type="number" min={0} max={60} defaultValue={settings.sms_reminder_days}
                    onBlur={(e) => saveSettings({ sms_reminder_days: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>SMS message</Label>
                  <Input
                    defaultValue={settings.sms_template}
                    onBlur={(e) => saveSettings({ sms_template: e.target.value })}
                  />
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={sendSms} disabled={busy === "sms"}>
                {busy === "sms" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                Send reminders now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <FileText className="h-6 w-6 mx-auto mb-2 opacity-50" />
              No invoices for {monthLabel(month)} yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Workspace</th>
                  <th className="px-3 py-2 text-left">Plan</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{inv.invoice_number}</td>
                    <td className="px-3 py-2">
                      <div>{inv.tenant_name}</div>
                      <div className="text-xs text-muted-foreground">{inv.contact_email || "No email"}</div>
                    </td>
                    <td className="px-3 py-2">{inv.plan_name}</td>
                    <td className="px-3 py-2">{fmtDate(inv.due_date)}</td>
                    <td className="px-3 py-2 text-right">{money(inv.total_cents, inv.currency)}</td>
                    <td className="px-3 py-2">
                      <Select value={inv.status} onValueChange={(v) => changeStatus(inv, v)}>
                        <SelectTrigger className="h-8 w-[104px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["draft", "sent", "paid", "void"].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      {inv.email_sent_at ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" /> {fmtDate(inv.email_sent_at)}
                        </Badge>
                      ) : inv.email_result?.error ? (
                        <span className="text-xs text-destructive">{inv.email_result.error}</span>
                      ) : (
                        <Badge variant={statusVariant("draft")}>Not sent</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Download PDF"
                          onClick={() => downloadPdf(inv)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Email invoice"
                          disabled={busy === `send-${inv.id}`}
                          onClick={() => sendOne(inv)}>
                          {busy === `send-${inv.id}`
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Mail className="h-4 w-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Remove invoice"
                          disabled={busy === `del-${inv.id}`}
                          onClick={() => remove(inv)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
