import { useCallback, useEffect, useState } from "react";

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

const KEY = "aquawash.expenses.v1";

function load(): Expense[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Expense[]) : [];
  } catch {
    return [];
  }
}

function save(items: Expense[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>(() => load());

  useEffect(() => {
    save(expenses);
  }, [expenses]);

  const addExpense = useCallback((data: Omit<Expense, "id" | "createdAt">) => {
    const e: Expense = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setExpenses((prev) => [e, ...prev]);
    return e;
  }, []);

  const updateExpense = useCallback((id: string, patch: Partial<Expense>) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { expenses, addExpense, updateExpense, deleteExpense };
}
