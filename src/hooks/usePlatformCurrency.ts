import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "aquawash-platform-currency";
let cached: string | null =
  typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
let inflight: Promise<string> | null = null;
const subs = new Set<(c: string) => void>();

async function fetchOnce(): Promise<string> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.functions.invoke("platform-admin", {
      body: { action: "get_platform_settings" },
    });
    const c = (data as any)?.settings?.currency || cached || "USD";
    if (c !== cached) {
      cached = c;
      try { localStorage.setItem(STORAGE_KEY, c); } catch {}
      subs.forEach((fn) => fn(c));
    }
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
  useEffect(() => {
    let mounted = true;
    const sub = (c: string) => mounted && setCurrency(c);
    subs.add(sub);
    fetchOnce().then((c) => mounted && setCurrency(c));
    return () => {
      mounted = false;
      subs.delete(sub);
    };
  }, []);
  const format = (amount: number) => formatPlatformAmount(amount, currency);
  return { currency, format, ready: cached !== null };
}
