import { useMemo, useState } from "react";
import { Printer, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  buildReceiptModel,
  renderReceiptBytes,
  sendToPrinter,
  isBluetoothSupported,
  getSavedPrinterName,
} from "@/lib/thermalPrinter";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import { useReceiptSettings } from "@/hooks/useReceiptSettings";
import { useCurrency } from "@/hooks/useCurrency";
import type { WashOrder } from "@/hooks/useOrders";

interface Props {
  order: WashOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ReceiptPreviewDialog = ({ order, open, onOpenChange }: Props) => {
  const { settings } = useReceiptSettings();
  const { currency } = useCurrency();
  const [busy, setBusy] = useState(false);
  const savedName = getSavedPrinterName();

  const model = useMemo(() => {
    if (!order) return [];
    return buildReceiptModel(order, {
      settings,
      currencySymbol: currency.symbol,
      vatPercent: currency.vatEnabled ? currency.vatPercent : 0,
    });
  }, [order, settings, currency]);

  if (!order) return null;

  const handlePrint = async () => {
    if (!isBluetoothSupported()) {
      toast.error("Bluetooth printing not supported", {
        description: "Open this app in Chrome on Android/desktop, or Bluefy on iOS.",
      });
      return;
    }
    setBusy(true);
    try {
      const name = await sendToPrinter(renderReceiptBytes(model));
      toast.success(`Receipt sent to ${name}`);
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Receipt preview · {order.orderNumber}</DialogTitle>
          <DialogDescription>
            Exact thermal print preview (80mm).{" "}
            {savedName ? (
              <span className="text-foreground">Will send to <b>{savedName}</b>.</span>
            ) : (
              <span>No printer paired yet — you'll be prompted to choose one.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto py-2 bg-muted/40 rounded-md">
          <ReceiptPreview model={model} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {busy ? "Sending…" : "Send to printer"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
