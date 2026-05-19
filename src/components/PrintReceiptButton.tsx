import { useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { printReceipt, isBluetoothSupported, getSavedPrinterName } from "@/lib/thermalPrinter";
import type { WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  order: WashOrder;
  variant?: "primary" | "ghost" | "compact";
  className?: string;
  label?: string;
}

export const PrintReceiptButton = ({ order, variant = "primary", className = "", label }: Props) => {
  const [busy, setBusy] = useState(false);
  const { currency } = useCurrency();
  const savedName = getSavedPrinterName();

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isBluetoothSupported()) {
      toast.error("Bluetooth printing not supported", {
        description: "Open this app in Chrome on Android/desktop, or Bluefy on iOS.",
      });
      return;
    }
    setBusy(true);
    try {
      const name = await printReceipt(order, {
        currencySymbol: currency.symbol,
        vatPercent: currency.vatEnabled ? currency.vatPercent : 0,
      });
      toast.success(`Receipt sent to ${name}`);
    } catch (err: any) {
      const msg = err?.message || "Failed to print receipt";
      if (/cancelled|user cancel/i.test(msg)) {
        // user dismissed picker — silent
      } else {
        toast.error("Print failed", { description: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  const text = label ?? (savedName ? `Print · ${savedName}` : "Print receipt");

  const styles =
    variant === "primary"
      ? "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      : variant === "compact"
        ? "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
        : "inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-60";

  return (
    <button type="button" onClick={handle} disabled={busy} className={`${styles} ${className}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
      {text}
    </button>
  );
};
