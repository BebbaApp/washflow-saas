import { useLiveQuery } from "dexie-react-hooks";
import { useRef } from "react";
import { db, type BaseRow, type MirroredTable } from "./db";
import { perfMark } from "@/lib/perf";

/** Live-query a mirrored table, scoped to a tenant. Returns `undefined`
 *  while Dexie is loading the initial result. */
export function useLiveTable<T extends BaseRow = BaseRow>(
  tenantId: string | null | undefined,
  table: MirroredTable,
): T[] | undefined {
  const loggedRef = useRef(false);
  const startRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  const result = useLiveQuery(async () => {
    if (!tenantId) return [];
    const t0 = performance.now();
    const rows = (await (db as any)[table].where("tenant_id").equals(tenantId).toArray()) as T[];
    const dur = performance.now() - t0;
    if (!loggedRef.current) {
      loggedRef.current = true;
      perfMark(`dexie:first-read:${table} (${rows.length} rows, query ${dur.toFixed(0)}ms, since mount ${(performance.now() - startRef.current).toFixed(0)}ms)`);
    }
    return rows;
  }, [tenantId, table]);
  return result;
}

