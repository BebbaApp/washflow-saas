import { useEffect, useMemo, useState } from "react";
import { X, Users, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useWorkers } from "@/hooks/useWorkers";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { VEHICLES } from "@/lib/vehicleUsage";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

type PayType = "salary" | "wage" | "hourly";
interface Compensation {
  user_id: string;
  pay_type: PayType;
  base_rate: number;
  category_rates: Record<string, number>;
}

interface AttRow {
  user_id: string;
  kind: "check_in" | "check_out";
  created_at: string;
}

const RANGE_PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "week", label: "Last 7d", days: 7 },
  { id: "month", label: "Last 30d", days: 30 },
  { id: "custom", label: "Custom", days: 0 },
] as const;

function pairAttendance(rows: AttRow[]) {
  // group by local date, pair check_in / check_out
  const byDate = new Map<string, { in?: Date; out?: Date }[]>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    const d = new Date(r.created_at);
    const key = d.toDateString();
    const list = byDate.get(key) ?? [];
    if (r.kind === "check_in") {
      list.push({ in: d });
    } else {
      const last = list[list.length - 1];
      if (last && !last.out) last.out = d;
      else list.push({ out: d });
    }
    byDate.set(key, list);
  }
  let totalMs = 0;
  const daysWorked = new Set<string>();
  for (const [key, pairs] of byDate) {
    let dayMs = 0;
    let hasPair = false;
    for (const p of pairs) {
      if (p.in && p.out) {
        dayMs += p.out.getTime() - p.in.getTime();
        hasPair = true;
      }
    }
    if (hasPair) {
      // subtract 1h lunch if day > 5h
      const lunch = dayMs > 5 * 3600_000 ? 3600_000 : 0;
      totalMs += Math.max(0, dayMs - lunch);
      daysWorked.add(key);
    }
  }
  return { hours: totalMs / 3600_000, days: daysWorked.size };
}

export function EmployeeExpenseDialog({ open, onClose }: Props) {
  const { tenant } = useTenant();
  const { workers } = useWorkers();
  const { formatPrice, currency } = useCurrency();
  const { addExpense } = useExpenses();
  const { categories } = useExpenseCategories();

  const [comps, setComps] = useState<Compensation[]>([]);
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [rangeId, setRangeId] = useState<typeof RANGE_PRESETS[number]["id"]>("month");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicleCounts, setVehicleCounts] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("Salaries");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // resolve range
  const { from, to } = useMemo(() => {
    const preset = RANGE_PRESETS.find((p) => p.id === rangeId);
    if (preset && preset.days > 0) {
      const t = new Date(); t.setHours(23, 59, 59, 999);
      const f = new Date(); f.setDate(f.getDate() - (preset.days - 1)); f.setHours(0, 0, 0, 0);
      return { from: f, to: t };
    }
    const f = new Date(startDate); f.setHours(0, 0, 0, 0);
    const t = new Date(endDate); t.setHours(23, 59, 59, 999);
    return { from: f, to: t };
  }, [rangeId, startDate, endDate]);

  // load compensation
  useEffect(() => {
    if (!open || !tenant?.id) return;
    (async () => {
      const { data } = await supabase
        .from("staff_compensation" as any)
        .select("user_id, pay_type, base_rate, category_rates")
        .eq("tenant_id", tenant.id);
      setComps(((data as any[]) || []).map((r) => ({
        user_id: r.user_id,
        pay_type: r.pay_type as PayType,
        base_rate: Number(r.base_rate) || 0,
        category_rates: (r.category_rates || {}) as Record<string, number>,
      })));
    })();
  }, [open, tenant?.id]);

  // load attendance for selected staff & range
  useEffect(() => {
    if (!open || !staffId) { setAttendance([]); return; }
    (async () => {
      const { data } = await supabase
        .from("attendance_records")
        .select("user_id, kind, created_at")
        .eq("user_id", staffId)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("created_at", { ascending: true });
      setAttendance((data as any[]) || []);
    })();
  }, [open, staffId, from, to]);

  const comp = comps.find((c) => c.user_id === staffId);
  const worker = workers.find((w) => w.id === staffId);
  const { hours, days } = useMemo(() => pairAttendance(attendance), [attendance]);

  // count absent days within range (range days minus days worked)
  const rangeDays = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86400000) + 1
  );
  const absentDays = Math.max(0, rangeDays - days);

  const baseAmount = useMemo(() => {
    if (!comp) return 0;
    if (comp.pay_type === "salary") return comp.base_rate;
    if (comp.pay_type === "wage") return comp.base_rate * days;
    return comp.base_rate * hours;
  }, [comp, days, hours]);

  const categoryBonus = useMemo(() => {
    if (!comp) return 0;
    return VEHICLES.reduce((sum, v) => {
      const rate = Number(comp.category_rates[v] || 0);
      const count = Number(vehicleCounts[v] || 0);
      return sum + rate * count;
    }, 0);
  }, [comp, vehicleCounts]);

  const total = baseAmount + categoryBonus;

  const handleSubmit = async () => {
    if (!worker) { toast.error("Select an employee"); return; }
    if (!comp) { toast.error("No compensation set for this employee in Settings → Workers"); return; }
    if (total <= 0) { toast.error("Computed amount is zero"); return; }
    setSaving(true);
    const label = RANGE_PRESETS.find((p) => p.id === rangeId)?.label
      ?? `${from.toLocaleDateString()} → ${to.toLocaleDateString()}`;
    const parts: string[] = [`${comp.pay_type}`];
    if (comp.pay_type === "wage") parts.push(`${days} day(s)`);
    else if (comp.pay_type === "hourly") parts.push(`${hours.toFixed(2)}h`);
    if (categoryBonus > 0) parts.push(`+ vehicle bonuses`);
    const desc = `Remuneration — ${worker.name || "Employee"} (${label})`;
    const summary = `${parts.join(", ")} · ${days} worked / ${absentDays} absent`;
    await addExpense({
      description: desc,
      amount: Number(total.toFixed(2)),
      category,
      vendor: worker.name,
      notes: notes ? `${summary}\n${notes}` : summary,
      date: new Date().toISOString(),
    });
    toast.success("Employee expense recorded");
    setSaving(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold text-foreground">Employee Expense</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Employee</span>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
              >
                <option value="">— Select —</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.name || "Unnamed"} · {w.role}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Expense Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Attendance Period</span>
            <div className="mt-1.5 inline-flex flex-wrap gap-1 p-1 rounded-full bg-muted">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setRangeId(p.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    rangeId === p.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >{p.label}</button>
              ))}
            </div>
            {rangeId === "custom" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-background border border-border text-sm" />
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-background border border-border text-sm" />
              </div>
            )}
          </div>

          {staffId && !comp && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm p-3">
              No pay settings for this employee. Set their pay type and rate under Settings → Workers.
            </div>
          )}

          {comp && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Pay type" value={comp.pay_type} />
                <Stat label="Base rate" value={formatPrice(comp.base_rate)} />
                <Stat label="Days worked" value={String(days)} />
                <Stat label="Absent days" value={String(absentDays)} />
              </div>

              {comp.pay_type === "hourly" && (
                <div className="text-xs text-muted-foreground">
                  Worked hours (after 1h lunch deduction per full day): <span className="font-semibold text-foreground">{hours.toFixed(2)}h</span>
                </div>
              )}

              {VEHICLES.some((v) => Number(comp.category_rates[v] || 0) > 0) && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Vehicle category bonuses (optional units served)</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {VEHICLES.map((v) => {
                      const rate = Number(comp.category_rates[v] || 0);
                      if (!rate) return null;
                      return (
                        <label key={v} className="block">
                          <span className="text-[11px] text-muted-foreground">{v} · {formatPrice(rate)}/unit</span>
                          <input
                            type="number" min="0" step="1"
                            value={vehicleCounts[v] ?? ""}
                            onChange={(e) => setVehicleCounts((p) => ({ ...p, [v]: parseInt(e.target.value) || 0 }))}
                            className="mt-1 w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm"
                            placeholder="0"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-muted/50 border border-border p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Computed amount</p>
                    <p className="text-xs text-muted-foreground">
                      Base {formatPrice(baseAmount)}{categoryBonus > 0 ? ` + bonus ${formatPrice(categoryBonus)}` : ""}
                    </p>
                  </div>
                </div>
                <span className="text-2xl font-bold text-primary">{formatPrice(total)}</span>
              </div>
            </>
          )}

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={2}
              className="mt-1.5 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm resize-none"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !comp || total <= 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Record Expense ({currency.symbol}{total.toFixed(2)})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 border border-border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground capitalize mt-0.5">{value}</p>
    </div>
  );
}
