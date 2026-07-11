import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";
import { db } from "@/offline/db";
import { offlineInsert } from "@/offline/offlineWrite";
import { enqueueOutbox } from "@/offline/sync";

// supabase.functions.invoke turns any non-2xx into a generic
// "Edge Function returned a non-2xx status code" error. Read the response
// body from FunctionsHttpError.context so the toast shows the real reason.
async function extractInvokeError(err: unknown): Promise<{ code?: string; detail?: string; message: string }> {
  const anyErr = err as any;
  const fallback = anyErr?.message || String(err);
  try {
    const ctx = anyErr?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.clone().json().catch(async () => {
        const t = await ctx.clone().text().catch(() => "");
        return t ? { error: t } : {};
      });
      const code = body?.error || body?.code;
      const detail = body?.detail || body?.message || body?.reason;
      return { code, detail, message: [code, detail].filter(Boolean).join(": ") || fallback };
    }
  } catch { /* ignore */ }
  return { message: fallback };
}

export interface AttendanceRecord {
  id: string;
  tenant_id?: string;
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

function enrollmentImageBelongsToUser(enrollment: { tenant_id?: string | null; user_id?: string | null; image_url?: string | null }) {
  if (!enrollment?.user_id || !enrollment?.image_url) return false;
  const clean = String(enrollment.image_url).replace(/^.*attendance-selfies\//, "");
  return clean.startsWith(`${enrollment.user_id}/`) ||
    (!!enrollment.tenant_id && clean.startsWith(`${enrollment.tenant_id}/${enrollment.user_id}/`));
}

// localStorage keys for offline queue
const SELFIE_QUEUE_KEY = "wf_selfie_upload_queue";
const AUDIT_CACHE_KEY = "wf_audit_log_cache";
const PROFILES_CACHE_KEY = "wf_attendance_profiles_cache";
const LAST_FACE_ENROLLMENT_KEY_PREFIX = "wf_last_face_enrollment:";

function lsLoad<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function lsSave(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

function rememberLastFaceEnrollment(tenantId: string, userId: string) {
  lsSave(`${LAST_FACE_ENROLLMENT_KEY_PREFIX}${tenantId}`, {
    userId,
    createdAt: Date.now(),
  });
}

// Queue a selfie for upload when back online
interface SelfieQueueItem {
  id: string;
  userId: string;
  kind: string;
  dataUrl: string;
  attendanceRecordId: string;
  queuedAt: string;
}

async function queueSelfieUpload(item: SelfieQueueItem) {
  const queue = lsLoad<SelfieQueueItem[]>(SELFIE_QUEUE_KEY, []);
  queue.push(item);
  lsSave(SELFIE_QUEUE_KEY, queue);
}

async function cacheAttendanceRecord(record: any) {
  if (!record?.id || !record?.tenant_id) return;
  await db.attendance_records.put({ ...record, _dirty: 0 });
}

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

// Drain the selfie upload queue when back online
async function drainSelfieQueue() {
  const queue = lsLoad<SelfieQueueItem[]>(SELFIE_QUEUE_KEY, []);
  if (queue.length === 0) return;
  const remaining: SelfieQueueItem[] = [];
  for (const item of queue) {
    try {
      const path = await uploadDataUrl(item.userId, item.kind, item.dataUrl);
      // Update the attendance record with the real selfie URL
      await supabase.from("attendance_records" as any)
        .update({ selfie_url: path })
        .eq("id", item.attendanceRecordId);
      // Update local Dexie record too
      const local = await db.attendance_records.get(item.attendanceRecordId);
      if (local) await db.attendance_records.put({ ...local, selfie_url: path } as any);
    } catch {
      remaining.push(item); // keep for retry
    }
  }
  lsSave(SELFIE_QUEUE_KEY, remaining);
}

export function useAttendance(_opts: { adminView?: boolean } = {}) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const recordRows = useLiveTable<any>(tenantId, "attendance_records");
  const enrollmentRows = useLiveTable<any>(tenantId, "staff_face_enrollments");

  // Audit log — fetch from Supabase when online, use localStorage cache when offline
  const [auditRows, setAuditRows] = useState<any[] | undefined>(undefined);

  useEffect(() => {
    if (!tenantId) { setAuditRows([]); return; }
    let active = true;

    const load = async () => {
      if (navigator.onLine) {
        try {
          const { data } = await supabase
            .from("attendance_audit_log")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(500);
          if (!active) return;
          const rows = (data as any[]) ?? [];
          setAuditRows(rows);
          lsSave(AUDIT_CACHE_KEY, rows); // cache for offline
          return;
        } catch { /* fall through */ }
      }
      // Offline: use cached audit log
      if (active) setAuditRows(lsLoad<any[]>(AUDIT_CACHE_KEY, []));
    };

    load();

    let ch: ReturnType<typeof supabase.channel> | null = null;
    if (navigator.onLine) {
      ch = supabase
        .channel(`audit-${tenantId}-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "attendance_audit_log" }, () => load())
        .subscribe();
    }

    return () => { active = false; if (ch) supabase.removeChannel(ch); };
  }, [tenantId]);

  // Profiles — Supabase when online, Dexie tenant_members + localStorage cache when offline
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>(
    () => lsLoad(PROFILES_CACHE_KEY, {})
  );
  const [profilesLoading, setProfilesLoading] = useState(true);

  const loadProfiles = useCallback(async () => {
    if (navigator.onLine) {
      try {
        const { data } = await supabase.from("profiles").select("user_id,name");
        const map: Record<string, string> = {};
        (data || []).forEach((p: any) => { map[p.user_id] = p.name; });
        setProfilesMap(map);
        lsSave(PROFILES_CACHE_KEY, map);
        setProfilesLoading(false);
        return;
      } catch { /* fall through */ }
    }
    // Offline: use cached profiles + local tenant_members
    const cached = lsLoad<Record<string, string>>(PROFILES_CACHE_KEY, {});
    if (tenantId) {
      try {
        const members = await (db as any).tenant_members
          .where("tenant_id").equals(tenantId).toArray();
        for (const m of members) {
          if (m.user_id && m.name) cached[m.user_id] = m.name;
        }
      } catch { /* ignore */ }
    }
    setProfilesMap(cached);
    setProfilesLoading(false);
  }, [tenantId]);

  useEffect(() => {
    loadProfiles();
    let ch: ReturnType<typeof supabase.channel> | null = null;
    if (navigator.onLine) {
      ch = supabase
        .channel(`attendance-profiles-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadProfiles())
        .subscribe();
    }
    return () => { if (ch) supabase.removeChannel(ch); };
  }, [loadProfiles]);

  // Drain selfie queue when coming back online
  useEffect(() => {
    const handleOnline = () => drainSelfieQueue();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const records = useMemo<AttendanceRecord[]>(() => {
    const list = (recordRows ?? []).map((r: any) => ({
      ...r, staffName: profilesMap[r.user_id] || "Unknown",
    }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return list.slice(0, 2000);
  }, [recordRows, profilesMap]);

  const enrollments = useMemo<FaceEnrollment[]>(() => {
    const list = (enrollmentRows ?? [])
      .filter((e: any) => e.is_active !== false)
      .filter(enrollmentImageBelongsToUser)
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

  const lastForUser = useCallback((userId: string) => {
    return records.find((r) => r.user_id === userId) || null;
  }, [records]);

  // Face enrollment — requires internet, queues if offline
  const enrollFace = useCallback(async (targetUserId: string, dataUrl: string) => {
    if (!navigator.onLine) {
      toast.error("Face enrollment requires an internet connection. Please try again when online.");
      return false;
    }
    if (!tenantId) {
      toast.error("No active workspace. Open a tenant and try again.");
      return false;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast.error("Your session has expired. Please sign in again.");
        return false;
      }
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: {
          action: "enroll_face",
          tenant_id: tenantId,
          target_user_id: targetUserId,
          image_data_url: dataUrl,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      // Immediately reconcile the local Dexie mirror so the UI (Enrolled badge,
      // Check-in button) updates without waiting on realtime. Any previous
      // enrollment for this user is replaced by the freshly-inserted active row.
      try {
        const savedEnrollment = (data as any)?.enrollment;
        const existing = await db.staff_face_enrollments
          .where("tenant_id").equals(tenantId).toArray();
        const stale = existing.filter((r: any) => r.user_id === targetUserId);
        if (stale.length) await db.staff_face_enrollments.bulkDelete(stale.map((r: any) => r.id));

        if (savedEnrollment?.id) {
          await db.staff_face_enrollments.put({ ...savedEnrollment, _dirty: 0 } as any);
        } else {
          const { data: rows } = await supabase
            .from("staff_face_enrollments" as any)
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("user_id", targetUserId)
            .eq("is_active", true);
          if (rows?.length) {
            await db.staff_face_enrollments.bulkPut(
              rows.map((r: any) => ({ ...r, _dirty: 0 })),
            );
          }
        }
      } catch { /* mirror will catch up via realtime */ }

      toast.success("Face enrolled");
      rememberLastFaceEnrollment(tenantId, targetUserId);
      window.dispatchEvent(new CustomEvent("wf:face-enrolled", { detail: { userId: targetUserId } }));
      return true;
    } catch (e: any) {
      toast.error("Enrollment failed: " + (e.message || e));
      return false;
    }
  }, [tenantId]);

  // Record attendance — face verify online, manual fallback offline
  const recordAttendance = useCallback(async (kind: "check_in" | "check_out", selfieDataUrl: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }

    // Resolve tenant ID
    let activeTenantId: string | null = tenantId;
    if (!activeTenantId) {
      const claim = (user as any)?.app_metadata?.active_tenant_id as string | undefined;
      if (claim) activeTenantId = claim;
    }
    if (!activeTenantId) {
      if (navigator.onLine) {
        const { data: tm } = await supabase
          .from("tenant_members").select("tenant_id")
          .eq("user_id", user.id).limit(1).maybeSingle();
        activeTenantId = (tm as any)?.tenant_id ?? null;
      } else {
        // Offline: try local Dexie
        try {
          const members = await (db as any).tenant_members
            .where("user_id").equals(user.id).first();
          activeTenantId = members?.tenant_id ?? null;
        } catch { /* ignore */ }
      }
    }
    if (!activeTenantId) {
      toast.error("No active workspace. Open a tenant and try again.");
      return null;
    }

    // Check last record for sequence validation
    let last = lastForUser(user.id);
    if (navigator.onLine) {
      try {
        const { data: freshLast } = await supabase
          .from("attendance_records").select("*")
          .eq("tenant_id", activeTenantId).eq("user_id", user.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (freshLast) {
          await cacheAttendanceRecord(freshLast);
          last = freshLast as any;
        }
      } catch { /* use local last */ }
    }

    if (kind === "check_in" && last?.kind === "check_in") {
      toast.error("Already checked in. Check out first.");
      return null;
    }
    if (kind === "check_out" && (!last || last.kind === "check_out")) {
      toast.error("You haven't checked in yet.");
      return null;
    }

    // ONLINE: use face verification edge function
    if (navigator.onLine) {
      try {
        const { data: verify, error: vErr } = await supabase.functions.invoke("verify-attendance-face", {
          body: { selfieDataUrl, kind, tenantId: activeTenantId },
        });
        if (vErr) {
          const { code, message } = await extractInvokeError(vErr);
          if (code === "no_enrollment") {
            toast.error("No enrolled face. Ask an admin to enroll your face first.");
          } else if (code === "ai_overloaded") {
            toast.error("Face verification busy. Please retake in a few seconds.");
          } else if (code === "tenant_not_resolved") {
            toast.error("No active workspace found for your account.");
          } else if (code === "AI not configured") {
            toast.error("Face verification is not configured. Contact an admin.");
          } else {
            toast.error("Face verification failed: " + message);
          }
          return null;
        }
        const { score = 0, isMatch = false, reason = "", record = null } = (verify || {}) as any;
        if (!isMatch) {
          toast.error(`Face did not match (score ${score}). ${reason || "Please retake or ask admin for override."}`);
          return null;
        }
        if (record?.id) {
          await cacheAttendanceRecord(record);
          toast.success(kind === "check_in" ? "✅ Checked in" : "✅ Checked out");
          return record as AttendanceRecord;
        }
        // Fallback: upload selfie + insert record manually
        const path = await uploadDataUrl(user.id, kind, selfieDataUrl);
        const { data, error } = await supabase.from("attendance_records")
          .insert({
            tenant_id: activeTenantId, user_id: user.id, kind,
            selfie_url: path, match_score: score, status: "verified",
          } as any).select().single();
        if (error) { toast.error("Could not save attendance: " + error.message); return null; }
        await cacheAttendanceRecord(data);
        toast.success(kind === "check_in" ? "✅ Checked in" : "✅ Checked out");
        return data as AttendanceRecord;
      } catch (e: any) {
        toast.error("Attendance failed: " + (e?.message || String(e)));
        return null;
      }
    }

    // OFFLINE: record as manual check-in, queue selfie upload
    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const offlineRecord = {
      id: recordId,
      tenant_id: activeTenantId,
      user_id: user.id,
      kind,
      selfie_url: null, // will be updated when selfie uploads
      match_score: null,
      status: "manual" as const,
      notes: "Offline check-in — face verification pending sync",
      created_at: now,
    };

    // Save to local Dexie
    await db.attendance_records.put({ ...offlineRecord, _dirty: 1, _op: "insert" });

    // Queue for Supabase sync
    await enqueueOutbox({
      tenant_id: activeTenantId,
      table: "attendance_records",
      op: "insert",
      payload: offlineRecord,
    });

    // Queue selfie for upload when back online
    if (selfieDataUrl) {
      await queueSelfieUpload({
        id: crypto.randomUUID(),
        userId: user.id,
        kind,
        dataUrl: selfieDataUrl,
        attendanceRecordId: recordId,
        queuedAt: now,
      });
    }

    toast.success(
      kind === "check_in" ? "✅ Checked in (offline)" : "✅ Checked out (offline)",
      { description: "Face verification will complete when you're back online." }
    );
    return offlineRecord as AttendanceRecord;
  }, [lastForUser, tenantId]);

  // Admin-assisted attendance for another staff member
  const recordAttendanceFor = useCallback(async (
    targetUserId: string,
    kind: "check_in" | "check_out",
    selfieDataUrl: string,
  ) => {
    let last = lastForUser(targetUserId);
    if (tenantId && navigator.onLine) {
      try {
        const { data: freshLast } = await supabase
          .from("attendance_records").select("*")
          .eq("tenant_id", tenantId).eq("user_id", targetUserId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (freshLast) { await cacheAttendanceRecord(freshLast); last = freshLast as any; }
      } catch { /* use local */ }
    }

    if (kind === "check_in" && last?.kind === "check_in") {
      toast.error("Staff is already checked in. Check out first."); return null;
    }
    if (kind === "check_out" && (!last || last.kind === "check_out")) {
      toast.error("Staff hasn't checked in yet."); return null;
    }

    // ONLINE: use face verification
    if (navigator.onLine) {
      const { data, error } = await supabase.functions.invoke("verify-attendance-face", {
        body: { selfieDataUrl, targetUserId, kind, tenantId },
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
      if (record) await cacheAttendanceRecord(record);
      toast.success(`${kind === "check_in" ? "Checked in" : "Checked out"} (score ${score})`);
      return record as AttendanceRecord;
    }

    // OFFLINE: record as manual for the target staff member
    if (!tenantId) { toast.error("No active workspace."); return null; }
    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const offlineRecord = {
      id: recordId, tenant_id: tenantId, user_id: targetUserId,
      kind, selfie_url: null, match_score: null, status: "manual" as const,
      notes: "Offline assisted check-in — face verification pending sync",
      created_at: now,
    };
    await db.attendance_records.put({ ...offlineRecord, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenantId, table: "attendance_records", op: "insert", payload: offlineRecord });
    if (selfieDataUrl) {
      await queueSelfieUpload({
        id: crypto.randomUUID(), userId: targetUserId, kind,
        dataUrl: selfieDataUrl, attendanceRecordId: recordId, queuedAt: now,
      });
    }
    const staffName = profilesMap[targetUserId] || "Staff member";
    toast.success(`${staffName} ${kind === "check_in" ? "checked in" : "checked out"} (offline)`);
    return offlineRecord as AttendanceRecord;
  }, [lastForUser, tenantId, profilesMap]);

  // Manual override — offline-first via Dexie + outbox
  const manualOverride = useCallback(async (params: {
    targetUserId: string;
    kind: "check_in" | "check_out";
    reason: string;
    originalScore?: number | null;
    originalStatus?: string | null;
  }) => {
    const { targetUserId, kind, reason, originalScore = null, originalStatus = null } = params;
    if (!reason || reason.trim().length < 5) {
      toast.error("Please provide a reason (min 5 chars)."); return null;
    }
    if (!tenantId) { toast.error("No active workspace."); return null; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not signed in"); return null; }

    // Create attendance record offline-first
    const rec = await offlineInsert("attendance_records", tenantId, {
      user_id: targetUserId, kind,
      selfie_url: null, match_score: null, status: "manual",
      notes: `Admin override: ${reason}`,
    });

    // Audit log — write to Supabase if online, cache locally if offline
    const auditEntry = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      attendance_id: rec.id,
      target_user_id: targetUserId,
      acted_by: user.id,
      action: originalScore != null
        ? "override_failed_verification"
        : kind === "check_in" ? "manual_check_in" : "manual_check_out",
      reason: reason.trim(),
      original_score: originalScore,
      original_status: originalStatus,
      created_at: new Date().toISOString(),
    };

    if (navigator.onLine) {
      const { error: aErr } = await supabase
        .from("attendance_audit_log").insert(auditEntry as any);
      if (aErr) {
        // Cache locally for retry
        const cached = lsLoad<any[]>(AUDIT_CACHE_KEY, []);
        cached.unshift(auditEntry);
        lsSave(AUDIT_CACHE_KEY, cached);
        toast.error("Override saved but audit log failed: " + aErr.message);
      } else {
        toast.success("Manual override recorded");
      }
    } else {
      // Offline: save audit entry to localStorage and queue for Supabase
      const cached = lsLoad<any[]>(AUDIT_CACHE_KEY, []);
      cached.unshift(auditEntry);
      lsSave(AUDIT_CACHE_KEY, cached);
      setAuditRows(cached);
      // Queue audit log for sync (note: attendance_audit_log isn't in MIRRORED_TABLES
      // so we push directly via outbox with a custom table flag)
      await enqueueOutbox({
        tenant_id: tenantId,
        table: "attendance_audit_log" as any,
        op: "insert",
        payload: auditEntry,
      });
      toast.success("Manual override recorded (offline — will sync when online)");
    }

    return rec as unknown as AttendanceRecord;
  }, [tenantId]);

  const refetch = useCallback(async () => { await loadProfiles(); }, [loadProfiles]);

  return {
    records, enrollments, auditLog, profilesMap, loading,
    enrollFace, recordAttendance, recordAttendanceFor,
    manualOverride, lastForUser, refetch,
  };
}

// Signed URL for selfie — returns null when offline (no storage access)
export async function getSignedSelfieUrl(path: string, expiresIn = 300): Promise<string | null> {
  if (!path || !navigator.onLine) return null;
  const clean = path.replace(/^.*attendance-selfies\//, "");
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(clean, expiresIn);
  return data?.signedUrl || null;
}

export async function signSelfieUrls(
  paths: (string | null)[],
  expiresIn = 7 * 24 * 3600,
): Promise<Record<string, string>> {
  if (!navigator.onLine) return {};
  const out: Record<string, string> = {};
  await Promise.all(
    paths.filter(Boolean).map(async (p) => {
      const url = await getSignedSelfieUrl(p as string, expiresIn);
      if (url) out[p as string] = url;
    }),
  );
  return out;
}
