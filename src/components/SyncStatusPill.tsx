import { useEffect, useState, useCallback } from "react";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  AlertTriangle,
  Trash2,
  HardDrive,
  RotateCw,
  X,
} from "lucide-react";
import {
  onSyncStatus,
  forceResync,
  getOutboxItems,
  retryOutboxItem,
  discardOutboxItem,
  retryAllOutbox,
  clearLocalCache,
  pruneLocalCache,
  getStorageEstimate,
} from "@/offline/sync";
import type { OutboxItem } from "@/offline/db";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

type State = {
  status: "idle" | "pulling" | "online" | "offline" | "error";
  pending: number;
  lastError?: string | null;
};

function formatBytes(n?: number) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SyncStatusPill({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ status: "idle", pending: 0 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => onSyncStatus(setState), []);

  const refresh = useCallback(async () => {
    const [o, s] = await Promise.all([getOutboxItems(100), getStorageEstimate()]);
    setItems(o);
    setStorage(s);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [open, refresh]);

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

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const failed = items.filter((i) => i.attempts > 0 || i.last_error);
  const usagePct =
    storage?.usage != null && storage?.quota
      ? Math.min(100, Math.round((storage.usage / storage.quota) * 100))
      : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:opacity-90",
            isOffline && "border-muted bg-muted/40 text-muted-foreground",
            isError && "border-destructive/40 bg-destructive/10 text-destructive",
            !isOffline && !isError && "border-success/30 bg-success/15 text-success",
            className,
          )}
          title={state.lastError ?? undefined}
        >
          <Icon className={cn("h-3.5 w-3.5", isPulling && "animate-spin")} />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="border-b p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Sync</div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              isOffline && "bg-muted text-muted-foreground",
              isError && "bg-destructive/10 text-destructive",
              !isOffline && !isError && "bg-success/15 text-success",
            )}>
              {status === "online" && pending === 0 ? "Up to date" : label}
            </span>
          </div>
          {state.lastError && (
            <p className="mt-1.5 break-words text-[11px] text-destructive">{state.lastError}</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy !== null}
              onClick={() => run("resync", forceResync, "Resync started")}
            >
              <RotateCw className={cn("mr-1.5 h-3.5 w-3.5", busy === "resync" && "animate-spin")} />
              Force resync
            </Button>
            {pending > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => run("retryAll", retryAllOutbox, "Retrying queued changes")}
              >
                Retry all
              </Button>
            )}
          </div>
        </div>

        <div className="border-b p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
            <span>Sync issues</span>
            <span className="text-muted-foreground">
              {pending} pending{failed.length ? ` · ${failed.length} failing` : ""}
            </span>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">All changes are synced.</p>
          ) : (
            <ScrollArea className="h-[160px] pr-2">
              <ul className="space-y-1.5">
                {items.map((it) => {
                  const isFailing = (it.attempts ?? 0) > 0 || !!it.last_error;
                  return (
                    <li
                      key={it.id}
                      className={cn(
                        "rounded-md border p-2 text-[11px]",
                        isFailing ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {it.op} · {it.table}
                          </div>
                          <div className="text-muted-foreground">
                            {new Date(it.created_at).toLocaleTimeString()}
                            {it.attempts > 0 ? ` · ${it.attempts} attempt${it.attempts === 1 ? "" : "s"}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isFailing && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Retry now"
                              disabled={busy !== null}
                              onClick={() => run(`r${it.id}`, () => retryOutboxItem(it.id!), "Retrying")}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            title="Discard this change"
                            disabled={busy !== null}
                            onClick={() => run(`d${it.id}`, () => discardOutboxItem(it.id!), "Change discarded")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {it.last_error && (
                        <p className="mt-1 break-words text-destructive">{it.last_error}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>

        <div className="p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
            <span className="inline-flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" /> Local storage
            </span>
            <span className="text-muted-foreground">
              {storage
                ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
                : "—"}
            </span>
          </div>
          {usagePct != null && (
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full transition-all",
                  usagePct > 85 ? "bg-destructive" : usagePct > 60 ? "bg-warning" : "bg-success",
                )}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy !== null}
              onClick={() =>
                run("prune", async () => {
                  const n = await pruneLocalCache();
                  toast.success(n > 0 ? `Pruned ${n} old rows` : "Nothing to prune");
                  return n;
                }, "Prune complete")
              }
            >
              Prune old data
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-destructive hover:text-destructive"
              disabled={busy !== null}
              onClick={() => {
                if (!confirm("Clear the local cache and re-download from the server? Pending changes are kept.")) return;
                void run("clear", clearLocalCache, "Local cache cleared");
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear cache
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
