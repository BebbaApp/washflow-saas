import { useEffect, useState, useCallback } from "react";
import { getDefaultReceiptSettings, type ReceiptSettings } from "@/lib/thermalPrinter";

const STORAGE_KEY = "aquawash-receipt-settings";

function load(): ReceiptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultReceiptSettings();
    const parsed = JSON.parse(raw);
    return { ...getDefaultReceiptSettings(), ...parsed };
  } catch {
    return getDefaultReceiptSettings();
  }
}

/**
 * Project-wide receipt copy used by the thermal printer + preview.
 * Stored in localStorage; broadcast across tabs via the 'storage' event.
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const def = getDefaultReceiptSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(def));
    setSettings(def);
  }, []);

  return { settings, update, reset };
}
