import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useAttendance, type AttendanceRecord } from "@/hooks/useAttendance";
import { CameraCapture } from "@/components/CameraCapture";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  LogIn, LogOut, UserCheck, Camera, Search, ShieldCheck,
  Volume2, VolumeX, ExternalLink,
} from "lucide-react";

interface StaffOption { user_id: string; name: string; role: string; has_face_enrollment?: boolean; }

interface StaffCheckInPanelProps {
  onOpenFaceEnroll?: () => void;
}

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

/**
 * Unified Staff Check-in panel.
 * - Shows the logged-in user's self check-in card at top (if they're on this
 *   workspace's roster).
 * - Below, admins/supervisors/managers see the full staff table for assisted
 *   check-in/out.
 * - All data is wired to the same `useAttendance` hook so records flow into
 *   the existing Attendance page / day log.
 */
export function StaffCheckInPanel({ onOpenFaceEnroll }: StaffCheckInPanelProps) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const canAssist = user?.role === "admin" || user?.role === "supervisor" || user?.role === "manager";
  const { records, enrollments, loading: attendanceLoading, recordAttendance, recordAttendanceFor, lastForUser, refetch } = useAttendance();

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

  const [captureMode, setCaptureMode] = useState<null | { kind: "check_in" | "check_out" | "assist_check_in" | "assist_check_out"; targetUserId?: string }>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const [directEnrollmentIds, setDirectEnrollmentIds] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const seenIdsRef = useRef<Set<string> | null>(null);

  const loadStaff = useCallback(async () => {
    if (!tenant?.id || !user?.id) { setStaff([]); return; }
    const { data } = await supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant.id } });
    setStaff(((data as any)?.users ?? [])
      .filter((u: any) => !!u.role)
      .filter((u: any) => canAssist || u.id === user.id)
      .map((u: any) => ({
        user_id: u.id,
        name: u.name || u.email || "Staff",
        role: u.role,
        has_face_enrollment: u.has_face_enrollment,
      })));
    const { data: statusRows } = await (supabase as any)
      .from("staff_active_status")
      .select("user_id,is_active");
    const m: Record<string, boolean> = {};
    (statusRows || []).forEach((r: any) => { m[r.user_id] = !!r.is_active; });
    setActiveMap(m);
  }, [canAssist, tenant?.id, user?.id]);

  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const loadEnrollmentIds = useCallback(async () => {
    if (!tenant?.id) { setDirectEnrollmentIds(null); return; }
    const { data, error } = await supabase
      .from("staff_face_enrollments" as any)
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("is_active", true);
    setDirectEnrollmentIds(error ? null : new Set(((data as any[]) ?? []).map((e) => e.user_id)));
  }, [tenant?.id]);

  useEffect(() => {
    setDirectEnrollmentIds(null);
    void loadEnrollmentIds();
  }, [loadEnrollmentIds, enrollments.length]);

  // Refresh when a face enrollment happens elsewhere in the app.
  useEffect(() => {
    const handler = () => { void loadEnrollmentIds(); void loadStaff(); };
    window.addEventListener("wf:face-enrolled", handler);
    return () => window.removeEventListener("wf:face-enrolled", handler);
  }, [loadEnrollmentIds, loadStaff]);

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

  const myEnrolled = useMemo(
    () => !!user && (
      directEnrollmentIds?.has(user.id) === true ||
      staff.some((s) => s.user_id === user.id && s.has_face_enrollment === true) ||
      enrollments.some((e) => e.user_id === user.id)
    ),
    [directEnrollmentIds, enrollments, staff, user]
  );
  const myEnrollmentResolving = !!user && directEnrollmentIds === null &&
    !staff.some((s) => s.user_id === user.id && s.has_face_enrollment !== undefined) && attendanceLoading;
  const myLast = user ? lastForUser(user.id) : null;
  const nextKind: "check_in" | "check_out" = myLast?.kind === "check_in" ? "check_out" : "check_in";

  const handleCapture = async (dataUrl: string) => {
    if (!captureMode) return;
    setBusy(true);
    try {
      let res: any = null;
      if (captureMode.kind === "check_in" || captureMode.kind === "check_out") {
        res = await recordAttendance(captureMode.kind, dataUrl);
      } else if (captureMode.targetUserId) {
        const realKind = captureMode.kind === "assist_check_in" ? "check_in" : "check_out";
        res = await recordAttendanceFor(captureMode.targetUserId, realKind, dataUrl);
      }
      // Always close the dialog so it never gets stuck; toast errors stay visible.
      setCaptureMode(null);
      await refetch();
      return res;
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Self check-in card */}
      {isStaffHere === true && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="font-semibold text-foreground">{user?.name || user?.email} <span className="text-xs text-muted-foreground ml-1">(you)</span></h3>
              <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Last activity</p>
              <p className="text-sm font-medium">
                {myLast ? (
                  <>
                    <Badge variant={myLast.kind === "check_in" ? "default" : "secondary"} className="mr-2">
                      {myLast.kind === "check_in" ? "Checked In" : "Checked Out"}
                    </Badge>
                    {new Date(myLast.created_at).toLocaleString()}
                  </>
                ) : "—"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setCaptureMode({ kind: "check_in" })}
              disabled={busy || myEnrollmentResolving || !myEnrolled || nextKind !== "check_in"}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-40"
            >
              <LogIn className="w-4 h-4" /> Check In
            </button>
            <button
              onClick={() => setCaptureMode({ kind: "check_out" })}
              disabled={busy || myEnrollmentResolving || !myEnrolled || nextKind !== "check_out"}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-40"
            >
              <LogOut className="w-4 h-4" /> Check Out
            </button>
          </div>

          {myEnrollmentResolving ? (
            <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
              <ShieldCheck className="w-4 h-4" />
              Checking face enrollment…
            </div>
          ) : !myEnrolled && (
            <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
              <ShieldCheck className="w-4 h-4" />
              Your face hasn't been enrolled yet. Ask an admin to enroll you under{" "}
              <button type="button" onClick={onOpenFaceEnroll} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Attendance → Enroll Faces <ExternalLink className="w-3 h-3" />
              </button>
              .
            </div>
          )}
        </div>
      )}

      {/* Assisted check-in (admin/supervisor/manager) */}
      {canAssist && (
        <>
          <div className="glass-card p-5 space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> Check in / out staff with a live selfie
            </h3>
            <p className="text-xs text-muted-foreground">
              Capture each staff member's photo as they report or leave. Their face is verified
              against the enrolled reference and the record is saved live.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative max-w-xs flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search staff…"
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => setSoundOn((v) => !v)}>
                {soundOn ? <Volume2 className="w-4 h-4 mr-1" /> : <VolumeX className="w-4 h-4 mr-1" />}
                {soundOn ? "Sound on" : "Muted"}
              </Button>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-2">Staff</th>
                    <th className="text-left px-4 py-2">Role</th>
                    <th className="text-left px-4 py-2">Enrolled</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Last activity</th>
                    <th className="text-right px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No staff found</td></tr>
                  )}
                  {staff
                    .filter((s) => activeMap[s.user_id] !== false)
                    .filter((s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()))
                    .map((s) => {
                      const enrolled =
                        directEnrollmentIds?.has(s.user_id) === true ||
                        s.has_face_enrollment === true ||
                        enrollments.some((e) => e.user_id === s.user_id);
                      const enrollmentResolving = directEnrollmentIds === null && s.has_face_enrollment === undefined && attendanceLoading;
                      const last = lastForUser(s.user_id);
                      const next: "check_in" | "check_out" = last?.kind === "check_in" ? "check_out" : "check_in";
                      return (
                        <tr key={s.user_id} className="border-t border-border">
                          <td className="px-4 py-2 font-medium">{s.name}{s.user_id === user?.id && <span className="text-xs text-muted-foreground ml-1">(you)</span>}</td>
                          <td className="px-4 py-2 text-muted-foreground capitalize">{s.role}</td>
                          <td className="px-4 py-2">
                            {enrolled
                              ? <Badge variant="default">Enrolled</Badge>
                              : enrollmentResolving
                                ? <Badge variant="secondary">Checking…</Badge>
                              : <Badge variant="outline">Not enrolled</Badge>}
                          </td>
                          <td className="px-4 py-2"><StatusPill last={last} /></td>
                          <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                            {last ? new Date(last.created_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              disabled={busy || enrollmentResolving || !enrolled}
                              title={!enrolled ? "Face not enrolled yet — enroll under Attendance → Enroll Faces first." : undefined}
                              variant={next === "check_in" ? "default" : "secondary"}
                              onClick={() => setCaptureMode({
                                kind: next === "check_in" ? "assist_check_in" : "assist_check_out",
                                targetUserId: s.user_id,
                              })}
                            >
                              <Camera className="w-3.5 h-3.5 mr-1" />
                              {next === "check_in" ? "Check In" : "Check Out"}
                            </Button>
                            {!enrolled && !enrollmentResolving && (
                              <p className="text-[10px] text-muted-foreground mt-1">Enroll face to enable</p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: staff without an enrolled face must be enrolled first under{" "}
            <button
              type="button"
              onClick={onOpenFaceEnroll}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Attendance → Enroll Faces <ExternalLink className="w-3 h-3" />
            </button>
            .
          </p>
        </>
      )}

      {/* Capture dialog */}
      <Dialog open={!!captureMode} onOpenChange={(o) => { if (!o) setCaptureMode(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {captureMode?.kind === "check_in" || captureMode?.kind === "assist_check_in"
                ? `Check In${captureMode?.targetUserId ? `: ${staff.find((s) => s.user_id === captureMode.targetUserId)?.name || "Staff"}` : ""}`
                : `Check Out${captureMode?.targetUserId ? `: ${staff.find((s) => s.user_id === captureMode.targetUserId)?.name || "Staff"}` : ""}`}
            </DialogTitle>
          </DialogHeader>
          {captureMode && (
            <CameraCapture onCapture={handleCapture} busy={busy} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
