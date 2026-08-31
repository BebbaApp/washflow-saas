import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { phoneDigits } from "@/lib/phone";
import type { WashOrder } from "@/hooks/useOrders";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";


export const POINTS_PER_WASH = 10;
export const FREE_WASH_COST = 100;

const phoneKey = (p?: string | null) => {
  const d = phoneDigits(p);
  return d ? d.slice(-9) : "";
};
const nameKey = (n?: string | null) => (n ?? "").trim().toLowerCase();
const plateKey = (p?: string | null) => (p ?? "").replace(/\s+/g, "").toUpperCase();
// Loyalty identity = the VEHICLE. The plate is the one field staff capture
// consistently, so washes accumulate per normalized plate regardless of how
// the customer name or phone number was typed on each visit.
const groupKey = (o: { customer?: string | null; customerPhone?: string | null; plate?: string | null }) => {
  const pl = plateKey(o.plate);
  if (pl) return `plate:${pl}`;
  // Walk-ins with no plate captured still accumulate by phone.
  const p = phoneKey(o.customerPhone);
  return p ? `phone:${p}` : "";
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
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [redeemedOrderIds, setRedeemedOrderIds] = useState<Set<string>>(new Set());
  const [redeemedTxns, setRedeemedTxns] = useState<Array<{ order_id: string | null; points: number }>>([]);
  const [customerLookup, setCustomerLookup] = useState<CustomerLookup>({ byPhone: {}, byName: {} });
  const autoRedeemedRef = useRef<Set<string>>(new Set()); // in-flight guard

  const refresh = async () => {
    const [{ data: txns }, { data: custs }] = await Promise.all([
      supabase.from("loyalty_transactions").select("customer_id, order_id, points, type"),
      supabase.from("customers").select("id, name, phone"),
    ]);
    const orderIds = new Set<string>();
    const redeemed: Array<{ order_id: string | null; points: number }> = [];
    for (const r of txns || []) {
      if (r.type === "redeemed") {
        redeemed.push({ order_id: r.order_id, points: Math.abs(r.points) });
        if (r.order_id) orderIds.add(r.order_id);
      }
    }
    setRedeemedTxns(redeemed);
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
  // Redemptions are attributed to a group via the order they were tagged with,
  // so a free wash on car A only reduces car A's balance, not car B's.
  const redemptionsByGroupKey = useMemo(() => {
    const orderKeyById = new Map<string, string>();
    for (const o of orders) {
      const k = groupKey(o);
      if (k) orderKeyById.set(o.id, k);
    }
    const acc: Record<string, number> = {};
    for (const t of redeemedTxns) {
      if (!t.order_id) continue;
      const k = orderKeyById.get(t.order_id);
      if (!k) continue;
      acc[k] = (acc[k] || 0) + t.points;
    }
    return acc;
  }, [orders, redeemedTxns]);

  // Progress per active order: how many qualifying washes toward next free wash
  // (e.g. { current: 9, target: 10 } — completed washes for this vehicle after
  // accounting for redemptions already applied).
  const progressByOrderId = useMemo(() => {
    const map = new Map<string, { current: number; target: number }>();
    const target = FREE_WASH_COST / POINTS_PER_WASH; // washes per free wash
    const active = orders.filter((o) => o.status === "waiting" || o.status === "in-progress");
    for (const o of active) {
      const k = groupKey(o);
      if (!k) continue;
      const group = groups.get(k);
      const earned = (group?.length ?? 0) * POINTS_PER_WASH;
      const redeemed = redemptionsByGroupKey[k] || 0;
      const balancePoints = Math.max(0, earned - redeemed);
      const current = Math.min(target, Math.floor(balancePoints / POINTS_PER_WASH));
      map.set(o.id, { current, target });
    }
    return map;
  }, [orders, groups, redemptionsByGroupKey]);

  const eligibleOrderIds = useMemo(() => {
    const eligible = new Set<string>();
    for (const [id, p] of progressByOrderId) {
      if (p.current >= p.target) eligible.add(id);
    }
    return eligible;
  }, [progressByOrderId]);



  // Manual redemption: staff open the order and press "Apply FREE WASH".
  // Inserts one redemption tagged with the order (idempotent) and zeroes the
  // order's remaining price into its discount.
  const applyFreeWash = async (o: WashOrder): Promise<boolean> => {
    if (!eligibleOrderIds.has(o.id) || redeemedOrderIds.has(o.id)) return false;
    if (autoRedeemedRef.current.has(o.id)) return false;
    if (!tenant?.id) {
      toast.error("Could not apply free wash — no active workspace.");
      return false;
    }
    autoRedeemedRef.current.add(o.id);

    // Redemption runs server-side: the client's active_tenant_id JWT claim can
    // be stale, which makes the direct customer/loyalty inserts fail RLS.
    const { data, error } = await supabase.functions.invoke("apply-free-wash", {
      body: { tenant_id: tenant.id, order_id: o.id, points: FREE_WASH_COST },
    });
    const errMsg = (error as any)?.message ?? (data as any)?.error;
    if (error || (data as any)?.error) {
      autoRedeemedRef.current.delete(o.id);
      console.error("[useRewardEligibility] redeem failed", errMsg);
      toast.error(`Could not apply free wash: ${errMsg ?? "unknown error"}`);
      return false;
    }


    // Reflect the zeroed price locally right away (server is authoritative,
    // sync will confirm on the next pull).
    try {
      const local: any = await db.orders.get(o.id);
      if (local && Number(local.service_price) > 0) {
        await db.orders.put({
          ...local,
          discount: +(Number(local.discount ?? 0) + Number(local.service_price)).toFixed(2),
          service_price: 0,
        });
      }
    } catch {
      // ignore — remote state already updated
    }

    toast.success(`🎁 Free wash applied for ${o.customer} (${o.orderNumber})`);
    await refresh();
    return true;

  };

  return { eligibleOrderIds, redeemedOrderIds, progressByOrderId, applyFreeWash, refresh };
}

