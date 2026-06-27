import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";
import { db } from "@/offline/db";

export type WorkerRole = "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";

export interface Worker {
  id: string;
  name: string;
  role: WorkerRole;
  phone: string;
  active: boolean;
}

export function useWorkers() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const memberRows = useLiveTable<any>(tenantId, "tenant_members");
  const roleRows = useLiveTable<any>(tenantId, "user_roles");
  const pinRows = useLiveTable<any>(tenantId, "staff_pins");

  const [profileByUser, setProfileByUser] = useState<Map<string, string>>(new Map());
  const [profilesLoading, setProfilesLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) { setProfileByUser(new Map()); setProfilesLoading(false); return; }
    let active = true;

    const load = async () => {
      const ids = Array.from(new Set((memberRows ?? []).map((m: any) => m.user_id)));
      if (ids.length === 0) {
        if (active) { setProfileByUser(new Map()); setProfilesLoading(false); }
        return;
      }

      // Try Supabase profiles when online
      if (navigator.onLine) {
        try {
          const { data } = await supabase.from("profiles").select("user_id, name").in("user_id", ids);
          if (!active) return;
          if (data && data.length > 0) {
            setProfileByUser(new Map((data ?? []).map((p: any) => [p.user_id, p.name])));
            setProfilesLoading(false);
            return;
          }
        } catch { /* fall through to local */ }
      }

      // Offline: use names from tenant_members or staff_pins local data
      const map = new Map<string, string>();
      for (const id of ids) {
        const member = (memberRows ?? []).find((m: any) => m.user_id === id);
        const pin = (pinRows ?? []).find((p: any) => p.user_id === id);
        map.set(id, member?.name ?? pin?.phone ?? id.slice(0, 8));
      }
      if (active) { setProfileByUser(map); setProfilesLoading(false); }
    };

    load();

    // Real-time profiles subscription — only when online
    let ch: ReturnType<typeof supabase.channel> | null = null;
    if (navigator.onLine) {
      ch = supabase
        .channel(`workers-profiles-${tenantId}-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load())
        .subscribe();
    }

    return () => {
      active = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, [tenantId, memberRows, pinRows]);

  const workers = useMemo<Worker[]>(() => {
    const ids = Array.from(new Set((memberRows ?? []).map((m: any) => m.user_id)));
    const roleByUser = new Map<string, WorkerRole>(
      (roleRows ?? []).map((r: any) => [r.user_id, r.role as WorkerRole])
    );
    const phoneByUser = new Map<string, string>(
      (pinRows ?? []).map((p: any) => [p.user_id, p.phone ?? ""])
    );
    return ids.map((uid) => ({
      id: uid,
      name: profileByUser.get(uid) ?? "",
      role: roleByUser.get(uid) ?? "washer",
      phone: phoneByUser.get(uid) ?? "",
      active: true,
    }));
  }, [memberRows, roleRows, pinRows, profileByUser]);

  const loading = profilesLoading || memberRows === undefined || roleRows === undefined || pinRows === undefined;

  const notManaged = () => {
    throw new Error("Staff are managed in Settings → Team. useWorkers is read-only.");
  };

  return {
    workers, loading,
    addWorker: notManaged as (data: Omit<Worker, "id">) => void,
    updateWorker: notManaged as (id: string, updates: Partial<Omit<Worker, "id">>) => void,
    removeWorker: notManaged as (id: string) => void,
  };
}
