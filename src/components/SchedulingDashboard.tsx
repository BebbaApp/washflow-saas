import { useEffect, useMemo, useState } from "react";
import {
  Calendar, Users, Trophy, Clock, UserCheck, CheckCircle2, XCircle, Coffee,
  Bell, X, FileDown, FileText, ChevronLeft, ChevronRight, AlertCircle, CalendarOff,
} from "lucide-react";

import { useScheduling } from "@/hooks/useScheduling";
import { useAttendance, type AttendanceRecord } from "@/hooks/useAttendance";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StaffCheckInPanel } from "@/components/StaffCheckInPanel";
import { TimeOffPanel } from "@/components/TimeOffPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface SchedulingDashboardProps {
  isAdmin: boolean;
  onOpenFaceEnroll?: () => void;
}

type View = "checkin" | "daylog" | "employees" | "performance" | "timeoff";
type Preset = "today" | "7d" | "30d" | "all" | "custom";

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

interface Period {
  start: Date;
  end: Date | null;
  hours: number;
}
interface DayRow {
  user_id: string;
  staffName: string;
  date: string;
  start: Date | null;
  end: Date | null;
  hours: number;
  periods: Period[];
  periodCount: number;
  status: "present" | "absent" | "in_progress" | "marked_absent" | "time_off";
}

function csvEscape(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export const SchedulingDashboard = ({ isAdmin, onOpenFaceEnroll }: SchedulingDashboardProps) => {
  const { staffMembers, loading, timeOffRequests } = useScheduling();
  const { records } = useAttendance();
  const { can } = usePermissions();

  const tabPerm: Record<View, string> = {
    checkin: "staff.checkin",
    daylog: "staff.daylog",
    employees: "staff.employees",
    performance: "staff.performance",
    timeoff: "staff.timeOff",
  };
  const allowedViews = (["checkin", "daylog", "employees", "performance", "timeoff"] as View[]).filter((v) => can(tabPerm[v]));
  const defaultView: View = allowedViews[0] ?? "checkin";

  const [view, setView] = useState<View>(defaultView);
  useEffect(() => {
    if (allowedViews.length && !allowedViews.includes(view)) setView(defaultView);
  }, [allowedViews.join("|")]);
  const [preset, setPreset] = useState<Preset>("7d");
  // Pagination by 7-day windows: 0 = current, 1 = previous week, etc.
  const [weekOffset, setWeekOffset] = useState(0);

  const todayKey = ymd(new Date());

  // Earliest date any active staff member became active (their account created_at).
  // Used as "all time" lower bound — no more 2000-01-01.
  const earliestActiveDate = useMemo(() => {
    const dates = staffMembers
      .map((s) => (s.createdAt ? s.createdAt.slice(0, 10) : null))
      .filter((d): d is string => !!d);
    if (!dates.length) return todayKey;
    return dates.sort()[0];
  }, [staffMembers, todayKey]);

  const presetRange = (p: Preset, offset = 0): { from: string; to: string } => {
    if (p === "today") return { from: todayKey, to: todayKey };
    if (p === "7d") {
      const end = new Date(); end.setDate(end.getDate() - 7 * offset);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      return { from: ymd(start), to: ymd(end) };
    }
    if (p === "30d") {
      const d = new Date(); d.setDate(d.getDate() - 29);
      return { from: ymd(d), to: todayKey };
    }
    if (p === "all") return { from: earliestActiveDate, to: todayKey };
    return { from: todayKey, to: todayKey };
  };

  const initial = presetRange("7d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  useEffect(() => {
    if (preset === "custom") return;
    const r = presetRange(preset, preset === "7d" ? weekOffset : 0);
    setFrom(r.from); setTo(r.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, weekOffset, earliestActiveDate]);

  // Reset week offset when leaving 7d preset
  useEffect(() => { if (preset !== "7d") setWeekOffset(0); }, [preset]);

  // Marked-absent audit entries (action='marked_absent', reason contains date)
  const [markedAbsent, setMarkedAbsent] = useState<Set<string>>(new Set());
  const refreshMarkedAbsent = async () => {
    const { data } = await supabase
      .from("attendance_audit_log")
      .select("target_user_id,reason,created_at,action")
      .eq("action", "marked_absent")
      .limit(2000);
    const s = new Set<string>();
    (data || []).forEach((r: any) => {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(r.reason || "");
      const d = m ? m[1] : r.created_at.slice(0, 10);
      s.add(`${r.target_user_id}|${d}`);
    });
    setMarkedAbsent(s);
  };
  useEffect(() => { refreshMarkedAbsent(); }, []);

  // === Active/Inactive status per staff member (Settings → Workers toggle) ===
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const refreshActive = async () => {
    const { data } = await (supabase as any)
      .from("staff_active_status")
      .select("user_id,is_active");
    const m: Record<string, boolean> = {};
    (data || []).forEach((r: any) => { m[r.user_id] = !!r.is_active; });
    setActiveMap(m);
  };
  useEffect(() => { refreshActive(); }, []);

  // Filter to only active staff (default to active when no row exists)
  const activeStaff = useMemo(
    () => staffMembers.filter((s) => activeMap[s.id] !== false),
    [staffMembers, activeMap]
  );

  // Approved time-off expanded per user/date
  const approvedTimeOff = useMemo(() => {
    const s = new Set<string>();
    for (const r of timeOffRequests) {
      if (r.status !== "approved") continue;
      const start = new Date(r.startDate + "T00:00:00");
      const end = new Date(r.endDate + "T00:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        s.add(`${r.userId}|${ymd(d)}`);
      }
    }
    return s;
  }, [timeOffRequests]);

  // === Build per-staff per-day rows from attendance records ===
  const dayRows = useMemo<DayRow[]>(() => {
    const dates = daysBetween(from, to);
    const rows: DayRow[] = [];
    const byUserDate: Record<string, AttendanceRecord[]> = {};
    for (const r of records) {
      const d = r.created_at.slice(0, 10);
      if (d < from || d > to) continue;
      const k = `${r.user_id}|${d}`;
      (byUserDate[k] ||= []).push(r);
    }
    for (const s of activeStaff) {
      // Per-staff active-since date — never count days before this as absent.
      const activeSince = s.createdAt ? s.createdAt.slice(0, 10) : from;
      for (const date of dates) {
        if (date < activeSince) continue;
        const recs = (byUserDate[`${s.id}|${date}`] || []).slice().sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        // Build periods: pair consecutive check_in -> check_out
        const periods: Period[] = [];
        let openStart: Date | null = null;
        for (const r of recs) {
          if (r.kind === "check_in") {
            openStart = new Date(r.created_at);
          } else if (r.kind === "check_out" && openStart) {
            const end = new Date(r.created_at);
            const hrs = Math.max(0, (end.getTime() - openStart.getTime()) / 3600000);
            periods.push({ start: openStart, end, hours: hrs });
            openStart = null;
          }
        }
        if (openStart) periods.push({ start: openStart, end: null, hours: 0 });

        const firstIn = recs.find((r) => r.kind === "check_in");
        const lastOut = [...recs].reverse().find((r) => r.kind === "check_out");
        if (!firstIn) {
          const onTimeOff = approvedTimeOff.has(`${s.id}|${date}`);
          const wasMarked = markedAbsent.has(`${s.id}|${date}`);
          rows.push({
            user_id: s.id, staffName: s.name, date,
            start: null, end: null, hours: 0,
            periods: [], periodCount: 0,
            status: onTimeOff ? "time_off" : (wasMarked ? "marked_absent" : "absent"),
          });
        } else {
          const start = new Date(firstIn.created_at);
          const end = lastOut ? new Date(lastOut.created_at) : null;
          const rawHours = periods.reduce((a, p) => a + p.hours, 0);
          const hours = end ? Math.max(0, rawHours - LUNCH_BREAK_HOURS) : 0;
          const status: DayRow["status"] = end ? "present" : "in_progress";
          rows.push({
            user_id: s.id, staffName: s.name, date, start, end, hours,
            periods, periodCount: periods.length, status,
          });
        }
      }
    }
    return rows.sort((a, b) =>
      b.date.localeCompare(a.date) || a.staffName.localeCompare(b.staffName)
    );
  }, [records, activeStaff, from, to, markedAbsent]);

  // === 7-day pagination for Day Log + Employee detail ===
  // Build descending list of unique dates in range and chunk into 7-day pages.
  const datePages = useMemo<string[][]>(() => {
    const set = new Set<string>();
    dayRows.forEach((r) => set.add(r.date));
    const sorted = Array.from(set).sort((a, b) => b.localeCompare(a)); // newest first
    const out: string[][] = [];
    for (let i = 0; i < sorted.length; i += 7) out.push(sorted.slice(i, i + 7));
    return out.length ? out : [[]];
  }, [dayRows]);
  const needsPagination = datePages.length > 1;
  const [pageIdx, setPageIdx] = useState(0);
  useEffect(() => { setPageIdx(0); }, [from, to, preset]);
  const currentPageDates = useMemo(
    () => new Set(datePages[Math.min(pageIdx, datePages.length - 1)] || []),
    [datePages, pageIdx]
  );
  const pagedDayRows = useMemo(
    () => needsPagination ? dayRows.filter((r) => currentPageDates.has(r.date)) : dayRows,
    [dayRows, needsPagination, currentPageDates]
  );
  const pageLabel = useMemo(() => {
    const page = datePages[Math.min(pageIdx, datePages.length - 1)] || [];
    if (!page.length) return "";
    const last = page[page.length - 1];
    const first = page[0];
    return first === last ? first : `${last} → ${first}`;
  }, [datePages, pageIdx]);


  // Today's absentees (for in-app notification)
  const todayAbsentees = useMemo(() => {
    return activeStaff.filter((s) => {
      const activeSince = s.createdAt ? s.createdAt.slice(0, 10) : todayKey;
      if (todayKey < activeSince) return false;
      const has = records.some(
        (r) => r.user_id === s.id && r.created_at.slice(0, 10) === todayKey
      );
      return !has;
    }).map((s) => ({
      ...s,
      marked: markedAbsent.has(`${s.id}|${todayKey}`),
    }));
  }, [activeStaff, records, todayKey, markedAbsent]);

  const [notifDismissed, setNotifDismissed] = useState(false);
  const [notifExpanded, setNotifExpanded] = useState(false);
  const unmarkedAbsentees = todayAbsentees.filter((a) => !a.marked);
  const showNotif = !notifDismissed && unmarkedAbsentees.length > 0;

  const markAbsent = async (userId: string, date: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return; }
    const { error } = await supabase.from("attendance_audit_log").insert({
      target_user_id: userId,
      acted_by: user.id,
      action: "marked_absent",
      reason: `Marked absent for ${date}`,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Marked absent");
    setMarkedAbsent((prev) => new Set(prev).add(`${userId}|${date}`));
  };

  // Aggregate per employee — count PERIODS per day, not hours
  const employeeStats = useMemo(() => {
    return activeStaff.map((s) => {
      const mine = dayRows.filter((r) => r.user_id === s.id);
      const present = mine.filter((r) => r.status === "present").length;
      const absent = mine.filter((r) => r.status === "absent" || r.status === "marked_absent").length;
      const inProgress = mine.filter((r) => r.status === "in_progress").length;
      const totalPeriods = mine.reduce((a, r) => a + r.periodCount, 0);
      const totalHours = mine.reduce((a, r) => a + r.hours, 0);
      return { ...s, present, absent, inProgress, totalPeriods, totalHours };
    });
  }, [activeStaff, dayRows]);

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

  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<"week" | "month">("week");
  const [calAnchor, setCalAnchor] = useState<Date>(new Date());
  useEffect(() => { setCalAnchor(new Date()); setCalMode("week"); }, [selectedEmployee]);
  const selectedEmployeeName = useMemo(
    () => staffMembers.find((s) => s.id === selectedEmployee)?.name || "",
    [selectedEmployee, staffMembers]
  );
  const employeeDayRows = useMemo(
    () => selectedEmployee ? dayRows.filter((r) => r.user_id === selectedEmployee) : [],
    [dayRows, selectedEmployee]
  );
  const employeeDayMap = useMemo(() => {
    const m: Record<string, DayRow> = {};
    employeeDayRows.forEach((r) => { m[r.date] = r; });
    return m;
  }, [employeeDayRows]);


  // === Exports ===
  const exportCsv = (rows: DayRow[], filename: string) => {
    const head = ["Date","Staff","Day start","Day end","Periods","Hours worked","Status"];
    const body = rows.map((r) => [
      r.date, r.staffName,
      r.start ? r.start.toLocaleTimeString() : "",
      r.end ? r.end.toLocaleTimeString() : "",
      r.periodCount,
      r.hours.toFixed(2),
      r.status,
    ]);
    const csv = [head, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
    downloadBlob(`${filename}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    toast.success("CSV exported");
  };
  const exportPdf = (rows: DayRow[], title: string, filename: string) => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14); doc.text(title, 14, 14);
    doc.setFontSize(9); doc.text(`Range: ${from} → ${to}  ·  Generated: ${new Date().toLocaleString()}`, 14, 20);
    autoTable(doc, {
      startY: 26,
      head: [["Date","Staff","Day start","Day end","Periods","Hours","Status"]],
      body: rows.map((r) => [
        r.date, r.staffName,
        r.start ? r.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
        r.end ? r.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
        String(r.periodCount),
        r.hours > 0 ? r.hours.toFixed(2) : "—",
        r.status.replace("_", " "),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    doc.save(`${filename}.pdf`);
    toast.success("PDF exported");
  };

  const viewTabs: { id: View; label: string; icon: typeof Calendar }[] = ([
    { id: "checkin" as View, label: "Staff Check-in", icon: UserCheck },
    { id: "daylog" as View, label: "Day Log", icon: Calendar },
    { id: "employees" as View, label: "Employees", icon: Users },
    { id: "performance" as View, label: "Performance", icon: Trophy },
    { id: "timeoff" as View, label: "Time Off", icon: CalendarOff },
  ]).filter((t) => allowedViews.includes(t.id));

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const DateRangeBar = () => (
    <div className="flex flex-wrap items-end gap-3">
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border">
        {([
          ["today","Today"],["7d","7 Days"],["30d","30 Days"],["all","All Time"],["custom","Custom"],
        ] as [Preset,string][]).map(([id,label]) => (
          <button
            key={id}
            onClick={() => setPreset(id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              preset === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >{label}</button>
        ))}
      </div>
      {preset === "custom" && (
        <>
          <div>
            <label className="text-xs text-muted-foreground block">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
        </>
      )}
    </div>
  );

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

      {/* IN-APP NOTIFICATION: absentees today */}
      {showNotif && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <Bell className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-foreground"
                  aria-expanded={notifExpanded}
                  onClick={() => setNotifExpanded((expanded) => !expanded)}
                >
                  <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${notifExpanded ? "rotate-90" : ""}`} />
                  <span className="min-w-0">
                    {unmarkedAbsentees.length} {unmarkedAbsentees.length === 1 ? "employee has" : "employees have"} not checked in today
                  </span>
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setNotifDismissed(true)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {notifExpanded && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {unmarkedAbsentees.map((a) => (
                    <div key={a.id} className="inline-flex items-center gap-2 bg-card border border-border rounded-lg pl-3 pr-1 py-1">
                      <span className="text-xs font-medium">{a.name}</span>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => markAbsent(a.id, todayKey)}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Mark absent
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CHECK-IN VIEW */}
      {view === "checkin" && <StaffCheckInPanel onOpenFaceEnroll={onOpenFaceEnroll} />}
      {view === "timeoff" && <TimeOffPanel />}

      {/* DAY LOG VIEW */}
      {view === "daylog" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <DateRangeBar />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => exportCsv(dayRows, `day-log_${from}_to_${to}`)}>
                <FileDown className="w-4 h-4 mr-1" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportPdf(dayRows, "Day Work Log", `day-log_${from}_to_${to}`)}>
                <FileText className="w-4 h-4 mr-1" /> PDF
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Coffee className="w-3 h-3" /> {LUNCH_BREAK_HOURS}h lunch break deducted per completed day
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Present days</p>
              <p className="text-2xl font-bold text-success">{dayRows.filter((r) => r.status === "present").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Absent days</p>
              <p className="text-2xl font-bold text-destructive">{dayRows.filter((r) => r.status === "absent" || r.status === "marked_absent").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">In progress</p>
              <p className="text-2xl font-bold text-warning">{dayRows.filter((r) => r.status === "in_progress").length}</p>
            </div>
            <div className="glass-card p-4">
              <p className="text-xs text-muted-foreground">Total periods</p>
              <p className="text-2xl font-bold">{dayRows.reduce((a, r) => a + r.periodCount, 0)}</p>
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
                    <th className="text-left px-4 py-2">Periods</th>
                    <th className="text-left px-4 py-2">Hours worked</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDayRows.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No staff or no data in range</td></tr>
                  )}
                  {pagedDayRows.map((r, i) => (
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
                      <td className="px-4 py-2">{r.periodCount}</td>
                      <td className="px-4 py-2 font-medium">{r.hours > 0 ? r.hours.toFixed(2) : "—"}</td>
                      <td className="px-4 py-2">
                        {r.status === "present" && <Badge variant="default" className="bg-success/20 text-success hover:bg-success/20"><CheckCircle2 className="w-3 h-3 mr-1" />Present</Badge>}
                        {r.status === "absent" && <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Absent</Badge>}
                        {r.status === "marked_absent" && <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Marked absent</Badge>}
                        {r.status === "in_progress" && <Badge variant="outline">In progress</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {needsPagination && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Showing 7-day window {pageIdx + 1} of {datePages.length}
                {pageLabel && <span className="ml-2 text-foreground/70">· {pageLabel}</span>}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pageIdx >= datePages.length - 1}
                  onClick={() => setPageIdx((i) => Math.min(datePages.length - 1, i + 1))}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Older
                </Button>
                <Button variant="outline" size="sm" disabled={pageIdx <= 0}
                  onClick={() => setPageIdx((i) => Math.max(0, i - 1))}>
                  Newer <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* 7-day filter pagination — step through prior weeks */}
          {preset === "7d" && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {weekOffset === 0 ? "Current week" : `${weekOffset} week${weekOffset === 1 ? "" : "s"} ago`}
                <span className="ml-2 text-foreground/70">· {from} → {to}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Older
                </Button>
                <Button variant="outline" size="sm" disabled={weekOffset <= 0}
                  onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}>
                  Newer <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}


      {/* EMPLOYEES VIEW */}
      {view === "employees" && !selectedEmployee && (
        <div className="space-y-3">
          <DateRangeBar />
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
                  <button
                    key={emp.id}
                    onClick={() => setSelectedEmployee(emp.id)}
                    className="w-full text-left flex items-center gap-4 py-3 flex-wrap hover:bg-secondary/40 rounded-lg px-2 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{emp.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {emp.totalPeriods} work {emp.totalPeriods === 1 ? "period" : "periods"} · {emp.present} present · {emp.absent} absent
                      </p>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <Badge variant="secondary">{emp.totalPeriods} periods</Badge>
                      <Badge variant="default" className="bg-success/20 text-success hover:bg-success/20">{emp.present}P</Badge>
                      <Badge variant="destructive">{emp.absent}A</Badge>
                      {emp.inProgress > 0 && <Badge variant="outline">{emp.inProgress} active</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EMPLOYEE DETAIL */}
      {view === "employees" && selectedEmployee && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedEmployee(null)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Back to employees
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => exportCsv(employeeDayRows, `${selectedEmployeeName}_${from}_to_${to}`)}>
                <FileDown className="w-4 h-4 mr-1" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportPdf(employeeDayRows, `Work record — ${selectedEmployeeName}`, `${selectedEmployeeName}_${from}_to_${to}`)}>
                <FileText className="w-4 h-4 mr-1" /> PDF
              </Button>
            </div>
          </div>

          <div className="glass-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{selectedEmployeeName}</h3>
                <p className="text-xs text-muted-foreground">Work log calendar</p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border">
                {(["week","month"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCalMode(m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
                      calMode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >{m}</button>
                ))}
              </div>
            </div>

            <EmployeeCalendar
              mode={calMode}
              anchor={calAnchor}
              setAnchor={setCalAnchor}
              dayMap={employeeDayMap}
            />
          </div>
        </div>
      )}


      {/* PERFORMANCE VIEW */}
      {view === "performance" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <DateRangeBar />
            <p className="text-xs text-muted-foreground">Hours worked (less {LUNCH_BREAK_HOURS}h lunch)</p>
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
                          {emp.totalHours.toFixed(1)}h · {emp.totalPeriods} periods · {emp.present} present · {emp.absent} absent
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

// ============================================================
// EmployeeCalendar — weekly (default) and monthly work-log view
// ============================================================
interface EmployeeCalendarProps {
  mode: "week" | "month";
  anchor: Date;
  setAnchor: (d: Date) => void;
  dayMap: Record<string, DayRow>;
}

function startOfWeekMon(d: Date) {
  const x = new Date(d); x.setHours(0,0,0,0);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function startOfMonth(d: Date) { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x; }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

const WEEK_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function statusTone(row?: DayRow): string {
  if (!row) return "bg-muted/30 text-muted-foreground";
  if (row.status === "present") return "bg-success/15 border-success/40 text-foreground";
  if (row.status === "in_progress") return "bg-warning/15 border-warning/40 text-foreground";
  if (row.status === "absent" || row.status === "marked_absent") return "bg-destructive/15 border-destructive/40 text-foreground";
  return "bg-muted/30 text-muted-foreground";
}

const EmployeeCalendar = ({ mode, anchor, setAnchor, dayMap }: EmployeeCalendarProps) => {
  if (mode === "week") {
    const start = startOfWeekMon(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const rangeLabel = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${addDays(start,6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setAnchor(addDays(start, -7))}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev week
          </Button>
          <p className="text-sm font-medium">{rangeLabel}</p>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(addDays(start, 7))}>
            Next week <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((d, i) => {
            const key = ymd(d);
            const row = dayMap[key];
            return (
              <div key={i} className={`rounded-lg border p-3 min-h-[120px] ${statusTone(row)}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide">{WEEK_LABELS[i]}</p>
                  <p className="text-xs text-muted-foreground">{d.getDate()}</p>
                </div>
                {!row ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : row.status === "absent" || row.status === "marked_absent" ? (
                  <p className="text-xs font-medium">Absent</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs"><span className="text-muted-foreground">Periods:</span> <span className="font-semibold">{row.periodCount}</span></p>
                    <p className="text-xs"><span className="text-muted-foreground">Hours:</span> <span className="font-semibold">{row.hours > 0 ? row.hours.toFixed(2) : "—"}</span></p>
                    <div className="text-[10px] text-muted-foreground space-y-0.5 pt-1">
                      {row.periods.map((p, j) => (
                        <div key={j}>
                          {p.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" → "}
                          {p.end ? p.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "open"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // MONTH
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeekMon(monthStart);
  const totalCells = Math.ceil(((monthEnd.getTime() - gridStart.getTime()) / 86400000 + 1) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
  const monthLabel = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Prev month
        </Button>
        <p className="text-sm font-medium">{monthLabel}</p>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>
          Next month <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground">
        {WEEK_LABELS.map((l) => <div key={l} className="px-2 py-1 text-center">{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const key = ymd(d);
          const row = dayMap[key];
          return (
            <div
              key={i}
              className={`rounded-md border p-2 min-h-[72px] text-xs ${inMonth ? statusTone(row) : "bg-muted/10 border-border/40 text-muted-foreground/50"}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{d.getDate()}</span>
                {inMonth && row && row.status === "present" && <CheckCircle2 className="w-3 h-3 text-success" />}
                {inMonth && row && (row.status === "absent" || row.status === "marked_absent") && <XCircle className="w-3 h-3 text-destructive" />}
                {inMonth && row && row.status === "in_progress" && <Clock className="w-3 h-3 text-warning" />}
              </div>
              {inMonth && row && (row.status === "present" || row.status === "in_progress") && (
                <div className="text-[10px] leading-tight">
                  <div>{row.periodCount}p · {row.hours > 0 ? row.hours.toFixed(1) + "h" : "—"}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

