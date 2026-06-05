import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { onSyncStatus } from "@/offline/sync";
import { cn } from "@/lib/utils";

type State = { status: "idle" | "pulling" | "online" | "offline" | "error"; pending: number; lastError?: string | null };

export function SyncStatusPill({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ status: "idle", pending: 0 });
  useEffect(() => onSyncStatus(setState), []);

  const { status, pending } = state;
  const isOffline = status === "offline";
  const isError = status === "error";
  const isPulling = status === "pulling";

  const Icon = isOffline ? CloudOff : isError ? AlertTriangle : isPulling ? RefreshCw : Cloud;
  const label =
    isOffline ? (pending > 0 ? `Offline · ${pending} pending` : "Offline")
    : isError ? (pending > 0 ? `Sync issue · ${pending} pending` : "Sync issue")
    : isPulling ? "Syncing…"
    : pending > 0 ? `Syncing · ${pending} pending`
    : "Online";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        isOffline && "border-muted bg-muted/40 text-muted-foreground",
        isError && "border-destructive/40 bg-destructive/10 text-destructive",
        !isOffline && !isError && "border-border bg-background/60 text-muted-foreground",
        className,
      )}
      title={state.lastError ?? undefined}
    >
      <Icon className={cn("h-3.5 w-3.5", isPulling && "animate-spin")} />
      <span>{label}</span>
    </div>
  );
}
