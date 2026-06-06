import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
}

export interface Shift {
  id: string;
  staffUserId: string;
  templateId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  staffName?: string;
}

export interface TimeOffRequest {
  id: string;
  staffUserId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  staffName?: string;
  createdAt: string;
}

export function useScheduling() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const templateRows = useLiveTable<any>(tenantId, "shift_templates");
  const shiftRows = useLiveTable<any>(tenantId, "shifts");
  const timeOffRows = useLiveTable<any>(tenantId, "time_off_requests");

  const [staffMembers, setStaffMembers] = useState<{ id: string; name: string; createdAt?: string }[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  // Staff list still comes from the manage-staff edge function (auth.users-backed),
  // since profiles aren't tenant-scoped in the local mirror.
  useEffect(() => {
    if (!tenantId) { setStaffMembers([]); setStaffLoading(false); return; }
    let active = true;
    (async () => {
      setStaffLoading(true);
      const { data } = await supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenantId } });
      if (!active) return;
      const list = ((data as any)?.users ?? [])
        .filter((u: any) => !!u.role)
        .map((u: any) => ({ id: u.id, name: u.name || u.email || "Staff", createdAt: u.created_at }));
      setStaffMembers(list);
      setStaffLoading(false);
    })();
    return () => { active = false; };
  }, [tenantId]);

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of staffMembers) m[s.id] = s.name;
    return m;
  }, [staffMembers]);

  const templates = useMemo<ShiftTemplate[]>(() => {
    const list = (templateRows ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      startTime: t.start_time,
      endTime: t.end_time,
      color: t.color,
    }));
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return list;
  }, [templateRows]);

  const shifts = useMemo<Shift[]>(() => {
    const list = (shiftRows ?? []).map((s: any) => ({
      id: s.id,
      staffUserId: s.staff_user_id,
      templateId: s.template_id,
      shiftDate: s.shift_date,
      startTime: s.start_time,
      endTime: s.end_time,
      notes: s.notes,
      staffName: profileMap[s.staff_user_id] || "Unknown",
    }));
    list.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
    return list;
  }, [shiftRows, profileMap]);

  const timeOffRequests = useMemo<TimeOffRequest[]>(() => {
    const list = (timeOffRows ?? []).map((r: any) => ({
      id: r.id,
      staffUserId: r.staff_user_id,
      startDate: r.start_date,
      endDate: r.end_date,
      reason: r.reason,
      status: r.status,
      staffName: profileMap[r.staff_user_id] || "Unknown",
      createdAt: r.created_at,
    }));
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  }, [timeOffRows, profileMap]);

  const loading =
    staffLoading || templateRows === undefined || shiftRows === undefined || timeOffRows === undefined;

  const findConflict = useCallback(
    (data: { staffUserId: string; shiftDate: string; startTime: string; endTime: string; ignoreShiftId?: string }) => {
      return shifts.find((s) => {
        if (s.id === data.ignoreShiftId) return false;
        if (s.staffUserId !== data.staffUserId) return false;
        if (s.shiftDate !== data.shiftDate) return false;
        return data.startTime < s.endTime && data.endTime > s.startTime;
      }) || null;
    },
    [shifts]
  );

  const addShift = useCallback(async (data: {
    staffUserId: string;
    templateId?: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!tenantId) return { ok: false, error: "No workspace selected" };
    if (data.endTime <= data.startTime) {
      return { ok: false, error: "End time must be after start time" };
    }
    const conflict = findConflict(data);
    if (conflict) {
      return {
        ok: false,
        error: `Conflicts with ${conflict.staffName}'s shift ${conflict.startTime.slice(0, 5)}–${conflict.endTime.slice(0, 5)}`,
      };
    }

    const { error } = await supabase.from("shifts").insert({
      tenant_id: tenantId,
      staff_user_id: data.staffUserId,
      template_id: data.templateId || null,
      shift_date: data.shiftDate,
      start_time: data.startTime,
      end_time: data.endTime,
      notes: data.notes || null,
    } as any);

    if (error) {
      toast.error("Failed to add shift: " + error.message);
      return { ok: false, error: error.message };
    }
    toast.success("Shift scheduled");
    return { ok: true };
  }, [findConflict, tenantId]);

  const updateShift = useCallback(async (
    shiftId: string,
    data: {
      staffUserId: string;
      templateId?: string | null;
      shiftDate: string;
      startTime: string;
      endTime: string;
      notes?: string | null;
    }
  ): Promise<{ ok: boolean; error?: string }> => {
    if (data.endTime <= data.startTime) {
      return { ok: false, error: "End time must be after start time" };
    }
    const conflict = findConflict({ ...data, ignoreShiftId: shiftId });
    if (conflict) {
      return {
        ok: false,
        error: `Conflicts with ${conflict.staffName}'s shift ${conflict.startTime.slice(0, 5)}–${conflict.endTime.slice(0, 5)}`,
      };
    }

    const { error } = await supabase.from("shifts").update({
      staff_user_id: data.staffUserId,
      template_id: data.templateId ?? null,
      shift_date: data.shiftDate,
      start_time: data.startTime,
      end_time: data.endTime,
      notes: data.notes ?? null,
    }).eq("id", shiftId);

    if (error) {
      toast.error("Failed to update shift: " + error.message);
      return { ok: false, error: error.message };
    }
    toast.success("Shift updated");
    return { ok: true };
  }, [findConflict]);

  const deleteShift = useCallback(async (shiftId: string) => {
    const { error } = await supabase.from("shifts").delete().eq("id", shiftId);
    if (error) {
      toast.error("Failed to cancel shift: " + error.message);
      return false;
    }
    toast.success("Shift cancelled");
    return true;
  }, []);

  const requestTimeOff = useCallback(async (data: {
    startDate: string;
    endDate: string;
    reason?: string;
  }) => {
    if (!tenantId) return;
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { error } = await supabase.from("time_off_requests").insert({
      tenant_id: tenantId,
      staff_user_id: session.session.user.id,
      start_date: data.startDate,
      end_date: data.endDate,
      reason: data.reason || null,
    } as any);

    if (error) {
      toast.error("Failed to submit request: " + error.message);
      return;
    }
    toast.success("Time off request submitted");
  }, [tenantId]);

  const updateTimeOffStatus = useCallback(async (requestId: string, status: "approved" | "denied") => {
    const { error } = await supabase.from("time_off_requests").update({ status }).eq("id", requestId);

    if (error) {
      toast.error("Failed to update request: " + error.message);
      return;
    }
    toast.success(`Request ${status}`);
  }, []);

  const refetch = useCallback(async () => { /* sync engine handles it */ }, []);

  return {
    templates,
    shifts,
    timeOffRequests,
    staffMembers,
    loading,
    addShift,
    updateShift,
    deleteShift,
    findConflict,
    requestTimeOff,
    updateTimeOffStatus,
    refetch,
  };
}
