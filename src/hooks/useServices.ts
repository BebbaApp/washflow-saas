import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

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
  const rows = useLiveTable<Row & { tenant_id: string }>(tenant?.id, "services");
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
    const { error } = await supabase.from("services").update(toRow(updates)).eq("id", id);
    if (error) {
      toast.error("Failed to save changes");
      throw error;
    }
  };

  const addService = async (service: Omit<ServicePackage, "id">) => {
    if (!tenant?.id) {
      toast.error("No workspace selected.");
      throw new Error("no_tenant");
    }
    const { data, error } = await supabase
      .from("services")
      .insert({ ...toRow(service), tenant_id: tenant.id } as any)
      .select()
      .single();
    if (error || !data) {
      toast.error("Failed to add service");
      throw error;
    }
    return fromRow(data as Row);
  };

  const removeService = async (id: string) => {
    const removed = services.find((s) => s.id === id);
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete service");
      throw error;
    }
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
}
