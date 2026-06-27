import { useCallback, useMemo } from "react";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useLiveTable } from "@/offline/useLiveTable";

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

function rowToSupplier(r: any): Supplier {
  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    address: r.address ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export function useSuppliers() {
  const { tenant } = useTenant();
  const rows = useLiveTable<any>(tenant?.id, "suppliers");
  const loading = rows === undefined;

  const suppliers = useMemo<Supplier[]>(() => {
    const list = (rows ?? []).map(rowToSupplier);
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [rows]);

  const addSupplier = useCallback(async (data: Omit<Supplier, "id">) => {
    if (!tenant?.id) return null;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      tenant_id: tenant.id,
      name: data.name,
      contact_name: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      notes: data.notes ?? null,
      created_at: now,
    };
    await (db as any).suppliers.put({ ...payload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "suppliers", op: "insert", payload });
    return rowToSupplier(payload);
  }, [tenant?.id]);

  const updateSupplier = useCallback(async (id: string, patch: Partial<Supplier>) => {
    if (!tenant?.id) return;
    const existing = await (db as any).suppliers.get(id);
    if (!existing) return;
    const update: Record<string, unknown> = { id };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.contactName !== undefined) update.contact_name = patch.contactName ?? null;
    if (patch.phone !== undefined) update.phone = patch.phone ?? null;
    if (patch.email !== undefined) update.email = patch.email ?? null;
    if (patch.address !== undefined) update.address = patch.address ?? null;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    await (db as any).suppliers.put({ ...existing, ...update, _dirty: 1, _op: "update" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "suppliers", op: "update", payload: update });
  }, [tenant?.id]);

  const deleteSupplier = useCallback(async (id: string) => {
    if (!tenant?.id) return;
    await (db as any).suppliers.delete(id);
    await enqueueOutbox({ tenant_id: tenant.id, table: "suppliers", op: "delete", payload: { id } });
  }, [tenant?.id]);

  return { suppliers, loading, addSupplier, updateSupplier, deleteSupplier };
}
