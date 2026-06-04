import { Car, Wallet, Clock, TrendingUp } from "lucide-react";
import type { WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";

interface DashboardStatsProps {
  orders: WashOrder[];
}

export const DashboardStats = ({ orders }: DashboardStatsProps) => {
  const { formatPrice } = useCurrency();
  const totalCars = orders.length;
  const revenue = orders.reduce((sum, o) => sum + o.servicePrice, 0);
  const completedOrders = orders.filter((o) => o.status === "completed");
  const avgWait = completedOrders.length
    ? Math.round(completedOrders.reduce((sum, o) => sum + (o.waitMinutes || 0), 0) / completedOrders.length)
    : 0;
  const conversionRate = totalCars ? Math.round((completedOrders.length / totalCars) * 100) : 0;

  const stats = [
    { label: "Cars Washed", value: String(totalCars), icon: Car, color: "text-primary" },
    { label: "Revenue", value: formatPrice(revenue), icon: Wallet, color: "text-success" },
    { label: "Avg Wait Time", value: `${avgWait}m`, icon: Clock, color: "text-warning" },
    { label: "Completion", value: `${conversionRate}%`, icon: TrendingUp, color: "text-info" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="glass-card p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <stat.icon className={`w-5 h-5 ${stat.color}`} />
          </div>
          <p className="stat-value text-foreground">{stat.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
        </div>
      ))}
    </div>
  );
};
