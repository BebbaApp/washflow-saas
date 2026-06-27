import { useMemo } from "react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
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
    if (!tenant?.id) return;
    const existing = await (db as any).services.get(id);
    if (!existing) { toast.error("Service not found"); return; }
    const patch = toRow(updates);
    const now = new Date().toISOString();
    const updated = { ...existing, ...patch, updated_at: now, _dirty: 1, _op: "update" };
    await (db as any).services.put(updated);
    await enqueueOutbox({ tenant_id: tenant.id, table: "services", op: "update", payload: { id, ...patch, updated_at: now } });
  };

  const addService = async (service: Omit<ServicePackage, "id">) => {
    if (!tenant?.id) { toast.error("No workspace selected."); throw new Error("no_tenant"); }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = { id, tenant_id: tenant.id, ...toRow(service), created_at: now, updated_at: now };
    await (db as any).services.put({ ...payload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "services", op: "insert", payload });
    return fromRow(payload as Row);
  };

  const removeService = async (id: string) => {
    if (!tenant?.id) return;
    const removed = services.find((s) => s.id === id);
    await (db as any).services.delete(id);
    await enqueueOutbox({ tenant_id: tenant.id, table: "services", op: "delete", payload: { id } });
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
}
