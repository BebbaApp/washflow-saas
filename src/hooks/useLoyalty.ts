import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loyaltyPoints: number;
  totalWashes: number;
  createdAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  orderId: string | null;
  points: number;
  type: "earned" | "redeemed";
  description: string | null;
  createdAt: string;
}

const POINTS_PER_WASH = 10;
const FREE_WASH_COST = 100; // 10 washes = 100 points = 1 free wash

function mapCustomer(row: any): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    loyaltyPoints: row.loyalty_points,
    totalWashes: row.total_washes,
    createdAt: row.created_at,
  };
}

export function useLoyalty() {
  const { tenant } = useTenant();
  const rows = useLiveTable<any>(tenant?.id, "customers");
  const loading = rows === undefined;

  const customers = useMemo<Customer[]>(() => {
    const list = (rows ?? []).map(mapCustomer);
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  }, [rows]);

  const addCustomer = useCallback(async (data: { name: string; email?: string; phone?: string }) => {
    if (!tenant?.id) {
      toast.error("No workspace selected.");
      return;
    }
    const { error } = await supabase.from("customers").insert({
      tenant_id: tenant.id,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
    } as any);

    if (error) {
      toast.error("Failed to add customer: " + error.message);
      return;
    }
    toast.success(`Customer ${data.name} added`);
  }, [tenant?.id]);

  const earnPoints = useCallback(async (customerId: string, orderId?: string) => {
    if (!tenant?.id) return;
    const { error: txnError } = await supabase.from("loyalty_transactions").insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      order_id: orderId || null,
      points: POINTS_PER_WASH,
      type: "earned",
      description: `Earned ${POINTS_PER_WASH} points for wash`,
    } as any);

    if (txnError) {
      toast.error("Failed to add points: " + txnError.message);
      return;
    }

    const customer = customers.find((c) => c.id === customerId);
    if (customer) {
      await supabase.from("customers").update({
        loyalty_points: customer.loyaltyPoints + POINTS_PER_WASH,
        total_washes: customer.totalWashes + 1,
      }).eq("id", customerId);
    }

    const newPoints = (customer?.loyaltyPoints || 0) + POINTS_PER_WASH;

    if (customer?.phone) {
      let milestone: string | null = null;
      if (newPoints >= FREE_WASH_COST && (customer.loyaltyPoints || 0) < FREE_WASH_COST) {
        milestone = "free_wash";
      } else if (newPoints >= FREE_WASH_COST / 2 && (customer.loyaltyPoints || 0) < FREE_WASH_COST / 2) {
        milestone = "halfway";
      }

      if (milestone) {
        supabase.functions.invoke("send-loyalty-sms", {
          body: {
            phone: customer.phone,
            customerName: customer.name,
            points: newPoints,
            milestone,
          },
        }).then(({ error }) => {
          if (error) console.error("SMS send failed:", error);
          else toast.info("📱 Loyalty SMS sent to " + customer.name);
        });
      }
    }

    toast.success(`+${POINTS_PER_WASH} loyalty points earned!`);
  }, [customers, tenant?.id]);

  const redeemPoints = useCallback(async (customerId: string) => {
    if (!tenant?.id) return;
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || customer.loyaltyPoints < FREE_WASH_COST) {
      toast.error("Not enough points for a free wash");
      return;
    }

    const { error: txnError } = await supabase.from("loyalty_transactions").insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      points: FREE_WASH_COST,
      type: "redeemed",
      description: "Redeemed for free wash",
    } as any);

    if (txnError) {
      toast.error("Failed to redeem: " + txnError.message);
      return;
    }

    await supabase.from("customers").update({
      loyalty_points: customer.loyaltyPoints - FREE_WASH_COST,
    }).eq("id", customerId);

    toast.success("🎉 Free wash redeemed!");
  }, [customers, tenant?.id]);

  const refetch = useCallback(async () => { /* sync engine handles it */ }, []);

  return {
    customers,
    loading,
    addCustomer,
    earnPoints,
    redeemPoints,
    POINTS_PER_WASH,
    FREE_WASH_COST,
    refetch,
  };
}
