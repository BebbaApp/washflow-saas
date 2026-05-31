import { useMemo, useState } from "react";
import { Calendar, Users, Trophy, Clock, UserCheck, CheckCircle2, XCircle, Coffee } from "lucide-react";
import { useScheduling } from "@/hooks/useScheduling";
import { useAttendance, type AttendanceRecord } from "@/hooks/useAttendance";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaffCheckInPanel } from "@/components/StaffCheckInPanel";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface SchedulingDashboardProps {
  isAdmin: boolean;
}

type View = "checkin" | "daylog" | "employees" | "performance";

// 1 hour lunch break deducted from each present day
const LUNCH_BREAK_HOURS = 1;

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

interface DayRow {
  user_id: string;
  staffName: string;
  date: string;
  start: Date | null;
  end: Date | null;
  hours: number;
  status: "present" | "absent" | "in_progress";
}

export const SchedulingDashboard = ({ isAdmin }: SchedulingDashboardProps) => {
  const { staffMembers, loading } = useScheduling();
  const { records } = useAttendance();

  const [view, setView] = useState<View>("checkin");

  const todayKey = ymd(new Date());
  const weekStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return ymd(d);
  }, []);
  const [from, setFrom] = useState(weekStart);
  const [to, setTo] = useState(todayKey);

  // === Build per-staff per-day rows from attendance records ===
  const dayRows = useMemo<DayRow[]>(() => {
    const dates = daysBetween(from, to);
    const rows: DayRow[] = [];
    // index records by user/date
    const byUserDate: Record<string, AttendanceRecord[]> = {};
    for (const r of records) {
      const d = r.created_at.slice(0, 10);
      if (d < from || d > to) continue;
      const k = `${r.user_id}|${d}`;
      (byUserDate[k] ||= []).push(r);
    }
    for (const s of staffMembers) {
      for (const date of dates) {
        const recs = (byUserDate[`${s.id}|${date}`] || []).slice().sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const firstIn = recs.find((r) => r.kind === "check_in");
        const lastOut = [...recs].reverse().find((r) => r.kind === "check_out");
        if (!firstIn) {
          rows.push({
            user_id: s.id, staffName: s.name, date,
            start: null, end: null, hours: 0, status: "absent",
          });
        } else {
          const start = new Date(firstIn.created_at);
          const end = lastOut ? new Date(lastOut.created_at) : null;
          let hours = 0;
          let status: DayRow["status"] = "in_progress";
          if (end) {
            const raw = (end.getTime() - start.getTime()) / 3600000;
            hours = Math.max(0, raw - LUNCH_BREAK_HOURS);
            status = "present";
          }
          rows.push({ user_id: s.id, staffName: s.name, date, start, end, hours, status });
        }
      }
    }
    return rows.sort((a, b) =>
      b.date.localeCompare(a.date) || a.staffName.localeCompare(b.staffName)
    );
  }, [records, staffMembers, from, to]);

  // Aggregate per employee
  const employeeStats = useMemo(() => {
    return staffMembers.map((s) => {
      const mine = dayRows.filter((r) => r.user_id === s.id);
      const present = mine.filter((r) => r.status === "present").length;
      const absent = mine.filter((r) => r.status === "absent").length;
      const inProgress = mine.filter((r) => r.status === "in_progress").length;
      const totalHours = mine.reduce((a, r) => a + r.hours, 0);
      return { ...s, present, absent, inProgress, totalHours };
    });
  }, [staffMembers, dayRows]);

  const performance = useMemo(
    () => [...employeeStats].sort((a, b) => b.totalHours - a.totalHours || b.present - a.present),
    [employeeStats]
  );

  const chartData = useMemo(
    () => performance.filter((e) => e.totalHours > 0 || e.present > 0).map((e) => ({
      name: e.name.length > 12 ? e.name.slice(0, 12) + "…" : e.name,
      hours: Number(e.totalHours.toFixed(1)),
    })),
    [performance]
  );

  const viewTabs: { id: View; label: string; icon: typeof Calendar }[] = [
    { id: "checkin", label: "Staff Check-in", icon: UserCheck },
    { id: "daylog", label: "Day Log", icon: Calendar },
    { id: "employees", label: "Employees", icon: Users },
    { id: "performance", label: "Performance", icon: Trophy },
  ];

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {/* View tabs */}
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
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* CHECK-IN VIEW */}
      {view === "checkin" && <StaffCheckInPanel />}

      {/* DAY LOG VIEW */}
      {view === "daylog" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
              <Coffee className="w-3 h-3" /> {LUNCH_BREAK_HOURS}h lunch break deducted per present day
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Present days</p>
              <p className="text-2xl font-bold text-success">{dayRows.filter((r) => r.status === "present").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Absent days</p>
              <p className="text-2xl font-bold text-destructive">{dayRows.filter((r) => r.status === "absent").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">In progress</p>
              <p className="text-2xl font-bold text-warning">{dayRows.filter((r) => r.status === "in_progress").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Total hours</p>
              <p className="text-2xl font-bold">{dayRows.reduce((a, r) => a + r.hours, 0).toFixed(1)}</p>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Staff</th>
                    <th className="text-left px-4 py-2">Day start</th>
                    <th className="text-left px-4 py-2">Day end</th>
                    <th className="text-left px-4 py-2">Hours worked</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No staff or no data in range</td></tr>
                  )}
                  {dayRows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {new Date(r.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </td>
                      <td className="px-4 py-2 font-medium">{r.staffName}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {r.start ? <><Clock className="w-3 h-3 inline mr-1 text-muted-foreground" />{r.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</> : "—"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {r.end ? <><Clock className="w-3 h-3 inline mr-1 text-muted-foreground" />{r.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</> : "—"}
                      </td>
                      <td className="px-4 py-2 font-medium">{r.hours > 0 ? r.hours.toFixed(2) : "—"}</td>
                      <td className="px-4 py-2">
                        {r.status === "present" && <Badge variant="default" className="bg-success/20 text-success hover:bg-success/20"><CheckCircle2 className="w-3 h-3 mr-1" />Present</Badge>}
                        {r.status === "absent" && <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Absent</Badge>}
                        {r.status === "in_progress" && <Badge variant="outline">In progress</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EMPLOYEES VIEW */}
      {view === "employees" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
            </div>
          </div>
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
                  <div key={emp.id} className="flex items-center gap-4 py-3 flex-wrap">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.present} present · {emp.absent} absent · {emp.totalHours.toFixed(1)}h worked
                      </p>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <Badge variant="default" className="bg-success/20 text-success hover:bg-success/20">{emp.present}P</Badge>
                      <Badge variant="destructive">{emp.absent}A</Badge>
                      {emp.inProgress > 0 && <Badge variant="outline">{emp.inProgress} active</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PERFORMANCE VIEW */}
      {view === "performance" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <p className="text-xs text-muted-foreground ml-auto">Hours worked (less {LUNCH_BREAK_HOURS}h lunch)</p>
          </div>

          <div className="glass-card p-4">
            {chartData.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-5xl mb-4" aria-hidden>🏆</div>
                <p className="text-lg font-semibold text-foreground">No performance data yet</p>
                <p className="text-sm text-muted-foreground mt-1">Staff check-ins will populate this view</p>
              </div>
            ) : (
              <>
                <div className="h-64 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
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
                      <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
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
                          {emp.totalHours.toFixed(1)}h · {emp.present} present · {emp.absent} absent
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
    </div>
  );
};
