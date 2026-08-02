import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  receiptUrl?: string;
}

export const RECEIPT_BUCKET = "expense-receipts";

/** Signed URL for a stored receipt — null when offline or missing. */
export async function getSignedReceiptUrl(path: string, expiresIn = 300): Promise<string | null> {
  if (!path) return null;
  const clean = path.replace(/^.*expense-receipts\//, "");
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(clean, expiresIn);
  return data?.signedUrl || null;
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
    receiptUrl: r.receipt_url ?? undefined,
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
      receipt_url: data.receiptUrl ?? null,
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
    if ("receiptUrl" in patch) update.receipt_url = patch.receiptUrl ?? null;
    await (db as any).expenses.put({ ...existing, ...update, _dirty: 1, _op: "update" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "expenses", op: "update", payload: update });
  }, [tenant?.id]);

  const deleteExpense = useCallback(async (id: string) => {
    if (!tenant?.id) return;
    await (db as any).expenses.delete(id);
    await enqueueOutbox({ tenant_id: tenant.id, table: "expenses", op: "delete", payload: { id } });
  }, [tenant?.id]);

  /** Uploads a receipt image/PDF into the tenant folder; returns the storage path. */
  const uploadReceipt = useCallback(async (file: File | Blob, ext = "jpg"): Promise<string> => {
    if (!tenant?.id) throw new Error("No active tenant");
    const path = `${tenant.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, file, {
      contentType: (file as File).type || "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    return path;
  }, [tenant?.id]);

  const refresh = useCallback(async () => { /* sync engine handles it */ }, []);

  return { expenses, loading, addExpense, updateExpense, deleteExpense, uploadReceipt, refresh };
}
