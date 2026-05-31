import { useMemo, useState } from "react";
import { Plus, Search, Filter, Receipt, TrendingDown, TrendingUp, Trash2, X, Download, Pencil, AlertTriangle } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useCurrency } from "@/hooks/useCurrency";
import { useExpenses, type Expense } from "@/hooks/useExpenses";
import { useExpenseCategories, categoryTone } from "@/hooks/useExpenseCategories";
import type { WashOrder } from "@/hooks/useOrders";
import { EmployeeExpenseDialog } from "@/components/EmployeeExpenseDialog";

type ExpenseCategory = string;

type Range = "today" | "week" | "month" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" },
];

function inRange(iso: string, range: Range): boolean {
  if (range === "all") return true;
  const d = new Date(iso);
  const now = new Date();
  if (range === "today") return d.toDateString() === now.toDateString();
  if (range === "week") {
    const diff = (now.getTime() - d.getTime()) / 86400000;
    return diff <= 7 && diff >= 0;
  }
  if (range === "month") {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return true;
}

interface Props {
  orders: WashOrder[];
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  employeeExpenseOpen?: boolean;
  onEmployeeExpenseOpenChange?: (open: boolean) => void;
}

export function ExpensesPage({ orders, addOpen, onAddOpenChange, employeeExpenseOpen = false, onEmployeeExpenseOpenChange }: Props) {
  const { formatPrice, currency } = useCurrency();
  const { expenses, addExpense, updateExpense, deleteExpense } = useExpenses();
  const { categories, subcategoriesFor } = useExpenseCategories();


  const [range, setRange] = useState<Range>("month");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<ExpenseCategory | "all">("all");
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const filtered = useMemo(() => {
    return expenses
      .filter((e) => inRange(e.date, range))
      .filter((e) => (catFilter === "all" ? true : e.category === catFilter))
      .filter((e) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          e.description.toLowerCase().includes(q) ||
          (e.vendor || "").toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
        );
      });
  }, [expenses, range, catFilter, search]);

  const rangeRevenue = useMemo(() => {
    return orders
      .filter((o) => o.status === "completed")
      .filter((o) => inRange(o.completedAt || o.createdAt, range))
      .reduce((sum, o) => sum + (o.servicePrice || 0), 0);
  }, [orders, range]);

  const rangeExpenses = useMemo(
    () => expenses.filter((e) => inRange(e.date, range)).reduce((s, e) => s + e.amount, 0),
    [expenses, range]
  );

  const netProfit = rangeRevenue - rangeExpenses;
  const margin = rangeRevenue > 0 ? (netProfit / rangeRevenue) * 100 : 0;

  const byCategory = useMemo(() => {
    const map = new Map<ExpenseCategory, number>();
    expenses
      .filter((e) => inRange(e.date, range))
      .forEach((e) => map.set(e.category, (map.get(e.category) || 0) + e.amount));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [expenses, range]);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    const rangeLabel = RANGES.find((r) => r.id === range)?.label || "All";
    doc.setFontSize(18);
    doc.text("Expenses Report", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    const filterParts = [`Range: ${rangeLabel}`];
    if (catFilter !== "all") filterParts.push(`Category: ${catFilter}`);
    if (search.trim()) filterParts.push(`Search: "${search.trim()}"`);
    doc.text(filterParts.join("  ·  "), 14, 25);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

    const total = filtered.reduce((s, e) => s + e.amount, 0);
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`Total: ${formatPrice(total)}  ·  ${filtered.length} entries`, 14, 38);

    autoTable(doc, {
      startY: 44,
      head: [["Date", "Description", "Category", "Vendor", "Amount"]],
      body: filtered.map((e) => [
        new Date(e.date).toLocaleDateString(),
        e.description,
        e.category,
        e.vendor || "-",
        formatPrice(e.amount),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save(`expenses-${rangeLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Range pills + export */}
      <div className="flex items-center justify-between flex-wrap gap-3 -mt-4">
        <button
          onClick={handleExportPDF}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-card border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export PDF
        </button>
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                range === r.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Revenue"
          value={formatPrice(rangeRevenue)}
          sub="From completed washes"
          valueClass="text-foreground"
        />
        <StatCard
          title="Total Expenses"
          value={formatPrice(rangeExpenses)}
          sub={`${expenses.filter((e) => inRange(e.date, range)).length} entries`}
          valueClass="text-red-500"
        />
        <StatCard
          title="Net Profit"
          value={`${netProfit >= 0 ? "+" : ""}${formatPrice(netProfit)}`}
          sub={`${margin.toFixed(1)}% margin`}
          valueClass={netProfit >= 0 ? "text-green-500" : "text-red-500"}
        />
        <div className="bg-card border border-border rounded-2xl p-5">
          <p className="text-sm text-muted-foreground">By Category</p>
          {byCategory.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No expenses yet</p>
          ) : (
            <ul className="mt-3 space-y-1.5 max-h-24 overflow-auto pr-1">
              {byCategory.slice(0, 4).map(([cat, amt]) => (
                <li key={cat} className="flex items-center justify-between text-xs">
                  <span className={`px-2 py-0.5 rounded-md font-medium ${categoryTone(cat)}`}>{cat}</span>
                  <span className="font-semibold text-foreground">{formatPrice(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Profit margin bar */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">Profit Margin</h3>
          <span className={`text-lg font-bold ${margin >= 0 ? "text-green-500" : "text-red-500"}`}>
            {margin.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${margin >= 0 ? "bg-green-500" : "bg-red-500"}`}
            style={{ width: `${Math.max(0, Math.min(100, Math.abs(margin)))}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5" />
            Expenses {formatPrice(rangeExpenses)}
          </span>
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            Revenue {formatPrice(rangeRevenue)}
          </span>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value as any)}
            className="appearance-none pl-10 pr-10 py-2.5 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="bg-card border border-border rounded-2xl">
        {filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center px-4">
            <div className="text-4xl mb-3">💸</div>
            <p className="text-lg font-semibold text-foreground">No expenses recorded</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click "Add Expense" to record your first cost
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((e) => (
              <li
                key={e.id}
                onClick={() => setDetailExpense(e)}
                className="p-4 flex items-center justify-between gap-4 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${categoryTone(e.category)}`}>
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{e.description}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {new Date(e.date).toLocaleDateString()} · {e.category}
                      {e.subcategory ? ` › ${e.subcategory}` : ""}
                      {e.vendor ? ` · ${e.vendor}` : ""}
                    </p>
                  </div>

                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(ev) => ev.stopPropagation()}>
                  <span className="font-bold text-red-500 mr-1">-{formatPrice(e.amount)}</span>
                  <button
                    onClick={() => setEditExpense(e)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Edit expense"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(e)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    aria-label="Delete expense"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {addOpen && (
        <ExpenseFormDialog
          mode="add"
          initial={null}
          categories={categories}
          subcategoriesFor={subcategoriesFor}
          onClose={() => onAddOpenChange(false)}
          onSubmit={(data) => {
            addExpense(data);
            onAddOpenChange(false);
          }}
          currencySymbol={currency.symbol}
        />
      )}

      {editExpense && (
        <ExpenseFormDialog
          mode="edit"
          initial={editExpense}
          categories={categories}
          subcategoriesFor={subcategoriesFor}
          onClose={() => setEditExpense(null)}
          onSubmit={(data) => {
            updateExpense(editExpense.id, data);
            setEditExpense(null);
          }}
          currencySymbol={currency.symbol}
        />
      )}


      {detailExpense && (
        <ExpenseDetailsDialog
          expense={detailExpense}
          formatPrice={formatPrice}
          onClose={() => setDetailExpense(null)}
          onEdit={() => {
            setEditExpense(detailExpense);
            setDetailExpense(null);
          }}
          onDelete={() => {
            setConfirmDelete(detailExpense);
            setDetailExpense(null);
          }}
        />
      )}

      {confirmDelete && (
        <DeleteExpenseDialog
          expense={confirmDelete}
          formatPrice={formatPrice}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteExpense(confirmDelete.id);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  title, value, sub, valueClass,
}: { title: string; value: string; sub: string; valueClass: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className={`text-2xl font-bold mt-2 ${valueClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function ExpenseFormDialog({
  mode, initial, categories, subcategoriesFor, onClose, onSubmit, currencySymbol,
}: {
  mode: "add" | "edit";
  initial: Expense | null;
  categories: string[];
  subcategoriesFor: (category: string) => string[];
  onClose: () => void;
  onSubmit: (data: Omit<Expense, "id" | "createdAt">) => void;
  currencySymbol: string;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? categories[0] ?? "Other");
  const [subcategory, setSubcategory] = useState<string>(initial?.subcategory ?? "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [date, setDate] = useState(() =>
    initial ? new Date(initial.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [error, setError] = useState("");

  const subOptions = useMemo(() => subcategoriesFor(category), [category, subcategoriesFor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!description.trim()) return setError("Description is required");
    if (!amt || amt <= 0) return setError("Amount must be greater than zero");
    if (notes.length > 500) return setError("Notes too long (max 500 chars)");
    onSubmit({
      description: description.trim(),
      amount: amt,
      category,
      subcategory: subcategory.trim() || undefined,
      vendor: vendor.trim() || undefined,
      notes: notes.trim() || undefined,
      date: new Date(date).toISOString(),
    });
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">{mode === "add" ? "Add Expense" : "Edit Expense"}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="e.g. Soap restock from supplier"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currencySymbol})`}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="0.00"
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value as ExpenseCategory); setSubcategory(""); }}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Subcategory">
              {subOptions.length > 0 ? (
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">— None —</option>
                  {subOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="No subcategories"
                  disabled
                  className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm text-muted-foreground"
                />
              )}
            </Field>
          </div>

          <Field label="Vendor (optional)">
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Supplier name"
            />
          </Field>
          <Field label={`Notes (optional · ${notes.length}/500)`}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </Field>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
            >
              {mode === "add" ? "Save Expense" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ExpenseDetailsDialog({
  expense, formatPrice, onClose, onEdit, onDelete,
}: {
  expense: Expense;
  formatPrice: (n: number) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">Expense Details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Description</p>
              <p className="font-semibold text-foreground mt-1 break-words">{expense.description}</p>
            </div>
            <span className="font-bold text-red-500 text-lg shrink-0">-{formatPrice(expense.amount)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="Date" value={new Date(expense.date).toLocaleDateString()} />
            <DetailRow label="Category">
              <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${categoryTone(expense.category)}`}>
                {expense.category}
              </span>
              {expense.subcategory ? (
                <span className="ml-1 text-xs text-muted-foreground">› {expense.subcategory}</span>
              ) : null}
            </DetailRow>

            <DetailRow label="Vendor" value={expense.vendor || "—"} />
            <DetailRow label="Recorded" value={new Date(expense.createdAt).toLocaleString()} />
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
            {expense.notes ? (
              <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded-lg p-3 border border-border">
                {expense.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No notes</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-500/10"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children ?? value}</div>
    </div>
  );
}

function DeleteExpenseDialog({
  expense, formatPrice, onClose, onConfirm,
}: {
  expense: Expense;
  formatPrice: (n: number) => string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-foreground">Delete expense?</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the following expense. This action cannot be undone.
          </p>
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
            <p className="font-semibold text-foreground break-words">{expense.description}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(expense.date).toLocaleDateString()} · {expense.category}
              {expense.vendor ? ` · ${expense.vendor}` : ""}
            </p>
            <p className="font-bold text-red-500 mt-2">-{formatPrice(expense.amount)}</p>
          </div>
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
