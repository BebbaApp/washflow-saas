import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";

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
  name: string;
  price: number | string;
  duration: string;
  features: string[] | null;
  popular: boolean;
  vat_exempt: boolean;
  sort_order: number;
  created_at?: string;
  tenant_id?: string;
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
  const [rows, setRows] = useState<Row[] | undefined>(undefined);

  useEffect(() => {
    if (!tenant?.id) { setRows([]); return; }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("tenant_id", tenant.id);
      if (cancelled) return;
      if (error) { toast.error(`Failed to load services: ${error.message}`); setRows([]); return; }
      setRows((data ?? []) as Row[]);
    };
    void load();

    const channel = supabase.channel(`services:${tenant.id}:${crypto.randomUUID()}`);

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "services", filter: `tenant_id=eq.${tenant.id}` },
      (payload) => {
        setRows((prev) => {
          const list = prev ? [...prev] : [];
          if (payload.eventType === "DELETE") {
            return list.filter((r) => r.id !== (payload.old as any).id);
          }
          const next = payload.new as Row;
          const idx = list.findIndex((r) => r.id === next.id);
          if (idx >= 0) list[idx] = next; else list.push(next);
          return list;
        });
      },
    );

    channel.subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [tenant?.id]);

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
    const data = await writeService("update", { action: "update", tenant_id: tenant.id, service_id: id, service: patch });
    if (!data.service) throw new Error("Service update did not return a row");
    setRows((prev) => {
      const list = prev ? [...prev] : [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx >= 0) list[idx] = data.service!; else list.push(data.service!);
      return list;
    });
  };


  const addService = async (service: Omit<ServicePackage, "id">) => {
    if (!tenant?.id) { toast.error("No workspace selected."); throw new Error("no_tenant"); }
    const payload = { tenant_id: tenant.id, ...toRow(service) };
    const data = await writeService("add", { action: "create", tenant_id: tenant.id, service: payload });
    if (!data.service) throw new Error("Service creation did not return a row");
    setRows((prev) => [...(prev ?? []), data.service!]);
    return fromRow(data.service);
  };

  const removeService = async (id: string) => {
    if (!tenant?.id) return;
    const removed = services.find((s) => s.id === id);
    await writeService("delete", { action: "delete", tenant_id: tenant.id, service_id: id });
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
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
    toast.error(`Failed to ${actionLabel} service: ${message}`);
    throw new Error(message);
  }
  if (data?.error) {
    toast.error(`Failed to ${actionLabel} service: ${data.error}`);
    throw new Error(data.error);
  }
  return data ?? {};
}
