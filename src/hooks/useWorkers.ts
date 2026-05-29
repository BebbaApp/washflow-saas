import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

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
 * Read-only view of the tenant's staff, composed from the existing tables:
 *   - `tenant_members`     → membership (source of truth for "is on the team")
 *   - `profiles`           → display name
 *   - `user_roles`         → app role (washer / cashier / …)
 *   - `staff_pins`         → phone number
 *
 * Subscribes to realtime changes on all four so the list stays live.
 * Mutations (add/update/remove) are intentionally not exposed here — staff are
 * managed via SettingsPage / invite-member / manage-staff edge functions so
 * permissions and auth invites stay consistent.
 */
export function useWorkers() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setWorkers([]);
      setLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      const [membersRes, rolesRes, pinsRes] = await Promise.all([
        supabase
          .from("tenant_members")
          .select("user_id")
          .eq("tenant_id", tenantId),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("tenant_id", tenantId),
        supabase
          .from("staff_pins")
          .select("user_id, phone")
          .eq("tenant_id", tenantId),
      ]);

      if (!active) return;

      const userIds = Array.from(
        new Set((membersRes.data ?? []).map((m) => m.user_id))
      );

      const profilesRes = userIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, name")
            .in("user_id", userIds)
        : { data: [] as { user_id: string; name: string }[] };

      if (!active) return;

      const profileByUser = new Map(
        (profilesRes.data ?? []).map((p) => [p.user_id, p.name])
      );
      const roleByUser = new Map(
        (rolesRes.data ?? []).map((r) => [r.user_id, r.role as WorkerRole])
      );
      const phoneByUser = new Map(
        (pinsRes.data ?? []).map((p) => [p.user_id, p.phone ?? ""])
      );

      setWorkers(
        userIds.map((uid) => ({
          id: uid,
          name: profileByUser.get(uid) ?? "",
          role: roleByUser.get(uid) ?? "washer",
          phone: phoneByUser.get(uid) ?? "",
          active: true,
        }))
      );
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel(`workers-${tenantId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tenant_members", filter: `tenant_id=eq.${tenantId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `tenant_id=eq.${tenantId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_pins", filter: `tenant_id=eq.${tenantId}` },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => load()
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

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
