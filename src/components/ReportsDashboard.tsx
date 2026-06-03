import { useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Download, BarChart3, Receipt, DollarSign, Car, TrendingUp, Clock,
  CalendarDays, Award,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { VATReport } from "@/components/VATReport";
import { usePermissions } from "@/hooks/usePermissions";

interface ReportsDashboardProps {
  orders: WashOrder[];
}

type Range = "today" | "week" | "month" | "all";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "all", label: "All Time" },
];

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van"] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];
const VEHICLE_COLORS: Record<VehicleType, string> = {
  SUV: "hsl(210, 90%, 56%)",
  Sedan: "hsl(165, 65%, 48%)",
  Truck: "hsl(265, 70%, 60%)",
  Van: "hsl(38, 92%, 55%)",
};

function classifyVehicle(v: string): VehicleType {
  const s = v.toLowerCase();
  if (/(suv|crossover|rav4|cr-v|highlander|tahoe|explorer|escape|rogue|pilot|x5|q5|q7)/.test(s)) return "SUV";
  if (/(truck|pickup|f-?150|silverado|ram|tacoma|tundra|ranger|titan)/.test(s)) return "Truck";
  if (/(van|odyssey|sienna|caravan|transit|sprinter)/.test(s)) return "Van";
  return "Sedan";
}

function rangeStart(r: Range): number {
  const now = new Date();
  if (r === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (r === "week") {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (r === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  return 0;
}

export const ReportsDashboard = ({ orders }: ReportsDashboardProps) => {
  const { formatPrice } = useCurrency();
  const { can } = usePermissions();
  const canVat = can("reports.vat");
  const canExport = can("reports.export");
  const [tab, setTab] = useState<"overview" | "vat">("overview");
  const [range, setRange] = useState<Range>("week");

  const filtered = useMemo(() => {
    const start = rangeStart(range);
    return orders.filter((o) => new Date(o.createdAt).getTime() >= start);
  }, [orders, range]);

  const stats = useMemo(() => {
    const completed = filtered.filter((o) => o.status === "completed");
    const cancelled = filtered.filter((o) => o.status === "cancelled").length;
    const totalRevenue = completed.reduce((s, o) => s + o.servicePrice, 0);
    const waits = completed.map((o) => o.waitMinutes ?? 0);
    const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
    const avgPerJob = completed.length ? totalRevenue / completed.length : 0;
    return {
      totalRevenue,
      carsWashed: completed.length,
      avgPerJob,
      avgWait,
      totalJobs: filtered.length,
      cancelled,
    };
  }, [filtered]);

  // Revenue & Job Count over last 14 days
  const dailySeries = useMemo(() => {
    const days: { day: number; label: string; revenue: number; jobs: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push({
        day: d.getTime(),
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        revenue: 0,
        jobs: 0,
      });
    }
    orders.forEach((o) => {
      const t = new Date(o.createdAt);
      t.setHours(0, 0, 0, 0);
      const idx = days.findIndex((x) => x.day === t.getTime());
      if (idx === -1) return;
      days[idx].jobs += 1;
      if (o.status === "completed") days[idx].revenue += o.servicePrice;
    });
    return days;
  }, [orders]);

  const vehicleTypes = useMemo(() => {
    const counts: Record<VehicleType, number> = { SUV: 0, Sedan: 0, Truck: 0, Van: 0 };
    filtered.forEach((o) => { counts[classifyVehicle(o.vehicle)] += 1; });
    return VEHICLE_TYPES.map((name) => ({ name, value: counts[name] }));
  }, [filtered]);

  const hourly = useMemo(() => {
    const start = rangeStart("today");
    const map = new Map<number, number>();
    for (let h = 8; h <= 19; h++) map.set(h, 0);
    orders.forEach((o) => {
      const t = new Date(o.createdAt).getTime();
      if (t < start) return;
      const h = new Date(o.createdAt).getHours();
      if (!map.has(h)) map.set(h, 0);
      map.set(h, (map.get(h) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([h, cars]) => ({
        label: `${(h % 12) || 12}${h >= 12 ? "pm" : "am"}`,
        cars,
      }));
  }, [orders]);

  const servicePopularity = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((o) => map.set(o.service, (map.get(o.service) ?? 0) + 1));
    return Array.from(map.entries())
      .map(([service, jobs]) => ({ service, jobs }))
      .sort((a, b) => b.jobs - a.jobs);
  }, [filtered]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { revenue: number; jobs: number }>();
    filtered.forEach((o) => {
      if (o.status !== "completed") return;
      const cur = map.get(o.customer) ?? { revenue: 0, jobs: 0 };
      cur.revenue += o.servicePrice;
      cur.jobs += 1;
      map.set(o.customer, cur);
    });
    const sorted = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    const max = sorted[0]?.revenue ?? 1;
    return sorted.map((c) => ({ ...c, pct: max ? (c.revenue / max) * 100 : 0 }));
  }, [filtered]);

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Washflow Saas Report", 14, 20);
    doc.setFontSize(10);
    doc.text(`Range: ${RANGES.find((r) => r.id === range)?.label} · Generated ${new Date().toLocaleDateString()}`, 14, 28);
    doc.setFontSize(12);
    doc.text(`Total Revenue: ${formatPrice(stats.totalRevenue)}`, 14, 40);
    doc.text(`Cars Washed: ${stats.carsWashed}`, 14, 48);
    doc.text(`Avg per Job: ${formatPrice(stats.avgPerJob)}`, 14, 56);
    doc.text(`Avg Wait: ${stats.avgWait}m`, 14, 64);
    doc.text(`Total Jobs: ${stats.totalJobs}`, 14, 72);
    autoTable(doc, {
      startY: 80,
      head: [["Order", "Customer", "Vehicle", "Service", "Price", "Status", "Date"]],
      body: filtered.map((o) => [
        o.orderNumber, o.customer, o.vehicle, o.service,
        `${formatPrice(o.servicePrice)}`, o.status,
        new Date(o.createdAt).toLocaleDateString(),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    doc.save("aquawash-report.pdf");
  };

  return (
    <div className="space-y-6">
      {/* Tab + Range header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {([
            { id: "overview" as const, label: "Overview", icon: BarChart3 },
            { id: "vat" as const, label: "VAT Report", icon: Receipt },
          ]).filter((t) => t.id !== "vat" || canVat).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {tab === "overview" && (
            <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border">
              {RANGES.map((r) => {
                const active = range === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                      active
                        ? "bg-card text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          )}
          {tab === "overview" && canExport && (
            <button
              onClick={exportPDF}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
              title="Export PDF"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          )}
        </div>
      </div>

      {tab === "vat" && <VATReport orders={orders} />}

      {tab === "overview" && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <StatCard
              label="Total Revenue"
              value={formatPrice(stats.totalRevenue)}
              sub={`${stats.totalJobs} jobs`}
              icon={DollarSign}
              tone="info"
            />
            <StatCard
              label="Cars Washed"
              value={String(stats.carsWashed)}
              sub="Completed"
              icon={Car}
              tone="success"
            />
            <StatCard
              label="Avg per Job"
              value={formatPrice(stats.avgPerJob)}
              sub="Revenue per wash"
              icon={TrendingUp}
              tone="violet"
            />
            <StatCard
              label="Avg Wait Time"
              value={`${stats.avgWait}m`}
              sub="From arrival"
              icon={Clock}
              tone="warning"
            />
            <StatCard
              label="Total Jobs"
              value={String(stats.totalJobs)}
              sub={`${stats.cancelled} cancelled`}
              icon={CalendarDays}
              tone="success"
            />
          </div>

          {/* Row 1: Revenue area + Vehicle Types donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="glass-card p-5 lg:col-span-2">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Revenue & Job Count</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">Last 14 days</p>
                </div>
              </div>
              <div className="h-72 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatPrice(v)}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(v: number, name) => name === "revenue" ? [formatPrice(v), "Revenue"] : [v, "Jobs"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#revGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card p-5">
              <h4 className="text-sm font-bold text-foreground">Vehicle Types</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{RANGES.find((r) => r.id === range)?.label}</p>
              <div className="h-60 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={vehicleTypes}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {vehicleTypes.map((v) => (
                        <Cell key={v.name} fill={VEHICLE_COLORS[v.name as VehicleType]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-3 flex-wrap text-xs">
                {VEHICLE_TYPES.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="w-2 h-2 rounded-full" style={{ background: VEHICLE_COLORS[t] }} />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Row 2: Hourly Throughput + Service Popularity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-card p-5">
              <h4 className="text-sm font-bold text-foreground">Hourly Throughput</h4>
              <p className="text-xs text-muted-foreground mt-0.5">Cars washed by hour (today)</p>
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Bar dataKey="cars" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card p-5">
              <h4 className="text-sm font-bold text-foreground">Service Popularity</h4>
              <p className="text-xs text-muted-foreground mt-0.5">Jobs by service type</p>
              <div className="h-64 mt-4">
                {servicePopularity.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    No jobs in this range yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={servicePopularity}
                      layout="vertical"
                      margin={{ top: 5, right: 20, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        type="category"
                        dataKey="service"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                        width={110}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => [`${v}`, "Jobs"]}
                      />
                      <Bar dataKey="jobs" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} barSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Top Customers */}
          <div className="glass-card p-5">
            <h4 className="text-sm font-bold text-foreground">Top Customers</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              By revenue — {RANGES.find((r) => r.id === range)?.label.toLowerCase()}
            </p>
            {topCustomers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No completed jobs in this range yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {topCustomers.map((c, idx) => (
                  <li key={c.name} className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      idx === 0
                        ? "bg-warning/15 text-warning"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {idx === 0 ? <Award className="w-4 h-4" /> : idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground truncate">{c.name}</p>
                        <p className="text-sm font-bold text-primary shrink-0">{formatPrice(c.revenue)}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${c.pct}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0 w-10 text-right">
                      {c.jobs} job{c.jobs === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};

function StatCard({
  label, value, sub, icon: Icon, tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof DollarSign;
  tone: "info" | "success" | "violet" | "warning";
}) {
  const toneMap: Record<string, string> = {
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    violet: "bg-[hsl(265,70%,60%)]/10 text-[hsl(265,70%,60%)]",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${toneMap[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-bold text-foreground mt-2 tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}
