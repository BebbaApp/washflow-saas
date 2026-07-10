/**
 * useScheduling — offline-first replacement
 * Reads from Dexie (useLiveTable), writes via offlineWrite helpers.
 * Supabase edge-function calls (manage-staff list) fall back to Dexie when offline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { useLiveTable } from "@/offline/useLiveTable";
import { db } from "@/offline/db";
import { offlineInsert, offlineUpdate, offlineDelete } from "@/offline/offlineWrite";
import { supabase } from "@/integrations/supabase/client";

export interface StaffMember { id: string; name: string; email: string; role: string; createdAt?: string; }
export interface Shift {
  id: string; staffUserId: string; staffName: string;
  shiftDate: string; startTime: string; endTime: string;
  templateId?: string; notes?: string;
}
export interface ShiftTemplate {
  id: string; name: string; startTime: string; endTime: string; daysOfWeek: number[]; color?: string;
}
export interface TimeOffRequest {
  id: string; userId: string; staffName: string;
  startDate: string; endDate: string; reason: string;
  status: "pending" | "approved" | "rejected"; createdAt: string;
}

function mapShift(r: any): Shift {
  return {
    id: r.id, staffUserId: r.staff_user_id, staffName: r.staff_name ?? "",
    shiftDate: r.shift_date, startTime: r.start_time, endTime: r.end_time,
    templateId: r.template_id ?? undefined, notes: r.notes ?? undefined,
  };
}
function mapTemplate(r: any): ShiftTemplate {
  return {
    id: r.id, name: r.name, startTime: r.start_time, endTime: r.end_time,
    daysOfWeek: r.days_of_week ?? [],
  };
}
function mapTimeOff(r: any): TimeOffRequest {
  return {
    id: r.id, userId: r.user_id, staffName: r.staff_name ?? "",
    startDate: r.start_date, endDate: r.end_date, reason: r.reason ?? "",
    status: r.status ?? "pending", createdAt: r.created_at,
  };
}

export function useScheduling() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  const shiftRows = useLiveTable<any>(tenant?.id, "shifts");
  const templateRows = useLiveTable<any>(tenant?.id, "shift_templates");
  const timeOffRows = useLiveTable<any>(tenant?.id, "time_off_requests");

  const shifts = useMemo(() => (shiftRows ?? []).map(mapShift), [shiftRows]);
  const shiftTemplates = useMemo(() => (templateRows ?? []).map(mapTemplate), [templateRows]);
  const timeOffRequests = useMemo(() => (timeOffRows ?? []).map(mapTimeOff), [timeOffRows]);
  const loading = shiftRows === undefined;

  // Load staff — from Supabase when online, from local Dexie when offline
  useEffect(() => {
    if (!tenant?.id) return;
    const isUuid = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const prettify = (name: string, email: string, id: string) => {
      if (name && !isUuid(name)) return name;
      if (email) return email.split("@")[0];
      return "Unnamed staff";
    };
    const load = async () => {
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase.functions.invoke("manage-staff", {
            body: { action: "list", tenant_id: tenant.id },
          });
          if (!error && data?.users) {
            setStaffMembers(
              data.users.map((u: any) => ({
                ...u,
                name: prettify(u.name ?? "", u.email ?? "", u.id),
              })),
            );
            return;
          }
        } catch { /* fall through to offline */ }
      }
      // Offline: read from local tenant_members + profiles
      const members = await (db as any).tenant_members
        .where("tenant_id").equals(tenant.id).toArray();
      setStaffMembers(members.map((m: any) => ({
        id: m.user_id,
        name: prettify(m.name ?? "", m.email ?? "", m.user_id),
        email: m.email ?? "",
        role: m.tenant_role ?? "member",
      })));
    };
    load();
  }, [tenant?.id]);

  const addShift = useCallback(async (data: Omit<Shift, "id" | "staffName">) => {
    if (!tenant?.id) return;
    const staff = staffMembers.find((s) => s.id === data.staffUserId);
    await offlineInsert("shifts", tenant.id, {
      staff_user_id: data.staffUserId,
      staff_name: staff?.name ?? "",
      shift_date: data.shiftDate,
      start_time: data.startTime,
      end_time: data.endTime,
      template_id: data.templateId ?? null,
      notes: data.notes ?? null,
    });
    toast.success("Shift added");
  }, [tenant?.id, staffMembers]);

  const updateShift = useCallback(async (shiftId: string, data: Partial<Shift>) => {
    if (!tenant?.id) return;
    const patch: Record<string, unknown> = {};
    if (data.shiftDate) patch.shift_date = data.shiftDate;
    if (data.startTime) patch.start_time = data.startTime;
    if (data.endTime) patch.end_time = data.endTime;
    if (data.notes !== undefined) patch.notes = data.notes ?? null;
    await offlineUpdate("shifts", tenant.id, shiftId, patch);
    toast.success("Shift updated");
  }, [tenant?.id]);

  const deleteShift = useCallback(async (shiftId: string) => {
    if (!tenant?.id) return;
    await offlineDelete("shifts", tenant.id, shiftId);
    toast.success("Shift deleted");
  }, [tenant?.id]);

  const submitTimeOffRequest = useCallback(async (data: {
    startDate: string; endDate: string; reason: string;
  }) => {
    if (!tenant?.id || !user?.id) return;
    const staff = staffMembers.find((s) => s.id === user.id);
    await offlineInsert("time_off_requests", tenant.id, {
      user_id: user.id,
      staff_name: staff?.name ?? user.email ?? "",
      start_date: data.startDate,
      end_date: data.endDate,
      reason: data.reason,
      status: "pending",
    });
    toast.success("Time-off request submitted");
  }, [tenant?.id, user, staffMembers]);

  const updateTimeOffStatus = useCallback(async (requestId: string, status: "approved" | "rejected") => {
    if (!tenant?.id) return;
    await offlineUpdate("time_off_requests", tenant.id, requestId, { status });
    toast.success(`Request ${status}`);
  }, [tenant?.id]);

  return {
    shifts, shiftTemplates, timeOffRequests, staffMembers, loading,
    addShift, updateShift, deleteShift, submitTimeOffRequest, updateTimeOffStatus,
  };
}
