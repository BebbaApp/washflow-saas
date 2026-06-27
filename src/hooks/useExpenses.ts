import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useLiveTable } from "@/offline/useLiveTable";

export const EXPENSE_CATEGORIES = [
  "Supplies", "Utilities", "Salaries", "Maintenance",
  "Rent", "Marketing", "Other",
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
  date: string;
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
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      tenant_id: tenant.id,
      description: data.description,
      amount: data.amount,
      category: data.category,
      subcategory: data.subcategory ?? null,
      vendor: data.vendor ?? null,
      notes: data.notes ?? null,
      date: data.date,
      created_by: user?.id ?? null,
      created_at: now,
      updated_at: now,
    };
    await (db as any).expenses.put({ ...payload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "expenses", op: "insert", payload });
    return rowToExpense(payload);
  }, [tenant?.id, user?.id]);

  const updateExpense = useCallback(async (id: string, patch: Partial<Expense>) => {
    if (!tenant?.id) return;
    const existing = await (db as any).expenses.get(id);
    if (!existing) return;
    const update: Record<string, unknown> = { id, updated_at: new Date().toISOString() };
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.amount !== undefined) update.amount = patch.amount;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.subcategory !== undefined) update.subcategory = patch.subcategory ?? null;
    if (patch.vendor !== undefined) update.vendor = patch.vendor ?? null;
    if (patch.notes !== undefined) update.notes = patch.notes ?? null;
    if (patch.date !== undefined) update.date = patch.date;
    await (db as any).expenses.put({ ...existing, ...update, _dirty: 1, _op: "update" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "expenses", op: "update", payload: update });
  }, [tenant?.id]);

  const deleteExpense = useCallback(async (id: string) => {
    if (!tenant?.id) return;
    await (db as any).expenses.delete(id);
    await enqueueOutbox({ tenant_id: tenant.id, table: "expenses", op: "delete", payload: { id } });
  }, [tenant?.id]);

  const refresh = useCallback(async () => { /* sync engine handles it */ }, []);

  return { expenses, loading, addExpense, updateExpense, deleteExpense, refresh };
}
