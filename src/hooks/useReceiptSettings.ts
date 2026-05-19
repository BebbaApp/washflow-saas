import { useEffect, useState, useCallback } from "react";
import { getDefaultReceiptSettings, type ReceiptSettings } from "@/lib/thermalPrinter";

const STORAGE_KEY = "aquawash-receipt-settings";

function load(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultReceiptSettings();
    return { ...getDefaultReceiptSettings(), ...JSON.parse(raw) };
  } catch {
    return getDefaultReceiptSettings();
  }
}

/**
 * Receipt content is persisted in the browser's localStorage and kept until
 * the user changes it (or hits Reset). Changes broadcast across tabs via the
 * native 'storage' event.
 */
export function useReceiptSettings() {
  const [settings, setSettings] = useState<ReceiptSettings>(load);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setSettings(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<ReceiptSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const def = getDefaultReceiptSettings();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setSettings(def);
  }, []);

  // Kept for API compatibility with the previous DB-backed version.
  const status = "idle" as const;
  const error: string | null = null;

  return { settings, update, reset, status, error };
}
