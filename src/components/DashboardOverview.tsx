import { useMemo, useState } from "react";
import { Car, DollarSign, Clock, CheckCircle2, Phone, Hash, Loader2, Play, Gift } from "lucide-react";
import { useRewardEligibility } from "@/hooks/useRewardEligibility";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { OrderDetailsModal } from "@/components/OrderDetailsModal";
import { InventoryTrendsPanel } from "@/components/InventoryTrendsPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPhone } from "@/lib/phone";

interface DashboardOverviewProps {
  orders: WashOrder[];
  onUpdateStatus: (id: string, status: WashOrder["status"]) => void;
  onUpdateNotes?: (id: string, notes: string) => Promise<boolean> | void;
  onViewAll: () => void;
}

type TabKey = "overview" | "inventory";
type RangeKey = "today" | "week" | "month" | "custom";

const RANGE_OPTIONS: { id: RangeKey; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "custom", label: "Custom" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DashboardOverview = ({ orders, onUpdateStatus, onUpdateNotes, onViewAll }: DashboardOverviewProps) => {
  const { formatPrice } = useCurrency();
  const { can } = usePermissions();
  const showRevenue = can("dashboard.revenue");
  const showInventoryTab = can("dashboard.inventory");
  const showActivity = can("dashboard.activity");
  const { eligibleOrderIds } = useRewardEligibility(orders);
  const [tab, setTab] = useState<TabKey>("overview");
  const [range, setRange] = useState<RangeKey>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
    const now = new Date();
    const end = now.getTime();
    if (range === "today") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { rangeStart: s, rangeEnd: end, rangeLabel: "Today" };
    }
    if (range === "week") {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      const e = new Date(d);
      e.setDate(d.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      return { rangeStart: d.getTime(), rangeEnd: e.getTime(), rangeLabel: "This week" };
    }
    if (range === "month") {
      const s = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
      return { rangeStart: s, rangeEnd: e, rangeLabel: "This month" };
    }
    const s = customStart ? new Date(customStart + "T00:00:00").getTime() : 0;
    const e = customEnd ? new Date(customEnd + "T23:59:59").getTime() : end;
    return { rangeStart: s, rangeEnd: e, rangeLabel: "Custom" };
  }, [range, customStart, customEnd]);

  const rangeOrders = orders.filter((o) => {
    const t = new Date(o.createdAt).getTime();
    return t >= rangeStart && t <= rangeEnd && o.status !== "cancelled" && o.status !== "deleted";
  });
  const rangeCompleted = rangeOrders.filter((o) => o.status === "completed");
  const rangeRevenue = rangeCompleted.reduce((s, o) => s + o.servicePrice, 0);
  const inQueue = orders.filter((o) => o.status === "waiting").length;
  const activeNow = orders.filter((o) => o.status === "in-progress");
  const activeJobs = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled" && o.status !== "deleted");

  const { revenueSeries, chartTitle } = useMemo(() => {
    const completed = orders.filter((o) => o.status === "completed");
    const spanMs = Math.max(0, rangeEnd - rangeStart);
    const dayMs = 86_400_000;
    if (range === "today") {
      const buckets: { day: string; revenue: number }[] = [];
      for (let h = 7; h <= 18; h++) {
        const start = new Date(rangeStart);
        start.setHours(h, 0, 0, 0);
        const end = new Date(start);
        end.setHours(h + 1, 0, 0, 0);
        const rev = completed
          .filter((o) => {
            const t = new Date(o.completedAt ?? o.createdAt).getTime();
            return t >= start.getTime() && t < end.getTime();
          })
          .reduce((s, o) => s + o.servicePrice, 0);
        buckets.push({ day: `${(h % 12) || 12}${h >= 12 ? "p" : "a"}`, revenue: rev });
      }
      return { revenueSeries: buckets, chartTitle: "Revenue (Today, hourly)" };
    }
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(rangeEnd);
    end.setHours(0, 0, 0, 0);
    const buckets: { day: string; revenue: number }[] = [];
    const cursor = new Date(start);
    let safety = 0;
    while (cursor.getTime() <= end.getTime() && safety < 400) {
      const next = new Date(cursor);
      next.setDate(cursor.getDate() + 1);
      const rev = completed
        .filter((o) => {
          const t = new Date(o.completedAt ?? o.createdAt).getTime();
          return t >= cursor.getTime() && t < next.getTime();
        })
        .reduce((s, o) => s + o.servicePrice, 0);
      const label = spanMs > 31 * dayMs
        ? cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : `${DAYS[cursor.getDay()]} ${cursor.getDate()}`;
      buckets.push({ day: label, revenue: rev });
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }
    return { revenueSeries: buckets, chartTitle: `Revenue (${rangeLabel})` };
  }, [orders, rangeStart, rangeEnd, range, rangeLabel]);

  const stats = [
    {
      label: `Washes (${rangeLabel})`,
      value: String(rangeOrders.length),
      sub: `${rangeCompleted.length} completed`,
      icon: Car,
      iconBg: "bg-info/10",
      iconColor: "text-info",
    },
    ...(showRevenue
      ? [{
          label: `Revenue (${rangeLabel})`,
          value: formatPrice(rangeRevenue),
          sub: `${rangeCompleted.length} paid jobs`,
          icon: DollarSign,
          iconBg: "bg-success/10",
          iconColor: "text-success",
        }]
      : []),
    {
      label: "In Queue",
      value: String(inQueue),
      sub: "Waiting to start",
      icon: Clock,
      iconBg: "bg-warning/10",
      iconColor: "text-warning",
    },
    {
      label: "Active Now",
      value: String(activeNow.length),
      sub: "Currently washing",
      icon: CheckCircle2,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header row with tabs */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold text-foreground tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-1">Today's overview at a glance</p>
        </div>
        {showInventoryTab && (
        <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border">
          {(["overview", "inventory"] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                tab === t
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "overview" ? "Overview" : "Inventory Trends"}
            </button>
          ))}
        </div>
        )}
      </div>

      {tab === "inventory" && showInventoryTab ? (
        <InventoryTrendsPanel />
      ) : (
        <>
      {/* Range filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                range === r.id
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1 rounded-md bg-secondary border border-border text-foreground text-xs"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1 rounded-md bg-secondary border border-border text-foreground text-xs"
            />
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-sm text-muted-foreground font-medium">{s.label}</p>
              <div className={`w-10 h-10 rounded-xl ${s.iconBg} flex items-center justify-center`}>
                <s.icon className={`w-5 h-5 ${s.iconColor}`} />
              </div>
            </div>
            <p className="text-4xl font-bold text-foreground tracking-tight">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-2">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart + active jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {showRevenue && (
        <div className={`glass-card p-6 ${showActivity ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <h3 className="text-lg font-semibold text-foreground mb-4">{chartTitle}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => formatPrice(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatPrice(value), "Revenue"]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#revGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}

        {/* Active Jobs */}
        {showActivity && (
        <div className={`space-y-4 ${showRevenue ? "" : "lg:col-span-3"}`}>
          <div className="flex items-center justify-between px-1">
            <h3 className="text-lg font-semibold text-foreground">Active Jobs</h3>
            <button
              onClick={onViewAll}
              className="text-sm text-primary font-medium hover:underline"
            >
              View all
            </button>
          </div>
          <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
            {activeJobs.length === 0 && (
              <div className="glass-card p-6 text-center text-sm text-muted-foreground">
                No active jobs right now.
              </div>
            )}
            {activeJobs.map((o) => {
              const isWaiting = o.status === "waiting";
              const StatusIcon = isWaiting ? Clock : Loader2;
              const statusClasses = isWaiting
                ? "bg-warning/10 text-warning border-warning/20"
                : "bg-info/10 text-info border-info/20";
              const iconWrapClasses = isWaiting ? "bg-warning/10" : "bg-info/10";
              const iconColor = isWaiting ? "text-warning" : "text-info";
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(o.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(o.id); } }}
                  className="glass-card p-4 space-y-3 cursor-pointer hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-9 h-9 rounded-lg ${iconWrapClasses} flex items-center justify-center shrink-0`}>
                        <Car className={`w-4 h-4 ${iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{o.customer}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {o.plate}
                          {o.customerPhone && (
                            <>
                              <span className="mx-1 text-border">/</span>
                              <Phone className="w-3 h-3" />
                              <span className="truncate">{formatPhone(o.customerPhone)}</span>
                            </>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {o.orderNumber}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(o.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className={`status-badge border shrink-0 inline-flex items-center gap-1 ${statusClasses}`}>
                      <StatusIcon className={`w-3 h-3 ${isWaiting ? "" : "animate-spin"}`} />
                      {isWaiting ? "Waiting" : "In Progress"}
                    </span>
                  </div>
                  {eligibleOrderIds.has(o.id) ? (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/15 text-success text-[10px] font-bold border border-success/40 w-fit">
                      <Gift className="w-3 h-3" /> QUALIFY FOR FREE WASH
                    </div>
                  ) : progressByOrderId.get(o.id) ? (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold border border-border w-fit">
                      <Gift className="w-3 h-3" /> {progressByOrderId.get(o.id)!.current}/{progressByOrderId.get(o.id)!.target} to free wash
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground capitalize">
                      {o.service} <span className="text-primary ml-1">{formatPrice(o.servicePrice)}</span>
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateStatus(o.id, isWaiting ? "in-progress" : "completed"); }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity ${
                        isWaiting
                          ? "bg-primary text-primary-foreground"
                          : "bg-success text-success-foreground"
                      }`}
                    >
                      {isWaiting ? <Play className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {isWaiting ? "Start" : "Complete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}
      </div>
        </>
      )}

      <OrderDetailsModal
        order={orders.find((o) => o.id === selectedId) ?? null}
        open={selectedId !== null}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        onUpdateStatus={onUpdateStatus}
        onUpdateNotes={onUpdateNotes}
      />
    </div>
  );
};
