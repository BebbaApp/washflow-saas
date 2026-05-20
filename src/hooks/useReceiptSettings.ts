import { useEffect, useState, useCallback, useRef } from "react";
import { getDefaultReceiptSettings, type ReceiptSettings } from "@/lib/thermalPrinter";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

const STORAGE_PREFIX = "aquawash-receipt-settings"; // per-tenant local cache

type Row = {
  tenant_id: string;
  business_name: string;
  business_line2: string;
  footer: string;
  updated_at?: string;
};

function rowToSettings(row: Row): ReceiptSettings {
  return {
    businessName: row.business_name,
    businessLine2: row.business_line2,
    footer: row.footer,
  };
}

function cacheKey(tenantId: string | null) {
  return tenantId ? `${STORAGE_PREFIX}:${tenantId}` : null;
}

function loadCache(tenantId: string | null): ReceiptSettings {
  const key = cacheKey(tenantId);
  if (!key) return getDefaultReceiptSettings();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return getDefaultReceiptSettings();
    return { ...getDefaultReceiptSettings(), ...JSON.parse(raw) };
  } catch {
    return getDefaultReceiptSettings();
  }
}

function writeCache(tenantId: string | null, s: ReceiptSettings) {
  const key = cacheKey(tenantId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(s)); } catch {}
}

/**
 * Per-tenant receipt settings (`public.receipt_settings`, PK tenant_id).
 * LocalStorage mirrors the active-tenant value for instant render and
 * offline tolerance. Realtime updates broadcast to other tabs/devices.
 */
export function useReceiptSettings() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const [settings, setSettings] = useState<ReceiptSettings>(() => loadCache(tenantId));
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Partial<ReceiptSettings>>({});

  // Re-hydrate cache + fetch when active tenant changes
  useEffect(() => {
    setSettings(loadCache(tenantId));
    if (!tenantId) { setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const { data, error: err } = await (supabase as any)
          .from("receipt_settings")
          .select("tenant_id, business_name, business_line2, footer, updated_at")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (err) throw err;
        if (data) {
          const next = rowToSettings(data as Row);
          setSettings(next);
          writeCache(tenantId, next);
        }
        setStatus("idle");
        setError(null);
      } catch (e: any) {
        if (!cancelled) {
          setStatus("error");
          setError(e?.message || "Could not load receipt settings");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Realtime subscription (per tenant)
  useEffect(() => {
    if (!tenantId) return;
    const chanName = `receipt_settings_${tenantId}_${Math.random().toString(36).slice(2, 8)}`;
    const ch = (supabase as any)
      .channel(chanName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "receipt_settings", filter: `tenant_id=eq.${tenantId}` },
        (payload: any) => {
          const row = payload?.new as Row | undefined;
          if (!row) return;
          const next = rowToSettings(row);
          setSettings(next);
          writeCache(tenantId, next);
        },
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [tenantId]);

  const flush = useCallback(async () => {
    if (!tenantId) return;
    const patch = pendingPatch.current;
    pendingPatch.current = {};
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
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeCache(tenantId, next);
      return next;
    });
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { flush(); }, 600);
  }, [flush, tenantId]);

  const reset = useCallback(async () => {
    const def = getDefaultReceiptSettings();
    setSettings(def);
    writeCache(tenantId, def);
    pendingPatch.current = { ...def };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await flush();
  }, [flush, tenantId]);

  return { settings, update, reset, status, error };
}
