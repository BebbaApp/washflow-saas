import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

export type WorkerRole =
  | "admin"
  | "supervisor"
  | "washer"
  | "driver"
  | "manager"
  | "cashier";

export interface Worker {
  /** Auth user id — also the join key across profiles / user_roles / staff_pins. */
  id: string;
  name: string;
  role: WorkerRole;
  phone: string;
  active: boolean;
}

/**
 * Read-only view of the tenant's staff, composed from local mirrors:
 *   - `tenant_members` (mirrored)   → membership
 *   - `user_roles`     (mirrored)   → app role
 *   - `staff_pins`     (mirrored)   → phone number
 *   - `profiles`       (not tenant-scoped) → fetched once and kept in a local state map
 *
 * Staff mutations are intentionally not exposed — manage them via Settings → Team.
 */
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
      const { data } = await supabase.from("profiles").select("user_id, name").in("user_id", ids);
      if (!active) return;
      setProfileByUser(new Map((data ?? []).map((p: any) => [p.user_id, p.name])));
      setProfilesLoading(false);
    };
    load();
    const ch = supabase
      .channel(`workers-profiles-${tenantId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load())
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [tenantId, memberRows]);

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

  const loading =
    profilesLoading ||
    memberRows === undefined ||
    roleRows === undefined ||
    pinRows === undefined;

  const notManaged = () => {
    throw new Error(
      "Staff are managed in Settings → Team (invite-member / manage-staff). useWorkers is read-only."
    );
  };

  return {
    workers,
    loading,
    /** @deprecated read-only — use Settings → Team */
    addWorker: notManaged as (data: Omit<Worker, "id">) => void,
    /** @deprecated read-only — use Settings → Team */
    updateWorker: notManaged as (id: string, updates: Partial<Omit<Worker, "id">>) => void,
    /** @deprecated read-only — use Settings → Team */
    removeWorker: notManaged as (id: string) => void,
  };
}
