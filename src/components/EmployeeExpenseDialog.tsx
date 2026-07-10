import { useEffect, useMemo, useState } from "react";
import { X, Users, Calculator, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { toast } from "sonner";

const BUSY_THRESHOLD = 20;
const QUIET_THRESHOLD = 10;

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

function pairAttendance(rows: AttRow[]) {
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
  let totalMs = 0;
  const workedDays = new Set<string>();
  const hoursByDay = new Map<string, number>();
  for (const [key, pairs] of byDate) {
    let dayMs = 0; let hasPair = false;
    for (const p of pairs) if (p.in && p.out) { dayMs += p.out.getTime() - p.in.getTime(); hasPair = true; }
    if (hasPair) {
      const lunch = dayMs > 5 * 3600_000 ? 3600_000 : 0;
      const net = Math.max(0, dayMs - lunch);
      totalMs += net;
      workedDays.add(key);
      hoursByDay.set(key, net / 3600_000);
    }
  }
  return { hours: totalMs / 3600_000, workedDays, hoursByDay };
}

export function EmployeeExpenseDialog({ open, onClose }: Props) {
  const { tenant } = useTenant();
  const { formatPrice, currency } = useCurrency();
  const { addExpense } = useExpenses();
  const { categories } = useExpenseCategories();

  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [comps, setComps] = useState<Compensation[]>([]);
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  const [dayVolumes, setDayVolumes] = useState<Record<string, number>>({});
  const [category, setCategory] = useState("Salaries");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { from, to, daysInMonth } = useMemo(() => {
    const f = new Date(monthAnchor);
    const t = new Date(f.getFullYear(), f.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: f, to: t, daysInMonth: t.getDate() };
  }, [monthAnchor]);

  // load staff list (names + emails) via edge function, and active status
  useEffect(() => {
    if (!open || !tenant?.id) return;
    (async () => {
      const [staffRes, activeRes] = await Promise.all([
        supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant.id } }),
        supabase.from("staff_active_status" as any).select("user_id, is_active").eq("tenant_id", tenant.id),
      ]);
      const compRes = { data: (staffRes.data?.compensation_rows ?? []) as any[] };
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

  // load attendance
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

  // load tenant-wide order volumes per day for the month (drives busy/quiet classification)
  useEffect(() => {
    if (!open || !tenant?.id) { setDayVolumes({}); return; }
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("created_at, status")
        .eq("tenant_id", tenant.id)
        .neq("status", "cancelled")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString());
      const map: Record<string, number> = {};
      ((data as any[]) || []).forEach((r) => {
        const k = new Date(r.created_at).toDateString();
        map[k] = (map[k] || 0) + 1;
      });
      setDayVolumes(map);
    })();
  }, [open, tenant?.id, from, to]);

  const comp = comps.find((c) => c.user_id === staffId);
  const selected = staff.find((s) => s.id === staffId);
  const displayName = selected ? (selected.name || selected.email.split("@")[0] || "Employee") : "";
  const { hours, workedDays, hoursByDay } = useMemo(() => pairAttendance(attendance), [attendance]);
  const days = workedDays.size;
  const [workBonus, setWorkBonus] = useState<string>("");

  // Build the day grid for the chosen month, clamped to "today" so future days aren't counted.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayCells = useMemo(() => {
    const cells: { date: Date; status: "worked" | "absent" | "future" }[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), i);
      let status: "worked" | "absent" | "future";
      if (d > today) status = "future";
      else if (workedDays.has(d.toDateString())) status = "worked";
      else status = "absent";
      cells.push({ date: d, status });
    }
    return cells;
  }, [from, daysInMonth, workedDays, today]);

  const absentDays = dayCells.filter((c) => c.status === "absent").length;

  // Count busy/quiet days based on worked days only.
  const { busyDays, quietDays, normalDays } = useMemo(() => {
    let busy = 0, quiet = 0, normal = 0;
    workedDays.forEach((key) => {
      const v = dayVolumes[key] || 0;
      if (v >= BUSY_THRESHOLD) busy++;
      else if (v < QUIET_THRESHOLD) quiet++;
      else normal++;
    });
    return { busyDays: busy, quietDays: quiet, normalDays: normal };
  }, [workedDays, dayVolumes]);

  // Base amount: for wage/hourly, quiet days are paid at quiet_day_rate (flat)
  // instead of the base rate. Busy days pay the normal base rate; any bonus
  // is entered manually as "Work Bonus" below.
  const baseAmount = useMemo(() => {
    if (!comp) return 0;
    if (comp.pay_type === "salary") return comp.base_rate;
    if (comp.pay_type === "wage") {
      const paidAtBase = days - quietDays; // normal + busy days
      return comp.base_rate * paidAtBase + comp.quiet_day_rate * quietDays;
    }
    // hourly
    let sum = 0;
    hoursByDay.forEach((h, key) => {
      const v = dayVolumes[key] || 0;
      if (v < QUIET_THRESHOLD) sum += comp.quiet_day_rate; // flat quiet-day pay
      else sum += comp.base_rate * h;
    });
    return sum;
  }, [comp, days, quietDays, hoursByDay, dayVolumes]);

  const workBonusAmount = Number(workBonus) || 0;
  const total = baseAmount + workBonusAmount;

  const monthLabel = from.toLocaleString(undefined, { month: "long", year: "numeric" });

  const handleSubmit = async () => {
    if (!selected) { toast.error("Select an employee"); return; }
    if (!comp) { toast.error("No pay settings — set them in Settings → Workers"); return; }
    if (total <= 0) { toast.error("Computed amount is zero"); return; }
    setSaving(true);
    const parts: string[] = [PAY_LABEL[comp.pay_type]];
    if (comp.pay_type === "wage") parts.push(`${days} day(s)`);
    else if (comp.pay_type === "hourly") parts.push(`${hours.toFixed(2)}h`);
    if (busyDays > 0) parts.push(`${busyDays} busy day(s)`);
    if (quietDays > 0) parts.push(`${quietDays} quiet day(s)`);
    const desc = `Remuneration — ${displayName} (${monthLabel})`;
    const summary = `${parts.join(", ")} · ${days} worked / ${absentDays} absent`;
    await addExpense({
      description: desc,
      amount: Number(total.toFixed(2)),
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
              {/* Pay settings summary */}
              <div className="rounded-xl border border-border bg-muted/30 p-3 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pay setting</p>
                  <p className="text-sm font-semibold text-foreground">{PAY_LABEL[comp.pay_type]}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rate</p>
                  <p className="text-sm font-semibold text-foreground">
                    {formatPrice(comp.base_rate)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {comp.pay_type === "salary" ? "/month" : comp.pay_type === "wage" ? "/day" : "/hour"}
                    </span>
                  </p>
                </div>
                {comp.pay_type === "hourly" && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Hours (−1h lunch /day)</p>
                    <p className="text-sm font-semibold text-foreground">{hours.toFixed(2)}h</p>
                  </div>
                )}
              </div>

              {/* Month attendance chart */}
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
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" />Worked {days}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Absent {absentDays}</span>
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
                    const cls = c.status === "worked"
                      ? "bg-emerald-500 text-white"
                      : c.status === "absent"
                      ? "bg-red-500/80 text-white"
                      : "bg-muted text-muted-foreground";
                    return (
                  <div
                    key={c.date.toISOString()}
                    className={`h-[45px] w-full rounded-md flex items-center justify-center text-[13px] font-medium ${cls}`}
                    title={`${c.date.toDateString()} — ${c.status}`}
                  >
                    {c.date.getDate()}
                  </div>
                    );
                  })}
                </div>
              </div>

              {(comp.busy_day_rate !== 0 || comp.quiet_day_rate !== 0) && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Day-volume adjustments (busy ≥ {BUSY_THRESHOLD} vehicles, quiet &lt; {QUIET_THRESHOLD} vehicles)
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Busy days · {formatPrice(comp.busy_day_rate)}/day</span>
                      <span className="font-semibold text-foreground">{busyDays}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Quiet days · {formatPrice(comp.quiet_day_rate)}/day</span>
                      <span className="font-semibold text-foreground">{quietDays}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-muted/50 border border-border p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Computed amount</p>
                    <p className="text-xs text-muted-foreground">
                      Base {formatPrice(baseAmount)}{dayAdjustment !== 0 ? ` ${dayAdjustment >= 0 ? "+" : "−"} ${formatPrice(Math.abs(dayAdjustment))} day adj.` : ""}
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
