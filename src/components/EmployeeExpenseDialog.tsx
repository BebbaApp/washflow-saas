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

  useEffect(() => {
    if (!open || !tenant?.id) { setDailyVehicleCounts(new Map()); return; }
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("completed_at, created_at, status")
        .eq("status", "completed")
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString());
      const map = new Map<string, number>();
      ((data as any[]) || []).forEach((o) => {
        const ts = o.completed_at || o.created_at;
        if (!ts) return;
        const key = new Date(ts).toDateString();
        map.set(key, (map.get(key) || 0) + 1);
      });
      setDailyVehicleCounts(map);
    })();
  }, [open, tenant?.id, from, to]);

  const comp = comps.find((c) => c.user_id === staffId);
  const selected = staff.find((s) => s.id === staffId);
  const displayName = selected ? (selected.name || selected.email.split("@")[0] || "Employee") : "";
  const { hours, workedDays, hoursByDay } = useMemo(() => pairAttendance(attendance), [attendance]);
  const days = workedDays.size;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayCells = useMemo(() => {
    const cells: { date: Date; status: "worked" | "absent" | "future"; volume: "busy" | "quiet" | "normal" | "none" }[] = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(from.getFullYear(), from.getMonth(), i);
      let status: "worked" | "absent" | "future";
      if (d > today) status = "future";
      else if (workedDays.has(d.toDateString())) status = "worked";
      else status = "absent";
      const cnt = dailyVehicleCounts.get(d.toDateString()) || 0;
      let volume: "busy" | "quiet" | "normal" | "none";
      if (status === "future") volume = "none";
      else if (cnt >= BUSY_THRESHOLD) volume = "busy";
      else if (cnt < QUIET_THRESHOLD) volume = "quiet";
      else volume = "normal";
      cells.push({ date: d, status, volume });
    }
    return cells;
  }, [from, daysInMonth, workedDays, today, dailyVehicleCounts]);

  const absentDays = dayCells.filter((c) => c.status === "absent").length;

  // Per-day pay model: busy/quiet wages REPLACE the day's normal pay when set (> 0).
  const { busyWorked, quietWorked, normalWorked, normalHours, busyPay, quietPay, normalPay, total } = useMemo(() => {
    let busyWorked = 0, quietWorked = 0, normalWorked = 0, normalHours = 0;
    let busyPay = 0, quietPay = 0, normalPay = 0;
    const baseRate = comp?.base_rate || 0;
    const busyRate = comp?.busy_day_rate || 0;
    const quietRate = comp?.quiet_day_rate || 0;
    const payType = comp?.pay_type || "salary";
    const salaryPerDay = payType === "salary" ? baseRate / Math.max(1, daysInMonth) : 0;

    const dailyNormal = (key: string) => {
      if (payType === "wage") return baseRate;
      if (payType === "hourly") return baseRate * (hoursByDay.get(key) || 0);
      return salaryPerDay;
    };

    for (const c of dayCells) {
      if (c.status !== "worked") continue;
      const key = c.date.toDateString();
      const useBusy = c.volume === "busy" && busyRate > 0;
      const useQuiet = c.volume === "quiet" && quietRate > 0;
      if (useBusy) {
        busyWorked++;
        busyPay += busyRate;
      } else if (useQuiet) {
        quietWorked++;
        quietPay += quietRate;
      } else {
        normalWorked++;
        normalHours += hoursByDay.get(key) || 0;
        normalPay += dailyNormal(key);
      }
    }

    return {
      busyWorked, quietWorked, normalWorked, normalHours,
      busyPay, quietPay, normalPay,
      total: busyPay + quietPay + normalPay,
    };
  }, [comp, dayCells, hoursByDay, daysInMonth]);

  const monthLabel = from.toLocaleString(undefined, { month: "long", year: "numeric" });

  const handleSubmit = async () => {
    if (!selected) { toast.error("Select an employee"); return; }
    if (!comp) { toast.error("No pay settings — set them in Settings → Workers"); return; }
    if (total <= 0) { toast.error("Computed amount is zero"); return; }
    setSaving(true);
    const parts: string[] = [PAY_LABEL[comp.pay_type]];
    if (comp.pay_type === "hourly") parts.push(`${normalHours.toFixed(2)}h normal`);
    parts.push(`${normalWorked} normal / ${busyWorked} busy / ${quietWorked} quiet`);
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
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
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
                    const cnt = dailyVehicleCounts.get(c.date.toDateString()) || 0;
                    const ring = c.volume === "busy"
                      ? "ring-2 ring-amber-400"
                      : c.volume === "quiet"
                      ? "ring-2 ring-sky-400"
                      : "";
                    return (
                  <div
                    key={c.date.toISOString()}
                    className={`h-[45px] w-full rounded-md flex flex-col items-center justify-center text-[13px] font-medium ${cls} ${ring}`}
                    title={`${c.date.toDateString()} — ${c.status} · ${cnt} vehicle(s)`}
                  >
                    <span>{c.date.getDate()}</span>
                    {c.status !== "future" && (
                      <span className="text-[9px] leading-none opacity-80">{cnt}</span>
                    )}
                  </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-amber-400" />Busy (≥{BUSY_THRESHOLD})</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm ring-2 ring-sky-400" />Quiet (&lt;{QUIET_THRESHOLD})</span>
                </div>
              </div>

              <div className="rounded-xl border border-border p-3 text-sm space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Pay breakdown</p>
                <p className="text-foreground">
                  Normal days: <span className="font-semibold">{normalWorked}</span>
                  {comp.pay_type === "hourly" && <> · <span className="font-semibold">{normalHours.toFixed(2)}h</span></>}
                  {" "}= <span className="font-semibold">{formatPrice(normalPay)}</span>
                </p>
                {comp.busy_day_rate > 0 && (
                  <p className="text-foreground">
                    Busy days: <span className="font-semibold">{busyWorked}</span> × {formatPrice(comp.busy_day_rate)} = <span className="font-semibold">{formatPrice(busyPay)}</span>
                  </p>
                )}
                {comp.quiet_day_rate > 0 && (
                  <p className="text-foreground">
                    Quiet days: <span className="font-semibold">{quietWorked}</span> × {formatPrice(comp.quiet_day_rate)} = <span className="font-semibold">{formatPrice(quietPay)}</span>
                  </p>
                )}
                {(comp.busy_day_rate > 0 || comp.quiet_day_rate > 0) && (
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Busy/Quiet day wages replace the day's normal pay.
                  </p>
                )}
              </div>

              <div className="rounded-xl bg-muted/50 border border-border p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Computed amount</p>
                    <p className="text-xs text-muted-foreground">
                      {formatPrice(normalPay)} normal
                      {busyPay > 0 ? ` + ${formatPrice(busyPay)} busy` : ""}
                      {quietPay > 0 ? ` + ${formatPrice(quietPay)} quiet` : ""}
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
