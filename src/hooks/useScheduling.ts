import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";

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
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [staffMembers, setStaffMembers] = useState<{ id: string; name: string; createdAt?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tenant?.id) {
      setTemplates([]);
      setShifts([]);
      setTimeOffRequests([]);
      setStaffMembers([]);
      setLoading(false);
      return;
    }

    const [templatesRes, shiftsRes, timeOffRes, staffRes] = await Promise.all([
      supabase.from("shift_templates").select("*").order("start_time"),
      supabase.from("shifts").select("*").order("shift_date"),
      supabase.from("time_off_requests").select("*").order("created_at", { ascending: false }),
      supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant.id } }),
    ]);

    const profileMap: Record<string, string> = {};
    const tenantStaff = ((staffRes.data as any)?.users ?? [])
      .filter((u: any) => !!u.role)
      .map((u: any) => ({ id: u.id, name: u.name || u.email || "Staff", createdAt: u.created_at }));
    if (tenantStaff.length > 0) {
      tenantStaff.forEach((p: any) => {
        profileMap[p.id] = p.name;
      });
    }
    setStaffMembers(tenantStaff);

    if (templatesRes.data) {
      setTemplates(templatesRes.data.map((t: any) => ({
        id: t.id,
        name: t.name,
        startTime: t.start_time,
        endTime: t.end_time,
        color: t.color,
      })));
    }

    if (shiftsRes.data) {
      setShifts(shiftsRes.data.map((s: any) => ({
        id: s.id,
        staffUserId: s.staff_user_id,
        templateId: s.template_id,
        shiftDate: s.shift_date,
        startTime: s.start_time,
        endTime: s.end_time,
        notes: s.notes,
        staffName: profileMap[s.staff_user_id] || "Unknown",
      })));
    }

    if (timeOffRes.data) {
      setTimeOffRequests(timeOffRes.data.map((r: any) => ({
        id: r.id,
        staffUserId: r.staff_user_id,
        startDate: r.start_date,
        endDate: r.end_date,
        reason: r.reason,
        status: r.status,
        staffName: profileMap[r.staff_user_id] || "Unknown",
        createdAt: r.created_at,
      })));
    }

    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => {
    fetchAll();

    const shiftsChannel = supabase
      .channel(`shifts-realtime-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => fetchAll())
      .subscribe();

    const timeOffChannel = supabase
      .channel(`timeoff-realtime-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests" }, () => fetchAll())
      .subscribe();

    return () => {
      supabase.removeChannel(shiftsChannel);
      supabase.removeChannel(timeOffChannel);
    };
  }, [fetchAll]);

  // Returns conflicting shift if overlap exists for the same staff on the same date
  const findConflict = useCallback(
    (data: { staffUserId: string; shiftDate: string; startTime: string; endTime: string; ignoreShiftId?: string }) => {
      return shifts.find((s) => {
        if (s.id === data.ignoreShiftId) return false;
        if (s.staffUserId !== data.staffUserId) return false;
        if (s.shiftDate !== data.shiftDate) return false;
        // overlap if start < other.end && end > other.start
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
      staff_user_id: data.staffUserId,
      template_id: data.templateId || null,
      shift_date: data.shiftDate,
      start_time: data.startTime,
      end_time: data.endTime,
      notes: data.notes || null,
    });

    if (error) {
      toast.error("Failed to add shift: " + error.message);
      return { ok: false, error: error.message };
    }
    toast.success("Shift scheduled");
    return { ok: true };
  }, [findConflict]);

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

    // Optimistic update
    setShifts((prev) =>
      prev.map((s) =>
        s.id === shiftId
          ? { ...s, staffUserId: data.staffUserId, templateId: data.templateId ?? null, shiftDate: data.shiftDate, startTime: data.startTime, endTime: data.endTime, notes: data.notes ?? null }
          : s
      )
    );

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
      fetchAll();
      return { ok: false, error: error.message };
    }
    toast.success("Shift updated");
    return { ok: true };
  }, [findConflict, fetchAll]);

  const deleteShift = useCallback(async (shiftId: string) => {
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    const { error } = await supabase.from("shifts").delete().eq("id", shiftId);
    if (error) {
      toast.error("Failed to cancel shift: " + error.message);
      fetchAll();
      return false;
    }
    toast.success("Shift cancelled");
    return true;
  }, [fetchAll]);

  const requestTimeOff = useCallback(async (data: {
    startDate: string;
    endDate: string;
    reason?: string;
  }) => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) return;

    const { error } = await supabase.from("time_off_requests").insert({
      staff_user_id: session.session.user.id,
      start_date: data.startDate,
      end_date: data.endDate,
      reason: data.reason || null,
    });

    if (error) {
      toast.error("Failed to submit request: " + error.message);
      return;
    }
    toast.success("Time off request submitted");
  }, []);

  const updateTimeOffStatus = useCallback(async (requestId: string, status: "approved" | "denied") => {
    const { error } = await supabase.from("time_off_requests").update({ status }).eq("id", requestId);

    if (error) {
      toast.error("Failed to update request: " + error.message);
      return;
    }
    toast.success(`Request ${status}`);
  }, []);

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
    refetch: fetchAll,
  };
}
