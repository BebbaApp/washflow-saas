import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";

export const EXPENSE_CATEGORIES = [
  "Supplies",
  "Utilities",
  "Salaries",
  "Maintenance",
  "Rent",
  "Marketing",
  "Other",
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  vendor?: string;
  notes?: string;
  date: string; // ISO
  createdAt: string;
}

const LEGACY_KEY = "aquawash.expenses.v1";
const MIGRATED_FLAG = "aquawash.expenses.migrated.v1";

function rowToExpense(r: any): Expense {
  return {
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    category: r.category as ExpenseCategory,
    vendor: r.vendor ?? undefined,
    notes: r.notes ?? undefined,
    date: r.date,
    createdAt: r.created_at,
  };
}

export function useExpenses() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tenant?.id) { setExpenses([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("expenses" as any)
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("date", { ascending: false });
    if (!error && data) setExpenses((data as any[]).map(rowToExpense));
    setLoading(false);
  }, [tenant?.id]);

  // One-time migration of any localStorage entries into Supabase
  useEffect(() => {
    const run = async () => {
      if (!tenant?.id || !user?.id) return;
      const flagKey = `${MIGRATED_FLAG}.${tenant.id}`;
      if (typeof localStorage === "undefined") return;
      if (localStorage.getItem(flagKey)) return;
      try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) {
          const legacy = JSON.parse(raw) as Expense[];
          if (Array.isArray(legacy) && legacy.length) {
            const rows = legacy.map((e) => ({
              tenant_id: tenant.id,
              description: e.description,
              amount: e.amount,
              category: e.category,
              vendor: e.vendor ?? null,
              notes: e.notes ?? null,
              date: e.date,
              created_by: user.id,
            }));
            await supabase.from("expenses" as any).insert(rows);
          }
        }
        localStorage.setItem(flagKey, "1");
        // Keep legacy key around for safety; do not remove automatically.
      } catch { /* ignore */ }
      fetchAll();
    };
    run();
  }, [tenant?.id, user?.id, fetchAll]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`expenses_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "expenses", filter: `tenant_id=eq.${tenant.id}` },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id, fetchAll]);

  const addExpense = useCallback(async (data: Omit<Expense, "id" | "createdAt">) => {
    if (!tenant?.id) return null;
    const { data: row, error } = await supabase
      .from("expenses" as any)
      .insert({
        tenant_id: tenant.id,
        description: data.description,
        amount: data.amount,
        category: data.category,
        vendor: data.vendor ?? null,
        notes: data.notes ?? null,
        date: data.date,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();
    if (error || !row) return null;
    const e = rowToExpense(row);
    setExpenses((prev) => [e, ...prev]);
    return e;
  }, [tenant?.id, user?.id]);

  const updateExpense = useCallback(async (id: string, patch: Partial<Expense>) => {
    const update: Record<string, unknown> = {};
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.amount !== undefined) update.amount = patch.amount;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.vendor !== undefined) update.vendor = patch.vendor ?? null;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    if (patch.date !== undefined) update.date = patch.date;
    const { error } = await supabase.from("expenses" as any).update(update).eq("id", id);
    if (!error) setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    const { error } = await supabase.from("expenses" as any).delete().eq("id", id);
    if (!error) setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { expenses, loading, addExpense, updateExpense, deleteExpense, refresh: fetchAll };
}
