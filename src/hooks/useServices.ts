import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [services, setServices] = useState<ServicePackage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (!active) return;
      if (error) {
        toast.error("Failed to load services");
      } else if (data) {
        setServices((data as Row[]).map(fromRow));
      }
      setLoading(false);
    })();

    const channel = supabase
      .channel(`services-changes-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "services" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const r = fromRow(payload.new as Row);
          setServices((prev) => (prev.some((s) => s.id === r.id) ? prev : [...prev, r]));
        } else if (payload.eventType === "UPDATE") {
          const r = fromRow(payload.new as Row);
          setServices((prev) => prev.map((s) => (s.id === r.id ? r : s)));
        } else if (payload.eventType === "DELETE") {
          const id = (payload.old as { id: string }).id;
          setServices((prev) => prev.filter((s) => s.id !== id));
        }
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const updateService = async (id: string, updates: Partial<Omit<ServicePackage, "id">>) => {
    const prev = services;
    setServices((curr) => curr.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    const { error } = await supabase.from("services").update(toRow(updates)).eq("id", id);
    if (error) {
      setServices(prev);
      toast.error("Failed to save changes");
      throw error;
    }
  };

  const addService = async (service: Omit<ServicePackage, "id">) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: ServicePackage = { ...service, id: tempId };
    const prev = services;
    setServices((curr) => [...curr, optimistic]);
    const { data, error } = await supabase
      .from("services")
      .insert(toRow(service))
      .select()
      .single();
    if (error || !data) {
      setServices(prev);
      toast.error("Failed to add service");
      throw error;
    }
    const created = fromRow(data as Row);
    setServices((curr) => curr.map((s) => (s.id === tempId ? created : s)));
    return created;
  };

  const removeService = async (id: string) => {
    const prev = services;
    const removed = prev.find((s) => s.id === id);
    setServices((curr) => curr.filter((s) => s.id !== id));
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      setServices(prev);
      toast.error("Failed to delete service");
      throw error;
    }
    return removed;
  };

  return { services, loading, updateService, addService, removeService };
}
