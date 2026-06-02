import { useState, useMemo } from "react";
import { Clock, CheckCircle2, Play, Phone, Hash, ArrowUp, ArrowDown, ArrowUpDown, X, Gift, CloudOff, RefreshCw, Package } from "lucide-react";
import { useRewardEligibility } from "@/hooks/useRewardEligibility";
import type { WashOrder, WashStatus } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPhone, telHref, phoneDigits } from "@/lib/phone";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { usePendingInventoryOrderIds, retryPendingSync } from "@/hooks/usePendingOutbox";

type TabKey = "active" | "waiting" | "in-progress" | "completed" | "cancelled";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "waiting", label: "Waiting" },
  { key: "in-progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const statusBadge: Record<WashStatus, string> = {
  "waiting": "bg-warning/10 text-warning border-warning/20",
  "in-progress": "bg-info/10 text-info border-info/20",
  "completed": "bg-success/10 text-success border-success/20",
  "cancelled": "bg-destructive/10 text-destructive border-destructive/20",
};

const statusLabel: Record<WashStatus, string> = {
  "waiting": "Waiting",
  "in-progress": "In Progress",
  "completed": "Completed",
  "cancelled": "Cancelled",
};

/**
 * Small chip next to the status badge that signals whether the row's most
 * recent change has reached Supabase. "Queued" = offline insert pending,
 * "Syncing" = offline mutation against an existing row pending.
 */
function SyncChip({ pending }: { pending: boolean }) {
  return (
    <span
      title={pending ? "Created offline — waiting to upload" : "Change saved offline — waiting to sync"}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-warning/10 text-warning border-warning/30"
    >
      {pending ? <CloudOff className="w-2.5 h-2.5" /> : <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
      {pending ? "Queued" : "Syncing"}
    </span>
  );
}

interface WashQueueProps {
  orders: WashOrder[];
  onUpdateStatus?: (id: string, status: WashStatus) => Promise<void> | void;
  onUpdateNotes?: (id: string, notes: string) => Promise<boolean> | void;
}

type SortKey = "completed" | "amount" | "customer";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 15;

export const WashQueue = ({ orders, onUpdateStatus, onUpdateNotes }: WashQueueProps) => {
  const { formatPrice } = useCurrency();
  const { eligibleOrderIds } = useRewardEligibility(orders);
  const { can } = usePermissions();
  const canCancel = can("queue.cancel");
  const canStart = can("queue.start");
  const canComplete = can("queue.complete");
  const [tab, setTab] = useState<TabKey>("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Completed tab controls
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("completed");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmCancelIds, setConfirmCancelIds] = useState<string[] | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [selectedWaiting, setSelectedWaiting] = useState<Set<string>>(new Set());

  const counts = useMemo(() => ({
    active: orders.filter((o) => o.status !== "completed" && o.status !== "cancelled").length,
    waiting: orders.filter((o) => o.status === "waiting").length,
    "in-progress": orders.filter((o) => o.status === "in-progress").length,
    completed: orders.filter((o) => o.status === "completed").length,
    cancelled: orders.filter((o) => o.status === "cancelled").length,
  }), [orders]);

  const baseList = useMemo(() => {
    if (tab === "active") return orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
    return orders.filter((o) => o.status === tab);
  }, [orders, tab]);

  const completedServices = useMemo(() => {
    const set = new Set<string>();
    orders.filter((o) => o.status === "completed").forEach((o) => set.add(o.service));
    return Array.from(set).sort();
  }, [orders]);

  const filteredCompleted = useMemo(() => {
    if (tab !== "completed") return baseList;
    let list = baseList;
    if (fromDate) {
      const f = new Date(fromDate).getTime();
      list = list.filter((o) => o.completedAt && new Date(o.completedAt).getTime() >= f);
    }
    if (toDate) {
      const t = new Date(toDate).getTime() + 86400000 - 1; // include the whole day
      list = list.filter((o) => o.completedAt && new Date(o.completedAt).getTime() <= t);
    }
    if (serviceFilter !== "all") {
      list = list.filter((o) => o.service === serviceFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    const qDigits = phoneDigits(searchQuery);
    if (q) {
      list = list.filter((o) => {
        const phoneMatch = qDigits.length >= 3 && phoneDigits(o.customerPhone).includes(qDigits);
        return (
          phoneMatch ||
          o.customer.toLowerCase().includes(q) ||
          o.plate.toLowerCase().includes(q) ||
          o.vehicle.toLowerCase().includes(q) ||
          o.service.toLowerCase().includes(q) ||
          o.orderNumber.toLowerCase().includes(q)
        );
      });
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "amount") cmp = a.servicePrice - b.servicePrice;
      else if (sortKey === "customer") cmp = a.customer.localeCompare(b.customer);
      else {
        const at = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const bt = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        cmp = at - bt;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [tab, baseList, fromDate, toDate, serviceFilter, sortKey, sortDir, searchQuery]);

  const searchedNonCompleted = useMemo(() => {
    if (tab === "completed") return baseList;
    const q = searchQuery.trim().toLowerCase();
    const qDigits = phoneDigits(searchQuery);
    if (!q) return baseList;
    return baseList.filter((o) => {
      const phoneMatch = qDigits.length >= 3 && phoneDigits(o.customerPhone).includes(qDigits);
      return (
        phoneMatch ||
        o.customer.toLowerCase().includes(q) ||
        o.plate.toLowerCase().includes(q) ||
        o.vehicle.toLowerCase().includes(q) ||
        o.service.toLowerCase().includes(q) ||
        o.orderNumber.toLowerCase().includes(q)
      );
    });
  }, [tab, baseList, searchQuery]);

  const visible = tab === "completed" ? filteredCompleted : searchedNonCompleted;

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const paged = (tab === "completed" || tab === "cancelled") ? visible.slice(pageStart, pageStart + PAGE_SIZE) : visible;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "customer" ? "asc" : "desc");
    }
    setPage(1);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border flex-wrap">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1); }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                active
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label} ({counts[t.key]})
            </button>
          );
        })}
      </div>

      {/* Search bar (works for any tab; phone-aware) */}
      <div className="relative max-w-xl">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          placeholder="Search by name, phone, plate, vehicle, service..."
          className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          aria-label="Search wash queue"
        />
      </div>

      {/* Bulk cancel toolbar for Waiting tab */}
      {tab === "waiting" && selectedWaiting.size > 0 && onUpdateStatus && canCancel && (
        <div className="glass-card p-3 flex items-center justify-between gap-3">
          <span className="text-sm text-foreground font-medium">
            {selectedWaiting.size} job{selectedWaiting.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedWaiting(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmCancelIds(Array.from(selectedWaiting));
                setCancelReason("");
                setCancelReasonError(null);
              }}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Cancel selected
            </Button>
          </div>
        </div>
      )}

      {/* Completed filters */}
      {tab === "completed" && (
        <div className="glass-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Service</label>
            <Select value={serviceFilter} onValueChange={(v) => { setServiceFilter(v); setPage(1); }}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">All services</SelectItem>
                {completedServices.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Sort by</label>
            <Select value={sortKey} onValueChange={(v: SortKey) => { setSortKey(v); setPage(1); }}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="completed">Completed time</SelectItem>
                <SelectItem value="amount">Amount</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Direction</label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="w-full justify-between"
            >
              {sortDir === "asc" ? "Ascending" : "Descending"}
              {sortDir === "asc" ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </Button>
          </div>
          {(fromDate || toDate || serviceFilter !== "all") && (
            <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-between text-xs text-muted-foreground">
              <span>{visible.length} match{visible.length === 1 ? "" : "es"}</span>
              <button
                onClick={() => { setFromDate(""); setToDate(""); setServiceFilter("all"); setPage(1); }}
                className="text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty */}
      {visible.length === 0 && (
        <div className="glass-card p-10 text-center text-sm text-muted-foreground">
          No wash jobs in this view.
        </div>
      )}

      {(tab === "completed" || tab === "cancelled") && visible.length > 0 ? (
        <div className="glass-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Job</TableHead>
                <TableHead>
                  <button onClick={() => toggleSort("customer")} className="inline-flex items-center gap-1 hover:text-foreground">
                    Customer {sortIcon("customer")}
                  </button>
                </TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>
                  {tab === "completed" ? (
                    <button onClick={() => toggleSort("completed")} className="inline-flex items-center gap-1 hover:text-foreground">
                      Completed {sortIcon("completed")}
                    </button>
                  ) : (
                    "Cancelled"
                  )}
                </TableHead>
                <TableHead>{tab === "completed" ? "Wait" : "Status"}</TableHead>
                {tab === "cancelled" && <TableHead>Reason</TableHead>}
                <TableHead className="text-right">
                  <button onClick={() => toggleSort("amount")} className="inline-flex items-center gap-1 hover:text-foreground ml-auto">
                    Amount {sortIcon("amount")}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((o) => {
                const cancelMatch = tab === "cancelled" && o.notes
                  ? o.notes.match(/\[CANCELLED ([^\]]+)\]\s*([\s\S]*)$/)
                  : null;
                const timeLabel = tab === "completed"
                  ? (o.completedAt ? new Date(o.completedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—")
                  : (cancelMatch?.[1]
                      ? cancelMatch[1]
                      : new Date(o.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
                const reason = cancelMatch?.[2]?.trim() || "—";
                return (
                  <TableRow
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(o.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(o.id); } }}
                    className="cursor-pointer hover:bg-secondary/60 [&>td]:py-[0.2rem]"
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">{o.orderNumber}</TableCell>
                    <TableCell className="font-semibold text-foreground">{o.customer}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[140px]">
                      {o.customerPhone ? (
                        <a
                          href={`tel:${telHref(o.customerPhone)}`}
                          className="hover:text-foreground block truncate whitespace-nowrap"
                          title={formatPhone(o.customerPhone)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {formatPhone(o.customerPhone)}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm text-foreground">{o.vehicle}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {o.plate}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{o.service}</TableCell>
                    <TableCell className="text-muted-foreground">{timeLabel}</TableCell>
                    <TableCell>
                      {tab === "completed" ? (
                        typeof o.waitMinutes === "number" ? `${o.waitMinutes} min` : "—"
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className={`status-badge border ${statusBadge[o.status]}`}>
                            {statusLabel[o.status]}
                          </span>
                          {(o._pendingSync || o._syncing) && <SyncChip pending={!!o._pendingSync} />}
                        </div>
                      )}
                    </TableCell>
                    {tab === "cancelled" && (
                      <TableCell className="text-muted-foreground max-w-[260px]">
                        <span className="block truncate" title={reason}>{reason}</span>
                      </TableCell>
                    )}
                    <TableCell className="text-right font-bold text-primary">{formatPrice(o.servicePrice)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
              <span className="text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visible.length)} of {visible.length}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <span className="text-muted-foreground">Page {safePage} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map((o) => {
          const time = new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const nextStatus: WashStatus | null =
            o.status === "waiting" ? "in-progress" : o.status === "in-progress" ? "completed" : null;
          return (
            <div
              key={o.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(o.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(o.id); } }}
              className="glass-card p-5 space-y-4 cursor-pointer hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {tab === "waiting" && o.status === "waiting" && (
                    <div onClick={(e) => e.stopPropagation()} className="pt-1">
                      <Checkbox
                        checked={selectedWaiting.has(o.id)}
                        onCheckedChange={(checked) => {
                          setSelectedWaiting((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(o.id); else next.delete(o.id);
                            return next;
                          });
                        }}
                        aria-label={`Select ${o.customer}'s job`}
                      />
                    </div>
                  )}
                  <div className="text-2xl leading-none mt-0.5">🚗</div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-foreground truncate">{o.customer}</p>
                    {o.customerPhone && (
                      <a
                        href={`tel:${telHref(o.customerPhone)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-muted-foreground flex items-center gap-1 mt-1 hover:text-foreground truncate"
                      >
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{formatPhone(o.customerPhone)}</span>
                      </a>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Hash className="w-3 h-3" />
                      {o.plate}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`status-badge border ${statusBadge[o.status]}`}>
                    {statusLabel[o.status]}
                  </span>
                  {(o._pendingSync || o._syncing) && <SyncChip pending={!!o._pendingSync} />}
                </div>
              </div>

              {eligibleOrderIds.has(o.id) && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15 text-success text-xs font-bold border border-success/40 w-fit">
                  <Gift className="w-3.5 h-3.5" /> FREE WASH REWARD
                </div>
              )}

              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-foreground">{o.service}</p>
                <p className="text-sm font-bold text-primary">{formatPrice(o.servicePrice)}</p>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="w-3.5 h-3.5" />
                {o.orderNumber}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {time}
                </div>
                {onUpdateStatus && nextStatus && (() => {
                  const allowAction = nextStatus === "completed" ? canComplete : canStart;
                  if (!allowAction && !(o.status === "waiting" && canCancel)) return null;
                  return (
                  <div className="flex items-center gap-2">
                    {o.status === "waiting" && canCancel && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmCancelIds([o.id]); setCancelReason(""); setCancelReasonError(null); }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 bg-destructive/10 text-destructive border border-destructive/20"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    )}
                    {allowAction && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateStatus(o.id, nextStatus); }}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 ${
                        nextStatus === "completed"
                          ? "bg-success text-success-foreground"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {nextStatus === "completed" ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Complete
                        </>
                      ) : (
                        <>
                        <Play className="w-3.5 h-3.5" />
                        Start
                      </>
                    )}
                    </button>
                    )}
                  </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <OrderDetailsModal
        order={orders.find((o) => o.id === selectedId) ?? null}
        open={selectedId !== null}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        onUpdateStatus={onUpdateStatus}
        onUpdateNotes={onUpdateNotes}
      />

      <AlertDialog
        open={confirmCancelIds !== null}
        onOpenChange={(open) => {
          if (!open && !cancelling) {
            setConfirmCancelIds(null);
            setCancelReason("");
            setCancelReasonError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmCancelIds && confirmCancelIds.length > 1
                ? `Cancel ${confirmCancelIds.length} wash jobs?`
                : "Cancel this wash job?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                if (!confirmCancelIds) return "";
                if (confirmCancelIds.length > 1) {
                  return `This will move ${confirmCancelIds.length} waiting jobs to the Cancelled tab. The reason below will be saved on each job for audit.`;
                }
                const o = orders.find((x) => x.id === confirmCancelIds[0]);
                return o
                  ? `This will move ${o.customer}'s ${o.service} (${o.plate}) to the Cancelled tab. The reason will be saved for audit.`
                  : "This will move the job to the Cancelled tab.";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <label htmlFor="cancel-reason" className="text-sm font-medium text-foreground">
              Reason for cancellation <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => {
                setCancelReason(e.target.value);
                if (cancelReasonError) setCancelReasonError(null);
              }}
              placeholder="e.g. Customer changed their mind, vehicle left, duplicate booking..."
              rows={3}
              aria-invalid={!!cancelReasonError}
              className={cancelReasonError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {cancelReasonError && <p className="text-xs text-destructive">{cancelReasonError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep {confirmCancelIds && confirmCancelIds.length > 1 ? "jobs" : "job"}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                const reason = cancelReason.trim();
                if (reason.length < 3) {
                  setCancelReasonError("Please enter a reason (at least 3 characters).");
                  return;
                }
                if (!confirmCancelIds || !onUpdateStatus) return;
                setCancelling(true);
                const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
                let failures = 0;
                for (const id of confirmCancelIds) {
                  const order = orders.find((o) => o.id === id);
                  const audit = `[CANCELLED ${ts}] ${reason}`;
                  const merged = order?.notes ? `${order.notes}\n${audit}` : audit;
                  if (onUpdateNotes) {
                    try { await onUpdateNotes(id, merged); } catch { /* ignore */ }
                  }
                  try {
                    await onUpdateStatus(id, "cancelled");
                  } catch {
                    failures++;
                  }
                }
                setCancelling(false);
                if (failures === 0) {
                  toast.success(
                    confirmCancelIds.length > 1
                      ? `Cancelled ${confirmCancelIds.length} jobs`
                      : "Job cancelled"
                  );
                } else {
                  toast.error(`${failures} of ${confirmCancelIds.length} could not be cancelled`);
                }
                setSelectedWaiting(new Set());
                setConfirmCancelIds(null);
                setCancelReason("");
                setCancelReasonError(null);
              }}
            >
              {cancelling ? "Cancelling..." : confirmCancelIds && confirmCancelIds.length > 1 ? `Cancel ${confirmCancelIds.length} jobs` : "Cancel job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
