import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BackupRow {
  id: string;
  tenant_id: string;
  created_at: string;
  kind: "nightly" | "manual" | "pre_restore";
  row_counts: Record<string, number>;
  size_bytes: number;
  storage_path: string | null;
  checksum: string | null;
}

export interface HealthRow {
  id: string;
  tenant_id: string;
  checked_at: string;
  status: "ok" | "warning" | "critical";
  findings: Array<{ check: string; count: number; sample?: any }>;
}

/** Reads backup metadata for a tenant via the backup-tenants function response,
 *  falling back to direct table reads through the service-role edge functions. */
export function useTenantBackups(tenantId: string | null) {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      // These tables deny anon/authenticated — read through an edge function.
      const { data, error } = await supabase.functions.invoke("list-tenant-backups", {
        body: { tenant_id: tenantId },
      });
      if (error) throw error;
      setBackups((data?.backups ?? []) as BackupRow[]);
      setHealth((data?.health ?? []) as HealthRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load backups");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { refresh(); }, [refresh]);

  const runManualBackup = useCallback(async () => {
    if (!tenantId) return;
    const { error } = await supabase.functions.invoke("backup-tenants", {
      body: { tenant_id: tenantId, kind: "manual" },
    });
    if (error) throw error;
    await refresh();
  }, [tenantId, refresh]);

  const restore = useCallback(async (backupId: string, confirmSlug: string) => {
    const { error } = await supabase.functions.invoke("restore-tenant", {
      body: { backup_id: backupId, confirm_slug: confirmSlug },
    });
    if (error) throw error;
    await refresh();
  }, [refresh]);

  const exportJson = useCallback(async (backupId?: string) => {
    if (!tenantId) return;
    const { data, error } = await supabase.functions.invoke("export-tenant", {
      body: { tenant_id: tenantId, backup_id: backupId },
    });
    if (error) throw error;
    const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tenantId}-export-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [tenantId]);

  return { backups, health, loading, error, refresh, runManualBackup, restore, exportJson };
}
