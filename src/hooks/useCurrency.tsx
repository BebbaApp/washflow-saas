import { useState, useEffect, createContext, useContext, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

export interface CurrencyConfig {
  symbol: string;
  code: string;
  vatPercent: number;
  vatEnabled: boolean;
}

const DEFAULT: CurrencyConfig = {
  symbol: "R",
  code: "ZAR",
  vatPercent: 15,
  vatEnabled: false,
};

const STORAGE_KEY = "aquawash-currency";

const CurrencyContext = createContext<{
  currency: CurrencyConfig;
  setCurrency: (c: CurrencyConfig) => void;
  formatPrice: (price: number) => string;
  calcVat: (price: number) => number;
  calcTotal: (price: number) => number;
}>({
  currency: DEFAULT,
  setCurrency: () => {},
  formatPrice: (p) => p.toFixed(2),
  calcVat: () => 0,
  calcTotal: (p) => p,
});

export function useCurrency() {
  return useContext(CurrencyContext);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const [currency, setCurrencyState] = useState<CurrencyConfig>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  const hydratedFor = useRef<string | null>(null);

  // Hydrate from DB when tenant becomes available
  useEffect(() => {
    if (!tenant?.id || hydratedFor.current === tenant.id) return;
    hydratedFor.current = tenant.id;
    (async () => {
      const { data, error } = await supabase
        .from("tenant_settings")
        .select("currency_symbol, currency_code, vat_percent, vat_enabled")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error || !data) return;
      const next: CurrencyConfig = {
        symbol: data.currency_symbol ?? DEFAULT.symbol,
        code: data.currency_code ?? DEFAULT.code,
        vatPercent: Number(data.vat_percent ?? DEFAULT.vatPercent),
        vatEnabled: !!data.vat_enabled,
      };
      setCurrencyState(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    })();
  }, [tenant?.id]);

  const setCurrency = (c: CurrencyConfig) => {
    setCurrencyState(c);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
    if (tenant?.id) {
      supabase
        .from("tenant_settings")
        .upsert({
          tenant_id: tenant.id,
          currency_symbol: c.symbol,
          currency_code: c.code,
          vat_percent: c.vatPercent,
          vat_enabled: c.vatEnabled,
        }, { onConflict: "tenant_id" })
        .then(({ error }) => {
          if (error) console.warn("Failed to persist currency settings:", error.message);
        });
    }
  };

  const formatPrice = (price: number) => `${currency.symbol}${price.toFixed(2)}`;

  const calcVat = (price: number) =>
    currency.vatEnabled ? +(price * currency.vatPercent / 100).toFixed(2) : 0;

  const calcTotal = (price: number) =>
    currency.vatEnabled ? +(price + price * currency.vatPercent / 100).toFixed(2) : price;

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice, calcVat, calcTotal }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const CURRENCY_PRESETS = [
  { symbol: "R", code: "ZAR", label: "South African Rand (R)" },
  { symbol: "$", code: "USD", label: "US Dollar ($)" },
  { symbol: "€", code: "EUR", label: "Euro (€)" },
  { symbol: "£", code: "GBP", label: "British Pound (£)" },
  { symbol: "¥", code: "JPY", label: "Japanese Yen (¥)" },
  { symbol: "₹", code: "INR", label: "Indian Rupee (₹)" },
  { symbol: "A$", code: "AUD", label: "Australian Dollar (A$)" },
  { symbol: "C$", code: "CAD", label: "Canadian Dollar (C$)" },
];
