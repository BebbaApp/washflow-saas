import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

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
  const tenantId = tenant?.id ?? null;
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tenantId) { setSuppliers([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("suppliers" as any)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");
    setSuppliers(((data as any[]) ?? []).map(rowToSupplier));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`suppliers_${tenantId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "suppliers", filter: `tenant_id=eq.${tenantId}` },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, fetchAll]);

  const addSupplier = useCallback(async (data: Omit<Supplier, "id">) => {
    if (!tenantId) return null;
    const { data: row, error } = await supabase
      .from("suppliers" as any)
      .insert({
        tenant_id: tenantId,
        name: data.name,
        contact_name: data.contactName ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
      })
      .select("*")
      .single();
    if (error || !row) return null;
    return rowToSupplier(row);
  }, [tenantId]);

  const updateSupplier = useCallback(async (id: string, patch: Partial<Supplier>) => {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.contactName !== undefined) update.contact_name = patch.contactName ?? null;
    if (patch.phone !== undefined) update.phone = patch.phone ?? null;
    if (patch.email !== undefined) update.email = patch.email ?? null;
    if (patch.address !== undefined) update.address = patch.address ?? null;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    await supabase.from("suppliers" as any).update(update).eq("id", id);
  }, []);

  const deleteSupplier = useCallback(async (id: string) => {
    await supabase.from("suppliers" as any).delete().eq("id", id);
  }, []);

  return { suppliers, loading, addSupplier, updateSupplier, deleteSupplier };
}
