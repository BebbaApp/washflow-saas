import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { useTenant } from "@/hooks/useTenant";
import type { WashOrder } from "@/hooks/useOrders";

interface EditOrderDialogProps {
  order: WashOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export const EditOrderDialog = ({ order, open, onOpenChange, onSaved }: EditOrderDialogProps) => {
  const [form, setForm] = useState({
    customer: "",
    customer_phone: "",
    vehicle: "",
    plate: "",
    service: "",
    service_price: 0,
    discount: 0,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!order) return;
    setForm({
      customer: order.customer ?? "",
      customer_phone: order.customerPhone ?? "",
      vehicle: order.vehicle ?? "",
      plate: order.plate ?? "",
      service: order.service ?? "",
      service_price: Number(order.servicePrice ?? 0),
      discount: Number(order.discount ?? 0),
      notes: order.notes ?? "",
    });
  }, [order?.id, open]);

  if (!order) return null;

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const audit = `[EDITED ${nowIso.replace("T", " ").slice(0, 16)}] Order details amended by admin`;
      const mergedNotes = form.notes?.trim()
        ? (form.notes.includes("[EDITED ") ? form.notes : `${form.notes}\n${audit}`)
        : audit;
      const patch = {
        customer: form.customer.trim(),
        customer_phone: form.customer_phone.trim() || null,
        vehicle: form.vehicle.trim(),
        plate: form.plate.trim(),
        service: form.service.trim(),
        service_price: Number(form.service_price) || 0,
        discount: Number(form.discount) || 0,
        notes: mergedNotes,
        updated_at: nowIso,
      };
      const { error } = await supabase.from("orders").update(patch).eq("id", order.id);
      if (error) throw error;
      // Keep offline cache in sync
      try {
        const existing = await db.orders.get(order.id);
        if (existing) await db.orders.put({ ...(existing as any), ...patch });
      } catch { /* ignore */ }
      toast.success(`Order ${order.orderNumber} updated`);
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Failed to update order", { description: err?.message || String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit work order</DialogTitle>
          <DialogDescription>
            Amend details for {order.orderNumber}. Changes are audited in the notes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Customer">
            <input
              value={form.customer}
              onChange={(e) => setField("customer", e.target.value)}
              className="input-base"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cellphone">
              <input
                value={form.customer_phone}
                onChange={(e) => setField("customer_phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                className="input-base"
              />
            </Field>
            <Field label="Plate">
              <input
                value={form.plate}
                onChange={(e) => setField("plate", e.target.value.toUpperCase())}
                className="input-base font-mono"
              />
            </Field>
          </div>
          <Field label="Vehicle">
            <input
              value={form.vehicle}
              onChange={(e) => setField("vehicle", e.target.value)}
              className="input-base"
            />
          </Field>
          <Field label="Service">
            <input
              value={form.service}
              onChange={(e) => setField("service", e.target.value)}
              className="input-base"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (final)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.service_price}
                onChange={(e) => setField("service_price", Number(e.target.value))}
                className="input-base"
              />
            </Field>
            <Field label="Discount">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.discount}
                onChange={(e) => setField("discount", Number(e.target.value))}
                className="input-base"
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={3}
              className="input-base resize-y"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </Button>
        </div>

        <style>{`
          .input-base {
            width: 100%;
            background: hsl(var(--background));
            border: 1px solid hsl(var(--border));
            border-radius: 0.5rem;
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
            color: hsl(var(--foreground));
          }
          .input-base:focus { outline: none; box-shadow: 0 0 0 2px hsl(var(--ring)); }
        `}</style>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
      {label}
    </label>
    {children}
  </div>
);
