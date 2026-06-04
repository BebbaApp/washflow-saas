import { useState } from "react";
import { Printer } from "lucide-react";
import { ReceiptPreviewDialog } from "@/components/ReceiptPreviewDialog";
import { getSavedPrinterName } from "@/lib/thermalPrinter";
import type { WashOrder } from "@/hooks/useOrders";

interface Props {
  order: WashOrder;
  variant?: "primary" | "ghost" | "compact";
  className?: string;
  label?: string;
}

/** Opens the receipt preview; sending to printer happens from the preview. */
export const PrintReceiptButton = ({ order, variant = "primary", className = "", label }: Props) => {
  const [open, setOpen] = useState(false);
  const savedName = getSavedPrinterName();
  const text = label ?? (savedName ? `Print · ${savedName}` : "Print receipt");

  const styles =
    variant === "primary"
      ? "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
      : variant === "compact"
        ? "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        : "inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline";

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`${styles} ${className}`}
      >
        <Printer className="w-4 h-4" />
        {text}
      </button>
      <ReceiptPreviewDialog order={order} open={open} onOpenChange={setOpen} />
    </>
  );
};
