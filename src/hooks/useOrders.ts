import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { cacheGetAll, cachePutAll, cachePut, cacheDelete, outboxAdd } from "@/lib/offlineDb";
import { drainOutbox } from "@/lib/syncRunner";

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
  status: WashStatus;
  createdAt: string;
  completedAt?: string;
  waitMinutes?: number;
  notes?: string;
  /** True for rows queued offline and not yet acknowledged by Supabase. */
  _pendingSync?: boolean;
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
    status: row.status as WashStatus,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    waitMinutes: row.wait_minutes ?? undefined,
    notes: row.notes ?? undefined,
    _pendingSync: row._pendingSync ?? false,
  };
}

// Convert a domain WashOrder -> the shape we cache in IndexedDB (mirrors the
// Supabase row layout so mapRow can round-trip).
function toCacheRow(o: WashOrder) {
  return {
    id: o.id,
    order_number: o.orderNumber,
    customer: o.customer,
    customer_phone: o.customerPhone ?? null,
    vehicle: o.vehicle,
    plate: o.plate,
    service: o.service,
    service_price: o.servicePrice,
    status: o.status,
    created_at: o.createdAt,
    completed_at: o.completedAt ?? null,
    wait_minutes: o.waitMinutes ?? null,
    notes: o.notes ?? null,
    _pendingSync: o._pendingSync ?? false,
  };
}

export function useOrders() {
  const [orders, setOrders] = useState<WashOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Fetch orders + subscribe to realtime (guarded against double-init)
  useEffect(() => {
    let cancelled = false;

    const hydrateFromCache = async () => {
      const cached = await cacheGetAll<any>("orders");
      if (!cancelled && cached.length > 0) {
        setOrders(
          cached
            .map(mapRow)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
        setLoading(false);
      }
    };

    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useOrders] Failed to fetch orders:", error);
        if (navigator.onLine) {
          toast.error("Could not load orders. Showing cached data.");
        }
      } else if (data && !cancelled) {
        const fresh = data.map(mapRow);
        setOrders((prev) => {
          // Preserve any locally-pending orders the server hasn't seen yet.
          const pending = prev.filter(
            (o) => o._pendingSync && !fresh.some((f) => f.id === o.id),
          );
          return [...pending, ...fresh];
        });
        // Mirror to IndexedDB for offline reads.
        cachePutAll("orders", fresh.map(toCacheRow)).catch((e) =>
          console.warn("[useOrders] cache mirror failed", e),
        );
      }
      if (!cancelled) setLoading(false);
    };

    // 1) Show whatever we have cached immediately (works offline)
    hydrateFromCache();
    // 2) Then refresh from network (will silently fail offline)
    fetchOrders();
    // 3) And drain any pending offline writes
    drainOutbox();

    // Guard: only create the channel once per hook instance
    if (channelRef.current) {
      console.warn("[useOrders] Realtime channel already exists, skipping re-subscribe");
    } else {
      const channelName = `orders-realtime-${crypto.randomUUID()}`;

      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          (payload) => {
            try {
              if (payload.eventType === "INSERT") {
                const row = mapRow(payload.new);
                setOrders((prev) => {
                  // If we already have an optimistic pending row with the same
                  // id, replace it in place (this is the sync reconciliation).
                  const idx = prev.findIndex((o) => o.id === row.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = row;
                    return next;
                  }
                  return [row, ...prev];
                });
                cachePut("orders", toCacheRow(row)).catch(() => {});
              } else if (payload.eventType === "UPDATE") {
                const row = mapRow(payload.new);
                setOrders((prev) =>
                  prev.map((o) => (o.id === row.id ? row : o)),
                );
                cachePut("orders", toCacheRow(row)).catch(() => {});
              } else if (payload.eventType === "DELETE") {
                setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
                cacheDelete("orders", payload.old.id).catch(() => {});
              }
            } catch (err) {
              console.error("[useOrders] Error handling realtime payload:", err, payload);
            }
          }
        )
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("[useOrders] Realtime subscription failed:", status, err);
          }
        });

      channelRef.current = channel;
    }

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current).catch((err) => {
          console.error("[useOrders] Error removing channel:", err);
        });
        channelRef.current = null;
      }
    };
  }, []);

  const addOrder = useCallback(
    async (data: { customer: string; customerPhone?: string; vehicle: string; plate: string; service: string; servicePrice?: number }) => {
      const serviceLabel = LEGACY_LABELS[data.service] ?? data.service;
      const servicePrice =
        typeof data.servicePrice === "number"
          ? data.servicePrice
          : LEGACY_PRICES[data.service] ?? 0;

      // ---------- OFFLINE PATH ------------------------------------------------
      // No network → queue to outbox, insert an optimistic local row with a
      // client UUID. When connectivity returns, syncRunner will insert it
      // server-side reusing the same id, and realtime INSERT will reconcile.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const clientId = crypto.randomUUID();
        const tempNumber = `W-OFF-${clientId.slice(0, 4).toUpperCase()}`;
        const createdAt = new Date().toISOString();
        const optimistic: WashOrder = {
          id: clientId,
          orderNumber: tempNumber,
          customer: data.customer,
          customerPhone: data.customerPhone,
          vehicle: data.vehicle,
          plate: data.plate,
          service: serviceLabel,
          servicePrice,
          status: "waiting",
          createdAt,
          _pendingSync: true,
        };

        await outboxAdd({
          id: clientId,
          kind: "order.create",
          payload: {
            customer: data.customer,
            customerPhone: data.customerPhone,
            vehicle: data.vehicle,
            plate: data.plate,
            service: serviceLabel,
            servicePrice,
            createdAt,
          },
          createdAt: Date.now(),
          attempts: 0,
        });

        setOrders((prev) => [optimistic, ...prev]);
        await cachePut("orders", toCacheRow(optimistic));

        toast.success(`Order saved offline for ${data.customer}`, {
          description: `Will sync when reconnected (${tempNumber})`,
        });
        return optimistic;
      }

      // ---------- ONLINE PATH (original behaviour) ---------------------------
      const { data: orderNum } = await supabase.rpc("next_order_number");

      const { data: row, error } = await supabase
        .from("orders")
        .insert({
          order_number: orderNum || `W-${Date.now()}`,
          customer: data.customer,
          customer_phone: data.customerPhone?.trim() || null,
          vehicle: data.vehicle,
          plate: data.plate,
          service: serviceLabel,
          service_price: servicePrice,
          status: "waiting",
        })
        .select()
        .single();

      if (error) {
        toast.error("Failed to create order: " + error.message);
        return null;
      }

      toast.success(`Order created for ${data.customer}`);
      return mapRow(row);
    },
    []
  );

  const updateStatus = useCallback(async (orderId: string, newStatus: WashStatus) => {
    const prevOrder = orders.find((o) => o.id === orderId);
    if (!prevOrder) return;

    // Status changes on a still-pending offline order would race the outbox
    // insert. Keep this simple in Phase 2: require sync to finish first.
    if (prevOrder._pendingSync) {
      toast.error("This order is still syncing. Please wait until it appears with its real order number.");
      return;
    }

    const updates: any = { status: newStatus };
    const optimistic: Partial<WashOrder> = { status: newStatus };
    if (newStatus === "completed") {
      const completedAt = new Date().toISOString();
      const waitMinutes = Math.round((Date.now() - new Date(prevOrder.createdAt).getTime()) / 60000);
      updates.completed_at = completedAt;
      updates.wait_minutes = waitMinutes;
      optimistic.completedAt = completedAt;
      optimistic.waitMinutes = waitMinutes;
    }

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...optimistic } : o)));

    const { error } = await supabase.from("orders").update(updates).eq("id", orderId);

    if (error) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? prevOrder : o)));
      toast.error("Failed to update status: " + error.message);
      return;
    }

    toast.info(
      `📱 ${prevOrder.customer}: ${prevOrder.vehicle} is now "${newStatus === "in-progress" ? "In Progress" : newStatus === "completed" ? "Completed" : "Waiting"}"`,
      { description: "Status updated", duration: 4000 }
    );
  }, [orders]);

  const updateNotes = useCallback(async (orderId: string, notes: string) => {
    const prevOrder = orders.find((o) => o.id === orderId);
    if (!prevOrder) return false;
    if (prevOrder._pendingSync) {
      toast.error("This order is still syncing. Please wait before editing notes.");
      return false;
    }
    const trimmed = notes.trim();
    const value = trimmed.length ? trimmed : null;

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, notes: value ?? undefined } : o)));

    const { error } = await supabase.from("orders").update({ notes: value }).eq("id", orderId);
    if (error) {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? prevOrder : o)));
      toast.error("Failed to save notes: " + error.message);
      return false;
    }
    toast.success("Notes saved");
    return true;
  }, [orders]);

  return { orders, addOrder, updateStatus, updateNotes, loading };
}
