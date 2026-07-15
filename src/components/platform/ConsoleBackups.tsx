import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantBackups, type BackupRow } from "@/hooks/useTenantBackups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Download, RefreshCw, Play, AlertTriangle, ShieldAlert } from "lucide-react";

interface TenantOpt { id: string; name: string; slug: string; }

function humanBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B","KB","MB","GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function ConsoleBackups() {
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [selected, setSelected] = useState<string>("");
  const { backups, health, loading, error, refresh, runManualBackup, restore, exportJson } =
    useTenantBackups(selected || null);
  const [running, setRunning] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState<BackupRow | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [restoring, setRestoring] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("tenants").select("id, name, slug").order("name");
      const list = (data ?? []) as TenantOpt[];
      setTenants(list);
      if (list.length && !selected) setSelected(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTenant = useMemo(() => tenants.find((t) => t.id === selected), [tenants, selected]);
  const latestHealth = health[0];

  const handleRunBackup = async () => {
    setRunning(true);
    try {
      await runManualBackup();
      toast({ title: "Backup created" });
    } catch (e: any) {
      toast({ title: "Backup failed", description: e?.message ?? "", variant: "destructive" });
    } finally { setRunning(false); }
  };

  const handleRestore = async () => {
    if (!restoreOpen) return;
    setRestoring(true);
    try {
      await restore(restoreOpen.id, confirmSlug);
      toast({ title: "Restore complete", description: "Clients will refresh their local cache." });
      setRestoreOpen(null); setConfirmSlug("");
    } catch (e: any) {
      toast({ title: "Restore failed", description: e?.message ?? "", variant: "destructive" });
    } finally { setRestoring(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <label className="text-xs text-muted-foreground">Workspace</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full h-9 px-2 rounded-md bg-background border border-border text-sm"
          >
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <Button size="sm" onClick={handleRunBackup} disabled={running || !selected} className="gap-2">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run backup now
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportJson()} disabled={!selected} className="gap-2">
          <Download className="w-4 h-4" /> Export live snapshot
        </Button>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {latestHealth && (
        <div className={`glass-card p-4 border ${
          latestHealth.status === "critical" ? "border-destructive/40" :
          latestHealth.status === "warning" ? "border-warning/40" : "border-success/40"
        }`}>
          <div className="flex items-center gap-2">
            {latestHealth.status === "ok"
              ? <Badge className="bg-success/10 text-success border-success/30" variant="outline">Healthy</Badge>
              : latestHealth.status === "warning"
              ? <><AlertTriangle className="w-4 h-4 text-warning" /><Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">Warning</Badge></>
              : <><ShieldAlert className="w-4 h-4 text-destructive" /><Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Critical</Badge></>}
            <span className="text-xs text-muted-foreground">
              Last checked {new Date(latestHealth.checked_at).toLocaleString([], { hour12: false })}
            </span>
          </div>
          {latestHealth.findings.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {latestHealth.findings.map((f, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="font-mono text-xs">{f.check}</span>
                  <span className="text-muted-foreground text-xs">{f.count} row(s)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Snapshots</h3>
          <span className="text-xs text-muted-foreground">{backups.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2">Created</th>
                <th className="text-left px-4 py-2">Kind</th>
                <th className="text-right px-4 py-2">Size</th>
                <th className="text-right px-4 py-2">Rows</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => {
                const totalRows = Object.values(b.row_counts ?? {}).reduce((s, n) => s + Number(n || 0), 0);
                return (
                  <tr key={b.id} className="border-t border-border/40">
                    <td className="px-4 py-2 font-mono text-xs">{new Date(b.created_at).toLocaleString([], { hour12: false })}</td>
                    <td className="px-4 py-2 capitalize">{b.kind.replace("_"," ")}</td>
                    <td className="px-4 py-2 text-right">{humanBytes(b.size_bytes)}</td>
                    <td className="px-4 py-2 text-right">{totalRows}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => exportJson(b.id)} className="gap-1">
                          <Download className="w-3.5 h-3.5" /> Download
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRestoreOpen(b)}>Restore…</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!backups.length && !loading && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-sm">
                  No snapshots yet. Run a manual backup to create one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!restoreOpen} onOpenChange={(o) => { if (!o) { setRestoreOpen(null); setConfirmSlug(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This deletes all current data for <b>{selectedTenant?.name}</b> and replaces it with the snapshot from{" "}
              <b>{restoreOpen && new Date(restoreOpen.created_at).toLocaleString([], { hour12: false })}</b>.
              A pre-restore snapshot is taken automatically.
            </p>
            <p className="text-xs text-muted-foreground">
              Type the workspace slug <code className="bg-muted px-1 rounded">{selectedTenant?.slug}</code> to confirm:
            </p>
            <Input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} placeholder={selectedTenant?.slug} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={restoring || confirmSlug !== selectedTenant?.slug}
              className="gap-2"
            >
              {restoring && <Loader2 className="w-4 h-4 animate-spin" />} Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
