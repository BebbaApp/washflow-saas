import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Car, Download, Printer, Calendar as CalendarIcon, X, Eye, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { WashOrder, WashStatus } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { useTenant } from "@/hooks/useTenant";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPhone, telHref } from "@/lib/phone";
import { useAppLogo } from "@/hooks/useAppLogo";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

/** Pulls the most recent "[CANCELLED <ts>] <reason>" entry from order notes. */
const extractCancelReason = (notes?: string): string | null => {
  if (!notes) return null;
  const matches = [...notes.matchAll(/\[CANCELLED[^\]]*\]\s*(.+?)(?=\n\[CANCELLED|$)/gs)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
};

/** True when the order has been soft-deleted via the delete-order function. */
const isDeleted = (notes?: string) => !!notes && /\[DELETED\b/.test(notes);

interface HistoryPageProps {
  // Kept for backwards compatibility. History fetches its own paginated data.
  orders?: WashOrder[];
}

type Filter = "all" | "completed" | "cancelled";
type CancelledSub = "all" | "with" | "without";
type DatePreset = "all" | "7d" | "30d" | "90d" | "custom";
type DeletedShow = "all" | "deleted" | "non-deleted";

const statusStyles: Record<string, string> = {
  completed: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
};

const statusLabel: Record<string, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
};

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];
const LS_FILTERS_KEY = "aquawash:history:filters:v1";
const LS_SCROLL_KEY = "aquawash:history:scroll:v1";

interface PersistedFilters {
  query: string;
  filter: Filter;
  cancelledSub: CancelledSub;
  deletedShow: DeletedShow;
  datePreset: DatePreset;
  customFrom?: string; // ISO date
  customTo?: string;
}

function loadPersistedFilters(): PersistedFilters {
  try {
    const raw = localStorage.getItem(LS_FILTERS_KEY);
    if (raw) return { query: "", filter: "all", cancelledSub: "all", deletedShow: "all", datePreset: "all", ...JSON.parse(raw) };
  } catch {}
  return { query: "", filter: "all", cancelledSub: "all", deletedShow: "all", datePreset: "all" };
}

function mapRow(row: any): WashOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customer: row.customer,
    customerPhone: row.customer_phone ?? undefined,
    vehicle: row.vehicle,
    plate: row.plate,
    service: row.service,
    servicePrice: Number(row.service_price),
    discount: Number(row.discount ?? 0),
    status: row.status as WashStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    waitMinutes: row.wait_minutes ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function presetRange(preset: DatePreset, customFrom?: string, customTo?: string): { from?: Date; to?: Date } {
  const now = new Date();
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * 86400000) };
  if (preset === "30d") return { from: new Date(now.getTime() - 30 * 86400000) };
  if (preset === "90d") return { from: new Date(now.getTime() - 90 * 86400000) };
  if (preset === "custom") {
    const from = customFrom ? new Date(customFrom) : undefined;
    const to = customTo ? new Date(customTo) : undefined;
    if (to) {
      // include the whole "to" day
      to.setHours(23, 59, 59, 999);
    }
    return { from, to };
  }
  return {};
}

export const HistoryPage = (_props: HistoryPageProps) => {
  const { formatPrice, currency } = useCurrency();
  const { logo } = useAppLogo();
  const { isSuperAdmin, tenant } = useTenant();
  const { isAdmin } = usePermissions();
  const canDelete = isAdmin || isSuperAdmin;
  const [selectedOrder, setSelectedOrder] = useState<WashOrder | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const persisted = useRef<PersistedFilters>(loadPersistedFilters()).current;
  const [query, setQuery] = useState(persisted.query);
  const [debouncedQuery, setDebouncedQuery] = useState(persisted.query);
  const [filter, setFilter] = useState<Filter>(persisted.filter);
  const [cancelledSub, setCancelledSub] = useState<CancelledSub>(persisted.cancelledSub);
  const [deletedShow, setDeletedShow] = useState<DeletedShow>(persisted.deletedShow);
  const [datePreset, setDatePreset] = useState<DatePreset>(persisted.datePreset);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(() => {
    if (persisted.datePreset !== "custom") return undefined;
    return {
      from: persisted.customFrom ? new Date(persisted.customFrom) : undefined,
      to: persisted.customTo ? new Date(persisted.customTo) : undefined,
    };
  });

  const [rows, setRows] = useState<WashOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [totalAmountAll, setTotalAmountAll] = useState(0);
  const [counts, setCounts] = useState({ completed: 0, cancelled: 0, deleted: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const restoredScrollRef = useRef(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Persist filters
  useEffect(() => {
    const data: PersistedFilters = {
      query,
      filter,
      cancelledSub,
      deletedShow,
      datePreset,
      customFrom: customRange?.from?.toISOString(),
      customTo: customRange?.to?.toISOString(),
    };
    try { localStorage.setItem(LS_FILTERS_KEY, JSON.stringify(data)); } catch {}
  }, [query, filter, cancelledSub, deletedShow, datePreset, customRange]);

  // Save scroll position as user scrolls
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        try { localStorage.setItem(LS_SCROLL_KEY, String(window.scrollY)); } catch {}
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Build supabase query with current filters
  const buildQuery = useCallback((forCount = false) => {
    let q = supabase
      .from("orders")
      .select("*", forCount ? { count: "exact", head: true } : undefined);

    // status filter
    if (filter === "all") {
      q = q.in("status", ["completed", "cancelled"]);
    } else {
      q = q.eq("status", filter);
    }

    // date range
    const { from, to } = presetRange(datePreset, customRange?.from?.toISOString(), customRange?.to?.toISOString());
    if (from) q = q.gte("created_at", from.toISOString());
    if (to) q = q.lte("created_at", to.toISOString());

    // search across customer text fields
    const term = debouncedQuery.trim();
    if (term) {
      const safe = term.replace(/[%,()]/g, " ").trim();
      if (safe) {
        const like = `%${safe}%`;
        q = q.or(
          `customer.ilike.${like},customer_phone.ilike.${like},plate.ilike.${like},service.ilike.${like},vehicle.ilike.${like}`
        );
      }
    }

    // Cancelled-with/without-reason (server-side via notes marker)
    if (filter === "cancelled" && cancelledSub !== "all") {
      if (cancelledSub === "with") {
        q = q.ilike("notes", "%[CANCELLED%");
      } else {
        // No cancellation marker recorded
        q = q.or("notes.is.null,notes.not.ilike.%[CANCELLED%");
      }
    }

    // Deleted / non-deleted toggle (server-side via notes marker)
    if (deletedShow === "deleted") {
      q = q.ilike("notes", "%[DELETED%");
    } else if (deletedShow === "non-deleted") {
      q = q.or("notes.is.null,notes.not.ilike.%[DELETED%");
    }

    return q;
  }, [filter, cancelledSub, deletedShow, datePreset, customRange, debouncedQuery]);

  // Fetch a specific page (offset). Returns the rows + range information.
  const fetchPage = useCallback(async (offset: number) => {
    if (isSuperAdmin && tenant?.id) {
      const { from, to } = presetRange(datePreset, customRange?.from?.toISOString(), customRange?.to?.toISOString());
      const { data, error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "history_orders",
          tenant_id: tenant.id,
          status: filter,
          cancelled_reason: cancelledSub,
          deleted_show: deletedShow,
          query: debouncedQuery.trim() || undefined,
          from: from?.toISOString().slice(0, 10),
          to: to?.toISOString().slice(0, 10),
          offset,
          limit: pageSize,
        },
      });
      if (error || (data as any)?.error) {
        console.error("[HistoryPage] super-admin fetch error", error || (data as any)?.error);
        return [] as WashOrder[];
      }
      return (((data as any)?.orders ?? []) as any[]).map(mapRow);
    }
    let q = buildQuery(false).order("created_at", { ascending: false });
    q = q.range(offset, offset + pageSize - 1);
    const { data, error } = await q;
    if (error) {
      console.error("[HistoryPage] fetch error", error);
      return [] as WashOrder[];
    }
    return (data || []).map(mapRow);
  }, [buildQuery, isSuperAdmin, tenant?.id, filter, cancelledSub, datePreset, customRange, debouncedQuery, pageSize]);

  // Fetch totals (count + amount sum + per-status counts) using lightweight head queries
  const fetchTotals = useCallback(async () => {
    if (isSuperAdmin && tenant?.id) {
      const { from, to } = presetRange(datePreset, customRange?.from?.toISOString(), customRange?.to?.toISOString());
      const common = {
        action: "history_orders",
        tenant_id: tenant.id,
        query: debouncedQuery.trim() || undefined,
        from: from?.toISOString().slice(0, 10),
        to: to?.toISOString().slice(0, 10),
        offset: 0,
        limit: 1,
      };
      const [total, completed, cancelled, deleted] = await Promise.all([
        supabase.functions.invoke("platform-admin", { body: { ...common, status: filter, cancelled_reason: cancelledSub, deleted_show: deletedShow } }),
        supabase.functions.invoke("platform-admin", { body: { ...common, status: "completed", cancelled_reason: "all", deleted_show: "non-deleted" } }),
        supabase.functions.invoke("platform-admin", { body: { ...common, status: "cancelled", cancelled_reason: "all", deleted_show: "non-deleted" } }),
        supabase.functions.invoke("platform-admin", { body: { ...common, status: "all", cancelled_reason: "all", deleted_show: "deleted" } }),
      ]);
      setTotalCount(Number((total.data as any)?.count ?? 0));
      setCounts({
        completed: Number((completed.data as any)?.count ?? 0),
        cancelled: Number((cancelled.data as any)?.count ?? 0),
        deleted: Number((deleted.data as any)?.count ?? 0),
      });
      setTotalAmountAll(0);
      return;
    }
    // Total filtered count
    const totalQ = buildQuery(true);
    const { count: totalC } = await totalQ;
    setTotalCount(totalC || 0);

    // Per-status counts (independent of `filter`, but respect date + search)
    const baseDateSearch = (forCount: boolean) => {
      let q = supabase.from("orders").select("*", forCount ? { count: "exact", head: true } : undefined);
      const { from, to } = presetRange(datePreset, customRange?.from?.toISOString(), customRange?.to?.toISOString());
      if (from) q = q.gte("created_at", from.toISOString());
      if (to) q = q.lte("created_at", to.toISOString());
      const term = debouncedQuery.trim();
      if (term) {
        const safe = term.replace(/[%,()]/g, " ").trim();
        if (safe) {
          const like = `%${safe}%`;
          q = q.or(
            `customer.ilike.${like},customer_phone.ilike.${like},plate.ilike.${like},service.ilike.${like},vehicle.ilike.${like}`
          );
        }
      }
      return q;
    };
    const [{ count: completedC }, { count: cancelledC }, { count: deletedC }] = await Promise.all([
      baseDateSearch(true).eq("status", "completed").or("notes.is.null,notes.not.ilike.%[DELETED%"),
      baseDateSearch(true).eq("status", "cancelled").or("notes.is.null,notes.not.ilike.%[DELETED%"),
      baseDateSearch(true).ilike("notes", "%[DELETED%"),
    ]);
    setCounts({ completed: completedC || 0, cancelled: cancelledC || 0, deleted: deletedC || 0 });

    // Amount sum: PostgREST doesn't have an aggregate select here without RPC, so
    // approximate by summing the loaded rows for the visible total chip. We keep the
    // exact count above and recompute amount from loaded rows in render.
    setTotalAmountAll(0);
  }, [buildQuery, datePreset, customRange, debouncedQuery, isSuperAdmin, tenant?.id, filter, cancelledSub]);

  // Reset to first page when filters/search/pageSize change
  useEffect(() => {
    setPage(1);
  }, [filter, cancelledSub, deletedShow, datePreset, customRange, debouncedQuery, pageSize]);

  // Fetch current page + totals
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const offset = (page - 1) * pageSize;
      const [pageRows] = await Promise.all([fetchPage(offset), fetchTotals()]);
      if (cancelled) return;
      setRows(pageRows);
      setLoading(false);
      // Restore scroll position once after first successful load
      if (!restoredScrollRef.current) {
        restoredScrollRef.current = true;
        try {
          const y = parseInt(localStorage.getItem(LS_SCROLL_KEY) || "0", 10);
          if (y > 0) {
            requestAnimationFrame(() => window.scrollTo({ top: y }));
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [fetchPage, fetchTotals, page, pageSize]);

  // Realtime: refetch current page when relevant orders change
  useEffect(() => {
    const channel = supabase
      .channel(`history-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        (async () => {
          const offset = (page - 1) * pageSize;
          const [pageRows] = await Promise.all([fetchPage(offset), fetchTotals()]);
          setRows(pageRows);
        })();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchPage, fetchTotals, page, pageSize]);

  // Server-side filtering covers cancelled-with/without-reason now.
  const visibleRows = rows;

  const loadedAmount = useMemo(
    () => visibleRows.reduce((sum, o) => sum + (o.servicePrice || 0), 0),
    [visibleRows]
  );



  // Daily totals (computed from loaded rows only)
  const dayKey = (iso?: string | null) => {
    if (!iso) return "Unknown";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  };
  const dailyTotals = useMemo(() => {
    const map = new Map<string, { jobs: number; amount: number; sortKey: string }>();
    for (const o of visibleRows) {
      const iso = o.completedAt || o.createdAt;
      const key = dayKey(iso);
      const sortKey = iso ? new Date(iso).toISOString().slice(0, 10) : "0000";
      const cur = map.get(key) || { jobs: 0, amount: 0, sortKey };
      cur.jobs += 1;
      cur.amount += o.servicePrice || 0;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [visibleRows]);

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  };

  const datePresetLabel = useMemo(() => {
    if (datePreset === "all") return "All time";
    if (datePreset === "7d") return "Last 7 days";
    if (datePreset === "30d") return "Last 30 days";
    if (datePreset === "90d") return "Last 90 days";
    if (customRange?.from && customRange?.to) {
      return `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`;
    }
    if (customRange?.from) return `From ${format(customRange.from, "MMM d, yyyy")}`;
    return "Custom range";
  }, [datePreset, customRange]);

  const exportCsv = () => {
    const headers = ["Customer", "Phone", "Plate", "Vehicle", "Service", "Discount", "Amount", "Status", "Date"];
    const escape = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rowsCsv = visibleRows.map((o) =>
      [
        o.customer,
        o.customerPhone ? formatPhone(o.customerPhone) : "",
        o.plate, o.vehicle, o.service,
        ((o.discount ?? 0)).toFixed(2),
        (o.servicePrice ?? 0).toFixed(2),
        statusLabel[o.status] || o.status,
        new Date(o.completedAt || o.createdAt).toISOString(),
      ].map(escape).join(",")
    );
    const csv = [headers.join(","), ...rowsCsv].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    if (visibleRows.length === 0) return;
    const escapeHtml = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const generated = new Date().toLocaleString();
    const filterLabel = filter === "all" ? "Completed & Cancelled" : statusLabel[filter] || filter;
    const rowsHtml = visibleRows.map((o) => {
      const phone = o.customerPhone ? formatPhone(o.customerPhone) : "—";
      const status = statusLabel[o.status] || o.status;
      const statusClass = o.status === "cancelled" ? "status cancelled" : "status completed";
      const reason = o.status === "cancelled" ? extractCancelReason(o.notes) : null;
      return `<tr>
        <td>${escapeHtml(o.customer)}</td>
        <td class="phone">${escapeHtml(phone)}</td>
        <td class="mono">${escapeHtml(o.plate)}</td>
        <td>${escapeHtml(o.vehicle)}</td>
        <td>${escapeHtml(o.service)}</td>
        <td class="num">${(o.discount ?? 0) > 0 ? escapeHtml(formatPrice(o.discount ?? 0)) : "—"}</td>
        <td class="num">${escapeHtml(formatPrice(o.servicePrice))}</td>
        <td><span class="${statusClass}">${escapeHtml(status)}</span>${reason ? `<div class="reason">${escapeHtml(reason)}</div>` : ""}</td>
        <td class="date">${escapeHtml(fmtDate(o.completedAt || o.createdAt))}</td>
      </tr>`;
    }).join("");
    const logoTag = logo ? `<img src="${logo}" alt="logo" class="logo" />` : "";
    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>Wash Job Report ${new Date().toISOString().slice(0, 10)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 24px; font-size: 12px; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { height: 40px; width: 40px; object-fit: contain; }
        h1 { font-size: 20px; margin: 0; }
        .meta { font-size: 11px; color: #555; text-align: right; }
        .summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 14px; font-size: 12px; }
        .summary div { background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 8px 12px; }
        .summary strong { display: block; color: #111; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e4e4e7; padding: 8px 6px; text-align: left; vertical-align: top; }
        th { background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
        td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        td.mono, td.phone { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
        td.date { white-space: nowrap; color: #444; }
        .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
        .status.completed { background: #dcfce7; color: #166534; }
        .status.cancelled { background: #fee2e2; color: #991b1b; }
        .reason { margin-top: 4px; font-size: 10px; color: #7f1d1d; font-style: italic; max-width: 220px; white-space: normal; word-break: break-word; }
        tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; padding-top: 10px; }
        .footer { margin-top: 18px; font-size: 10px; color: #777; text-align: center; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        tr, td, th { page-break-inside: avoid; break-inside: avoid; }
        @media print { body { padding: 0; } .header, .summary { page-break-after: avoid; break-after: avoid; } }
      </style>
    </head><body>
      <div class="header">
        <div class="brand">${logoTag}<h1>Wash Job Report</h1></div>
        <div class="meta">
          <div><strong>Filter:</strong> ${escapeHtml(filterLabel)}</div>
          <div><strong>Range:</strong> ${escapeHtml(datePresetLabel)}</div>
          ${query ? `<div><strong>Search:</strong> ${escapeHtml(query)}</div>` : ""}
          <div>Generated ${escapeHtml(generated)}</div>
        </div>
      </div>
      <div class="summary">
        <div>Loaded jobs<strong>${visibleRows.length} / ${totalCount}</strong></div>
        <div>Completed<strong>${counts.completed}</strong></div>
        <div>Cancelled<strong>${counts.cancelled}</strong></div>
        <div>Loaded revenue<strong>${escapeHtml(formatPrice(loadedAmount))}</strong></div>
      </div>
      <table>
        <thead><tr>
          <th>Customer</th><th>Phone</th><th>Plate</th><th>Vehicle</th>
          <th>Service</th><th class="num">Discount</th><th class="num">Amount</th><th>Status</th><th>Date</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="6">Loaded total (${visibleRows.length} jobs)</td>
          <td class="num">${escapeHtml(formatPrice(loadedAmount))}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
      <div class="footer">Washflow Saas · Confidential job report</div>
      <script>window.addEventListener('load',function(){setTimeout(function(){window.focus();window.print();},250);});</script>
    </body></html>`;
    const win = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
    if (!win) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wash-report-${new Date().toISOString().slice(0, 10)}.html`; a.click();
      URL.revokeObjectURL(url);
      return;
    }
    win.document.open(); win.document.write(html); win.document.close();
  };

  const filterTabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All (${counts.completed + counts.cancelled})` },
    { id: "completed", label: `Completed (${counts.completed})` },
    { id: "cancelled", label: `Cancelled (${counts.cancelled})` },
  ];

  const datePresets: { id: DatePreset; label: string }[] = [
    { id: "all", label: "All time" },
    { id: "7d", label: "7 days" },
    { id: "30d", label: "30 days" },
    { id: "90d", label: "90 days" },
  ];

  const clearAllFilters = () => {
    setQuery("");
    setFilter("all");
    setCancelledSub("all");
    setDatePreset("all");
    setCustomRange(undefined);
    try { localStorage.removeItem(LS_SCROLL_KEY); } catch {}
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const filtersActive =
    !!query || filter !== "all" || cancelledSub !== "all" || datePreset !== "all";

  const activeFilterChips: { key: string; label: string; onClear: () => void }[] = [];
  if (filter !== "all") {
    activeFilterChips.push({
      key: "status",
      label: `Status: ${statusLabel[filter] || filter}`,
      onClear: () => { setFilter("all"); setCancelledSub("all"); },
    });
  }
  if (filter === "cancelled" && cancelledSub !== "all") {
    activeFilterChips.push({
      key: "sub",
      label: cancelledSub === "with" ? "With reason" : "Without reason",
      onClear: () => setCancelledSub("all"),
    });
  }
  if (datePreset !== "all") {
    activeFilterChips.push({
      key: "date",
      label: `Date: ${datePresetLabel}`,
      onClear: () => { setDatePreset("all"); setCustomRange(undefined); },
    });
  }
  if (query) {
    activeFilterChips.push({
      key: "q",
      label: `Search: "${query}"`,
      onClear: () => setQuery(""),
    });
  }

  const handleDeleteOrder = async (o: WashOrder) => {
    if (!tenant?.id) return;
    const ok = window.confirm(
      `Delete work order ${o.orderNumber} for ${o.customer}?\n\nThis will permanently remove the order and reverse any inventory and loyalty transactions linked to it. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(o.id);
    try {
      const { data, error } = await supabase.functions.invoke("delete-order", {
        body: { tenant_id: tenant.id, order_id: o.id },
      });
      if (error || (data as any)?.error) {
        throw new Error((data as any)?.error || error?.message || "Failed to delete order");
      }
      toast.success(`Order ${o.orderNumber} deleted`, {
        description: `Reversed ${(data as any)?.reversed_transactions ?? 0} inventory transaction(s).`,
      });
      const offset = (page - 1) * pageSize;
      const [pageRows] = await Promise.all([fetchPage(offset), fetchTotals()]);
      setRows(pageRows);
    } catch (err: any) {
      toast.error("Delete failed", { description: err?.message || String(err) });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, plate, service..."
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Car className="w-4 h-4" />
            <span className="text-foreground font-semibold">{visibleRows.length}</span>
            <span>/ {totalCount} jobs</span>
          </div>
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-muted-foreground">{currency.symbol}</span>
            <span className="text-primary font-bold">{formatPrice(loadedAmount)}</span>
          </div>
          <button
            onClick={exportCsv}
            disabled={visibleRows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground border border-border text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={exportPdf}
            disabled={visibleRows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Printer className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center bg-card border border-border rounded-full p-1">
          {filterTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {filter === "cancelled" && (
          <div className="inline-flex items-center bg-card border border-border rounded-full p-1">
            {([
              { id: "all", label: "All cancelled" },
              { id: "with", label: "With reason" },
              { id: "without", label: "Without reason" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setCancelledSub(s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  cancelledSub === s.id ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Date range */}
        <div className="inline-flex items-center bg-card border border-border rounded-full p-1">
          {datePresets.map((p) => (
            <button
              key={p.id}
              onClick={() => { setDatePreset(p.id); if (p.id !== "custom") setCustomRange(undefined); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                datePreset === p.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  datePreset === "custom" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                {datePreset === "custom" ? datePresetLabel : "Custom"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={(r) => {
                  setCustomRange(r);
                  if (r?.from) setDatePreset("custom");
                }}
                numberOfMonths={2}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </div>

        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Active filters summary */}
      {activeFilterChips.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="uppercase tracking-wider text-muted-foreground font-semibold">
            Active filters:
          </span>
          {activeFilterChips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-secondary/70 border border-border text-foreground"
            >
              {c.label}
              <button
                onClick={c.onClear}
                aria-label={`Clear ${c.label}`}
                className="rounded-full p-0.5 hover:bg-destructive/15 hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Daily totals (loaded rows only) */}
      {dailyTotals.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Daily totals <span className="normal-case text-[10px] text-muted-foreground/70">(loaded rows)</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {dailyTotals.map((d) => (
              <div key={d.label} className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-xs text-muted-foreground">{d.label}</p>
                <p className="text-base font-bold text-foreground mt-1">{formatPrice(d.amount)}</p>
                <p className="text-[11px] text-muted-foreground">{d.jobs} job{d.jobs !== 1 ? "s" : ""}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-5 py-3.5">Customer</th>
                <th className="text-left font-medium px-5 py-3.5">Phone</th>
                <th className="text-left font-medium px-5 py-3.5">Vehicle</th>
                <th className="text-left font-medium px-5 py-3.5">Service</th>
                <th className="text-left font-medium px-5 py-3.5">Amount</th>
                <th className="text-left font-medium px-5 py-3.5">Status</th>
                <th className="text-left font-medium px-5 py-3.5">Date</th>
                <th className="text-right font-medium px-5 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                    No matching history. Adjust your filters or date range.
                  </td>
                </tr>
              ) : (
                visibleRows.map((o) => {
                  const cancelReason =
                    o.status === "cancelled" ? extractCancelReason(o.notes) : null;
                  const rowTitle =
                    o.status === "cancelled"
                      ? `Reason: ${cancelReason || "No reason recorded"}`
                      : undefined;
                  return (
                    <tr
                      key={o.id}
                      title={rowTitle}
                      className="border-b border-border/60 last:border-0 hover:bg-secondary/40 transition-colors"
                      style={{ paddingTop: "0.3rem", paddingBottom: "0.3rem" }}
                    >
                      <td className="px-5 [&]:py-[0.3rem] font-semibold text-foreground">{o.customer}</td>
                      <td className="px-5 [&]:py-[0.3rem] text-muted-foreground max-w-[160px]">
                        {o.customerPhone ? (
                          <a
                            href={`tel:${telHref(o.customerPhone)}`}
                            className="hover:text-foreground block truncate whitespace-nowrap"
                            title={formatPhone(o.customerPhone)}
                          >
                            {formatPhone(o.customerPhone)}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-5 [&]:py-[0.3rem] font-mono text-muted-foreground">{o.plate}</td>
                      <td className="px-5 [&]:py-[0.3rem] text-foreground">{o.service}</td>
                      <td className="px-5 [&]:py-[0.3rem] font-bold text-foreground">
                        {(o.discount ?? 0) > 0 ? (
                          <span className="inline-flex flex-col leading-tight">
                            <span className="text-xs font-normal text-muted-foreground line-through">{formatPrice(o.servicePrice + (o.discount ?? 0))}</span>
                            <span>{formatPrice(o.servicePrice)}</span>
                          </span>
                        ) : (
                          formatPrice(o.servicePrice)
                        )}
                      </td>
                      <td className="px-5 [&]:py-[0.3rem]">
                        <div className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[o.status] || "bg-secondary text-secondary-foreground"}`}>
                            {statusLabel[o.status] || o.status}
                          </span>
                          {isDeleted(o.notes) && (
                            <span
                              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-destructive text-destructive-foreground"
                              title="Order was deleted by an admin. Inventory and loyalty transactions were reversed."
                            >
                              Deleted
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 [&]:py-[0.3rem] text-muted-foreground whitespace-nowrap">
                        {fmtDate(o.completedAt || o.createdAt)}
                      </td>
                      <td className="px-5 [&]:py-[0.3rem] whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => { setSelectedOrder(o); setDetailsOpen(true); }}
                            title="View details"
                            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canDelete && !isDeleted(o.notes) && (
                            <button
                              onClick={() => handleDeleteOrder(o)}
                              disabled={deletingId === o.id}
                              title="Delete work order"
                              className="inline-flex items-center justify-center rounded-md p-1.5 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            >
                              {deletingId === o.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && totalCount > 0 && (
          <div className="border-t border-border/60 px-5 py-3">
            <PaginationBar
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              onPageChange={(p) => {
                setPage(p);
                requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
              }}
              onPageSizeChange={setPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          </div>
        )}
      </div>

      <OrderDetailsModal
        order={selectedOrder}
        open={detailsOpen}
        onOpenChange={(o) => { setDetailsOpen(o); if (!o) setSelectedOrder(null); }}
      />
    </div>
  );
};
