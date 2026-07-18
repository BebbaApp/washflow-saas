import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, MinusCircle, ArrowDownCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";
import { useLiveTable } from "@/offline/useLiveTable";
import { offlineInsert, offlineDelete } from "@/offline/offlineWrite";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface StaffOption {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

interface AdjustmentRow {
  id: string;
  tenant_id: string;
  worker_id: string;
  kind: "advance" | "penalty";
  amount: number;
  date: string;
  reason: string | null;
  status: "pending" | "settled";
  settled_at: string | null;
  created_at: string;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function StaffAdjustmentsDialog({ open, onClose }: Props) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { formatPrice, currency } = useCurrency();
  const canWrite = user?.role === "admin" || user?.role === "manager";

  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [kind, setKind] = useState<"advance" | "penalty">("advance");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string>(todayISO());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const rows = useLiveTable<any>(tenant?.id, "staff_pay_adjustments");

  useEffect(() => {
    if (!open || !tenant?.id) return;
    (async () => {
      const { data } = await supabase.functions.invoke("manage-staff", {
        body: { action: "list", tenant_id: tenant.id },
      });
      const list: StaffOption[] = ((data as any)?.users ?? [])
        .filter((u: any) => !!u.role)
        .map((u: any) => ({
          id: u.id,
          name: u.name || "",
          email: u.email || "",
          role: u.role ?? null,
        }))
        .sort((a: StaffOption, b: StaffOption) =>
          (a.name || a.email).localeCompare(b.name || b.email)
        );
      setStaff(list);
    })();
  }, [open, tenant?.id]);

  const workerRows = useMemo<AdjustmentRow[]>(() => {
    const list = (rows ?? []).filter((r: any) => !workerId || r.worker_id === workerId);
    return list
      .map((r: any) => ({
        id: r.id,
        tenant_id: r.tenant_id,
        worker_id: r.worker_id,
        kind: r.kind,
        amount: Number(r.amount) || 0,
        date: r.date,
        reason: r.reason ?? null,
        status: (r.status ?? "pending") as "pending" | "settled",
        settled_at: r.settled_at ?? null,
        created_at: r.created_at,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows, workerId]);

  const visibleRows = useMemo(
    () => workerRows.filter((r) => showSettled || r.status === "pending"),
    [workerRows, showSettled]
  );

  const pendingTotal = useMemo(() => {
    let advances = 0;
    let penalties = 0;
    workerRows.forEach((r) => {
      if (r.status !== "pending") return;
      if (r.kind === "advance") advances += r.amount;
      else penalties += r.amount;
    });
    return { advances, penalties, total: advances + penalties };
  }, [workerRows]);

  const nameFor = (id: string) => {
    const s = staff.find((s) => s.id === id);
    return s ? (s.name || s.email.split("@")[0] || "Staff") : id.slice(0, 6);
  };

  const handleAdd = async () => {
    if (!canWrite) { toast.error("Only admin or manager can log adjustments"); return; }
    if (!tenant?.id) return;
    if (!workerId) { toast.error("Select an employee"); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error("Enter an amount greater than 0"); return; }
    if (!date) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      await offlineInsert("staff_pay_adjustments", tenant.id, {
        worker_id: workerId,
        kind,
        amount: Number(amt.toFixed(2)),
        date,
        reason: reason.trim() || null,
        status: "pending",
        created_by: user?.id ?? null,
      });
      toast.success(`${kind === "advance" ? "Advance" : "Penalty"} recorded`);
      setAmount("");
      setReason("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save adjustment");
    } finally { setSaving(false); }
  };

  const handleDelete = async (row: AdjustmentRow) => {
    if (!tenant?.id) return;
    if (row.status === "settled") { toast.error("Settled entries cannot be removed"); return; }
    if (!confirm(`Remove ${row.kind} of ${formatPrice(row.amount)}?`)) return;
    await offlineDelete("staff_pay_adjustments", tenant.id, row.id);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-foreground">Staff pay adjustments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Advances and penalties auto-deduct on the next payout for the selected weeks.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Employee</span>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
            >
              <option value="">— Select —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.email.split("@")[0] || "Staff"}{s.role ? ` · ${s.role}` : ""}
                </option>
              ))}
            </select>
          </label>

          {workerId && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending advances</p>
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">−{formatPrice(pendingTotal.advances)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending penalties</p>
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">−{formatPrice(pendingTotal.penalties)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total to deduct</p>
                <p className="text-sm font-bold text-foreground">−{formatPrice(pendingTotal.total)}</p>
              </div>
            </div>
          )}

          {canWrite && workerId && (
            <div className="rounded-xl border border-border p-3 space-y-3">
              <p className="text-xs font-semibold text-foreground">New adjustment</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind("advance")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    kind === "advance"
                      ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <ArrowDownCircle className="w-4 h-4 inline mr-1.5" />Advance
                </button>
                <button
                  type="button"
                  onClick={() => setKind("penalty")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    kind === "penalty"
                      ? "border-red-500 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <MinusCircle className="w-4 h-4 inline mr-1.5" />Penalty
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Amount</span>
                  <div className="mt-1 relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">{currency.symbol}</span>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-background border border-border text-sm"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    max={todayISO()}
                    className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Reason (optional)</span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 200))}
                  placeholder={kind === "advance" ? "e.g. Mid-week advance requested" : "e.g. Broke wash bay window"}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
                />
              </label>
              <div className="flex justify-end">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />Add {kind}
                </button>
              </div>
            </div>
          )}

          {!canWrite && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs p-3">
              Only admin or manager can create staff pay adjustments.
            </div>
          )}

          {workerId && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-secondary flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {nameFor(workerId)} · {showSettled ? "all" : "pending"} entries
                </span>
                <label className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSettled}
                    onChange={(e) => setShowSettled(e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  Show settled
                </label>
              </div>
              {visibleRows.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">No adjustments recorded.</p>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-auto">
                  {visibleRows.map((r) => (
                    <div key={r.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <span className={`inline-block px-2 py-0.5 rounded font-semibold text-[10px] ${
                        r.kind === "advance"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          : "bg-red-500/15 text-red-700 dark:text-red-300"
                      }`}>
                        {r.kind}
                      </span>
                      <span className="font-semibold text-foreground">−{formatPrice(r.amount)}</span>
                      <span className="text-muted-foreground">
                        {new Date(r.date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                      <span className="text-muted-foreground truncate flex-1">{r.reason || "—"}</span>
                      {r.status === "settled" ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Settled</span>
                      ) : canWrite ? (
                        <button
                          onClick={() => handleDelete(r)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
