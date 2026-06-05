import { useEffect, useMemo, useState } from "react";
import { X, Users, Calculator, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
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
  busy_day_rate: number;
  quiet_day_rate: number;
}
interface StaffOption {
  id: string;
  name: string;
  email: string;
  role: string | null;
  active: boolean;
  phone: string | null;
}
interface AttRow {
  user_id: string;
  kind: "check_in" | "check_out";
  created_at: string;
}

const PAY_LABEL: Record<PayType, string> = {
  salary: "Monthly Salary",
  wage: "Daily Wage",
  hourly: "Hourly Rate",
};

const BUSY_THRESHOLD = 20;
const QUIET_THRESHOLD = 10;

interface DayAggregate {
  key: string;
  hours: number;
  hasPair: boolean;
}

function pairAttendance(rows: AttRow[]): Map<string, DayAggregate> {
  const byDate = new Map<string, { in?: Date; out?: Date }[]>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    const d = new Date(r.created_at);
    const key = d.toDateString();
    const list = byDate.get(key) ?? [];
    if (r.kind === "check_in") list.push({ in: d });
    else {
      const last = list[list.length - 1];
      if (last && !last.out) last.out = d;
      else list.push({ out: d });
    }
    byDate.set(key, list);
  }
  const result = new Map<string, DayAggregate>();
  for (const [key, pairs] of byDate) {
    let dayMs = 0; let hasPair = false;
    for (const p of pairs) if (p.in && p.out) { dayMs += p.out.getTime() - p.in.getTime(); hasPair = true; }
    if (hasPair) {
      const lunch = dayMs > 5 * 3600_000 ? 3600_000 : 0;
      result.set(key, { key, hours: Math.max(0, dayMs - lunch) / 3600_000, hasPair: true });
    }
  }
  return result;
}

export function EmployeeExpenseDialog({ open, onClose }: Props) {
  const { tenant } = useTenant();
  const { formatPrice, currency } = useCurrency();
  const { addExpense } = useExpenses();
  const { categories } = useExpenseCategories();

  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [comps, setComps] = useState<Compensation[]>([]);
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [dailyVehicleCounts, setDailyVehicleCounts] = useState<Map<string, number>>(new Map());
  const [staffId, setStaffId] = useState("");
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [category, setCategory] = useState("Salaries");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { from, to, daysInMonth } = useMemo(() => {
    const f = new Date(monthAnchor);
    const t = new Date(f.getFullYear(), f.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: f, to: t, daysInMonth: t.getDate() };
  }, [monthAnchor]);

  useEffect(() => {
    if (!open || !tenant?.id) return;
    (async () => {
      const [staffRes, activeRes, compRes] = await Promise.all([
        supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant.id } }),
        supabase.from("staff_active_status" as any).select("user_id, is_active").eq("tenant_id", tenant.id),
        supabase.from("staff_compensation" as any).select("user_id, pay_type, base_rate, busy_day_rate, quiet_day_rate").eq("tenant_id", tenant.id),
      ]);
      const activeMap = new Map<string, boolean>(
        ((activeRes.data as any[]) || []).map((r) => [r.user_id, r.is_active !== false])
      );
      const list: StaffOption[] = (staffRes.data?.users ?? [])
        .map((u: any) => ({
          id: u.id, name: u.name || "", email: u.email || "",
          role: u.role ?? null,
          active: activeMap.get(u.id) ?? true,
          phone: u.phone ?? null,
        }))
        .filter((u: StaffOption) => u.active)
        .sort((a: StaffOption, b: StaffOption) =>
          (a.name || a.email).localeCompare(b.name || b.email)
        );
      setStaff(list);
      setComps(((compRes.data as any[]) || []).map((r) => ({
        user_id: r.user_id,
        pay_type: r.pay_type as PayType,
        base_rate: Number(r.base_rate) || 0,
        busy_day_rate: Number(r.busy_day_rate) || 0,
        quiet_day_rate: Number(r.quiet_day_rate) || 0,
      })));
    })();
  }, [open, tenant?.id]);

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

  // Load tenant-wide daily completed vehicle counts for the month
  useEffect(() => {
    if (!open || !tenant?.id) { setDailyVehicleCounts(new Map()); return; }
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("completed_at,status")
        .eq("tenant_id", tenant.id)
        .eq("status", "completed")
        .gte("completed_at", from.toISOString())
        .lte("completed_at", to.toISOString());
      const m = new Map<string, number>();
      ((data as any[]) || []).forEach((o) => {
        if (!o.completed_at) return;
        const k = new Date(o.completed_at).toDateString();
        m.set(k, (m.get(k) || 0) + 1);
      });
      setDailyVehicleCounts(m);
    })();
  }, [open, tenant?.id, from, to]);

  const comp = comps.find((c) => c.user_id === staffId);
  const selected = staff.find((s) => s.id === staffId);
  const displayName = selected ? (selected.name || selected.email.split("@")[0] || "Employee") : "";
  const workedMap = useMemo(() => pairAttendance(attendance), [attendance]);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const dayCells = useMemo(() => {
    const cells: {
      date: Date;
      status: "worked" | "absent" | "future";
      volume: "busy" | "quiet" | "normal";
      vehicles: number;
    }[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), i);
      const key = d.toDateString();
      const vehicles = dailyVehicleCounts.get(key) || 0;
      const volume: "busy" | "quiet" | "normal" =
        vehicles >= BUSY_THRESHOLD ? "busy" : vehicles < QUIET_THRESHOLD ? "quiet" : "normal";
      let status: "worked" | "absent" | "future";
      if (d > today) status = "future";
      else if (workedMap.has(key)) status = "worked";
      else status = "absent";
      cells.push({ date: d, status, volume, vehicles });
    }
    return cells;
  }, [from, daysInMonth, workedMap, dailyVehicleCounts, today]);

  const breakdown = useMemo(() => {
    if (!comp) return { total: 0, normalDays: 0, busyDays: 0, quietDays: 0, normalPay: 0, busyPay: 0, quietPay: 0, hours: 0 };

    const workedDays = dayCells.filter((c) => c.status === "worked");
    const busyRate = comp.busy_day_rate;
    const quietRate = comp.quiet_day_rate;

    let normalDays = 0, busyDays = 0, quietDays = 0;
    let busyPay = 0, quietPay = 0, normalPay = 0, hours = 0;

    // Per-day base when on salary/wage
    const perDayBase =
      comp.pay_type === "wage" ? comp.base_rate
      : comp.pay_type === "salary" ? (comp.base_rate / daysInMonth)
      : 0; // hourly handled below

    for (const c of workedDays) {
      const agg = workedMap.get(c.date.toDateString());
      const dayHours = agg?.hours ?? 0;
      hours += dayHours;

      const useBusy = c.volume === "busy" && busyRate > 0;
      const useQuiet = c.volume === "quiet" && quietRate > 0;

      if (useBusy) {
        busyDays++;
        busyPay += busyRate;
      } else if (useQuiet) {
        quietDays++;
        quietPay += quietRate;
      } else {
        normalDays++;
        if (comp.pay_type === "hourly") normalPay += comp.base_rate * dayHours;
        else normalPay += perDayBase;
      }
    }
    return {
      total: normalPay + busyPay + quietPay,
      normalDays, busyDays, quietDays,
      normalPay, busyPay, quietPay,
      hours,
    };
  }, [comp, dayCells, workedMap, daysInMonth]);

  const absentDays = dayCells.filter((c) => c.status === "absent").length;
  const monthLabel = from.toLocaleString(undefined, { month: "long", year: "numeric" });
  const totalWorked = breakdown.normalDays + breakdown.busyDays + breakdown.quietDays;

  const handleSubmit = async () => {
    if (!selected) { toast.error("Select an employee"); return; }
    if (!comp) { toast.error("No pay settings — set them in Settings → Workers"); return; }
    if (breakdown.total <= 0) { toast.error("Computed amount is zero"); return; }
    setSaving(true);
    const parts: string[] = [PAY_LABEL[comp.pay_type]];
    if (breakdown.busyDays > 0) parts.push(`${breakdown.busyDays} busy`);
    if (breakdown.quietDays > 0) parts.push(`${breakdown.quietDays} quiet`);
    const desc = `Remuneration — ${displayName} (${monthLabel})`;
    const summary = `${parts.join(", ")} · ${totalWorked} worked / ${absentDays} absent`;
    await addExpense({
      description: desc,
      amount: Number(breakdown.total.toFixed(2)),
      category,
      vendor: displayName,
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
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.email.split("@")[0] || "Staff"}{s.role ? ` · ${s.role}` : ""}{s.phone ? ` · ${s.phone}` : ""}
                  </option>
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

          {staffId && !comp && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm p-3">
              No pay settings for this employee. Set their pay type and rate under Settings → Workers.
            </div>
          )}

          {comp && (
            <>
              <div className="rounded-xl border border-border bg-muted/30 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pay setting</p>
                  <p className="text-sm font-semibold text-foreground">{PAY_LABEL[comp.pay_type]}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Base rate</p>
                  <p className="text-sm font-semibold text-foreground">
                    {formatPrice(comp.base_rate)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {comp.pay_type === "salary" ? "/mo" : comp.pay_type === "wage" ? "/day" : "/hr"}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Busy day wage</p>
                  <p className="text-sm font-semibold text-foreground">{comp.busy_day_rate > 0 ? formatPrice(comp.busy_day_rate) : "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Quiet day wage</p>
                  <p className="text-sm font-semibold text-foreground">{comp.quiet_day_rate > 0 ? formatPrice(comp.quiet_day_rate) : "—"}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                      className="p-1.5 rounded-md hover:bg-muted"
                      aria-label="Previous month"
                    ><ChevronLeft className="w-4 h-4" /></button>
                    <p className="text-sm font-semibold text-foreground min-w-[140px] text-center">{monthLabel}</p>
                    <button
                      onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                      className="p-1.5 rounded-md hover:bg-muted"
                      aria-label="Next month"
                    ><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" />Worked {totalWorked}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Absent {absentDays}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-amber-500" />Busy</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-sky-500" />Quiet</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="text-[10px] text-center text-muted-foreground py-1">{d}</div>
                  ))}
                  {Array.from({ length: from.getDay() }).map((_, i) => (
                    <div key={`pad-${i}`} />
                  ))}
                  {dayCells.map((c) => {
                    const base = c.status === "worked"
                      ? "bg-emerald-500 text-white"
                      : c.status === "absent"
                      ? "bg-red-500/80 text-white"
                      : "bg-muted text-muted-foreground";
                    const ring = c.volume === "busy" ? "ring-2 ring-amber-500"
                      : c.volume === "quiet" ? "ring-2 ring-sky-500" : "";
                    return (
                      <div
                        key={c.date.toISOString()}
                        className={`h-[45px] w-full rounded-md flex items-center justify-center text-[13px] font-medium ${base} ${ring}`}
                        title={`${c.date.toDateString()} — ${c.status} · ${c.vehicles} vehicle(s)`}
                      >
                        {c.date.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-muted/50 border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Computed amount</p>
                  </div>
                  <span className="text-2xl font-bold text-primary">{formatPrice(breakdown.total)}</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>Normal days: {breakdown.normalDays} → {formatPrice(breakdown.normalPay)}{comp.pay_type === "hourly" ? ` (${breakdown.hours.toFixed(2)}h)` : ""}</p>
                  <p>Busy days (≥ {BUSY_THRESHOLD}): {breakdown.busyDays} → {formatPrice(breakdown.busyPay)}</p>
                  <p>Quiet days (&lt; {QUIET_THRESHOLD}): {breakdown.quietDays} → {formatPrice(breakdown.quietPay)}</p>
                  <p className="italic">Busy/quiet day wages replace normal pay on qualifying days.</p>
                </div>
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
              disabled={saving || !comp || breakdown.total <= 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              Record Expense ({currency.symbol}{breakdown.total.toFixed(2)})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
