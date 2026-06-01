/**
 * IndexedDB layer for offline support.
 *
 * Two roles:
 *   1. Read-through cache: every successful Supabase fetch mirrors rows here
 *      so the app can render today's data with no connectivity.
 *   2. Outbox: mutations created while offline are queued here and drained
 *      by syncRunner.ts when the tablet comes back online.
 *
 * Only the orders flow uses the outbox in this phase. Other tables (inventory,
 * customers, services, …) are cached read-only — writes still require network.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "aquawash-offline";
const DB_VERSION = 1;

// Cache stores — one per Supabase table we want available offline.
export type CacheStoreName =
  | "orders"
  | "services"
  | "customers"
  | "inventory_items";

// Outbox kinds — discriminator for syncRunner.
export type OutboxKind = "order.create";

export interface OutboxItem {
  id: string;            // client-generated; also used as the order id for order.create
  kind: OutboxKind;
  payload: any;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const caches: CacheStoreName[] = [
          "orders",
          "services",
          "customers",
          "inventory_items",
        ];
        for (const name of caches) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "id" });
          }
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

// --- Cache API ---------------------------------------------------------

export async function cachePutAll<T extends { id: string }>(
  store: CacheStoreName,
  rows: T[],
) {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  const tx = db.transaction(store, "readwrite");
  await tx.objectStore(store).clear();
  for (const row of rows) await tx.objectStore(store).put(row);
  await tx.done;
}

export async function cachePut<T extends { id: string }>(
  store: CacheStoreName,
  row: T,
) {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.put(store, row);
}

export async function cacheDelete(store: CacheStoreName, id: string) {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.delete(store, id);
}

export async function cacheGetAll<T = any>(store: CacheStoreName): Promise<T[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await getDb();
    return (await db.getAll(store)) as T[];
  } catch {
    return [];
  }
}

// --- Outbox API --------------------------------------------------------

export async function outboxAdd(item: OutboxItem) {
  const db = await getDb();
  await db.put("outbox", item);
}

export async function outboxList(): Promise<OutboxItem[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await getDb();
    return (await db.getAll("outbox")) as OutboxItem[];
  } catch {
    return [];
  }
}

export async function outboxRemove(id: string) {
  const db = await getDb();
  await db.delete("outbox", id);
}

export async function outboxUpdate(item: OutboxItem) {
  const db = await getDb();
  await db.put("outbox", item);
}

export async function outboxCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const db = await getDb();
    return await db.count("outbox");
  } catch {
    return 0;
  }
}
