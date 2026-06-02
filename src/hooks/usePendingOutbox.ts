import { useEffect, useState } from "react";
import { outboxList } from "@/lib/offlineDb";
import { subscribeSyncStatus, drainOutbox } from "@/lib/syncRunner";
import { toast } from "sonner";

/**
 * Returns a Set of inventory item ids that currently have a queued
 * `inventory.consume` entry in the offline outbox.
 */
export function usePendingInventoryItemIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const items = await outboxList();
      if (cancelled) return;
      const next = new Set<string>();
      for (const it of items) {
        if (it.kind !== "inventory.consume") continue;
        const lines: Array<{ itemId: string }> = it.payload?.lines ?? [];
        for (const ln of lines) if (ln.itemId) next.add(ln.itemId);
      }
      setIds(next);
    };

    refresh();
    const unsub = subscribeSyncStatus(() => refresh());
    const interval = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(interval);
    };
  }, []);

  return ids;
}

/**
 * Returns a Set of order ids that currently have a queued
 * `inventory.consume` entry pending — used to render a per-order
 * "Inventory queued" chip on the Orders page.
 */
export function usePendingInventoryOrderIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const items = await outboxList();
      if (cancelled) return;
      const next = new Set<string>();
      for (const it of items) {
        if (it.kind !== "inventory.consume") continue;
        const orderId = it.payload?.orderId;
        if (orderId) next.add(orderId);
      }
      setIds(next);
    };

    refresh();
    const unsub = subscribeSyncStatus(() => refresh());
    const interval = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(interval);
    };
  }, []);

  return ids;
}

/**
 * Manually trigger a drain of the outbox. Shows a toast describing the
 * outcome so the user gets feedback whether anything moved.
 */
export async function retryPendingSync(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    toast.error("You're offline — reconnect to sync queued changes.");
    return;
  }
  const before = (await outboxList()).length;
  if (before === 0) {
    toast.info("Nothing queued to sync.");
    return;
  }
  toast.message("Retrying sync…");
  await drainOutbox();
  const after = (await outboxList()).length;
  if (after === 0) {
    toast.success("All queued changes synced.");
  } else if (after < before) {
    toast.warning(`${before - after} synced, ${after} still pending. Will retry.`);
  } else {
    toast.error("Sync still failing. Check connection and try again.");
  }
}
