import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { useAttendance, getSignedSelfieUrl, signSelfieUrls, type AttendanceRecord } from "@/hooks/useAttendance";
import { CameraCapture } from "@/components/CameraCapture";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/ui/pagination-bar";
import {
  LogIn, LogOut, UserCheck, Camera, Clock, Search, ShieldCheck,
  Download, ShieldAlert, BarChart3, FileClock, Volume2, VolumeX,
} from "lucide-react";

interface StaffOption { user_id: string; name: string; role: string; }

// Default workday start used to compute lateness
const DEFAULT_SHIFT_START = "08:00";
const LATE_GRACE_MIN = 10;

// Subtle two-tone notification using WebAudio (no asset needed)
function playChime() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.08, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.12);
      o.stop(now + i * 0.12 + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* ignore */ }
}

// Pill describing the current state of a staff member based on their last record
function StatusPill({ last }: { last: AttendanceRecord | null }) {
  if (!last) return <Badge variant="outline">No activity</Badge>;
  const isIn = last.kind === "check_in";
  const sub = last.status === "verified" ? "Verified" : last.status === "manual" ? "Manual" : "Failed";
  const subTone: any = last.status === "rejected" ? "destructive" : last.status === "manual" ? "outline" : "default";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={isIn ? "default" : "secondary"}>{isIn ? "In" : "Out"}</Badge>
      <Badge variant={subTone} className="text-[10px]">{sub}</Badge>
    </span>
  );
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = c == null ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; }

export function AttendancePage() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { tenant } = useTenant();
  const { can } = usePermissions();
  const canReport = isAdmin || can("reports.attendance");
  const canEnroll = isAdmin || can("attendance.enroll");
  const canAudit = isAdmin || can("attendance.audit");
  const canOverride = isAdmin || can("attendance.manualOverride");
  const canAssist = user?.role === "admin" || user?.role === "supervisor" || user?.role === "manager";
  const { records, enrollments, auditLog, profilesMap, recordAttendance, recordAttendanceFor, enrollFace, manualOverride, lastForUser } =
    useAttendance();
  // Whether the current user actually has a staff role in THIS workspace.
  // Platform/super admins viewing other tenants where they have no role
  // should NOT see themselves on the clock — they aren't part of that
  // workspace's staff. `null` = still resolving.
  const [isStaffHere, setIsStaffHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user?.id || !tenant?.id) { setIsStaffHere(null); return; }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("user_roles" as any)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("tenant_id", tenant.id);
      if (!cancelled) setIsStaffHere((count ?? 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [user?.id, tenant?.id]);
  const [captureMode, setCaptureMode] = useState<null | { kind: "check_in" | "check_out" | "enroll" | "assist_check_in" | "assist_check_out"; targetUserId?: string }>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [enrollTarget, setEnrollTarget] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detailsRec, setDetailsRec] = useState<AttendanceRecord | null>(null);
  const [detailsUrl, setDetailsUrl] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const seenIdsRef = useRef<Set<string> | null>(null);

  // Date range (used by log + report)
  const today = ymd(new Date());
  const weekAgo = ymd(new Date(Date.now() - 7 * 86400000));
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);

  // Override dialog
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState<{ targetUserId: string; kind: "check_in" | "check_out"; reason: string }>(
    { targetUserId: "", kind: "check_in", reason: "" }
  );

  // Report grouping
  const [reportGroup, setReportGroup] = useState<"day" | "week">("day");

  useEffect(() => {
    if ((!canAssist && !canEnroll) || !tenant?.id) {
      setStaff([]);
      return;
    }
    (async () => {
      const { data } = await supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant.id } });
      setStaff(((data as any)?.users ?? [])
        .filter((u: any) => !!u.role)
        .map((u: any) => ({ user_id: u.id, name: u.name || u.email || "Staff", role: u.role })));
    })();
  }, [canAssist, canEnroll, tenant?.id]);

  // Detect newly inserted records (from realtime) and play a subtle chime.
  // Skip the very first sync so we don't beep on initial load.
  useEffect(() => {
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(records.map((r) => r.id));
      return;
    }
    const seen = seenIdsRef.current;
    const fresh = records.filter((r) => !seen.has(r.id));
    fresh.forEach((r) => seen.add(r.id));
    if (fresh.length > 0 && soundOn) playChime();
  }, [records, soundOn]);

  const openDetails = async (r: AttendanceRecord) => {
    setDetailsRec(r);
    setDetailsUrl(null);
    if (r.selfie_url) {
      const url = await getSignedSelfieUrl(r.selfie_url);
      setDetailsUrl(url);
    }
  };

  const myEnrolled = useMemo(
    () => !!user && enrollments.some((e) => e.user_id === user.id),
    [enrollments, user]
  );
  const myLast = user ? lastForUser(user.id) : null;
  const nextKind: "check_in" | "check_out" = myLast?.kind === "check_in" ? "check_out" : "check_in";

  const handleCapture = async (dataUrl: string) => {
    if (!captureMode) return;
    setBusy(true);
    try {
      if (captureMode.kind === "enroll" && captureMode.targetUserId) {
        const ok = await enrollFace(captureMode.targetUserId, dataUrl);
        if (ok) setCaptureMode(null);
      } else if (captureMode.kind === "check_in" || captureMode.kind === "check_out") {
        await recordAttendance(captureMode.kind, dataUrl);
        setCaptureMode(null);
      } else if (captureMode.kind === "assist_check_in" || captureMode.kind === "assist_check_out") {
        if (!captureMode.targetUserId) return;
        const realKind = captureMode.kind === "assist_check_in" ? "check_in" : "check_out";
        await recordAttendanceFor(captureMode.targetUserId, realKind, dataUrl);
        setCaptureMode(null);
      }
    } finally { setBusy(false); }
  };

  const myRecords = records.filter((r) => r.user_id === user?.id);
  const visibleRecords = canAssist ? records : myRecords;

  // Date-range filter
  const inRange = (iso: string) => {
    const d = iso.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  };
  const filtered = visibleRecords.filter((r) =>
    inRange(r.created_at) &&
    (!filter ||
      (r.staffName || "").toLowerCase().includes(filter.toLowerCase()) ||
      r.kind.includes(filter.toLowerCase()))
  );

  const showSelfie = async (path: string | null) => {
    if (!path) return;
    const url = await getSignedSelfieUrl(path);
    setPreviewUrl(url);
  };

  const handleExportRecords = async () => {
    const paths = filtered.map((r) => r.selfie_url).filter(Boolean) as string[];
    const signed = await signSelfieUrls(paths);
    const header = ["Date", "Time", "Staff", "Kind", "Status", "Match Score", "Notes", "Selfie URL (7-day signed)"];
    const rows = filtered.map((r) => {
      const d = new Date(r.created_at);
      return [
        d.toISOString().slice(0, 10),
        d.toLocaleTimeString([], { hour12: false }),
        r.staffName || "",
        r.kind,
        r.status,
        r.match_score ?? "",
        r.notes ?? "",
        r.selfie_url ? (signed[r.selfie_url] || "") : "",
      ];
    });
    downloadCsv(`attendance_${from}_to_${to}.csv`, toCsv([header, ...rows]));
  };

  // === Summary report aggregation ===
  // Pair check-ins with the next check-out per user to compute hours worked.
  const summary = useMemo(() => {
    const inRangeRecs = records.filter((r) => inRange(r.created_at)).slice().reverse(); // chronological
    const openIn: Record<string, AttendanceRecord> = {};
    type Session = { user_id: string; staffName: string; date: string; in: Date; out: Date | null; lateMin: number };
    const sessions: Session[] = [];

    for (const r of inRangeRecs) {
      if (r.kind === "check_in") {
        // Late = after shift start + grace
        const t = new Date(r.created_at);
        const [sh, sm] = DEFAULT_SHIFT_START.split(":").map(Number);
        const shiftStart = new Date(t); shiftStart.setHours(sh, sm + LATE_GRACE_MIN, 0, 0);
        const lateMin = Math.max(0, Math.round((t.getTime() - shiftStart.getTime()) / 60000));
        openIn[r.user_id] = r;
        sessions.push({ user_id: r.user_id, staffName: r.staffName || "Unknown", date: r.created_at.slice(0, 10), in: t, out: null, lateMin });
      } else if (r.kind === "check_out") {
        const last = sessions.slice().reverse().find((s) => s.user_id === r.user_id && !s.out);
        if (last) last.out = new Date(r.created_at);
      }
    }

    // Group
    const groupKey = (s: Session) => reportGroup === "day"
      ? `${s.user_id}|${s.date}`
      : `${s.user_id}|${ymd(startOfWeek(s.in))}`;

    const groups: Record<string, {
      user_id: string; staffName: string; period: string;
      checkIns: number; lateCount: number; totalLateMin: number; hoursWorked: number;
    }> = {};
    for (const s of sessions) {
      const k = groupKey(s);
      const period = reportGroup === "day" ? s.date : `Week of ${ymd(startOfWeek(s.in))}`;
      if (!groups[k]) groups[k] = { user_id: s.user_id, staffName: s.staffName, period, checkIns: 0, lateCount: 0, totalLateMin: 0, hoursWorked: 0 };
      groups[k].checkIns += 1;
      if (s.lateMin > 0) { groups[k].lateCount += 1; groups[k].totalLateMin += s.lateMin; }
      if (s.out) groups[k].hoursWorked += (s.out.getTime() - s.in.getTime()) / 3600000;
    }
    return Object.values(groups).sort((a, b) => a.period.localeCompare(b.period) || a.staffName.localeCompare(b.staffName));
  }, [records, from, to, reportGroup]);

  const exportSummary = () => {
    const header = ["Period", "Staff", "Check-ins", "Late Count", "Total Late (min)", "Hours Worked"];
    const rows = summary.map((s) => [s.period, s.staffName, s.checkIns, s.lateCount, s.totalLateMin, s.hoursWorked.toFixed(2)]);
    downloadCsv(`attendance_summary_${from}_to_${to}.csv`, toCsv([header, ...rows]));
  };

  const submitOverride = async () => {
    if (!overrideForm.targetUserId) { return; }
    const r = await manualOverride({
      targetUserId: overrideForm.targetUserId,
      kind: overrideForm.kind,
      reason: overrideForm.reason,
    });
    if (r) { setOverrideOpen(false); setOverrideForm({ targetUserId: "", kind: "check_in", reason: "" }); }
  };

  // Default tab: "log" for everyone — check-in lives on the Staff page now.
  // A `?sub=` URL param can preselect a specific sub-tab (e.g. ?sub=enroll
  // from quick-access links on the Staff page).
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedSubs = ["log", "report", "enroll", "audit"] as const;
  const subAllowed = (s: string | null): s is (typeof allowedSubs)[number] => {
    if (!s || !(allowedSubs as readonly string[]).includes(s)) return false;
    if (s === "report") return canReport;
    if (s === "enroll") return canEnroll;
    if (s === "audit") return canAudit;
    return true;
  };
  const subParam = searchParams.get("sub");
  // While auth/role is still resolving, keep the default tab to avoid a
  // flash of admin-only content when the URL preselects e.g. sub=enroll.
  const initialTab = !authLoading && subAllowed(subParam) ? subParam : "log";
  const [activeSub, setActiveSub] = useState<string>(initialTab);
  useEffect(() => {
    if (authLoading) return;
    const s = searchParams.get("sub");
    if (s && subAllowed(s)) {
      if (s !== activeSub) setActiveSub(s);
    } else if (activeSub !== "log") {
      setActiveSub("log");
    }
  }, [searchParams, authLoading, canReport, canEnroll, canAudit]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSubChange = (v: string) => {
    setActiveSub(v);
    const next = new URLSearchParams(searchParams);
    if (v === "log") next.delete("sub"); else next.set("sub", v);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Staff check-in &amp; check-out has moved to the <span className="font-medium text-foreground">Staff</span> page.
      </p>

      <Tabs value={activeSub} onValueChange={handleSubChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="log">{canAssist ? "All Records" : "My History"}</TabsTrigger>
          {!authLoading && canReport && <TabsTrigger value="report"><BarChart3 className="w-3.5 h-3.5 mr-1" />Report</TabsTrigger>}
          {!authLoading && canEnroll && <TabsTrigger value="enroll">Enroll Faces</TabsTrigger>}
          {!authLoading && canAudit && <TabsTrigger value="audit"><FileClock className="w-3.5 h-3.5 mr-1" />Audit Log</TabsTrigger>}
        </TabsList>


        <TabsContent value="log" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative max-w-xs flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or kind…" className="pl-9" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={handleExportRecords}>
                <Download className="w-4 h-4 mr-1" /> Export CSV
              </Button>
              {canOverride && (
                <Button size="sm" onClick={() => setOverrideOpen(true)}>
                  <ShieldAlert className="w-4 h-4 mr-1" /> Manual Override
                </Button>
              )}
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-2">Staff</th>
                    <th className="text-left px-4 py-2">Type</th>
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Score</th>
                    <th className="text-left px-4 py-2">Selfie</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No records in this range</td></tr>
                  )}
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => openDetails(r)}
                    >
                      <td className="px-4 py-2">{r.staffName}</td>
                      <td className="px-4 py-2">
                        <Badge variant={r.kind === "check_in" ? "default" : "secondary"}>
                          {r.kind === "check_in" ? "Check In" : "Check Out"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap"><Clock className="w-3 h-3 inline mr-1 text-muted-foreground" />{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <Badge variant={r.status === "manual" ? "outline" : r.status === "rejected" ? "destructive" : "default"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">{r.match_score != null ? `${r.match_score}` : "—"}</td>
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        {r.selfie_url ? (
                          <button onClick={() => showSelfie(r.selfie_url)} className="text-primary hover:underline text-xs">View</button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Report */}
        {canReport && (
          <TabsContent value="report" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground block">From</label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block">To</label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block">Group by</label>
                <Select value={reportGroup} onValueChange={(v) => setReportGroup(v as any)}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Daily</SelectItem>
                    <SelectItem value="week">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" onClick={exportSummary} className="ml-auto">
                <Download className="w-4 h-4 mr-1" /> Export Summary
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="glass-card p-4">
                <p className="text-xs text-muted-foreground">Total Check-ins</p>
                <p className="text-2xl font-bold">{summary.reduce((a, s) => a + s.checkIns, 0)}</p>
              </div>
              <div className="glass-card p-4">
                <p className="text-xs text-muted-foreground">Late Arrivals</p>
                <p className="text-2xl font-bold text-amber-500">{summary.reduce((a, s) => a + s.lateCount, 0)}</p>
              </div>
              <div className="glass-card p-4">
                <p className="text-xs text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold">{summary.reduce((a, s) => a + s.hoursWorked, 0).toFixed(1)}</p>
              </div>
              <div className="glass-card p-4">
                <p className="text-xs text-muted-foreground">Staff Active</p>
                <p className="text-2xl font-bold">{new Set(summary.map((s) => s.user_id)).size}</p>
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-muted/40">
                    <tr>
                      <th className="text-left px-4 py-2">Period</th>
                      <th className="text-left px-4 py-2">Staff</th>
                      <th className="text-left px-4 py-2">Check-ins</th>
                      <th className="text-left px-4 py-2">Late</th>
                      <th className="text-left px-4 py-2">Late (min)</th>
                      <th className="text-left px-4 py-2">Hours Worked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No data in range</td></tr>
                    )}
                    {summary.map((s, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-4 py-2 whitespace-nowrap">{s.period}</td>
                        <td className="px-4 py-2">{s.staffName}</td>
                        <td className="px-4 py-2">{s.checkIns}</td>
                        <td className="px-4 py-2">{s.lateCount > 0 ? <span className="text-amber-500">{s.lateCount}</span> : 0}</td>
                        <td className="px-4 py-2">{s.totalLateMin}</td>
                        <td className="px-4 py-2 font-medium">{s.hoursWorked.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Lateness based on shift start {DEFAULT_SHIFT_START} with {LATE_GRACE_MIN} min grace.</p>
          </TabsContent>
        )}

        {/* Admin enroll */}
        {canEnroll && (
          <TabsContent value="enroll" className="mt-4 space-y-4">
            <div className="glass-card p-5 space-y-3">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><UserCheck className="w-4 h-4" /> Enroll a staff member's face</h3>
              <p className="text-xs text-muted-foreground">Select the staff member, then capture a clear front-facing photo. They'll use this reference photo to verify check-ins.</p>
              <div className="grid sm:grid-cols-[1fr_auto] gap-3">
                <Select value={enrollTarget} onValueChange={setEnrollTarget}>
                  <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.user_id} value={s.user_id}>
                        {s.name} <span className="text-muted-foreground ml-2">({s.role})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  disabled={!enrollTarget}
                  onClick={() => setCaptureMode({ kind: "enroll", targetUserId: enrollTarget })}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-40"
                >
                  <Camera className="w-4 h-4" /> Capture Photo
                </button>
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-sm font-medium">Currently enrolled</div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr><th className="text-left px-4 py-2">Staff</th><th className="text-left px-4 py-2">Enrolled</th><th className="text-left px-4 py-2">Photo</th></tr>
                </thead>
                <tbody>
                  {enrollments.length === 0 && (
                    <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">Nobody enrolled yet</td></tr>
                  )}
                  {enrollments.map((e) => {
                    const fallbackName = staff.find((s) => s.user_id === e.user_id)?.name;
                    const displayName = (e.staffName && e.staffName !== "Unknown") ? e.staffName : (fallbackName || "Unknown");
                    return (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-4 py-2">{displayName}</td>
                        <td className="px-4 py-2">{new Date(e.created_at).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => showSelfie(e.image_url)} className="text-primary hover:underline text-xs">View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TabsContent>
        )}

        {/* Audit log */}
        {canAudit && (
          <TabsContent value="audit" className="mt-4">
            <div className="glass-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-sm font-medium flex items-center gap-2">
                <FileClock className="w-4 h-4" /> Manual Override Audit Log
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground bg-muted/40">
                    <tr>
                      <th className="text-left px-4 py-2">When</th>
                      <th className="text-left px-4 py-2">Staff</th>
                      <th className="text-left px-4 py-2">Action</th>
                      <th className="text-left px-4 py-2">Acted by</th>
                      <th className="text-left px-4 py-2">Reason</th>
                      <th className="text-left px-4 py-2">Original</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No overrides yet</td></tr>
                    )}
                    {auditLog.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-4 py-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="px-4 py-2">{a.targetName}</td>
                        <td className="px-4 py-2"><Badge variant="outline">{a.action}</Badge></td>
                        <td className="px-4 py-2">{a.actorName}</td>
                        <td className="px-4 py-2 max-w-xs">{a.reason}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {a.original_status ? `${a.original_status}${a.original_score != null ? ` (${a.original_score})` : ""}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Capture dialog */}
      <Dialog open={!!captureMode} onOpenChange={(o) => { if (!o) setCaptureMode(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {captureMode?.kind === "enroll"
                ? "Enroll Face"
                : captureMode?.kind === "check_in" || captureMode?.kind === "assist_check_in"
                  ? `Check In${captureMode?.targetUserId ? `: ${staff.find((s) => s.user_id === captureMode.targetUserId)?.name || "Staff"}` : ""}`
                  : `Check Out${captureMode?.targetUserId ? `: ${staff.find((s) => s.user_id === captureMode.targetUserId)?.name || "Staff"}` : ""}`}
            </DialogTitle>
            <DialogDescription>
              {captureMode?.kind === "enroll"
                ? "Capture a clear front-facing photo. Good lighting, no sunglasses."
                : "Look directly at the camera. The face will be matched against the enrolled reference photo."}
            </DialogDescription>
          </DialogHeader>
          {captureMode && (
            <CameraCapture
              busy={busy}
              ctaLabel={captureMode.kind === "enroll" ? "Save Photo" : "Verify & Submit"}
              onCapture={handleCapture}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Selfie preview */}
      <Dialog open={!!previewUrl} onOpenChange={(o) => { if (!o) setPreviewUrl(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Selfie</DialogTitle></DialogHeader>
          {previewUrl && <img src={previewUrl} alt="Selfie" className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>

      {/* Record details modal */}
      <Dialog open={!!detailsRec} onOpenChange={(o) => { if (!o) { setDetailsRec(null); setDetailsUrl(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attendance Record</DialogTitle>
            <DialogDescription>
              {detailsRec?.staffName} — {detailsRec?.kind === "check_in" ? "Check In" : "Check Out"}
            </DialogDescription>
          </DialogHeader>
          {detailsRec && (
            <div className="space-y-3">
              <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden min-h-[180px]">
                {detailsUrl ? (
                  <img src={detailsUrl} alt="Captured selfie" className="w-full max-h-72 object-contain" />
                ) : detailsRec.selfie_url ? (
                  <span className="text-xs text-muted-foreground py-10">Loading selfie…</span>
                ) : (
                  <span className="text-xs text-muted-foreground py-10">No selfie (manual entry)</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge variant={detailsRec.status === "manual" ? "outline" : detailsRec.status === "rejected" ? "destructive" : "default"}>
                    {detailsRec.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Match score</p>
                  <p className="font-medium">{detailsRec.match_score != null ? `${detailsRec.match_score} / 100` : "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">When</p>
                  <p className="font-medium">{new Date(detailsRec.created_at).toLocaleString()}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Verification reason / notes</p>
                  <p className="text-sm whitespace-pre-wrap">{detailsRec.notes || "—"}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDetailsRec(null); setDetailsUrl(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual override dialog (admin) */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Manual Attendance Override</DialogTitle>
            <DialogDescription>
              Use when face verification fails or staff forgot to clock. Action is logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Staff member</label>
              <Select value={overrideForm.targetUserId} onValueChange={(v) => setOverrideForm((f) => ({ ...f, targetUserId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>{s.name} ({s.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Action</label>
              <Select value={overrideForm.kind} onValueChange={(v) => setOverrideForm((f) => ({ ...f, kind: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="check_in">Check In</SelectItem>
                  <SelectItem value="check_out">Check Out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Reason (required, min 5 chars)</label>
              <Textarea
                value={overrideForm.reason}
                onChange={(e) => setOverrideForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Camera unavailable; verified ID at front desk."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button onClick={submitOverride} disabled={!overrideForm.targetUserId || overrideForm.reason.trim().length < 5}>
              Record Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
