import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { drainOutbox, subscribeSyncStatus } from "@/lib/syncRunner";
import { outboxCount } from "@/lib/offlineDb";
import { cn } from "@/lib/utils";

/**
 * Persistent badge that surfaces:
 *   - "Offline" pill when the tablet has no connectivity
 *   - "N pending sync" pill when offline-created records are waiting to upload
 *
 * Tap to manually retry a sync.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    outboxCount().then(setPending);
    const unsub = subscribeSyncStatus(setPending);
    return () => { unsub(); };
  }, []);

  // Auto-attempt a drain whenever we come back online
  useEffect(() => {
    if (online && pending > 0) {
      drainOutbox();
    }
  }, [online, pending]);

  if (online && pending === 0) return null;

  const label = !online
    ? "Offline — changes will sync when reconnected"
    : pending > 0
      ? `Syncing ${pending} pending change${pending === 1 ? "" : "s"}…`
      : "Synced";

  return (
    <button
      type="button"
      onClick={() => online && drainOutbox()}
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium",
        "shadow-lg border backdrop-blur",
        !online
          ? "bg-destructive/90 text-destructive-foreground border-destructive"
          : "bg-primary/90 text-primary-foreground border-primary",
      )}
      aria-live="polite"
    >
      {!online ? (
        <CloudOff className="w-4 h-4" />
      ) : pending > 0 ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : (
        <CheckCircle2 className="w-4 h-4" />
      )}
      <span>{label}</span>
    </button>
  );
}
