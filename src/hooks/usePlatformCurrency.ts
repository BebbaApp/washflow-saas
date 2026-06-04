import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "aquawash-platform-currency";
const READY_KEY = "aquawash-platform-currency-ready";
let cached: string | null =
  typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
let resolved: boolean =
  typeof window !== "undefined" && localStorage.getItem(READY_KEY) === "1";
let inflight: Promise<string> | null = null;
const subs = new Set<(c: string, ready: boolean) => void>();

async function fetchOnce(): Promise<string> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.functions.invoke("platform-admin", {
      body: { action: "get_platform_settings" },
    });
    const c = (data as any)?.settings?.currency || cached || "USD";
    const changed = c !== cached || !resolved;
    cached = c;
    resolved = true;
    try {
      localStorage.setItem(STORAGE_KEY, c);
      localStorage.setItem(READY_KEY, "1");
    } catch {}
    if (changed) subs.forEach((fn) => fn(c, true));
    return c;
  })();
  return inflight;
}

export function getCachedPlatformCurrency(): string {
  return cached ?? "USD";
}

export function formatPlatformAmount(amount: number, currency?: string): string {
  const c = currency ?? cached ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${c} ${amount.toFixed(2)}`;
  }
}

export function usePlatformCurrency() {
  const [currency, setCurrency] = useState<string>(cached ?? "USD");
  const [ready, setReady] = useState<boolean>(resolved);
  useEffect(() => {
    let mounted = true;
    const sub = (c: string, r: boolean) => {
      if (!mounted) return;
      setCurrency(c);
      setReady(r);
    };
    subs.add(sub);
    fetchOnce().then((c) => {
      if (!mounted) return;
      setCurrency(c);
      setReady(true);
    });
    return () => {
      mounted = false;
      subs.delete(sub);
    };
  }, []);
  const format = (amount: number) =>
    ready ? formatPlatformAmount(amount, currency) : "—";
  return { currency, format, ready };
}
