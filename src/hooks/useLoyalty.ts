import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useLiveTable } from "@/offline/useLiveTable";
import { supabase } from "@/integrations/supabase/client";

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
const FREE_WASH_COST = 100;

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
    if (!tenant?.id) { toast.error("No workspace selected."); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      id,
      tenant_id: tenant.id,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      loyalty_points: 0,
      total_washes: 0,
      created_at: now,
    };
    await (db as any).customers.put({ ...payload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "customers", op: "insert", payload });
    toast.success(`Customer ${data.name} added`);
  }, [tenant?.id]);

  const earnPoints = useCallback(async (customerId: string, orderId?: string) => {
    if (!tenant?.id) return;
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;

    // Add loyalty transaction to local DB
    const txnId = crypto.randomUUID();
    const now = new Date().toISOString();
    const txnPayload = {
      id: txnId,
      tenant_id: tenant.id,
      customer_id: customerId,
      order_id: orderId || null,
      points: POINTS_PER_WASH,
      type: "earned",
      description: `Earned ${POINTS_PER_WASH} points for wash`,
      created_at: now,
    };
    await (db as any).loyalty_transactions.put({ ...txnPayload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "loyalty_transactions", op: "insert", payload: txnPayload });

    // Update customer points locally
    const existingCustomer = await (db as any).customers.get(customerId);
    if (existingCustomer) {
      const newPoints = (existingCustomer.loyalty_points ?? 0) + POINTS_PER_WASH;
      const newWashes = (existingCustomer.total_washes ?? 0) + 1;
      const customerUpdate = { id: customerId, loyalty_points: newPoints, total_washes: newWashes, updated_at: now };
      await (db as any).customers.put({ ...existingCustomer, ...customerUpdate, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "customers", op: "update", payload: customerUpdate });

      // SMS notification — only when online (non-blocking)
      const newPointsTotal = newPoints;
      if (customer.phone && navigator.onLine) {
        let milestone: string | null = null;
        if (newPointsTotal >= FREE_WASH_COST && customer.loyaltyPoints < FREE_WASH_COST) milestone = "free_wash";
        else if (newPointsTotal >= FREE_WASH_COST / 2 && customer.loyaltyPoints < FREE_WASH_COST / 2) milestone = "halfway";
        if (milestone) {
          supabase.functions.invoke("send-loyalty-sms", {
            body: { phone: customer.phone, customerName: customer.name, points: newPointsTotal, milestone },
          }).then(({ error }) => {
            if (!error) toast.info("📱 Loyalty SMS sent to " + customer.name);
          });
        }
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

    const txnId = crypto.randomUUID();
    const now = new Date().toISOString();
    const txnPayload = {
      id: txnId,
      tenant_id: tenant.id,
      customer_id: customerId,
      order_id: null,
      points: FREE_WASH_COST,
      type: "redeemed",
      description: "Redeemed for free wash",
      created_at: now,
    };
    await (db as any).loyalty_transactions.put({ ...txnPayload, _dirty: 1, _op: "insert" });
    await enqueueOutbox({ tenant_id: tenant.id, table: "loyalty_transactions", op: "insert", payload: txnPayload });

    const existingCustomer = await (db as any).customers.get(customerId);
    if (existingCustomer) {
      const newPoints = Math.max(0, (existingCustomer.loyalty_points ?? 0) - FREE_WASH_COST);
      const customerUpdate = { id: customerId, loyalty_points: newPoints, updated_at: now };
      await (db as any).customers.put({ ...existingCustomer, ...customerUpdate, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "customers", op: "update", payload: customerUpdate });
    }

    toast.success("🎉 Free wash redeemed!");
  }, [customers, tenant?.id]);

  const refetch = useCallback(async () => { /* sync engine handles it */ }, []);

  return { customers, loading, addCustomer, earnPoints, redeemPoints, POINTS_PER_WASH, FREE_WASH_COST, refetch };
}
