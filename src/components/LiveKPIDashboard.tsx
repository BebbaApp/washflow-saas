import { useState, useEffect, useMemo, useCallback } from "react";
import { Car, DollarSign, Clock, TrendingUp, CalendarIcon } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { WashOrder } from "@/hooks/useOrders";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCurrency } from "@/hooks/useCurrency";

type DateRange = "today" | "week" | "month" | "custom";

interface LiveKPIDashboardProps {
  orders: WashOrder[];
}

export const LiveKPIDashboard = ({ orders: initialOrders }: LiveKPIDashboardProps) => {
  const { formatPrice } = useCurrency();
  const [orders, setOrders] = useState<WashOrder[]>(initialOrders);
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Sync with parent orders
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (data) {
        setOrders(data.map((row: any) => ({
          id: row.id,
          orderNumber: row.order_number,
          customer: row.customer,
          vehicle: row.vehicle,
          plate: row.plate,
          service: row.service,
          servicePrice: Number(row.service_price),
          status: row.status,
          createdAt: row.created_at,
          completedAt: row.completed_at ?? undefined,
          waitMinutes: row.wait_minutes ?? undefined,
        })));
        setLastRefresh(new Date());
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Filter orders by date range
  const filteredOrders = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate = now;

    switch (dateRange) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "custom":
        startDate = customStart ? new Date(customStart) : new Date(0);
        endDate = customEnd ? new Date(customEnd + "T23:59:59") : now;
        break;
      default:
        startDate = new Date(0);
    }

    return orders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= startDate && d <= endDate;
    });
  }, [orders, dateRange, customStart, customEnd]);

  // KPI calculations
  const totalCars = filteredOrders.length;
  const revenue = filteredOrders.reduce((sum, o) => sum + o.servicePrice, 0);
  const completedOrders = filteredOrders.filter((o) => o.status === "completed");
  const inProgressOrders = filteredOrders.filter((o) => o.status === "in-progress");
  const avgWait = completedOrders.length
    ? Math.round(completedOrders.reduce((sum, o) => sum + (o.waitMinutes || 0), 0) / completedOrders.length)
    : 0;
  const completionRate = totalCars ? Math.round((completedOrders.length / totalCars) * 100) : 0;

  // Sparkline data — group orders by hour for revenue trend
  const sparklineData = useMemo(() => {
    const hourMap: Record<number, number> = {};
    filteredOrders.forEach((o) => {
      const hour = new Date(o.createdAt).getHours();
      hourMap[hour] = (hourMap[hour] || 0) + o.servicePrice;
    });

    // Fill 24 hours
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      value: hourMap[i] || 0,
    }));
  }, [filteredOrders]);

  const washSparkline = useMemo(() => {
    const hourMap: Record<number, number> = {};
    filteredOrders.forEach((o) => {
      const hour = new Date(o.createdAt).getHours();
      hourMap[hour] = (hourMap[hour] || 0) + 1;
    });
    return Array.from({ length: 24 }, (_, i) => ({ hour: i, value: hourMap[i] || 0 }));
  }, [filteredOrders]);

  const waitSparkline = useMemo(() => {
    const hourMap: Record<number, { total: number; count: number }> = {};
    completedOrders.forEach((o) => {
      if (o.waitMinutes) {
        const hour = new Date(o.createdAt).getHours();
        if (!hourMap[hour]) hourMap[hour] = { total: 0, count: 0 };
        hourMap[hour].total += o.waitMinutes;
        hourMap[hour].count++;
      }
    });
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      value: hourMap[i] ? Math.round(hourMap[i].total / hourMap[i].count) : 0,
    }));
  }, [completedOrders]);

  const stats = [
    { label: "Total Washes", value: String(totalCars), icon: Car, color: "text-primary", sparkColor: "hsl(185, 72%, 48%)", sparkData: washSparkline },
    { label: "Revenue", value: `${formatPrice(revenue)}`, icon: DollarSign, color: "text-success", sparkColor: "hsl(152, 60%, 45%)", sparkData: sparklineData },
    { label: "Avg Wait", value: `${avgWait}m`, icon: Clock, color: "text-warning", sparkColor: "hsl(38, 92%, 55%)", sparkData: waitSparkline },
    { label: "Completion", value: `${completionRate}%`, icon: TrendingUp, color: "text-info", sparkColor: "hsl(210, 80%, 55%)", sparkData: washSparkline },
  ];

  const dateRangeOptions: { label: string; value: DateRange }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "Custom", value: "custom" },
  ];

  return (
    <div className="space-y-6">
      {/* Date Range Picker + Live indicator */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-muted-foreground">
            Live · Updated {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dateRangeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                dateRange === opt.value
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {dateRange === "custom" && (
        <div className="flex gap-3 items-center">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-secondary border border-border text-foreground text-sm"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-secondary border border-border text-foreground text-sm"
          />
        </div>
      )}

      {/* KPI Cards with Sparklines */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-4 md:p-5">
            <div className="flex items-center justify-between mb-2">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <p className="stat-value text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1 mb-2">{stat.label}</p>
            {/* Sparkline */}
            <div className="h-8">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stat.sparkData}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={stat.sparkColor}
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>

      {/* Active status summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground mb-1">In Progress</p>
          <p className="text-2xl font-bold font-mono text-info">{inProgressOrders.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Waiting</p>
          <p className="text-2xl font-bold font-mono text-warning">
            {filteredOrders.filter((o) => o.status === "waiting").length}
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Completed Today</p>
          <p className="text-2xl font-bold font-mono text-success">{completedOrders.length}</p>
        </div>
      </div>
    </div>
  );
};
