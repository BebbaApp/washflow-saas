import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomers = useCallback(async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setCustomers(data.map(mapCustomer));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const addCustomer = useCallback(async (data: { name: string; email?: string; phone?: string }) => {
    const { error } = await supabase.from("customers").insert({
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
    });

    if (error) {
      toast.error("Failed to add customer: " + error.message);
      return;
    }
    toast.success(`Customer ${data.name} added`);
    fetchCustomers();
  }, [fetchCustomers]);

  const earnPoints = useCallback(async (customerId: string, orderId?: string) => {
    // Add points
    const { error: txnError } = await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      order_id: orderId || null,
      points: POINTS_PER_WASH,
      type: "earned",
      description: `Earned ${POINTS_PER_WASH} points for wash`,
    });

    if (txnError) {
      toast.error("Failed to add points: " + txnError.message);
      return;
    }

    // Update customer totals
    const customer = customers.find((c) => c.id === customerId);
    if (customer) {
      await supabase.from("customers").update({
        loyalty_points: customer.loyaltyPoints + POINTS_PER_WASH,
        total_washes: customer.totalWashes + 1,
      }).eq("id", customerId);
    }

    const newPoints = (customer?.loyaltyPoints || 0) + POINTS_PER_WASH;

    // Send SMS milestone notifications
    if (customer?.phone) {
      let milestone: string | null = null;
      if (newPoints >= FREE_WASH_COST && (customer.loyaltyPoints || 0) < FREE_WASH_COST) {
        milestone = "free_wash";
      } else if (newPoints >= FREE_WASH_COST / 2 && (customer.loyaltyPoints || 0) < FREE_WASH_COST / 2) {
        milestone = "halfway";
      }

      if (milestone) {
        // Fire-and-forget SMS
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
    fetchCustomers();
  }, [customers, fetchCustomers]);

  const redeemPoints = useCallback(async (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer || customer.loyaltyPoints < FREE_WASH_COST) {
      toast.error("Not enough points for a free wash");
      return;
    }

    const { error: txnError } = await supabase.from("loyalty_transactions").insert({
      customer_id: customerId,
      points: FREE_WASH_COST,
      type: "redeemed",
      description: "Redeemed for free wash",
    });

    if (txnError) {
      toast.error("Failed to redeem: " + txnError.message);
      return;
    }

    await supabase.from("customers").update({
      loyalty_points: customer.loyaltyPoints - FREE_WASH_COST,
    }).eq("id", customerId);

    toast.success("🎉 Free wash redeemed!");
    fetchCustomers();
  }, [customers, fetchCustomers]);

  return {
    customers,
    loading,
    addCustomer,
    earnPoints,
    redeemPoints,
    POINTS_PER_WASH,
    FREE_WASH_COST,
    refetch: fetchCustomers,
  };
}
