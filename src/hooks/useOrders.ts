import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";

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
  };
}

export function useOrders() {
  const [orders, setOrders] = useState<WashOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Fetch orders + subscribe to realtime (guarded against double-init)
  useEffect(() => {
    let cancelled = false;

    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useOrders] Failed to fetch orders:", error);
        toast.error("Could not load orders. Please refresh the page.");
      } else if (data && !cancelled) {
        setOrders(data.map(mapRow));
      }
      if (!cancelled) setLoading(false);
    };

    fetchOrders();

    // Guard: only create the channel once per hook instance
    if (channelRef.current) {
      console.warn("[useOrders] Realtime channel already exists, skipping re-subscribe");
    } else {
      const channelName = `orders-realtime-${crypto.randomUUID()}`;
      console.log(`[useOrders] Creating realtime channel: ${channelName}`);

      const channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders" },
          (payload) => {
            try {
              if (payload.eventType === "INSERT") {
                setOrders((prev) => [mapRow(payload.new), ...prev]);
              } else if (payload.eventType === "UPDATE") {
                setOrders((prev) =>
                  prev.map((o) => (o.id === payload.new.id ? mapRow(payload.new) : o))
                );
              } else if (payload.eventType === "DELETE") {
                setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
              }
            } catch (err) {
              console.error("[useOrders] Error handling realtime payload:", err, payload);
            }
          }
        )
        .subscribe((status, err) => {
          console.log(`[useOrders] Realtime status: ${status}`);
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("[useOrders] Realtime subscription failed:", status, err);
            toast.error("Live updates are unavailable. Refresh to see latest orders.");
          } else if (status === "SUBSCRIBED") {
            console.log("[useOrders] Realtime subscribed successfully");
          }
        });

      channelRef.current = channel;
    }

    return () => {
      cancelled = true;
      if (channelRef.current) {
        console.log("[useOrders] Cleaning up realtime channel");
        supabase.removeChannel(channelRef.current).catch((err) => {
          console.error("[useOrders] Error removing channel:", err);
        });
        channelRef.current = null;
      }
    };
  }, []);

  const addOrder = useCallback(
    async (data: { customer: string; customerPhone?: string; vehicle: string; plate: string; service: string; servicePrice?: number }) => {
      // Prefer the explicit name/price coming from the Services tab; fall back to
      // legacy keys for any caller still passing "basic|premium|detail".
      const serviceLabel = LEGACY_LABELS[data.service] ?? data.service;
      const servicePrice =
        typeof data.servicePrice === "number"
          ? data.servicePrice
          : LEGACY_PRICES[data.service] ?? 0;

      // Get next order number via RPC
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

    // Optimistic UI update
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...optimistic } : o)));

    const { error } = await supabase.from("orders").update(updates).eq("id", orderId);

    if (error) {
      // Roll back
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
