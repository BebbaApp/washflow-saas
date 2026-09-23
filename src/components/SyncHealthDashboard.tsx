import { useEffect, useState } from "react";
import { db, type OutboxItem } from "@/offline/db";
import { getCompletedStats } from "@/offline/sync";
import { cn } from "@/lib/utils";

const isDup = (e?: string | null) => !!e && /duplicate key|23505|unique constraint/i.test(e);

function ago(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

export function SyncHealthDashboard() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [completed, setCompleted] = useState(getCompletedStats());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const all = await db.outbox.orderBy("created_at").toArray();
      if (alive) { setItems(all); setCompleted(getCompletedStats()); }
    };
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const failed = items.filter((i) => i.attempts > 0 || i.last_error);
  const pending = items.length - failed.length;
  const dups = items.filter((i) => isDup(i.last_error));
  const totalRetries = items.reduce((s, i) => s + (i.attempts || 0), 0);
  const maxRetries = items.reduce((m, i) => Math.max(m, i.attempts || 0), 0);
  const oldestBlocked = failed[0];

  const tiles = [
    { label: "Pending", value: pending, tone: "text-foreground" },
    { label: "Failed", value: failed.length, tone: failed.length ? "text-destructive" : "text-foreground" },
    { label: "Completed", value: completed.total, tone: "text-success" },
    { label: "Duplicate key", value: dups.length, tone: dups.length ? "text-destructive" : "text-foreground" },
    { label: "Total retries", value: totalRetries, tone: "text-foreground" },
    { label: "Max retries", value: maxRetries, tone: maxRetries >= 5 ? "text-warning" : "text-foreground" },
  ];

  return (
    <div className="border-b p-3 space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">Sync health</div>
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md bg-secondary px-2 py-1.5">
            <div className={cn("text-base font-bold leading-tight", t.tone)}>{t.value}</div>
            <div className="text-[10px] text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-md border px-2 py-1.5 text-[11px]">
        <div className="font-semibold">Oldest blocked job</div>
        {oldestBlocked ? (
          <div className="mt-0.5 space-y-0.5">
            <div>
              <span className="font-medium">{oldestBlocked.op} · {oldestBlocked.table}</span>
              <span className="text-muted-foreground"> — queued {ago(oldestBlocked.created_at)}, {oldestBlocked.attempts} retries</span>
            </div>
            {oldestBlocked.last_error && (
              <div className="break-words text-destructive">{oldestBlocked.last_error}</div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground">Nothing blocked</div>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">
        Completed count on this device since {new Date(completed.since).toLocaleDateString("en-GB")}
      </div>
    </div>
  );
}
