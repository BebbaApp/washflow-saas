import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/hooks/useTenant";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useLiveTable } from "@/offline/useLiveTable";

export type WashStatus = "waiting" | "in-progress" | "completed" | "cancelled" | "deleted";

export interface PendingDiscount {
  amount: number;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
}

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
  pendingDiscount?: PendingDiscount;
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
  const pd = row.pending_discount;
  const pendingDiscount: PendingDiscount | undefined =
    pd && typeof pd === "object" && typeof pd.amount === "number"
      ? {
          amount: Number(pd.amount),
          requestedById: String(pd.requested_by_id ?? ""),
          requestedByName: String(pd.requested_by_name ?? "Unknown"),
          requestedAt: String(pd.requested_at ?? row.created_at ?? new Date().toISOString()),
        }
      : undefined;
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
    pendingDiscount,
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
    async (data: {
      customer: string;
      customerPhone?: string;
      vehicle: string;
      plate: string;
      service: string;
      servicePrice?: number;
      discount?: number;
      pendingDiscount?: PendingDiscount;
    }) => {
      if (!tenant?.id) {
        toast.error("No workspace selected.");
        return null;
      }
      const serviceLabel = LEGACY_LABELS[data.service] ?? data.service;
      const basePrice =
        typeof data.servicePrice === "number"
          ? data.servicePrice
          : LEGACY_PRICES[data.service] ?? 0;
      const rawDiscount = Math.max(0, Math.min(Number(data.discount) || 0, basePrice));

      // If a pending-discount request is attached, DO NOT apply the discount:
      // the order stays at full price until a manager approves it.
      const hasPending = !!data.pendingDiscount && data.pendingDiscount.amount > 0;
      const discount = hasPending ? 0 : rawDiscount;
      const servicePrice = +(basePrice - discount).toFixed(2);
      const pendingPayload = hasPending
        ? {
            amount: Math.max(0, Math.min(Number(data.pendingDiscount!.amount) || 0, basePrice)),
            requested_by_id: data.pendingDiscount!.requestedById,
            requested_by_name: data.pendingDiscount!.requestedByName,
            requested_at: data.pendingDiscount!.requestedAt || new Date().toISOString(),
          }
        : null;

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
      const payload: any = {
        id,
        tenant_id: tenant.id,
        order_number: orderNum,
        customer: data.customer,
        customer_phone: data.customerPhone?.trim() || null,
        vehicle: data.vehicle,
        plate: data.plate,
        service: serviceLabel,
        service_price: servicePrice,
        discount,
        pending_discount: pendingPayload,
        status: "waiting" as const,
        created_at: nowIso,
        updated_at: nowIso,
      };

      await db.orders.put({ ...payload, _dirty: 1, _op: "insert" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "insert", payload });
      if (hasPending) {
        toast.success(
          `Order created at full price. Discount pending manager approval.`,
        );
      } else {
        toast.success(`Order created for ${data.customer}`);
      }
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
        // Completing without approval discards any pending discount request —
        // the record is finalised at the full amount that's already stored.
        if (existing.pending_discount) patch.pending_discount = null;
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

  const approveDiscount = useCallback(
    async (orderId: string, authorizer?: { id: string; name: string }) => {
      if (!tenant?.id) return false;
      const existing = (await db.orders.get(orderId)) as any;
      if (!existing) return false;
      const pd = existing.pending_discount;
      if (!pd || typeof pd !== "object" || typeof pd.amount !== "number") return false;

      const basePrice = Number(existing.service_price) + Number(existing.discount ?? 0);
      const amount = Math.max(0, Math.min(Number(pd.amount) || 0, basePrice));
      const newDiscount = +(Number(existing.discount ?? 0) + amount).toFixed(2);
      const newServicePrice = +(basePrice - newDiscount).toFixed(2);
      const nowIso = new Date().toISOString();

      const auditLine = `[DISCOUNT APPROVED ${nowIso.replace("T", " ").slice(0, 16)}] ${
        authorizer?.name ? `by ${authorizer.name}` : ""
      } — R${amount.toFixed(2)} (requested by ${pd.requested_by_name ?? "staff"})`.trim();
      const mergedNotes = existing.notes ? `${existing.notes}\n${auditLine}` : auditLine;

      const patch: any = {
        discount: newDiscount,
        service_price: newServicePrice,
        pending_discount: null,
        notes: mergedNotes,
        updated_at: nowIso,
      };
      const merged = { ...existing, ...patch };
      await db.orders.put({ ...merged, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "update", payload: { id: orderId, ...patch } });
      toast.success("Discount approved");
      return true;
    },
    [tenant?.id],
  );

  const rejectDiscount = useCallback(
    async (orderId: string, authorizer?: { id: string; name: string }) => {
      if (!tenant?.id) return false;
      const existing = (await db.orders.get(orderId)) as any;
      if (!existing || !existing.pending_discount) return false;
      const nowIso = new Date().toISOString();
      const auditLine = `[DISCOUNT REJECTED ${nowIso.replace("T", " ").slice(0, 16)}]${
        authorizer?.name ? ` by ${authorizer.name}` : ""
      }`;
      const mergedNotes = existing.notes ? `${existing.notes}\n${auditLine}` : auditLine;
      const patch: any = { pending_discount: null, notes: mergedNotes, updated_at: nowIso };
      const merged = { ...existing, ...patch };
      await db.orders.put({ ...merged, _dirty: 1, _op: "update" });
      await enqueueOutbox({ tenant_id: tenant.id, table: "orders", op: "update", payload: { id: orderId, ...patch } });
      toast.message("Discount request rejected");
      return true;
    },
    [tenant?.id],
  );

  return { orders, addOrder, updateStatus, updateNotes, approveDiscount, rejectDiscount, loading };
}

