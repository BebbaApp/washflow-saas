import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OwnerTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_id: string | null;
  trial_ends_at: string | null;
  grace_period_ends_at: string | null;
  current_period_end: string | null;
  tenant_id: string;
  my_role: string;
  revenue: number;
  expenses: number;
  orders_count: number;
  completed_count: number;
  avg_wait_minutes: number;
  top_service: string | null;
  today_revenue: number;
  today_orders: number;
  workers_total: number;
  workers_on_shift: number;
  inventory_low: number;
}

export function useOwnerOverview(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["owner-overview", range?.from ?? null, range?.to ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("owner-overview", {
        body: range ?? {},
      });
      if (error) throw error;
      return (data ?? { tenants: [] }) as { tenants: OwnerTenantSummary[]; range: { from: string; to: string } };
    },
    staleTime: 60_000,
  });
}
