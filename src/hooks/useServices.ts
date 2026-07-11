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

    const channel = supabase
      .channel(`services:${tenant.id}`)
      .on(
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
      )
      .subscribe();

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
    const { error } = await supabase.from("services").update(patch).eq("id", id).eq("tenant_id", tenant.id);
    if (error) { toast.error(`Failed to update service: ${error.message}`); throw error; }
  };

  const addService = async (service: Omit<ServicePackage, "id">) => {
    if (!tenant?.id) { toast.error("No workspace selected."); throw new Error("no_tenant"); }
    const payload = { tenant_id: tenant.id, ...toRow(service) };
    const { data, error } = await supabase.from("services").insert(payload).select("*").single();
    if (error) { toast.error(`Failed to add service: ${error.message}`); throw error; }
    return fromRow(data as Row);
  };

  const removeService = async (id: string) => {
    if (!tenant?.id) return;
    const removed = services.find((s) => s.id === id);
    const { error } = await supabase.from("services").delete().eq("id", id).eq("tenant_id", tenant.id);
    if (error) { toast.error(`Failed to delete service: ${error.message}`); throw error; }
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
}
