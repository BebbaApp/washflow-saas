import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { getDefaultReceiptSettings, type ReceiptSettings } from "@/lib/thermalPrinter";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useLiveTable } from "@/offline/useLiveTable";

type Row = {
  tenant_id: string;
  business_name: string;
  business_line2: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  footer: string;
  updated_at?: string;
};

function rowToSettings(row: Row): ReceiptSettings {
  return {
    businessName: row.business_name,
    businessLine2: row.business_line2,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    footer: row.footer,
  };
}

/**
 * Per-tenant receipt settings. Reads from the Dexie mirror so the form
 * renders instantly and stays in sync with realtime updates from other
 * tabs/devices. Writes go through Supabase; the sync engine reflects them
 * back into Dexie.
 */
export function useReceiptSettings() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const rows = useLiveTable<Row & { id: string }>(tenantId, "receipt_settings");

  const fromMirror = useMemo<ReceiptSettings>(() => {
    const row = (rows ?? [])[0];
    return row ? rowToSettings(row) : getDefaultReceiptSettings();
  }, [rows]);

  const [settings, setSettings] = useState<ReceiptSettings>(fromMirror);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Partial<ReceiptSettings>>({});
  const dirty = useRef(false);

  // Adopt the latest mirrored value whenever we don't have unflushed local edits.
  useEffect(() => {
    if (!dirty.current) setSettings(fromMirror);
  }, [fromMirror]);

  const flush = useCallback(async () => {
    if (!tenantId) return;
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    dirty.current = false;
    if (Object.keys(patch).length === 0) return;
    setStatus("saving");
    try {
      const row: Partial<Row> = { tenant_id: tenantId };
      if (patch.businessName !== undefined) row.business_name = patch.businessName;
      if (patch.businessLine2 !== undefined) row.business_line2 = patch.businessLine2;
      if (patch.footer !== undefined) row.footer = patch.footer;
      const { error: err } = await (supabase as any)
        .from("receipt_settings")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (err) throw err;
      setStatus("idle");
      setError(null);
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "Could not save receipt settings");
    }
  }, [tenantId]);

  const update = useCallback((patch: Partial<ReceiptSettings>) => {
    dirty.current = true;
    setSettings((prev) => ({ ...prev, ...patch }));
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { flush(); }, 600);
  }, [flush]);

  const reset = useCallback(async () => {
    const def = getDefaultReceiptSettings();
    dirty.current = true;
    setSettings(def);
    pendingPatch.current = { ...def };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await flush();
  }, [flush]);

  return { settings, update, reset, status, error };
}
