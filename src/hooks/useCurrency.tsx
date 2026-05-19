import { useState, useEffect, createContext, useContext } from "react";

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
  const [currency, setCurrencyState] = useState<CurrencyConfig>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currency));
  }, [currency]);

  const setCurrency = (c: CurrencyConfig) => setCurrencyState(c);

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
