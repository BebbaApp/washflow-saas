import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useLiveTable } from "@/offline/useLiveTable";

export type WashStatus = "waiting" | "in-progress" | "completed" | "cancelled";

export interface WashOrder {
  id: string;
  orderNumber: string;
  customer: string;
  customerPhone?: string;
  vehicle: string;
  plate: string;
  service: string;
  servicePrice: number;
  discount?: number;
  status: WashStatus;
  createdAt: string;
  completedAt?: string;
  waitMinutes?: number;
  notes?: string;
}

// Legacy fallbacks for old "basic|premium|detail" service ids. Real prices now
// come from the Services tab and are passed in by NewOrderDialog.
const LEGACY_LABELS: Record<string, string> = { basic: "Basic Wash", premium: "Premium Wash", detail: "Full Detail" };
const LEGACY_PRICES: Record<string, number> = { basic: 15, premium: 35, detail: 75 };

function mapRow(row: any): WashOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customer: row.customer,
    customerPhone: row.customer_phone ?? undefined,
    vehicle: row.vehicle,
    plate: row.plate,
    service: row.service,
    servicePrice: Number(row.service_price),
    discount: Number(row.discount ?? 0),
    status: row.status as WashStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    waitMinutes: row.wait_minutes ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export function useOrders() {
  const { tenant } = useTenant();
  const rows = useLiveTable<any>(tenant?.id, "orders");
  const loading = rows === undefined;

  const orders = useMemo<WashOrder[]>(() => {
    const list = (rows ?? []).map(mapRow);
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list;
  }, [rows]);

  const addOrder = useCallback(
    async (data: { customer: string; customerPhone?: string; vehicle: string; plate: string; service: string; servicePrice?: number; discount?: number }) => {
      if (!tenant?.id) {
        toast.error("No workspace selected.");
        return null;
      }
      const serviceLabel = LEGACY_LABELS[data.service] ?? data.service;
      const basePrice =
        typeof data.servicePrice === "number"
          ? data.servicePrice
          : LEGACY_PRICES[data.service] ?? 0;
      const discount = Math.max(0, Math.min(Number(data.discount) || 0, basePrice));
      const servicePrice = +(basePrice - discount).toFixed(2);

      // Try to get a sequential order number when online; fall back to a local
      // placeholder offline so the row is still usable until sync resolves it.
      let orderNum: string | null = null;
      try {
        const { data: rpc } = await supabase.rpc("next_order_number");
        if (rpc) orderNum = rpc as unknown as string;
      } catch {
        /* offline */
      }
      if (!orderNum) {
        // Offline: continue the W-XXX sequence using a "WO-XXX" prefix so the
        // reference is visibly distinct from server-issued numbers. We seed
        // from the highest known order_number in the local mirror (server
        // W-### + offline WO-###) so it picks up where the last reference
        // left off. The sync engine swaps WO-XXX for a canonical W-XXX from
        // next_order_number() on reconnect.
        const allLocal = await db.orders.toArray();
        let highest = 0;
        for (const r of allLocal as any[]) {
          const m = String(r?.order_number ?? "").match(/^(?:W|WO)-(\d+)$/i);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > highest) highest = n;
          }
        }
        const key = `__wf_offline_wo_seq_${tenant.id}`;
        const stored = Number(localStorage.getItem(key) || "0");
        const seq = Math.max(highest, stored) + 1;
        localStorage.setItem(key, String(seq));
        orderNum = `WO-${String(seq).padStart(3, "0")}`;
      }

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const payload = {
        id,
        tenant_id: tenant.id,
        order_number: orderNum,
        customer: data.customer,
        customer_phone: data.customerPhone?.trim() || null,
        vehicle: data.vehicle,
        plate: data.plate,
        service: serviceLabel,
        service_price: servicePrice,
        status: "waiting" as const,
        created_at: nowIso,
        updated_at: nowIso,
      };

      await db.orders.put({ ...payload, _dirty: 1, _op: "insert" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "insert", payload });
      toast.success(`Order created for ${data.customer}`);
      return mapRow(payload);
    },
    [tenant?.id],
  );

  const updateStatus = useCallback(
    async (orderId: string, newStatus: WashStatus) => {
      if (!tenant?.id) return;
      const existing = (await db.orders.get(orderId)) as any;
      if (!existing) return;

      const patch: any = { status: newStatus, updated_at: new Date().toISOString() };
      if (newStatus === "completed") {
        patch.completed_at = new Date().toISOString();
        patch.wait_minutes = Math.round((Date.now() - new Date(existing.created_at as string).getTime()) / 60000);
      }

      const merged = { ...existing, ...patch };
      await db.orders.put({ ...merged, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "update", payload: { id: orderId, ...patch } });

      toast.info(
        `📱 ${(existing as any).customer}: ${(existing as any).vehicle} is now "${newStatus === "in-progress" ? "In Progress" : newStatus === "completed" ? "Completed" : "Waiting"}"`,
        { description: "Status updated", duration: 4000 },
      );
    },
    [tenant?.id],
  );

  const updateNotes = useCallback(
    async (orderId: string, notes: string) => {
      if (!tenant?.id) return false;
      const existing = await db.orders.get(orderId);
      if (!existing) return false;
      const trimmed = notes.trim();
      const value = trimmed.length ? trimmed : null;
      const merged: any = { ...existing, notes: value, updated_at: new Date().toISOString() };
      await db.orders.put({ ...merged, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "update", payload: { id: orderId, notes: value, updated_at: merged.updated_at } });
      toast.success("Notes saved");
      return true;
    },
    [tenant?.id],
  );

  return { orders, addOrder, updateStatus, updateNotes, loading };
}
