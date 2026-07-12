import { useMemo } from "react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useLiveTable } from "@/offline/useLiveTable";
import { offlineInsert, offlineUpdate, offlineDelete } from "@/offline/offlineWrite";

export interface ServicePackage {
  id: string;
  name: string;
  price: number;
  duration: string;
  features: string[];
  popular?: boolean;
  vatExempt?: boolean;
  sort_order?: number;
}

type Row = {
  id: string;
  tenant_id: string;
  name: string;
  price: number | string;
  duration: string;
  features: string[] | null;
  popular: boolean;
  vat_exempt: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

const fromRow = (r: Row): ServicePackage => ({
  id: r.id,
  name: r.name,
  price: Number(r.price),
  duration: r.duration,
  features: r.features ?? [],
  popular: r.popular,
  vatExempt: r.vat_exempt,
  sort_order: r.sort_order,
});

const toRow = (s: Partial<ServicePackage>) => ({
  ...(s.name !== undefined && { name: s.name }),
  ...(s.price !== undefined && { price: s.price }),
  ...(s.duration !== undefined && { duration: s.duration }),
  ...(s.features !== undefined && { features: s.features }),
  ...(s.popular !== undefined && { popular: s.popular }),
  ...(s.vatExempt !== undefined && { vat_exempt: s.vatExempt }),
  ...(s.sort_order !== undefined && { sort_order: s.sort_order }),
});

type ServiceWriteResponse = { service?: Row; error?: string };

export function useServices() {
  const { tenant } = useTenant();
  const rows = useLiveTable<Row & { _dirty?: 0 | 1 }>(tenant?.id, "services");

  const loading = rows === undefined;

  const services = useMemo<ServicePackage[]>(() => {
    const list = (rows ?? []).map(fromRow);
    list.sort((a, b) => {
      const sa = a.sort_order ?? 0;
      const sb = b.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows]);

  const updateService = async (id: string, updates: Partial<Omit<ServicePackage, "id">>) => {
    if (!tenant?.id) return;
    const patch = toRow(updates);
    try {
      const data = await writeService("update", { action: "update", tenant_id: tenant.id, service_id: id, service: patch });
      if (!data.service) throw new Error("Service update did not return a row");
      // Sync engine's realtime channel will refresh Dexie; also apply locally for instant UI.
      await offlineUpdate("services", tenant.id, id, patch);
    } catch (e) {
      if (isNetworkError(e)) {
        await offlineUpdate("services", tenant.id, id, patch);
        toast.message("Saved locally — will sync when online");
        return;
      }
      throw e;
    }
  };

  const addService = async (service: Omit<ServicePackage, "id">) => {
    if (!tenant?.id) { toast.error("No workspace selected."); throw new Error("no_tenant"); }
    const payload = { tenant_id: tenant.id, ...toRow(service) };
    try {
      const data = await writeService("add", { action: "create", tenant_id: tenant.id, service: payload });
      if (!data.service) throw new Error("Service creation did not return a row");
      return fromRow(data.service);
    } catch (e) {
      if (isNetworkError(e)) {
        const row = await offlineInsert("services", tenant.id, payload);
        toast.message("Saved locally — will sync when online");
        return fromRow(row as Row);
      }
      throw e;
    }
  };

  const removeService = async (id: string) => {
    if (!tenant?.id) return;
    const removed = services.find((s) => s.id === id);
    try {
      await writeService("delete", { action: "delete", tenant_id: tenant.id, service_id: id });
      await offlineDelete("services", tenant.id, id);
    } catch (e) {
      if (isNetworkError(e)) {
        await offlineDelete("services", tenant.id, id);
        toast.message("Removed locally — will sync when online");
        return removed;
      }
      throw e;
    }
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
}

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = (e as { message?: string })?.message?.toLowerCase() ?? "";
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed");
}

async function writeService(actionLabel: "add" | "update" | "delete", body: Record<string, unknown>): Promise<ServiceWriteResponse> {
  const { data, error } = await supabase.functions.invoke<ServiceWriteResponse>("manage-service", { body });
  if (error) {
    let message = error.message;
    const response = (error as any).context;
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.json();
        if (payload?.error) message = typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error);
      } catch { /* keep default message */ }
    }
    const err = new Error(message);
    if (!isNetworkError(err)) toast.error(`Failed to ${actionLabel} service: ${message}`);
    throw err;
  }
  if (data?.error) {
    toast.error(`Failed to ${actionLabel} service: ${data.error}`);
    throw new Error(data.error);
  }
  return data ?? {};
}
