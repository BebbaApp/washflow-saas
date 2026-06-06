import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

export const EXPENSE_CATEGORIES = [
  "Supplies",
  "Utilities",
  "Salaries",
  "Maintenance",
  "Rent",
  "Marketing",
  "Other",
] as const;
export type ExpenseCategory = string;

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  subcategory?: string;
  vendor?: string;
  notes?: string;
  date: string; // ISO
  createdAt: string;
}

function rowToExpense(r: any): Expense {
  return {
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    category: r.category as ExpenseCategory,
    subcategory: r.subcategory ?? undefined,
    vendor: r.vendor ?? undefined,
    notes: r.notes ?? undefined,
    date: r.date,
    createdAt: r.created_at,
  };
}

/**
 * Offline-first expense list. Reads from the Dexie mirror (kept in sync by the
 * central sync engine), so the table renders instantly across navigations and
 * works offline. Writes still go through Supabase; realtime reflects them back
 * into Dexie automatically.
 */
export function useExpenses() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const rows = useLiveTable<any>(tenant?.id, "expenses");
  const loading = rows === undefined;

  const expenses = useMemo<Expense[]>(() => {
    const list = (rows ?? []).map(rowToExpense);
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    return list;
  }, [rows]);

  const addExpense = useCallback(async (data: Omit<Expense, "id" | "createdAt">) => {
    if (!tenant?.id) return null;
    const { data: row, error } = await supabase
      .from("expenses" as any)
      .insert({
        tenant_id: tenant.id,
        description: data.description,
        amount: data.amount,
        category: data.category,
        subcategory: data.subcategory ?? null,
        vendor: data.vendor ?? null,
        notes: data.notes ?? null,
        date: data.date,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();
    if (error || !row) return null;
    return rowToExpense(row);
  }, [tenant?.id, user?.id]);

  const updateExpense = useCallback(async (id: string, patch: Partial<Expense>) => {
    const update: Record<string, unknown> = {};
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.amount !== undefined) update.amount = patch.amount;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.subcategory !== undefined) update.subcategory = patch.subcategory ?? null;
    if (patch.vendor !== undefined) update.vendor = patch.vendor ?? null;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    if (patch.date !== undefined) update.date = patch.date;
    await supabase.from("expenses" as any).update(update).eq("id", id);
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    await supabase.from("expenses" as any).delete().eq("id", id);
  }, []);

  const refresh = useCallback(async () => { /* sync engine handles it */ }, []);

  return { expenses, loading, addExpense, updateExpense, deleteExpense, refresh };
}
