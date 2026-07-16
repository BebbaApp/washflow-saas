import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, Receipt, FileText } from "lucide-react";
import { exportTablePdf } from "@/lib/pdfExport";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePlatformCurrency } from "@/hooks/usePlatformCurrency";

interface ExpenseRow {
  id: string;
  tenant_id: string;
  date: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: number;
  notes: string | null;
  created_at: string;
}

interface TenantRow { id: string; name: string }

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function ConsoleExpenses() {
  const { toast } = useToast();
  const { format: fmtAmount } = usePlatformCurrency();
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [tenantId, setTenantId] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("expenses" as any)
      .select("id, tenant_id, date, category, description, vendor, amount, notes, created_at")
      .gte("date", `${from}T00:00:00`)
      .lte("date", `${to}T23:59:59.999`)
      .order("date", { ascending: false })
      .limit(1000);
    if (tenantId !== "all") q = q.eq("tenant_id", tenantId);
    if (category !== "all") q = q.eq("category", category);
    const { data, error } = await q;
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setRows(((data as any) ?? []) as ExpenseRow[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.from("tenants" as any).select("id, name").order("name")
      .then(({ data }) => setTenants(((data as any) ?? []) as TenantRow[]));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = useMemo(() => ({ format: fmtAmount }), [fmtAmount]);


  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  const total = useMemo(() => rows.reduce((s, r) => s + Number(r.amount || 0), 0), [rows]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.category && s.add(r.category));
    return Array.from(s).sort();
  }, [rows]);

  const exportCsv = () => {
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Date", "Tenant", "Category", "Description", "Vendor", "Amount", "Notes"];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      lines.push([
        r.date?.slice(0, 10) ?? "",
        tenantName(r.tenant_id),
        r.category,
        r.description,
        r.vendor ?? "",
        r.amount,
        r.notes ?? "",
      ].map(esc).join(","));
    });
    lines.push("");
    lines.push(`Total,,,,,${total},`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    if (rows.length === 0) return;
    const headers = ["Date", "Tenant", "Category", "Description", "Vendor", "Amount", "Notes"];
    const body = rows.map((r) => [
      r.date?.slice(0, 10) ?? "",
      tenantName(r.tenant_id),
      r.category,
      r.description,
      r.vendor ?? "",
      fmt.format(Number(r.amount || 0)),
      r.notes ?? "",
    ]);
    body.push(["", "", "", "", "Total", fmt.format(total), ""]);
    exportTablePdf({
      title: "Platform expenses",
      subtitle: `Range: ${from} → ${to}`,
      filename: `expenses-${from}_${to}.pdf`,
      headers,
      rows: body,
    });
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tenants</SelectItem>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply filters"}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Receipt className="w-4 h-4" />Records</div>
          <div className="text-2xl font-bold mt-1 text-foreground">{rows.length}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold mt-1 text-destructive">{fmt.format(total)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-xs text-muted-foreground">Categories</div>
          <div className="text-2xl font-bold mt-1 text-foreground">{categories.length}</div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Tenant</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-left px-3 py-2">Vendor</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No expenses in this range.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 whitespace-nowrap">{r.date?.slice(0, 10)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{tenantName(r.tenant_id)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.category}</td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.vendor ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-destructive whitespace-nowrap">{fmt.format(Number(r.amount || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
