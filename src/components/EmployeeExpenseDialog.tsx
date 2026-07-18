import { useEffect, useMemo, useState } from "react";
import { X, Users, Calculator, ChevronLeft, ChevronRight, MinusCircle, Pencil, Trash2, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenses } from "@/hooks/useExpenses";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useAttendance } from "@/hooks/useAttendance";
import { useLiveTable } from "@/offline/useLiveTable";
import { offlineUpdate, offlineDelete } from "@/offline/offlineWrite";
import { toast } from "sonner";

const BUSY_THRESHOLD = 20;
const QUIET_THRESHOLD = 10;

interface Props {
  open: boolean;
  onClose: () => void;
}

type PayType = "salary" | "wage" | "weekly";
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
  weekly: "Weekly Wage",
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

function getWeekMonday(d: Date) {
  const day = d.getDay();
  const diffToMon = (day + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diffToMon);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function EmployeeExpenseDialog({ open, onClose }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { formatPrice, currency } = useCurrency();
  const { addExpense } = useExpenses();
  const { categories } = useExpenseCategories();

  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [comps, setComps] = useState<Compensation[]>([]);
  const { records: liveAttendance } = useAttendance();
  const [staffId, setStaffId] = useState("");
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });
  // dayVolumes derived below from local Dexie orders mirror
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

  // Derive attendance for selected staff + month from the live records feed
  // (same source as the Work log calendar). Using the shared cache avoids the
  // per-dialog direct query that could return empty on some sessions.
  const attendance = useMemo<AttRow[]>(() => {
    if (!staffId) return [];
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return (liveAttendance || [])
      .filter((r: any) => r.user_id === staffId)
      .filter((r: any) => {
        const t = new Date(r.created_at).getTime();
        return t >= fromMs && t <= toMs;
      })
      .map((r: any) => ({ user_id: r.user_id, kind: r.kind, created_at: r.created_at }));
  }, [liveAttendance, staffId, from, to]);

  // Tenant-wide order volumes per day for the month (drives busy/quiet
  // classification). Read from the local Dexie mirror so this works offline
  // and matches the counts the rest of the app displays.
  const orderRows = useLiveTable<any>(tenant?.id, "orders");
  const dayVolumes = useMemo<Record<string, number>>(() => {
    if (!orderRows) return {};
    const fromMs = from.getTime();
    const toMs = to.getTime();
    const map: Record<string, number> = {};
    for (const r of orderRows) {
      const status = String(r?.status ?? "");
      if (status === "cancelled" || status === "deleted") continue;
      const t = new Date(r.created_at).getTime();
      if (isNaN(t) || t < fromMs || t > toMs) continue;
      const k = new Date(r.created_at).toDateString();
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }, [orderRows, from, to]);

  const comp = comps.find((c) => c.user_id === staffId);
  const selected = staff.find((s) => s.id === staffId);
  const displayName = selected ? (selected.name || selected.email.split("@")[0] || "Employee") : "";
  const { hours, workedDays, hoursByDay } = useMemo(() => pairAttendance(attendance), [attendance]);
  const totalWorkedDays = workedDays.size;
  const [workBonus, setWorkBonus] = useState<string>("");
  const [selectedWeeks, setSelectedWeeks] = useState<Set<string>>(new Set());

  // No default selection — user explicitly picks which weeks to calculate.
  // Reset when the employee or month changes.
  useEffect(() => {
    setSelectedWeeks(new Set());
  }, [staffId, monthAnchor]);

  const selectedWorkedDays = useMemo(() => {
    const selected = new Set<string>();
    workedDays.forEach((k) => {
      const d = new Date(k); d.setHours(0, 0, 0, 0);
      selectedWeeks.forEach((weekKey) => {
        const start = new Date(weekKey); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        if (d >= start && d <= end) selected.add(k);
      });
    });
    return selected;
  }, [workedDays, selectedWeeks]);

  const selectedDays = selectedWorkedDays.size;
  const { busyDays, quietDays, normalDays } = useMemo(() => {
    let busy = 0, quiet = 0, normal = 0;
    selectedWorkedDays.forEach((key) => {
      const v = dayVolumes[key] || 0;
      if (v >= BUSY_THRESHOLD) busy++;
      else if (v < QUIET_THRESHOLD) quiet++;
      else normal++;
    });
    return { busyDays: busy, quietDays: quiet, normalDays: normal };
  }, [selectedWorkedDays, dayVolumes]);

  const selectedWeeksWorked = selectedWeeks.size;

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

  // Calendar weeks for rendering with a checkbox per row.
  // Key each row by the ISO date of its first non-null cell — always unique
  // within a month, so no key collisions like getWeekMonday could produce.
  const calendarWeeks = useMemo(() => {
    const weeks: { key: string; cells: ({ date: Date; status: "worked" | "absent" | "future" } | null)[] }[] = [];
    let currentWeek: ({ date: Date; status: "worked" | "absent" | "future" } | null)[] = [];
    for (let i = 0; i < from.getDay(); i++) currentWeek.push(null);
    const flush = () => {
      const firstDay = currentWeek.find((c) => c !== null)?.date;
      const key = firstDay ? firstDay.toISOString() : `empty-${weeks.length}`;
      weeks.push({ key, cells: currentWeek });
      currentWeek = [];
    };
    for (const c of dayCells) {
      currentWeek.push(c);
      if (currentWeek.length === 7) flush();
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      flush();
    }
    return weeks;
  }, [dayCells, from]);

  const selectedAbsentDays = useMemo(() => {
    let count = 0;
    calendarWeeks.forEach((week) => {
      if (!selectedWeeks.has(week.key)) return;
      week.cells.forEach((cell) => {
        if (cell?.status === "absent") count++;
      });
    });
    return count;
  }, [calendarWeeks, selectedWeeks]);

  // Base amount: for wage, quiet days are paid at quiet_day_rate (flat)
  // instead of the base rate. Salary and weekly are flat amounts; busy-day
  // bonuses are entered manually as "Work Bonus" below.
  const baseAmount = useMemo(() => {
    if (!comp) return 0;
    if (comp.pay_type === "salary") return comp.base_rate;
    if (comp.pay_type === "weekly") return comp.base_rate * selectedWeeksWorked;
    // wage
    const paidAtBase = selectedDays - quietDays; // normal + busy days
    return comp.base_rate * paidAtBase + comp.quiet_day_rate * quietDays;
  }, [comp, selectedDays, quietDays, selectedWeeksWorked]);

  const workBonusAmount = Number(workBonus) || 0;

  // ── Pay adjustments (advances + penalties) ────────────────────────────────
  const adjRows = useLiveTable<any>(tenant?.id, "staff_pay_adjustments");
  const weekRanges = useMemo(() => {
    return Array.from(selectedWeeks).map((k) => {
      const start = new Date(k); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999);
      return { start, end };
    });
  }, [selectedWeeks]);
  const applicableAdjustments = useMemo(() => {
    if (!staffId || weekRanges.length === 0) return [] as any[];
    return (adjRows ?? []).filter((r: any) => {
      if (r.worker_id !== staffId) return false;
      if ((r.status ?? "pending") !== "pending") return false;
      const d = new Date(r.date + "T00:00:00");
      return weekRanges.some((w) => d >= w.start && d <= w.end);
    });
  }, [adjRows, staffId, weekRanges]);
  const adjustmentTotals = useMemo(() => {
    let advances = 0; let penalties = 0;
    applicableAdjustments.forEach((r) => {
      const n = Number(r.amount) || 0;
      if (r.kind === "advance") advances += n; else penalties += n;
    });
    return { advances, penalties, total: advances + penalties };
  }, [applicableAdjustments]);

  const grossBeforeAdjustments = baseAmount + workBonusAmount;
  const rawNet = grossBeforeAdjustments - adjustmentTotals.total;
  const wouldGoNegative = rawNet < 0;
  const total = Math.max(0, rawNet);

  const canManageAdj = user?.role === "admin" || user?.role === "manager";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<"advance" | "penalty">("advance");
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editDate, setEditDate] = useState("");

  const beginEdit = (r: any) => {
    setEditingId(r.id);
    setEditKind(r.kind);
    setEditAmount(String(r.amount ?? ""));
    setEditReason(r.reason ?? "");
    setEditDate(r.date);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (r: any) => {
    if (!tenant?.id) return;
    const amt = Number(editAmount);
    if (!(amt > 0)) { toast.error("Amount must be greater than 0"); return; }
    if (!editDate) { toast.error("Date required"); return; }
    try {
      await offlineUpdate("staff_pay_adjustments", tenant.id, r.id, {
        kind: editKind,
        amount: Number(amt.toFixed(2)),
        reason: editReason.trim() || null,
        date: editDate,
      });
      toast.success("Adjustment updated");
      setEditingId(null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    }
  };
  const cancelAdjustment = async (r: any) => {
    if (!tenant?.id) return;
    if (!confirm(`Cancel this ${r.kind} of ${formatPrice(Number(r.amount) || 0)}? It will no longer deduct from the payout.`)) return;
    try {
      await offlineDelete("staff_pay_adjustments", tenant.id, r.id);
      toast.success("Adjustment cancelled");
    } catch (e: any) {
      toast.error(e?.message || "Failed to cancel");
    }
  };

  const monthLabel = from.toLocaleString(undefined, { month: "long", year: "numeric" });

  const handleSubmit = async () => {
    if (!selected) { toast.error("Select an employee"); return; }
    if (!comp) { toast.error("No pay settings — set them in Settings → Workers"); return; }
    if (wouldGoNegative) {
      toast.error(`Adjustments (${formatPrice(adjustmentTotals.total)}) exceed pay (${formatPrice(grossBeforeAdjustments)}). Edit or cancel some adjustments first.`);
      return;
    }
    if (total <= 0) { toast.error("Computed amount is zero"); return; }
    if (!tenant?.id) return;
    setSaving(true);
    const parts: string[] = [PAY_LABEL[comp.pay_type]];
    if (comp.pay_type === "wage") parts.push(`${selectedDays} day(s)`);
    else if (comp.pay_type === "weekly") parts.push(`${selectedWeeksWorked} week(s)`);
    if (quietDays > 0) parts.push(`${quietDays} quiet day(s) @ ${formatPrice(comp.quiet_day_rate)}`);
    if (busyDays > 0) parts.push(`${busyDays} busy day(s)`);
    if (workBonusAmount > 0) parts.push(`work bonus ${formatPrice(workBonusAmount)}`);
    if (adjustmentTotals.advances > 0) parts.push(`less advances ${formatPrice(adjustmentTotals.advances)}`);
    if (adjustmentTotals.penalties > 0) parts.push(`less penalties ${formatPrice(adjustmentTotals.penalties)}`);
    const desc = `Remuneration — ${displayName} (${monthLabel})`;
    const summary = `${parts.join(", ")} · ${selectedDays} worked / ${selectedAbsentDays} absent`;
    const created = await addExpense({
      description: desc,
      amount: Number(total.toFixed(2)),
      category,
      vendor: displayName,
      notes: notes ? `${summary}\n${notes}` : summary,
      date: new Date().toISOString(),
    });
    // Settle the applied adjustments so they don't deduct again next payout.
    if (applicableAdjustments.length > 0) {
      const now = new Date().toISOString();
      for (const adj of applicableAdjustments) {
        try {
          await offlineUpdate("staff_pay_adjustments", tenant.id, adj.id, {
            status: "settled",
            settled_at: now,
            settled_by: user?.id ?? null,
            settled_expense_id: created?.id ?? null,
          });
        } catch { /* ignore individual failures */ }
      }
    }
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
                      {comp.pay_type === "salary" ? "/month" : comp.pay_type === "wage" ? "/day" : "/week"}
                    </span>
                  </p>
                </div>
                {comp.pay_type === "weekly" && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Weeks selected</p>
                    <p className="text-sm font-semibold text-foreground">{selectedWeeksWorked}</p>
                  </div>
                )}
              </div>

              {/* Month attendance chart */}
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
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
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500" />Worked {totalWorkedDays}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Absent {absentDays}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-primary" />Selected {selectedDays}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="grid grid-cols-[auto_repeat(7,1fr)] gap-1 items-center">
                    <div /> {/* checkbox column header */}
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                      <div key={i} className="text-[10px] text-center text-muted-foreground py-1">{d}</div>
                    ))}
                  </div>
                  {calendarWeeks.map((week) => {
                    const weekKey = week.key;
                    const isSelected = selectedWeeks.has(weekKey);
                    const hasWorked = week.cells.some((c) => c?.status === "worked");
                    return (
                      <div key={weekKey} className="grid grid-cols-[auto_repeat(7,1fr)] gap-1 items-center">
                        <div className="flex items-center justify-center px-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!hasWorked}
                            onChange={(e) => {
                              const next = new Set(selectedWeeks);
                              if (e.target.checked) next.add(weekKey);
                              else next.delete(weekKey);
                              setSelectedWeeks(next);
                            }}
                            className="w-4 h-4 accent-primary cursor-pointer disabled:opacity-40"
                            title={hasWorked ? "Include this week in the breakdown" : "No worked days in this week"}
                          />
                        </div>
                        {week.cells.map((c, i) => {
                          if (!c) return <div key={i} />;
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
                    );
                  })}
                </div>
              </div>

              {/* Per-day breakdown */}
              {selectedDays > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-secondary flex items-center justify-between text-xs font-semibold text-foreground">
                    <span>Per-day breakdown</span>
                    <span className="text-muted-foreground font-normal">{selectedDays} worked day{selectedDays === 1 ? "" : "s"}</span>
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-border">
                    <div className="grid grid-cols-12 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                      <div className="col-span-5">Date</div>
                      <div className="col-span-2 text-right">Vehicles</div>
                      <div className="col-span-2 text-center">Type</div>
                      <div className="col-span-3 text-right">Rate applied</div>
                    </div>
                    {Array.from(selectedWorkedDays)
                      .map((k) => new Date(k))
                      .sort((a, b) => a.getTime() - b.getTime())
                      .map((d) => {
                        const key = d.toDateString();
                        const vehicles = dayVolumes[key] || 0;
                        const isBusy = vehicles >= BUSY_THRESHOLD;
                        const isQuiet = vehicles < QUIET_THRESHOLD;
                        const label = isBusy ? "Busy" : isQuiet ? "Quiet" : "Normal";
                        const badgeCls = isBusy
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : isQuiet
                          ? "bg-red-500/15 text-red-600 dark:text-red-400"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
                        let rateApplied = "—";
                        if (comp.pay_type === "wage") {
                          rateApplied = isQuiet
                            ? `${formatPrice(comp.quiet_day_rate)} (quiet)`
                            : `${formatPrice(comp.base_rate)} (base)`;
                        } else if (comp.pay_type === "salary") {
                          rateApplied = "flat monthly";
                        } else {
                          rateApplied = "flat weekly";
                        }
                        return (
                          <div key={key} className="grid grid-cols-12 px-3 py-2 text-xs items-center">
                            <div className="col-span-5 text-foreground">
                              {d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}
                              {hoursByDay.get(key) ? (
                                <span className="ml-1.5 text-muted-foreground">· {hoursByDay.get(key)!.toFixed(1)}h</span>
                              ) : null}
                            </div>
                            <div className="col-span-2 text-right font-medium text-foreground">{vehicles}</div>
                            <div className="col-span-2 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeCls}`}>{label}</span>
                            </div>
                            <div className="col-span-3 text-right text-foreground">{rateApplied}</div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {(comp.pay_type === "wage" && comp.quiet_day_rate !== 0) && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Quiet-day rate replaces the base rate on any worked day with &lt; {QUIET_THRESHOLD} vehicles.
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="flex flex-col rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">Quiet · {formatPrice(comp.quiet_day_rate)}/day</span>
                      <span className="font-semibold text-foreground">{quietDays}</span>
                    </div>
                    <div className="flex flex-col rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">Normal (base rate)</span>
                      <span className="font-semibold text-foreground">{normalDays}</span>
                    </div>
                    <div className="flex flex-col rounded-lg bg-muted/40 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">Busy · ≥ {BUSY_THRESHOLD} vehicles</span>
                      <span className="font-semibold text-foreground">{busyDays}</span>
                    </div>
                  </div>
                </div>
              )}

              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  Work Bonus (optional) — {busyDays} busy day{busyDays === 1 ? "" : "s"} this month
                </span>
                <div className="mt-1.5 relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    {currency.symbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={workBonus}
                    onChange={(e) => setWorkBonus(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-background border border-border text-sm"
                  />
                </div>
              </label>

              {applicableAdjustments.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-secondary flex items-center justify-between text-xs font-semibold text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <MinusCircle className="w-3.5 h-3.5" /> Pay adjustments to deduct ({applicableAdjustments.length})
                    </span>
                    <span className="text-red-600 dark:text-red-400">−{formatPrice(adjustmentTotals.total)}</span>
                  </div>
                  <div className="grid grid-cols-12 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                    <div className="col-span-2">Type</div>
                    <div className="col-span-2">Date</div>
                    <div className="col-span-4">Reason</div>
                    <div className="col-span-2 text-right">Amount</div>
                    <div className="col-span-2 text-right">Status</div>
                  </div>
                  <div className="max-h-56 overflow-auto divide-y divide-border">
                    {applicableAdjustments.map((r: any) => {
                      const isEditing = editingId === r.id;
                      if (isEditing) {
                        return (
                          <div key={r.id} className="px-3 py-2 grid grid-cols-12 gap-1 items-center text-xs bg-primary/5">
                            <select
                              value={editKind}
                              onChange={(e) => setEditKind(e.target.value as any)}
                              className="col-span-2 px-1.5 py-1 rounded bg-background border border-border text-[11px]"
                            >
                              <option value="advance">advance</option>
                              <option value="penalty">penalty</option>
                            </select>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="col-span-2 px-1.5 py-1 rounded bg-background border border-border text-[11px]"
                            />
                            <input
                              type="text"
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value.slice(0, 200))}
                              placeholder="Reason"
                              className="col-span-4 px-1.5 py-1 rounded bg-background border border-border text-[11px]"
                            />
                            <input
                              type="number" min="0" step="0.01" inputMode="decimal"
                              value={editAmount}
                              onChange={(e) => setEditAmount(e.target.value)}
                              className="col-span-2 px-1.5 py-1 rounded bg-background border border-border text-[11px] text-right"
                            />
                            <div className="col-span-2 flex items-center justify-end gap-1">
                              <button onClick={() => saveEdit(r)} className="p-1 rounded hover:bg-emerald-500/15 text-emerald-600" title="Save">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={cancelEdit} className="p-1 rounded hover:bg-muted text-muted-foreground" title="Discard">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={r.id} className="px-3 py-2 grid grid-cols-12 gap-1 items-center text-xs">
                          <div className="col-span-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              r.kind === "advance"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                : "bg-red-500/15 text-red-700 dark:text-red-300"
                            }`}>{r.kind}</span>
                          </div>
                          <div className="col-span-2 text-muted-foreground">
                            {new Date(r.date + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                          </div>
                          <div className="col-span-4 text-muted-foreground truncate" title={r.reason || ""}>{r.reason || "—"}</div>
                          <div className="col-span-2 text-right font-semibold text-foreground">−{formatPrice(Number(r.amount) || 0)}</div>
                          <div className="col-span-2 flex items-center justify-end gap-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">Pending</span>
                            {canManageAdj && (
                              <>
                                <button onClick={() => beginEdit(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => cancelAdjustment(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500" title="Cancel this adjustment">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/40">
                    Edits/cancellations only apply to pending entries. These will be marked settled once this expense is recorded.
                  </p>
                </div>
              )}

              {wouldGoNegative && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 text-xs p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Adjustments exceed pay by {formatPrice(Math.abs(rawNet))}.</p>
                    <p className="mt-0.5">Payout cannot be negative. Edit or cancel some adjustments above, or add a work bonus, before recording this expense.</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-muted/50 border border-border p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-muted-foreground" />
                    <p className="font-medium text-foreground text-sm">Net Payable</p>
                  </div>
                  <span className={`text-2xl font-bold ${wouldGoNegative ? "text-red-500" : "text-primary"}`}>{formatPrice(total)}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Base</span><span className="text-right text-foreground">{formatPrice(baseAmount)}</span>
                  {workBonusAmount > 0 && (<><span>Work bonus</span><span className="text-right text-foreground">+{formatPrice(workBonusAmount)}</span></>)}
                  {adjustmentTotals.advances > 0 && (<><span>Less advances</span><span className="text-right text-amber-600 dark:text-amber-400">−{formatPrice(adjustmentTotals.advances)}</span></>)}
                  {adjustmentTotals.penalties > 0 && (<><span>Less penalties</span><span className="text-right text-red-600 dark:text-red-400">−{formatPrice(adjustmentTotals.penalties)}</span></>)}
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
              disabled={saving || !comp || total <= 0 || wouldGoNegative || editingId !== null}
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
