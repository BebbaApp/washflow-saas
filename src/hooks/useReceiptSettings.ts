import { useEffect, useState, useCallback, useRef } from "react";
import { getDefaultReceiptSettings, type ReceiptSettings } from "@/lib/thermalPrinter";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "aquawash-receipt-settings"; // local cache for instant render

type Row = {
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

function loadCache(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultReceiptSettings();
    return { ...getDefaultReceiptSettings(), ...JSON.parse(raw) };
  } catch {
    return getDefaultReceiptSettings();
  }
}

function writeCache(s: ReceiptSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

/**
 * Receipt settings are persisted in Supabase (`public.receipt_settings`,
 * singleton row id=true). Local storage mirrors the latest value so the UI
 * can render immediately on load and remain usable when offline.
 *
 * Updates are written back to the database; realtime changes broadcast to
 * other tabs/devices.
 */
export function useReceiptSettings() {
  const [settings, setSettings] = useState<ReceiptSettings>(loadCache);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const pendingPatch = useRef<Partial<ReceiptSettings>>({});

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: err } = await (supabase as any)
          .from("receipt_settings")
          .select("business_name, business_line2, footer, updated_at")
          .eq("id", true)
          .maybeSingle();
        if (cancelled) return;
        if (err) throw err;
        if (data) {
          const next = rowToSettings(data as Row);
          setSettings(next);
          writeCache(next);
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
  }, []);

  // Realtime subscription
  useEffect(() => {
    const chanName = `receipt_settings_changes_${Math.random().toString(36).slice(2, 10)}`;
    const ch = (supabase as any)
      .channel(chanName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "receipt_settings" },
        (payload: any) => {
          const row = payload?.new as Row | undefined;
          if (!row) return;
          const next = rowToSettings(row);
          setSettings(next);
          writeCache(next);
        },
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, []);

  const flush = useCallback(async () => {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    setStatus("saving");
    try {
      const row: Partial<Row> = {};
      if (patch.businessName !== undefined) row.business_name = patch.businessName;
      if (patch.businessLine2 !== undefined) row.business_line2 = patch.businessLine2;
      if (patch.footer !== undefined) row.footer = patch.footer;
      const { error: err } = await (supabase as any)
        .from("receipt_settings")
        .upsert({ id: true, ...row, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (err) throw err;
      setStatus("idle");
      setError(null);
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "Could not save receipt settings");
    }
  }, []);

  const update = useCallback((patch: Partial<ReceiptSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeCache(next);
      return next;
    });
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    // Debounce writes to avoid hammering the DB on every keystroke
    saveTimer.current = window.setTimeout(() => { flush(); }, 600);
  }, [flush]);

  const reset = useCallback(async () => {
    const def = getDefaultReceiptSettings();
    setSettings(def);
    writeCache(def);
    pendingPatch.current = { ...def };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    await flush();
  }, [flush]);

  return { settings, update, reset, status, error };
}
