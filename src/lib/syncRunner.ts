/**
 * Drains the offline outbox when the tablet has connectivity.
 *
 * Currently handles:
 *   - "order.create": inserts the queued order into Supabase, assigning a
 *     real W-### order number at sync time. The client-generated UUID is
 *     reused as the row id so the optimistic local entry is reconciled by
 *     realtime/refetch in useOrders.
 *
 * Inventory deduction, loyalty, etc. still require connectivity in this phase.
 */
import { supabase } from "@/integrations/supabase/client";
import { outboxList, outboxRemove, outboxUpdate, type OutboxItem } from "./offlineDb";
import { toast } from "sonner";

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();

export function subscribeSyncStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function notify() {
  const items = await outboxList();
  listeners.forEach((l) => l(items.length));
}

let running = false;

export async function drainOutbox(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  running = true;
  try {
    const items = await outboxList();
    if (items.length === 0) return;

    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        await processItem(item);
        await outboxRemove(item.id);
        synced++;
      } catch (err: any) {
        failed++;
        await outboxUpdate({
          ...item,
          attempts: item.attempts + 1,
          lastError: err?.message ?? String(err),
        });
        console.error("[syncRunner] Failed to sync", item, err);
      }
    }

    if (synced > 0) {
      toast.success(
        `Synced ${synced} offline ${synced === 1 ? "change" : "changes"}.`,
      );
    }
    if (failed > 0) {
      toast.error(
        `${failed} offline ${failed === 1 ? "change" : "changes"} could not be synced yet. Will retry.`,
      );
    }
    await notify();
  } finally {
    running = false;
  }
}

async function processItem(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case "order.create": {
      // Get a real order number at sync time so it lands in the W-### sequence.
      const { data: orderNum, error: rpcErr } = await supabase.rpc("next_order_number");
      if (rpcErr) throw rpcErr;

      const { error } = await supabase.from("orders").insert({
        id: item.id, // reuse client UUID so realtime reconciles the local row
        order_number: orderNum || `W-${Date.now()}`,
        customer: item.payload.customer,
        customer_phone: item.payload.customerPhone?.trim() || null,
        vehicle: item.payload.vehicle,
        plate: item.payload.plate,
        service: item.payload.service,
        service_price: item.payload.servicePrice ?? 0,
        status: "waiting",
        // preserve original offline timestamp so wait_minutes math stays honest
        created_at: item.payload.createdAt,
      });
      if (error) throw error;
      return;
    }

    case "order.updateStatus": {
      const updates: {
        status: string;
        completed_at?: string;
        wait_minutes?: number;
      } = { status: item.payload.status };
      if (item.payload.completedAt) updates.completed_at = item.payload.completedAt;
      if (item.payload.waitMinutes != null) updates.wait_minutes = item.payload.waitMinutes;
      const { error } = await supabase
        .from("orders")
        .update(updates as any)
        .eq("id", item.payload.orderId);
      if (error) throw error;
      return;
    }

    case "inventory.consume": {
      // Apply each line as a fresh balance read + decrement + transaction insert.
      // Doing it at sync time (not snapshotting balance offline) keeps us
      // resilient to concurrent online activity on the same item.
      const lines: Array<{
        itemId: string;
        qty: number;
        itemName: string;
        source: string;
        notes?: string;
        flow?: string;
      }> = item.payload.lines ?? [];
      for (const line of lines) {
        const { data: row, error: readErr } = await supabase
          .from("inventory_items")
          .select("quantity")
          .eq("id", line.itemId)
          .maybeSingle();
        if (readErr) throw readErr;
        if (!row) continue; // item was deleted while offline — skip silently
        const newBalance = Math.max(0, Number(row.quantity) - line.qty);
        const { error: updErr } = await supabase
          .from("inventory_items")
          .update({ quantity: newBalance })
          .eq("id", line.itemId);
        if (updErr) throw updErr;
        const { error: txErr } = await supabase.from("inventory_transactions").insert({
          item_id: line.itemId,
          item_name: line.itemName,
          delta: -line.qty,
          balance: newBalance,
          type: "consume",
          source: line.source,
          notes: line.notes ?? null,
          flow: line.flow ?? "auto",
        });
        if (txErr) throw txErr;
      }
      return;
    }

    default:
      throw new Error(`Unknown outbox kind: ${(item as any).kind}`);
  }
}

/**
 * Mounts global listeners that drain the outbox whenever the tablet regains
 * connectivity, and on a slow poll as a belt-and-braces safety net.
 */
export function startSyncRunner(): () => void {
  const onOnline = () => {
    drainOutbox();
    notify();
  };
  window.addEventListener("online", onOnline);
  // Try once on mount in case we're already online with queued items.
  drainOutbox();
  notify();
  // Slow poll: catches the case where navigator.onLine missed a transition.
  const interval = window.setInterval(() => {
    if (navigator.onLine) drainOutbox();
  }, 30_000);
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(interval);
  };
}
