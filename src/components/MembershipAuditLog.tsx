import { useEffect, useMemo, useState } from "react";
import { Loader2, History, Filter, Download, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Row {
  id: string;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  from_role: string | null;
  to_role: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const ACTIONS = [
  "all",
  "invite.created", "invite.accepted", "invite.revoked",
  "member.role_updated", "member.removed", "member.left",
  "tenant.settings_updated", "tenant.billing_updated",
  "platform_admin.granted", "platform_admin.revoked",
  "receipt_settings.updated",
] as const;

const LABEL: Record<string, string> = {
  "invite.created": "Invite created",
  "invite.accepted": "Invite accepted",
  "invite.revoked": "Invite revoked",
  "invite.expired": "Invite expired",
  "member.role_updated": "Role updated",
  "member.removed": "Member removed",
  "member.left": "Member left",
  "tenant.settings_updated": "Workspace settings updated",
  "tenant.billing_updated": "Billing / plan updated",
  "platform_admin.granted": "Platform admin granted",
  "platform_admin.revoked": "Platform admin revoked",
  "receipt_settings.updated": "Receipt settings updated",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MembershipAuditLog() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof ACTIONS[number]>("all");
  const [fromDate, setFromDate] = useState<string>(daysAgoISO(30));
  const [toDate, setToDate] = useState<string>(todayISO());
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);

  const fromIso = useMemo(() => new Date(`${fromDate}T00:00:00`).toISOString(), [fromDate]);
  const toIso = useMemo(() => new Date(`${toDate}T23:59:59.999`).toISOString(), [toDate]);

  useEffect(() => {
    if (!tenant) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      let q = supabase.from("membership_audit_log" as any)
        .select("*").eq("tenant_id", tenant.id)
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: false }).limit(200);
      if (filter !== "all") q = q.eq("action", filter);
      const { data } = await q;
      if (!cancel) { setRows(((data as any) ?? []) as Row[]); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [tenant?.id, filter, fromIso, toIso]);

  async function fetchAllForExport(): Promise<Row[]> {
    if (!tenant) return [];
    const all: Row[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      let q = supabase.from("membership_audit_log" as any)
        .select("*").eq("tenant_id", tenant.id)
        .gte("created_at", fromIso).lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (filter !== "all") q = q.eq("action", filter);
      const { data, error } = await q;
      if (error) throw error;
      const batch = ((data as any) ?? []) as Row[];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
      if (all.length >= 20000) break; // safety cap
    }
    return all;
  }

  const handleExportCSV = async () => {
    if (!tenant) return;
    setExporting("csv");
    try {
      const data = await fetchAllForExport();
      const header = ["Timestamp", "Action", "Actor", "Target", "From role", "To role", "Details"];
      const lines = [header.join(",")];
      for (const r of data) {
        lines.push([
          new Date(r.created_at).toISOString(),
          LABEL[r.action] ?? r.action,
          r.actor_email ?? "system",
          r.target_email ?? r.target_user_id ?? "",
          r.from_role ?? "",
          r.to_role ?? "",
          r.payload ? JSON.stringify(r.payload) : "",
        ].map(csvEscape).join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      downloadBlob(blob, `audit-log-${tenant.slug ?? tenant.id}-${fromDate}_${toDate}.csv`);
      toast.success(`Exported ${data.length} row${data.length === 1 ? "" : "s"} to CSV`);
    } catch (e: any) {
      toast.error("CSV export failed", { description: e?.message });
    } finally {
      setExporting(null);
    }
  };

  const handleExportPDF = async () => {
    if (!tenant) return;
    setExporting("pdf");
    try {
      const data = await fetchAllForExport();
      const doc = new jsPDF({ orientation: "landscape" });
      doc.setFontSize(16);
      doc.text("Membership Audit Log", 14, 16);
      doc.setFontSize(10);
      doc.text(
        `Workspace: ${tenant.name ?? tenant.id}  •  Range: ${fromDate} → ${toDate}  •  ${data.length} event${data.length === 1 ? "" : "s"}  •  Generated ${new Date().toLocaleString()}`,
        14, 23,
      );
      autoTable(doc, {
        startY: 30,
        head: [["When", "Action", "Actor", "Target", "Role change", "Details"]],
        body: data.map((r) => [
          new Date(r.created_at).toLocaleString(),
          LABEL[r.action] ?? r.action,
          r.actor_email ?? "system",
          r.target_email ?? (r.target_user_id ? r.target_user_id.slice(0, 8) + "…" : "—"),
          r.from_role && r.to_role ? `${r.from_role} → ${r.to_role}` : r.to_role ?? "",
          r.payload && Object.keys(r.payload).length ? JSON.stringify(r.payload) : "",
        ]),
        styles: { fontSize: 7, cellPadding: 1.5, overflow: "linebreak" },
        headStyles: { fillColor: [30, 41, 59] },
        columnStyles: { 5: { cellWidth: 80 } },
      });
      doc.save(`audit-log-${tenant.slug ?? tenant.id}-${fromDate}_${toDate}.pdf`);
      toast.success(`Exported ${data.length} row${data.length === 1 ? "" : "s"} to PDF`);
    } catch (e: any) {
      toast.error("PDF export failed", { description: e?.message });
    } finally {
      setExporting(null);
    }
  };

  if (!tenant) return null;

  return (
    <div className="glass-card p-6 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> Membership activity
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a === "all" ? "All actions" : LABEL[a] ?? a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap text-xs">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</label>
          <Input type="date" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-[150px] text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</label>
          <Input type="date" value={toDate} min={fromDate} max={todayISO()} onChange={(e) => setToDate(e.target.value)} className="h-8 w-[150px] text-xs" />
        </div>
        <div className="flex gap-1 ml-auto">
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!!exporting || loading}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting === "csv" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            CSV
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={!!exporting || loading}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting === "pdf" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">No activity in this range.</div>
      ) : (
        <>
          <ul className="divide-y divide-border max-h-[420px] overflow-auto">
            {rows.map((r) => (
              <li key={r.id} className="py-2 grid grid-cols-[1fr_auto] gap-2 text-xs">
                <div className="min-w-0">
                  <div className="text-foreground font-medium truncate">{LABEL[r.action] ?? r.action}</div>
                  <div className="text-muted-foreground truncate">
                    {r.actor_email ?? "system"}
                    {" → "}
                    {r.target_email ?? (r.target_user_id ? r.target_user_id.slice(0, 8) + "…" : "—")}
                    {r.from_role && r.to_role ? ` (${r.from_role} → ${r.to_role})` : r.to_role ? ` (${r.to_role})` : ""}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
          {rows.length === 200 && (
            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Showing the most recent 200 events in view. Exports include the full range.
            </p>
          )}
        </>
      )}
    </div>
  );
}
