import { useEffect } from "react";
import { useTenant } from "@/hooks/useTenant";
import { startSync, stopSync } from "@/offline/sync";

/** Mounted once near the app root. Starts the offline sync engine whenever
 *  the active tenant changes and tears it down on logout/unmount. */
export function SyncBoot() {
  const { tenant } = useTenant();
  useEffect(() => {
    if (!tenant?.id) { stopSync(); return; }
    void startSync(tenant.id);
    return () => { stopSync(); };
  }, [tenant?.id]);
  return null;
}
