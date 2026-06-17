import { useLiveQuery } from "dexie-react-hooks";
import { db, type BaseRow, type MirroredTable } from "./db";

/** Live-query a mirrored table, scoped to a tenant. Returns `undefined`
 *  while Dexie is loading the initial result. */
export function useLiveTable<T extends BaseRow = BaseRow>(
  tenantId: string | null | undefined,
  table: MirroredTable,
): T[] | undefined {
  return useLiveQuery(async () => {
    if (!tenantId) return [];
    return (await (db as any)[table].where("tenant_id").equals(tenantId).toArray()) as T[];
  }, [tenantId, table]);
}
