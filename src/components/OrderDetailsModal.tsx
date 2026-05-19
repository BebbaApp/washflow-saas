import { useEffect, useState } from "react";
import { Car, Hash, Phone, Clock, Calendar, StickyNote, CheckCircle2, Loader2, Play, Save, Loader, Receipt } from "lucide-react";
import { formatPhone, telHref } from "@/lib/phone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { WashOrder, WashStatus } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { PrintReceiptButton } from "@/components/PrintReceiptButton";

interface OrderDetailsModalProps {
  order: WashOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateStatus?: (id: string, status: WashStatus) => void;
  onUpdateNotes?: (id: string, notes: string) => Promise<boolean> | void;
}

const statusMeta: Record<WashStatus, { label: string; classes: string; Icon: typeof Clock }> = {
  waiting: { label: "Waiting", classes: "bg-warning/10 text-warning border-warning/20", Icon: Clock },
  "in-progress": { label: "In Progress", classes: "bg-info/10 text-info border-info/20", Icon: Loader2 },
  completed: { label: "Completed", classes: "bg-success/10 text-success border-success/20", Icon: CheckCircle2 },
  cancelled: { label: "Cancelled", classes: "bg-destructive/10 text-destructive border-destructive/20", Icon: Clock },
};

export const OrderDetailsModal = ({ order, open, onOpenChange, onUpdateStatus, onUpdateNotes }: OrderDetailsModalProps) => {
  const { formatPrice } = useCurrency();
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    setNotesDraft(order?.notes ?? "");
  }, [order?.id, order?.notes, open]);

  if (!order) return null;

  const meta = statusMeta[order.status];
  const created = new Date(order.createdAt);
  const completed = order.completedAt ? new Date(order.completedAt) : null;
  const nextStatus: WashStatus | null =
    order.status === "waiting" ? "in-progress" : order.status === "in-progress" ? "completed" : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-2xl font-bold tracking-tight truncate">
                {order.customer}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 mt-1">
                <Receipt className="w-3.5 h-3.5" />
                {order.orderNumber}
              </DialogDescription>
            </div>
            <span className={`status-badge border inline-flex items-center gap-1 ${meta.classes}`}>
              <meta.Icon className={`w-3 h-3 ${order.status === "in-progress" ? "animate-spin" : ""}`} />
              {meta.label}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                <Car className="w-3.5 h-3.5" /> Vehicle
              </p>
              <p className="text-sm font-semibold text-foreground truncate">{order.vehicle}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                <Hash className="w-3.5 h-3.5" /> Plate
              </p>
              <p className="text-sm font-semibold text-foreground font-mono truncate">{order.plate}</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
              <Phone className="w-3.5 h-3.5" /> Cellphone
            </p>
            {order.customerPhone ? (
              <a
                href={`tel:${telHref(order.customerPhone)}`}
                className="text-sm font-semibold text-foreground hover:text-primary hover:underline transition-colors"
              >
                {formatPhone(order.customerPhone)}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground italic">Not provided</p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-secondary/40 p-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{order.service}</p>
            <p className="text-base font-bold text-primary">{formatPrice(order.servicePrice)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                <Calendar className="w-3.5 h-3.5" /> Created
              </p>
              <p className="text-sm font-medium text-foreground">
                {created.toLocaleDateString()} · {created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
                <Clock className="w-3.5 h-3.5" />
                {completed ? "Completed in" : "Elapsed"}
              </p>
              <p className="text-sm font-medium text-foreground">
                {completed
                  ? `${order.waitMinutes ?? 0} min`
                  : `${Math.round((Date.now() - created.getTime()) / 60000)} min`}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5" /> Notes
              </p>
              {onUpdateNotes && notesDraft !== (order.notes ?? "") && (
                <button
                  disabled={savingNotes}
                  onClick={async () => {
                    setSavingNotes(true);
                    await onUpdateNotes(order.id, notesDraft);
                    setSavingNotes(false);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
                >
                  {savingNotes ? <Loader className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
              )}
            </div>
            {onUpdateNotes ? (
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Add notes for this job (e.g. extra attention to back seats)…"
                rows={3}
                className="w-full rounded-md bg-background border border-border px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {order.notes?.trim() ? order.notes : <span className="text-muted-foreground italic">No notes for this job.</span>}
              </p>
            )}
          </div>

          {onUpdateStatus && nextStatus && (
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => onOpenChange(false)}
                className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Close
              </button>
              <button
                onClick={() => {
                  onUpdateStatus(order.id, nextStatus);
                  if (nextStatus === "completed") onOpenChange(false);
                }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity ${
                  nextStatus === "completed"
                    ? "bg-success text-success-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {nextStatus === "completed" ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Mark Complete
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" /> Start Wash
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
