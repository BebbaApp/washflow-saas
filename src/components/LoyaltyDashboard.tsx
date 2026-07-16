import { useEffect, useMemo, useState } from "react";
import { Gift, Trophy, Users, Search, CreditCard, Award, Calendar, Car, History, Phone as PhoneIcon, Sparkles, Download, ArrowUpDown, FileText } from "lucide-react";
import { exportTablePdf } from "@/lib/pdfExport";
import { useOrders, type WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { formatPhone, phoneDigits } from "@/lib/phone";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { PaginationBar } from "@/components/ui/pagination-bar";

type View = "customers" | "leaderboard";
type DateRange = "all" | "30d" | "90d";
type SortKey = "visits" | "points" | "lastVisit";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "visits", label: "Most visits" },
  { id: "points", label: "Most points" },
  { id: "lastVisit", label: "Recent visit" },
];

const POINTS_PER_WASH = 10;
const FREE_WASH_COST = 100;

interface Visit {
  id: string;
  orderNumber: string;
  date: string;
  service: string;
  price: number;
  plate: string;
}

interface LoyaltyMember {
  key: string;
  name: string;
  phones: string[];
  plates: string[];
  visits: Visit[];
  totalWashes: number;
  totalSpend: number;
  earnedPoints: number;
  redeemedPoints: number;
  loyaltyPoints: number;
  lastVisit: string;
  customerId?: string; // resolved customers row id
}

// Phone fingerprint: last 9 digits to tolerate +27 / 0 prefix differences
const phoneKey = (p?: string | null) => {
  const d = phoneDigits(p);
  return d ? d.slice(-9) : "";
};
const nameKey = (n?: string | null) => (n ?? "").trim().toLowerCase();

/**
 * Smarter customer matching with union-find:
 * Orders are linked if they share a phone fingerprint OR a normalised name.
 */
function groupOrders(orders: WashOrder[]): WashOrder[][] {
  const parent: Record<number, number> = {};
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  orders.forEach((_, i) => (parent[i] = i));

  const phoneIdx = new Map<string, number>();
  const nameIdx = new Map<string, number>();

  orders.forEach((o, i) => {
    const p = phoneKey(o.customerPhone);
    const n = nameKey(o.customer);
    if (p) {
      if (phoneIdx.has(p)) union(i, phoneIdx.get(p)!);
      else phoneIdx.set(p, i);
    }
    if (n) {
      if (nameIdx.has(n)) union(i, nameIdx.get(n)!);
      else nameIdx.set(n, i);
    }
  });

  const groups = new Map<number, WashOrder[]>();
  orders.forEach((o, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(o);
  });
  return Array.from(groups.values());
}

export const LoyaltyDashboard = () => {
  const { orders } = useOrders();
  const { formatPrice } = useCurrency();

  const [view, setView] = useState<View>("customers");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<DateRange>("all");
  const [sortKey, setSortKey] = useState<SortKey>("visits");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<LoyaltyMember | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [lastRedemption, setLastRedemption] = useState<{ name: string; remaining: number; visitsToNext: number } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Track redemption transactions per resolved customer_id (and a name fallback bucket)
  const [redemptionsByCustomerId, setRedemptionsByCustomerId] = useState<Record<string, number>>({});

  const fetchRedemptions = async () => {
    const { data, error } = await supabase
      .from("loyalty_transactions")
      .select("customer_id, points, type");
    if (error) return;
    const acc: Record<string, number> = {};
    for (const r of data || []) {
      if (r.type === "redeemed") {
        acc[r.customer_id] = (acc[r.customer_id] || 0) + Math.abs(r.points);
      }
    }
    setRedemptionsByCustomerId(acc);
  };

  // Map customers table rows by phone fingerprint / name for redemption matching
  const [customerLookup, setCustomerLookup] = useState<{ byPhone: Record<string, string>; byName: Record<string, string> }>({
    byPhone: {},
    byName: {},
  });

  const fetchCustomers = async () => {
    const { data, error } = await supabase.from("customers").select("id, name, phone");
    if (error) return;
    const byPhone: Record<string, string> = {};
    const byName: Record<string, string> = {};
    for (const c of data || []) {
      const p = phoneKey(c.phone);
      if (p) byPhone[p] = c.id;
      const n = nameKey(c.name);
      if (n && !byName[n]) byName[n] = c.id;
    }
    setCustomerLookup({ byPhone, byName });
  };

  useEffect(() => {
    fetchRedemptions();
    fetchCustomers();
  }, []);

  // Build derived members (all-time, used for the customer list & details)
  const allMembers = useMemo<LoyaltyMember[]>(() => {
    const completed = orders.filter((o) => o.status === "completed");
    const groups = groupOrders(completed);

    return groups.map((g) => {
      // Pick most recent name + phone as canonical
      const sorted = [...g].sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
      const canonical = sorted[0];
      const phones = Array.from(new Set(g.map((o) => o.customerPhone).filter(Boolean))) as string[];
      const plates = Array.from(new Set(g.map((o) => o.plate).filter(Boolean)));
      const visits: Visit[] = sorted.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        date: o.completedAt || o.createdAt,
        service: o.service,
        price: o.servicePrice || 0,
        plate: o.plate,
      }));

      const totalWashes = g.length;
      const totalSpend = g.reduce((s, o) => s + (o.servicePrice || 0), 0);
      const earnedPoints = totalWashes * POINTS_PER_WASH;

      // Resolve customer_id via phone fingerprint, then name
      let customerId: string | undefined;
      for (const p of phones) {
        const id = customerLookup.byPhone[phoneKey(p)];
        if (id) { customerId = id; break; }
      }
      if (!customerId) {
        customerId = customerLookup.byName[nameKey(canonical.customer)];
      }
      const redeemedPoints = customerId ? (redemptionsByCustomerId[customerId] || 0) : 0;

      const key = phones[0] ? `p:${phoneKey(phones[0])}` : `n:${nameKey(canonical.customer)}`;
      return {
        key,
        name: canonical.customer,
        phones,
        plates,
        visits,
        totalWashes,
        totalSpend,
        earnedPoints,
        redeemedPoints,
        loyaltyPoints: Math.max(0, earnedPoints - redeemedPoints),
        lastVisit: canonical.completedAt || canonical.createdAt,
        customerId,
      };
    });
  }, [orders, redemptionsByCustomerId, customerLookup]);

  // Apply date filter (only affects leaderboard ranking & podium)
  const rangeStart = useMemo(() => {
    if (range === "all") return null;
    const days = range === "30d" ? 30 : 90;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }, [range]);

  const rangedMembers = useMemo<LoyaltyMember[]>(() => {
    if (!rangeStart) return allMembers;
    return allMembers
      .map((m) => {
        const visits = m.visits.filter((v) => v.date >= rangeStart);
        if (visits.length === 0) return null;
        const totalSpend = visits.reduce((s, v) => s + v.price, 0);
        return {
          ...m,
          visits,
          totalWashes: visits.length,
          totalSpend,
          earnedPoints: visits.length * POINTS_PER_WASH,
          loyaltyPoints: Math.max(0, visits.length * POINTS_PER_WASH - m.redeemedPoints),
          lastVisit: visits[0].date,
        };
      })
      .filter(Boolean) as LoyaltyMember[];
  }, [allMembers, rangeStart]);

  const baseMembers = view === "leaderboard" ? rangedMembers : allMembers;

  const totalMembers = baseMembers.length;
  const totalVisits = baseMembers.reduce((s, m) => s + m.totalWashes, 0);
  const totalSpend = baseMembers.reduce((s, m) => s + m.totalSpend, 0);
  const rewardsClaimed = Object.keys(redemptionsByCustomerId).filter(
    (cid) => (redemptionsByCustomerId[cid] || 0) >= FREE_WASH_COST,
  ).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? baseMembers.filter((m) =>
          m.name.toLowerCase().includes(q) ||
          m.phones.some((p) => phoneDigits(p).includes(phoneDigits(q))) ||
          m.plates.some((pl) => pl.toLowerCase().includes(q))
        )
      : baseMembers;
    if (view !== "leaderboard") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    const cmp = (a: LoyaltyMember, b: LoyaltyMember) => {
      if (sortKey === "points") return b.loyaltyPoints - a.loyaltyPoints || b.totalWashes - a.totalWashes;
      if (sortKey === "lastVisit") return b.lastVisit.localeCompare(a.lastVisit);
      return b.totalWashes - a.totalWashes || b.loyaltyPoints - a.loyaltyPoints;
    };
    return [...list].sort(cmp);
  }, [baseMembers, query, view, sortKey]);

  const stats = [
    { value: totalMembers, label: "Members", color: "text-foreground", border: "border-border" },
    { value: totalVisits, label: "Total Visits", color: "text-foreground", border: "border-border" },
    { value: formatPrice(totalSpend), label: "Total Spend", color: "text-primary", border: "border-border" },
    { value: rewardsClaimed, label: "Rewards Claimed", color: "text-success", border: "border-success/60", icon: Gift },
  ];

  const topThree = view === "leaderboard" ? filtered.slice(0, 3) : [];
  const selected = selectedKey ? allMembers.find((m) => m.key === selectedKey) || null : null;

  // Reset pagination when list-affecting inputs change
  useEffect(() => { setPage(1); }, [query, view, range, sortKey, pageSize]);
  const pagedFiltered = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );


  // Resolve or create a customers row, then insert a redemption transaction
  const handleConfirmRedeem = async () => {
    if (!redeemTarget) return;

    // Safeguard: re-check live balance against the freshest derived member
    const live = allMembers.find((m) => m.key === redeemTarget.key);
    if (!live || live.loyaltyPoints < FREE_WASH_COST) {
      toast.error(
        `${redeemTarget.name} doesn't have enough points to redeem. ` +
        `They need ${FREE_WASH_COST - (live?.loyaltyPoints ?? 0)} more.`
      );
      setRedeemTarget(null);
      return;
    }

    setRedeeming(true);
    try {
      let customerId = live.customerId;

      if (!customerId) {
        const { data, error } = await supabase
          .from("customers")
          .insert({
            name: live.name,
            phone: live.phones[0] || null,
            loyalty_points: 0,
            total_washes: live.totalWashes,
          })
          .select("id")
          .single();
        if (error || !data) {
          toast.error("Could not record redemption: " + (error?.message || "unknown"));
          setRedeeming(false);
          return;
        }
        customerId = data.id;
      }

      const { error: txnError } = await supabase.from("loyalty_transactions").insert({
        customer_id: customerId,
        points: FREE_WASH_COST,
        type: "redeemed",
        description: `Redeemed free wash for ${live.name}`,
      });

      if (txnError) {
        toast.error("Failed to redeem: " + txnError.message);
        setRedeeming(false);
        return;
      }

      const remaining = Math.max(0, live.loyaltyPoints - FREE_WASH_COST);
      const visitsToNext = Math.ceil((FREE_WASH_COST - remaining) / POINTS_PER_WASH);
      setLastRedemption({ name: live.name, remaining, visitsToNext });
      toast.success(
        `🎉 Free wash redeemed for ${live.name} — ${remaining} pts remaining (${visitsToNext} more visit${visitsToNext !== 1 ? "s" : ""} to next reward)`
      );
      setRedeemTarget(null);
      await Promise.all([fetchCustomers(), fetchRedemptions()]);
    } finally {
      setRedeeming(false);
    }
  };

  // CSV export of current leaderboard view (respects date range + sort + search)
  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "Rank", "Name", "Phone", "Plates", "Visits", "Total Spend",
      "Points", "Reward Eligible", "Next Reward In Visits", "Last Visit",
      "Visit Date", "Visit Order #", "Visit Service", "Visit Plate", "Visit Price",
    ];
    const lines = [header.join(",")];
    filtered.forEach((m, i) => {
      const eligible = m.loyaltyPoints >= FREE_WASH_COST;
      const nextRewardVisits = eligible
        ? 0
        : Math.ceil((FREE_WASH_COST - m.loyaltyPoints) / POINTS_PER_WASH);
      const baseRow = [
        i + 1,
        m.name,
        m.phones[0] ? formatPhone(m.phones[0]) : "",
        m.plates.join(" / "),
        m.totalWashes,
        m.totalSpend.toFixed(2),
        m.loyaltyPoints,
        eligible ? "Yes" : "No",
        nextRewardVisits,
        new Date(m.lastVisit).toISOString(),
      ];
      if (m.visits.length === 0) {
        lines.push([...baseRow, "", "", "", "", ""].map(esc).join(","));
      } else {
        m.visits.forEach((v, vi) => {
          // After the first visit row, blank the customer columns for readability
          const left = vi === 0 ? baseRow : Array(baseRow.length).fill("");
          lines.push([
            ...left,
            new Date(v.date).toISOString(),
            v.orderNumber,
            v.service,
            v.plate,
            v.price.toFixed(2),
          ].map(esc).join(","));
        });
      }
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `loyalty-leaderboard-${range}-${sortKey}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} customer${filtered.length !== 1 ? "s" : ""} to CSV`);
  };

  const handleExportPdf = () => {
    if (filtered.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const headers = [
      "Rank", "Name", "Phone", "Plates", "Visits", "Total Spend",
      "Points", "Eligible", "Next in", "Last Visit",
    ];
    const rows = filtered.map((m, i) => {
      const eligible = m.loyaltyPoints >= FREE_WASH_COST;
      const nextRewardVisits = eligible
        ? 0
        : Math.ceil((FREE_WASH_COST - m.loyaltyPoints) / POINTS_PER_WASH);
      return [
        i + 1,
        m.name,
        m.phones[0] ? formatPhone(m.phones[0]) : "",
        m.plates.join(" / "),
        m.totalWashes,
        m.totalSpend.toFixed(2),
        m.loyaltyPoints,
        eligible ? "Yes" : "No",
        nextRewardVisits,
        new Date(m.lastVisit).toLocaleDateString(),
      ];
    });
    exportTablePdf({
      title: "Loyalty leaderboard",
      subtitle: `Range: ${range} · Sort: ${sortKey}`,
      filename: `loyalty-leaderboard-${range}-${sortKey}-${new Date().toISOString().slice(0, 10)}.pdf`,
      headers,
      rows,
    });
    toast.success(`Exported ${filtered.length} customer${filtered.length !== 1 ? "s" : ""} to PDF`);
  };

  return (
    <div className="space-y-5 -mt-4">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-3 -mt-12 mb-4 flex-wrap">
        <div className="inline-flex items-center bg-card border border-border rounded-full p-1">
          <button
            onClick={() => setView("customers")}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              view === "customers" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-4 h-4" /> Customers
          </button>
          <button
            onClick={() => setView("leaderboard")}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              view === "leaderboard" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Trophy className="w-4 h-4" /> Leaderboard
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className={`glass-card p-5 border ${s.border}`}>
            <p className={`text-3xl font-extrabold leading-tight ${s.color}`}>{s.value}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {s.icon && <s.icon className="w-3.5 h-3.5 text-success" />}
              <p className={`text-sm ${s.label === "Rewards Claimed" ? "text-success font-medium" : "text-muted-foreground"}`}>
                {s.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone or plate..."
            className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        {view === "leaderboard" && (
          <div className="inline-flex items-center bg-card border border-border rounded-xl p-1 self-start sm:self-auto">
            {([
              { id: "all", label: "All time" },
              { id: "90d", label: "90 days" },
              { id: "30d", label: "30 days" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setRange(opt.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  range === opt.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Calendar className="w-3.5 h-3.5" /> {opt.label}
              </button>
            ))}
          </div>
        )}
        {view === "leaderboard" && (
          <>
            <div className="relative self-start sm:self-auto">
              <ArrowUpDown className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="appearance-none bg-card border border-border rounded-xl pl-9 pr-8 py-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>Sort: {o.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary/10 text-primary border border-primary/30 text-xs font-semibold hover:bg-primary/20 transition-colors self-start sm:self-auto"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </>
        )}
      </div>

      {/* Post-redemption confirmation banner */}
      {lastRedemption && (
        <div className="glass-card p-4 border border-success/40 bg-success/5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles className="w-5 h-5 text-success shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                Reward redeemed for {lastRedemption.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Updated balance: <span className="font-mono font-bold text-foreground">{lastRedemption.remaining}</span> pts ·{" "}
                {lastRedemption.remaining >= FREE_WASH_COST
                  ? "Eligible for another free wash"
                  : `${lastRedemption.visitsToNext} more visit${lastRedemption.visitsToNext !== 1 ? "s" : ""} to next reward`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setLastRedemption(null)}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Leaderboard podium */}
      {view === "leaderboard" && topThree.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {topThree.map((m, idx) => {
            const rankStyles = [
              { ring: "ring-warning/60", bg: "bg-warning/15", text: "text-warning", label: "🥇 1st" },
              { ring: "ring-muted-foreground/40", bg: "bg-muted-foreground/15", text: "text-muted-foreground", label: "🥈 2nd" },
              { ring: "ring-primary/50", bg: "bg-primary/15", text: "text-primary", label: "🥉 3rd" },
            ][idx];
            return (
              <button
                key={m.key}
                onClick={() => setSelectedKey(m.key)}
                className={`glass-card p-4 border ring-1 ${rankStyles.ring} text-center hover:bg-secondary/40 transition-colors`}
              >
                <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${rankStyles.bg} ${rankStyles.text}`}>
                  {rankStyles.label}
                </div>
                <p className="text-sm font-semibold text-foreground truncate mt-2">{m.name}</p>
                <p className="text-xs text-muted-foreground truncate">{m.phones[0] ? formatPhone(m.phones[0]) : "—"}</p>
                <p className="text-2xl font-extrabold font-mono text-foreground mt-2">{m.totalWashes}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider">visits</p>
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      <div className="glass-card p-4 min-h-[280px]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {view === "leaderboard" ? (
              <>
                <Trophy className="w-12 h-12 text-warning mb-3" />
                <p className="text-base font-semibold text-foreground">No data yet</p>
                <p className="text-sm text-muted-foreground mt-1">Customers appear here as soon as they complete a wash</p>
              </>
            ) : (
              <>
                <CreditCard className="w-10 h-10 text-warning/70 mb-4" />
                <p className="text-base font-semibold text-foreground">No customers yet</p>
                <p className="text-sm text-muted-foreground mt-1">Customers are added automatically as washes are completed</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  {view === "leaderboard" && <th className="text-left font-medium py-2 pr-3 w-10">#</th>}
                  <th className="text-left font-medium py-2 pr-3">Customer</th>
                  <th className="text-left font-medium py-2 pr-3 hidden sm:table-cell">Phone</th>
                  <th className="text-left font-medium py-2 pr-3 hidden md:table-cell">Plates</th>
                  <th className="text-right font-medium py-2 pr-3">Visits</th>
                  <th className="text-right font-medium py-2 pr-3 hidden sm:table-cell">Spend</th>
                  <th className="text-right font-medium py-2 pr-3">Points</th>
                  <th className="text-right font-medium py-2">Reward</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pagedFiltered.map((m, localIdx) => {
                  const idx = (page - 1) * pageSize + localIdx;
                  const isReward = m.loyaltyPoints >= FREE_WASH_COST;
                  return (
                    <tr key={m.key} className="hover:bg-secondary/40 transition-colors">
                      {view === "leaderboard" && (
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold ${
                            idx === 0 ? "bg-warning/20 text-warning" :
                            idx === 1 ? "bg-muted-foreground/20 text-muted-foreground" :
                            idx === 2 ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"
                          }`}>{idx + 1}</span>
                        </td>
                      )}
                      <td className="py-2 pr-3 max-w-[220px]">
                        <button onClick={() => setSelectedKey(m.key)} className="text-left">
                          <span className="font-semibold text-foreground truncate inline-block max-w-full align-middle">{m.name}</span>
                          {isReward && (
                            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/15 text-success text-[10px] font-bold align-middle">
                              <Award className="w-3 h-3" /> REWARD
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground hidden sm:table-cell">{m.phones[0] ? formatPhone(m.phones[0]) : "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground hidden md:table-cell truncate max-w-[160px]">{m.plates.join(", ") || "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono text-foreground">{m.totalWashes}</td>
                      <td className="py-2 pr-3 text-right font-mono text-foreground hidden sm:table-cell">{formatPrice(m.totalSpend)}</td>
                      <td className="py-2 pr-3 text-right font-mono font-bold text-foreground">{m.loyaltyPoints}</td>
                      <td className="py-2 text-right">
                        {isReward ? (
                          <button
                            onClick={() => setRedeemTarget(m)}
                            className="px-2.5 py-1 rounded-md bg-success/15 text-success text-xs font-semibold hover:bg-success/25 transition-colors"
                          >
                            Redeem
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">{FREE_WASH_COST - m.loyaltyPoints} pts</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 0 && (
              <div className="pt-3 mt-2 border-t border-border">
                <PaginationBar
                  page={page}
                  pageSize={pageSize}
                  totalCount={filtered.length}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </div>
            )}
          </div>
        )}
      </div>


      {/* Customer details modal */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-lg max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" /> {selected.name}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                  {selected.phones[0] && (
                    <span className="inline-flex items-center gap-1"><PhoneIcon className="w-3.5 h-3.5" /> {formatPhone(selected.phones[0])}</span>
                  )}
                  {selected.plates.length > 0 && (
                    <span className="inline-flex items-center gap-1"><Car className="w-3.5 h-3.5" /> {selected.plates.join(", ")}</span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="p-3 rounded-lg bg-secondary/50 border border-border text-center">
                  <p className="text-xl font-extrabold text-foreground">{selected.totalWashes}</p>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Visits</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/50 border border-border text-center">
                  <p className="text-xl font-extrabold font-mono text-primary">{selected.loyaltyPoints}</p>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Points</p>
                </div>
                <div className={`p-3 rounded-lg border text-center ${selected.loyaltyPoints >= FREE_WASH_COST ? "bg-success/10 border-success/40" : "bg-secondary/50 border-border"}`}>
                  <p className={`text-xl font-extrabold ${selected.loyaltyPoints >= FREE_WASH_COST ? "text-success" : "text-muted-foreground"}`}>
                    {selected.loyaltyPoints >= FREE_WASH_COST ? "Ready" : `${FREE_WASH_COST - selected.loyaltyPoints}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    {selected.loyaltyPoints >= FREE_WASH_COST ? "Reward" : "to reward"}
                  </p>
                </div>
              </div>

              <div className="mt-3 text-xs text-muted-foreground flex items-center justify-between">
                <span>Last visit: <span className="text-foreground font-medium">{new Date(selected.lastVisit).toLocaleString()}</span></span>
                {selected.redeemedPoints > 0 && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Sparkles className="w-3.5 h-3.5" /> {Math.floor(selected.redeemedPoints / FREE_WASH_COST)} reward(s) redeemed
                  </span>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                  <History className="w-3.5 h-3.5" /> Visit Timeline
                </p>
                <div className="border border-border rounded-lg divide-y divide-border max-h-64 overflow-y-auto">
                  {selected.visits.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-primary">{v.orderNumber}</p>
                        <p className="text-foreground truncate">{v.service}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                          <span>{new Date(v.date).toLocaleDateString()}</span>
                          {v.plate && <span className="inline-flex items-center gap-1"><Car className="w-3 h-3" /> {v.plate}</span>}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-foreground shrink-0">{formatPrice(v.price)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter className="mt-4">
                {selected.loyaltyPoints >= FREE_WASH_COST && (
                  <button
                    onClick={() => { setRedeemTarget(selected); }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-success text-success-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
                  >
                    <Gift className="w-4 h-4" /> Redeem free wash
                  </button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Redeem confirmation */}
      <AlertDialog open={!!redeemTarget} onOpenChange={(open) => !open && !redeeming && setRedeemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem free wash?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deduct <strong>{FREE_WASH_COST} points</strong> from{" "}
              <strong>{redeemTarget?.name}</strong> and record the redemption for audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeeming}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (!redeeming) handleConfirmRedeem(); }}
              disabled={redeeming}
            >
              {redeeming ? "Redeeming..." : "Confirm redemption"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
