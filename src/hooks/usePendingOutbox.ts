import { useEffect, useState } from "react";
import { outboxList } from "@/lib/offlineDb";
import { subscribeSyncStatus } from "@/lib/syncRunner";

/**
 * Returns a Set of inventory item ids that currently have a queued
 * `inventory.consume` entry in the offline outbox. Used to render a
 * "Queued" badge on the inventory page while a deduction is waiting
 * to be written through to Supabase.
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
    // syncRunner notifies on every drain — re-derive then.
    const unsub = subscribeSyncStatus(() => refresh());
    // Belt-and-braces: queue items added by other tabs/hooks don't always
    // notify; refresh every few seconds while mounted.
    const interval = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(interval);
    };
  }, []);

  return ids;
}
