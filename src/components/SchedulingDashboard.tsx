import { useState, useMemo } from "react";
import { Calendar, Users, Trophy, Plus, CheckCircle2, XCircle, AlertCircle, Clock, X, GripVertical } from "lucide-react";
import { useScheduling, type Shift } from "@/hooks/useScheduling";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShiftDetailsModal } from "@/components/ShiftDetailsModal";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface SchedulingDashboardProps {
  isAdmin: boolean;
}

type View = "schedule" | "employees" | "performance";
type Range = "today" | "week" | "all";

export const SchedulingDashboard = ({ isAdmin }: SchedulingDashboardProps) => {
  const {
    templates,
    shifts,
    timeOffRequests,
    staffMembers,
    loading,
    addShift,
    updateShift,
    deleteShift,
    updateTimeOffStatus,
  } = useScheduling();

  const [view, setView] = useState<View>("schedule");
  const [range, setRange] = useState<Range>("today");
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Shift form
  const [shiftStaff, setShiftStaff] = useState("");
  const [shiftTemplate, setShiftTemplate] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");
  const [shiftNotes, setShiftNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setShiftStaff("");
    setShiftTemplate("");
    setShiftDate("");
    setShiftStart("");
    setShiftEnd("");
    setShiftNotes("");
    setFormError(null);
  };

  const handleTemplateChange = (templateId: string) => {
    setShiftTemplate(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setShiftStart(tmpl.startTime.slice(0, 5));
      setShiftEnd(tmpl.endTime.slice(0, 5));
    }
  };

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!shiftStaff) return setFormError("Please select a staff member");
    if (!shiftDate) return setFormError("Please pick a date");
    if (!shiftStart || !shiftEnd) return setFormError("Please set start and end times");
    if (shiftEnd <= shiftStart) return setFormError("End time must be after start time");

    const res = await addShift({
      staffUserId: shiftStaff,
      templateId: shiftTemplate || undefined,
      shiftDate,
      startTime: shiftStart,
      endTime: shiftEnd,
      notes: shiftNotes || undefined,
    });
    if (!res.ok) {
      setFormError(res.error || "Could not schedule shift");
      return;
    }
    setShiftDialogOpen(false);
    resetForm();
  };

  const todayKey = new Date().toISOString().split("T")[0];
  const weekKeys = useMemo(() => {
    const out: string[] = [];
    const t = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(t);
      d.setDate(t.getDate() + i);
      out.push(d.toISOString().split("T")[0]);
    }
    return out;
  }, []);

  const filteredShifts = useMemo(() => {
    if (range === "today") return shifts.filter((s) => s.shiftDate === todayKey);
    if (range === "week") return shifts.filter((s) => weekKeys.includes(s.shiftDate));
    return shifts;
  }, [shifts, range, todayKey, weekKeys]);

  // For drag targets, always offer week dates when range=today/week, all dates from shifts otherwise
  const dropTargetDates = useMemo(() => {
    if (range === "today") return [todayKey];
    if (range === "week") return weekKeys;
    return Array.from(new Set(filteredShifts.map((s) => s.shiftDate))).sort();
  }, [range, todayKey, weekKeys, filteredShifts]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    dropTargetDates.forEach((d) => map.set(d, []));
    filteredShifts.forEach((s) => {
      const arr = map.get(s.shiftDate) || [];
      arr.push(s);
      map.set(s.shiftDate, arr);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredShifts, dropTargetDates]);

  // Drag-and-drop reschedule
  const handleDrop = async (newDate: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverDate(null);
    const shiftId = e.dataTransfer.getData("text/shift-id");
    if (!shiftId) return;
    const s = shifts.find((x) => x.id === shiftId);
    if (!s || s.shiftDate === newDate) return;
    await updateShift(shiftId, {
      staffUserId: s.staffUserId,
      templateId: s.templateId,
      shiftDate: newDate,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      notes: s.notes,
    });
  };

  const employeeStats = useMemo(() => {
    return staffMembers.map((s) => {
      const upcoming = shifts.filter((sh) => sh.staffUserId === s.id && sh.shiftDate >= todayKey).length;
      const total = shifts.filter((sh) => sh.staffUserId === s.id).length;
      const inRange = filteredShifts.filter((sh) => sh.staffUserId === s.id).length;
      return { ...s, upcoming, total, inRange };
    });
  }, [staffMembers, shifts, filteredShifts, todayKey]);

  const performance = useMemo(
    () => [...employeeStats].sort((a, b) => b.inRange - a.inRange || b.total - a.total),
    [employeeStats]
  );

  const chartData = useMemo(
    () => performance.filter((e) => e.inRange > 0 || e.total > 0).map((e) => ({
      name: e.name.length > 12 ? e.name.slice(0, 12) + "…" : e.name,
      shifts: e.inRange,
    })),
    [performance]
  );

  const statusConfig = {
    pending: { icon: AlertCircle, className: "bg-warning/10 text-warning", label: "Pending" },
    approved: { icon: CheckCircle2, className: "bg-success/10 text-success", label: "Approved" },
    denied: { icon: XCircle, className: "bg-destructive/10 text-destructive", label: "Denied" },
  };

  const viewTabs: { id: View; label: string; icon: typeof Calendar }[] = [
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "employees", label: "Employees", icon: Users },
    { id: "performance", label: "Performance", icon: Trophy },
  ];

  const rangeTabs: { id: Range; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "all", label: "All" },
  ];

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading schedule...</p>;
  }

  return (
    <div className="space-y-6">
      {/* View tabs — pulled to right on desktop, full-width on mobile */}
      <div className="flex md:justify-end md:-mt-16 md:mb-2 relative z-10">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border w-full md:w-auto overflow-x-auto">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* SCHEDULE VIEW */}
      {view === "schedule" && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
              {rangeTabs.map((r) => {
                const active = range === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            {isAdmin && (
              <button
                onClick={() => setShiftDialogOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Schedule Shift
              </button>
            )}
          </div>

          {filteredShifts.length === 0 ? (
            <div className="glass-card p-12 flex flex-col items-center justify-center text-center min-h-[280px]">
              <div className="text-5xl mb-4" aria-hidden>📅</div>
              <p className="text-lg font-semibold text-foreground">No shifts scheduled</p>
              <p className="text-sm text-muted-foreground mt-1">
                {isAdmin ? `Click "Schedule Shift" to assign an employee` : "No shifts have been assigned yet"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedByDate.map(([date, dayShifts]) => {
                const label = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                });
                const isOver = dragOverDate === date;
                return (
                  <div
                    key={date}
                    onDragOver={(e) => {
                      if (isAdmin) {
                        e.preventDefault();
                        setDragOverDate(date);
                      }
                    }}
                    onDragLeave={() => setDragOverDate((d) => (d === date ? null : d))}
                    onDrop={(e) => isAdmin && handleDrop(date, e)}
                    className={`glass-card p-4 transition-colors ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}
                  >
                    <p className="text-sm font-semibold text-foreground mb-3">{label}</p>
                    {dayShifts.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        {isAdmin ? "Drop a shift here or schedule a new one" : "No shifts"}
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {dayShifts.map((shift) => {
                          const tmpl = templates.find((t) => t.id === shift.templateId);
                          const color = tmpl?.color || "hsl(var(--primary))";
                          return (
                            <button
                              key={shift.id}
                              type="button"
                              onClick={() => setSelectedShift(shift)}
                              draggable={isAdmin}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/shift-id", shift.id);
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              className="group flex items-center gap-3 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-left hover:bg-secondary hover:border-primary/40 transition-colors cursor-pointer"
                            >
                              <div className="w-2 h-10 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{shift.staffName}</p>
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {shift.startTime.slice(0, 5)} – {shift.endTime.slice(0, 5)}
                                  {tmpl && <span className="ml-1 truncate">· {tmpl.name}</span>}
                                </p>
                              </div>
                              {isAdmin && (
                                <GripVertical className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isAdmin && timeOffRequests.some((r) => r.status === "pending") && (
            <div className="glass-card p-4">
              <p className="text-sm font-semibold text-foreground mb-3">Pending time-off requests</p>
              <div className="space-y-2">
                {timeOffRequests.filter((r) => r.status === "pending").map((req) => {
                  const cfg = statusConfig[req.status];
                  return (
                    <div key={req.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/50 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{req.staffName}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(req.startDate + "T00:00:00").toLocaleDateString()} — {new Date(req.endDate + "T00:00:00").toLocaleDateString()}
                          {req.reason ? ` · ${req.reason}` : ""}
                        </p>
                      </div>
                      <span className={`status-badge ${cfg.className}`}>
                        <cfg.icon className="w-3 h-3 mr-1" />
                        {cfg.label}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateTimeOffStatus(req.id, "approved")}
                          className="px-3 py-1.5 rounded-md bg-success/10 text-success text-xs font-medium hover:bg-success/20 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => updateTimeOffStatus(req.id, "denied")}
                          className="px-3 py-1.5 rounded-md bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* EMPLOYEES VIEW */}
      {view === "employees" && (
        <div className="glass-card p-4">
          {employeeStats.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-5xl mb-4" aria-hidden>👥</div>
              <p className="text-lg font-semibold text-foreground">No employees yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add staff in Settings → Workers</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {employeeStats.map((emp) => (
                <div key={emp.id} className="flex items-center gap-4 py-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                    <p className="text-xs text-muted-foreground">{emp.upcoming} upcoming · {emp.total} total shifts</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PERFORMANCE VIEW */}
      {view === "performance" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
              {rangeTabs.map((r) => {
                const active = range === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Shift count by employee · {range === "today" ? "Today" : range === "week" ? "This Week" : "All Time"}
            </p>
          </div>

          <div className="glass-card p-4">
            {chartData.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-5xl mb-4" aria-hidden>🏆</div>
                <p className="text-lg font-semibold text-foreground">No performance data yet</p>
                <p className="text-sm text-muted-foreground mt-1">Schedule shifts to start tracking</p>
              </div>
            ) : (
              <>
                <div className="h-64 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--secondary))", opacity: 0.4 }}
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          color: "hsl(var(--foreground))",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="shifts" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  {performance.map((emp, idx) => (
                    <div key={emp.id} className="flex items-center gap-4 rounded-lg border border-border bg-secondary/50 p-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        idx === 0 ? "bg-warning/20 text-warning" :
                        idx === 1 ? "bg-muted text-foreground" :
                        idx === 2 ? "bg-primary/10 text-primary" :
                        "bg-secondary text-muted-foreground"
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {emp.inRange} in range · {emp.total} all-time
                        </p>
                      </div>
                      <Trophy className={`w-4 h-4 ${idx === 0 ? "text-warning" : "text-muted-foreground/40"}`} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Schedule Shift Dialog */}
      <Dialog open={shiftDialogOpen} onOpenChange={(o) => { setShiftDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Schedule Shift</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddShift} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Staff Member *</Label>
              <Select value={shiftStaff} onValueChange={setShiftStaff}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder={staffMembers.length === 0 ? "No staff available" : "Select staff"} />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {staffMembers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Template (optional)</Label>
              <Select value={shiftTemplate} onValueChange={handleTemplateChange}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Custom hours" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                        {t.name} <span className="text-muted-foreground text-xs">({t.startTime.slice(0, 5)}–{t.endTime.slice(0, 5)})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Date *</Label>
              <Input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className="bg-secondary border-border text-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Start *</Label>
                <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} className="bg-secondary border-border text-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">End *</Label>
                <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} className="bg-secondary border-border text-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Notes</Label>
              <Input value={shiftNotes} onChange={(e) => setShiftNotes(e.target.value)} placeholder="Optional notes" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <X className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <button type="submit" className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
              Schedule Shift
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <ShiftDetailsModal
        open={!!selectedShift}
        onOpenChange={(o) => { if (!o) setSelectedShift(null); }}
        shift={selectedShift}
        templates={templates}
        staffMembers={staffMembers}
        isAdmin={isAdmin}
        onUpdate={updateShift}
        onDelete={deleteShift}
      />
    </div>
  );
};
