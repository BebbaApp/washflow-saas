import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { phoneDigits } from "@/lib/phone";
import type { WashOrder } from "@/hooks/useOrders";
import { toast } from "sonner";

export const POINTS_PER_WASH = 10;
export const FREE_WASH_COST = 100;

const phoneKey = (p?: string | null) => {
  const d = phoneDigits(p);
  return d ? d.slice(-9) : "";
};
const nameKey = (n?: string | null) => (n ?? "").trim().toLowerCase();
const plateKey = (p?: string | null) => (p ?? "").replace(/\s+/g, "").toUpperCase();
const groupKey = (o: { customer?: string | null; customerPhone?: string | null; plate?: string | null }) => {
  const p = phoneKey(o.customerPhone);
  const n = nameKey(o.customer);
  const pl = plateKey(o.plate);
  if (!p || !n || !pl) return "";
  return `${p}|${n}|${pl}`;
};

interface CustomerLookup {
  byPhone: Record<string, string>;
  byName: Record<string, string>;
}

/**
 * Computes which currently-active orders belong to a customer who has
 * earned a free-wash reward, and auto-redeems the reward once per order
 * (recording a `loyalty_transactions` row tagged with `order_id`).
 *
 * Returns the set of active order ids that are reward-eligible, so callers
 * can show a "FREE WASH" badge on Active cards.
 */
export function useRewardEligibility(orders: WashOrder[]) {
  const [redemptionsByCustomerId, setRedemptionsByCustomerId] = useState<Record<string, number>>({});
  const [redeemedOrderIds, setRedeemedOrderIds] = useState<Set<string>>(new Set());
  const [customerLookup, setCustomerLookup] = useState<CustomerLookup>({ byPhone: {}, byName: {} });
  const autoRedeemedRef = useRef<Set<string>>(new Set()); // in-flight guard

  const refresh = async () => {
    const [{ data: txns }, { data: custs }] = await Promise.all([
      supabase.from("loyalty_transactions").select("customer_id, order_id, points, type"),
      supabase.from("customers").select("id, name, phone"),
    ]);
    const acc: Record<string, number> = {};
    const orderIds = new Set<string>();
    for (const r of txns || []) {
      if (r.type === "redeemed") {
        acc[r.customer_id] = (acc[r.customer_id] || 0) + Math.abs(r.points);
        if (r.order_id) orderIds.add(r.order_id);
      }
    }
    setRedemptionsByCustomerId(acc);
    setRedeemedOrderIds(orderIds);

    const byPhone: Record<string, string> = {};
    const byName: Record<string, string> = {};
    for (const c of custs || []) {
      const p = phoneKey(c.phone);
      if (p) byPhone[p] = c.id;
      const n = nameKey(c.name);
      if (n && !byName[n]) byName[n] = c.id;
    }
    setCustomerLookup({ byPhone, byName });
  };

  useEffect(() => {
    refresh();
  }, []);

  // Group completed orders by exact (phone + name + plate) fingerprint.
  // A customer must return the SAME vehicle with the same phone & name
  // to accumulate points toward a free wash for that vehicle.
  const groups = useMemo(() => {
    const completed = orders.filter((o) => o.status === "completed");
    const map = new Map<string, WashOrder[]>();
    for (const o of completed) {
      const k = groupKey(o);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return map;
  }, [orders]);

  // For each active order, find the matching completed-customer+vehicle group
  // and check whether the balance is enough for a free wash.
  const eligibleOrderIds = useMemo(() => {
    const eligible = new Set<string>();
    const active = orders.filter((o) => o.status === "waiting" || o.status === "in-progress");
    if (active.length === 0) return eligible;

    for (const o of active) {
      const k = groupKey(o);
      if (!k) continue;
      const group = groups.get(k);
      if (!group || group.length === 0) continue;

      // Resolve customer_id (for redemption history) via phone/name lookup
      const customerId =
        customerLookup.byPhone[phoneKey(o.customerPhone)] ||
        customerLookup.byName[nameKey(o.customer)];

      const earned = group.length * POINTS_PER_WASH;
      const redeemed = customerId ? (redemptionsByCustomerId[customerId] || 0) : 0;
      const balance = Math.max(0, earned - redeemed);
      if (balance >= FREE_WASH_COST) eligible.add(o.id);
    }
    return eligible;
  }, [orders, groups, customerLookup, redemptionsByCustomerId]);

  // Auto-redeem: when an active order is eligible and no redemption is yet
  // recorded against this order, insert one (idempotent).
  useEffect(() => {
    const active = orders.filter((o) => o.status === "waiting" || o.status === "in-progress");
    const candidates = active.filter(
      (o) =>
        eligibleOrderIds.has(o.id) &&
        !redeemedOrderIds.has(o.id) &&
        !autoRedeemedRef.current.has(o.id),
    );
    if (candidates.length === 0) return;

    (async () => {
      for (const o of candidates) {
        autoRedeemedRef.current.add(o.id);

        // Resolve / create a customers row to attach the transaction to.
        let customerId =
          customerLookup.byPhone[phoneKey(o.customerPhone)] ||
          customerLookup.byName[nameKey(o.customer)];

        if (!customerId) {
          const { data, error } = await supabase
            .from("customers")
            .insert({ name: o.customer, phone: o.customerPhone || null })
            .select("id")
            .single();
          if (error || !data) {
            autoRedeemedRef.current.delete(o.id);
            continue;
          }
          customerId = data.id;
        }

        const { error } = await supabase.from("loyalty_transactions").insert({
          customer_id: customerId,
          order_id: o.id,
          points: FREE_WASH_COST,
          type: "redeemed",
          description: `Auto-redeemed free wash on order ${o.orderNumber}`,
        });
        if (error) {
          // Postgres unique_violation (23505) means another tab/device beat us
          // to the redemption — that's the intended idempotency path, not an
          // error worth surfacing.
          const isDuplicate = (error as any).code === "23505";
          if (!isDuplicate) {
            autoRedeemedRef.current.delete(o.id);
            console.error("[useRewardEligibility] auto-redeem failed", error);
          }
          continue;
        }

        // Zero out the order's revenue: move remaining service_price into discount.
        if (o.servicePrice > 0) {
          const { data: current } = await supabase
            .from("orders")
            .select("service_price, discount")
            .eq("id", o.id)
            .maybeSingle();
          const currentPrice = Number(current?.service_price ?? o.servicePrice) || 0;
          const currentDiscount = Number(current?.discount ?? 0) || 0;
          if (currentPrice > 0) {
            await supabase
              .from("orders")
              .update({
                service_price: 0,
                discount: +(currentDiscount + currentPrice).toFixed(2),
              })
              .eq("id", o.id);
          }
        }

        toast.success(`🎁 Free wash auto-applied for ${o.customer} (${o.orderNumber})`);
      }
      await refresh();
    })();
  }, [orders, eligibleOrderIds, redeemedOrderIds, customerLookup]);

  return { eligibleOrderIds, redeemedOrderIds, refresh };
}
