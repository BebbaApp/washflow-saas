import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

export interface AttendanceRecord {
  id: string;
  user_id: string;
  kind: "check_in" | "check_out";
  selfie_url: string | null;
  match_score: number | null;
  status: "verified" | "manual" | "rejected";
  notes: string | null;
  created_at: string;
  staffName?: string;
}

export interface FaceEnrollment {
  id: string;
  user_id: string;
  image_url: string;
  created_at: string;
  staffName?: string;
}

export interface AuditEntry {
  id: string;
  attendance_id: string | null;
  target_user_id: string;
  acted_by: string;
  action: string;
  reason: string;
  original_score: number | null;
  original_status: string | null;
  created_at: string;
  targetName?: string;
  actorName?: string;
}

const BUCKET = "attendance-selfies";

async function uploadDataUrl(userId: string, kind: string, dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${kind}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export function useAttendance(_opts: { adminView?: boolean } = {}) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  // Reads come from the Dexie mirror (auto-synced by the central sync engine).
  const recordRows = useLiveTable<any>(tenantId, "attendance_records");
  const enrollmentRows = useLiveTable<any>(tenantId, "staff_face_enrollments");
  const auditRows = useLiveTable<any>(tenantId, "attendance_audit_log");

  // Profiles aren't tenant-scoped in the mirror; fetch once and listen for changes.
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [profilesLoading, setProfilesLoading] = useState(true);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("user_id,name");
    const map: Record<string, string> = {};
    (data || []).forEach((p: any) => { map[p.user_id] = p.name; });
    setProfilesMap(map);
    setProfilesLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
    const ch = supabase
      .channel(`attendance-profiles-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadProfiles())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadProfiles]);

  const records = useMemo<AttendanceRecord[]>(() => {
    const list = (recordRows ?? []).map((r: any) => ({ ...r, staffName: profilesMap[r.user_id] || "Unknown" }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list.slice(0, 2000);
  }, [recordRows, profilesMap]);

  const enrollments = useMemo<FaceEnrollment[]>(() => {
    const list = (enrollmentRows ?? [])
      .filter((e: any) => e.is_active !== false)
      .map((e: any) => ({ ...e, staffName: profilesMap[e.user_id] || "Unknown" }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list;
  }, [enrollmentRows, profilesMap]);

  const auditLog = useMemo<AuditEntry[]>(() => {
    const list = (auditRows ?? []).map((a: any) => ({
      ...a,
      targetName: profilesMap[a.target_user_id] || "Unknown",
      actorName: profilesMap[a.acted_by] || "Admin",
    }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list.slice(0, 500);
  }, [auditRows, profilesMap]);

  const loading =
    profilesLoading ||
    recordRows === undefined ||
    enrollmentRows === undefined ||
    auditRows === undefined;

  const enrollFace = useCallback(async (targetUserId: string, dataUrl: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: { action: "enroll_face", target_user_id: targetUserId, image_data_url: dataUrl },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Face enrolled");
      return true;
    } catch (e: any) {
      toast.error("Enrollment failed: " + (e.message || e));
      return false;
    }
  }, []);

  const lastForUser = useCallback((userId: string) => {
    return records.find((r) => r.user_id === userId) || null;
  }, [records]);

  const recordAttendance = useCallback(async (kind: "check_in" | "check_out", selfieDataUrl: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }

    const last = lastForUser(user.id);
    if (kind === "check_in" && last?.kind === "check_in") {
      toast.error("You're already checked in. Check out first.");
      return null;
    }
    if (kind === "check_out" && (!last || last.kind === "check_out")) {
      toast.error("You haven't checked in yet.");
      return null;
    }

    const { data: verify, error: vErr } = await supabase.functions.invoke("verify-attendance-face", {
      body: { selfieDataUrl },
    });
    if (vErr) {
      const msg = (vErr as any).message || String(vErr);
      if (msg.includes("no_enrollment")) {
        toast.error("No enrolled face. Ask an admin to enroll your face first.");
      } else if (msg.includes("ai_overloaded") || msg.includes("503")) {
        toast.error("Face verification service is busy. Please try again in a few seconds.");
      } else {
        toast.error("Face verification failed: " + msg);
      }
      return null;
    }

    const { score = 0, isMatch = false, reason = "" } = (verify || {}) as any;

    if (!isMatch) {
      toast.error(`Face did not match (score ${score}). ${reason || "Ask an admin for a manual override."}`);
      return null;
    }

    const path = await uploadDataUrl(user.id, kind, selfieDataUrl);
    const { data, error } = await supabase
      .from("attendance_records")
      .insert({
        tenant_id: tenantId,
        user_id: user.id,
        kind,
        selfie_url: path,
        match_score: score,
        status: "verified",
      } as any)
      .select()
      .single();
    if (error) { toast.error(error.message); return null; }
    toast.success(kind === "check_in" ? "Checked in" : "Checked out");
    return data as AttendanceRecord;
  }, [lastForUser, tenantId]);

  const recordAttendanceFor = useCallback(async (
    targetUserId: string,
    kind: "check_in" | "check_out",
    selfieDataUrl: string,
  ) => {
    const last = lastForUser(targetUserId);
    if (kind === "check_in" && last?.kind === "check_in") {
      toast.error("Staff is already checked in. Check out first.");
      return null;
    }
    if (kind === "check_out" && (!last || last.kind === "check_out")) {
      toast.error("Staff hasn't checked in yet.");
      return null;
    }

    const { data, error } = await supabase.functions.invoke("verify-attendance-face", {
      body: { selfieDataUrl, targetUserId, kind },
    });
    if (error) {
      const msg = (error as any).message || String(error);
      if (msg.includes("no_enrollment")) {
        toast.error("This staff member has no enrolled face. Enroll them first.");
      } else if (msg.includes("forbidden_assisted_check_in")) {
        toast.error("You don't have permission to check in other staff.");
      } else {
        toast.error("Verification failed: " + msg);
      }
      return null;
    }
    const { score = 0, isMatch = false, reason = "", record } = (data || {}) as any;
    if (!isMatch) {
      toast.error(`Face did not match (score ${score}). ${reason || "Use manual override if needed."}`);
      return null;
    }
    toast.success(`${kind === "check_in" ? "Checked in" : "Checked out"} (score ${score})`);
    return record as AttendanceRecord;
  }, [lastForUser]);

  const manualOverride = useCallback(async (params: {
    targetUserId: string;
    kind: "check_in" | "check_out";
    reason: string;
    originalScore?: number | null;
    originalStatus?: string | null;
  }) => {
    const { targetUserId, kind, reason, originalScore = null, originalStatus = null } = params;
    if (!reason || reason.trim().length < 5) {
      toast.error("Please provide a reason (min 5 chars).");
      return null;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }

    const { data: rec, error } = await supabase
      .from("attendance_records")
      .insert({
        tenant_id: tenantId,
        user_id: targetUserId,
        kind,
        selfie_url: null,
        match_score: null,
        status: "manual",
        notes: `Admin override: ${reason}`,
      } as any)
      .select()
      .single();
    if (error) { toast.error(error.message); return null; }

    const { error: aErr } = await supabase.from("attendance_audit_log").insert({
      tenant_id: tenantId,
      attendance_id: rec.id,
      target_user_id: targetUserId,
      acted_by: user.id,
      action: originalScore != null ? "override_failed_verification" : (kind === "check_in" ? "manual_check_in" : "manual_check_out"),
      reason: reason.trim(),
      original_score: originalScore,
      original_status: originalStatus,
    } as any);
    if (aErr) { toast.error("Override saved but audit log failed: " + aErr.message); }
    else { toast.success("Manual override recorded"); }
    return rec as AttendanceRecord;
  }, [tenantId]);

  const refetch = useCallback(async () => { await loadProfiles(); }, [loadProfiles]);

  return {
    records,
    enrollments,
    auditLog,
    profilesMap,
    loading,
    enrollFace,
    recordAttendance,
    recordAttendanceFor,
    manualOverride,
    lastForUser,
    refetch,
  };
}

export async function getSignedSelfieUrl(path: string, expiresIn = 300): Promise<string | null> {
  if (!path) return null;
  const clean = path.replace(/^.*attendance-selfies\//, "");
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(clean, expiresIn);
  return data?.signedUrl || null;
}

export async function signSelfieUrls(paths: (string | null)[], expiresIn = 7 * 24 * 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(paths.filter(Boolean).map(async (p) => {
    const url = await getSignedSelfieUrl(p as string, expiresIn);
    if (url) out[p as string] = url;
  }));
  return out;
}
