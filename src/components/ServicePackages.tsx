import { useState } from "react";
import { Clock, Tag, Edit2, Save, X, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useServices, type ServicePackage } from "@/hooks/useServices";
import { useCurrency } from "@/hooks/useCurrency";
import { useInventory } from "@/hooks/useInventory";
import { ServiceRecipeEditor } from "@/components/ServiceRecipeEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ServicePackagesProps {
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
}

const emptyDraft: Partial<ServicePackage> = {
  name: "",
  price: 0,
  duration: "",
  features: [],
  popular: false,
  vatExempt: false,
};

export const ServicePackages = ({ addOpen, onAddOpenChange }: ServicePackagesProps) => {
  const { services, updateService, addService, removeService } = useServices();
  const { formatPrice, calcVat, calcTotal, currency } = useCurrency();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ServicePackage>>({});
  const [newDraft, setNewDraft] = useState<Partial<ServicePackage>>(emptyDraft);
  const [pendingDelete, setPendingDelete] = useState<ServicePackage | null>(null);

  const startEdit = (s: ServicePackage) => {
    setEditingId(s.id);
    setEditData({ name: s.name, price: s.price, duration: s.duration, features: s.features, popular: s.popular, vatExempt: s.vatExempt });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!editData.name?.trim()) {
      toast.error("Service name is required");
      return;
    }
    if (editData.price === undefined || editData.price === null || Number.isNaN(Number(editData.price))) {
      toast.error("Valid price is required");
      return;
    }
    const name = editData.name;
    setEditingId(null);
    try {
      await updateService(editingId, editData);
      toast.success(`Updated "${name}"`);
    } catch {
      // rollback handled in hook
    }
  };

  const saveNew = async () => {
    if (!newDraft.name?.trim()) {
      toast.error("Service name is required");
      return;
    }
    const draft = newDraft;
    setNewDraft(emptyDraft);
    onAddOpenChange?.(false);
    try {
      const created = await addService({
        name: draft.name!,
        price: Number(draft.price) || 0,
        duration: draft.duration || "",
        features: draft.features || [],
        popular: draft.popular,
        vatExempt: draft.vatExempt,
      });
      toast.success(`Added "${created.name}"`);
    } catch {
      setNewDraft(draft);
      onAddOpenChange?.(true);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await removeService(target.id);
      toast.success(`Deleted "${target.name}"`);
    } catch {
      // rollback handled in hook
    }
  };

  const description = (s: ServicePackage) =>
    s.features.length ? s.features.join(", ") : "—";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {services.map((pkg) => {
        const isEditing = editingId === pkg.id;
        return (
          <div key={pkg.id} className="glass-card p-6 flex flex-col">
            {isEditing ? (
              <div className="space-y-3 flex-1">
                <Input value={editData.name || ""} onChange={(e) => setEditData((p) => ({ ...p, name: e.target.value }))} placeholder="Service name" />
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" value={editData.price ?? ""} onChange={(e) => setEditData((p) => ({ ...p, price: Number(e.target.value) }))} placeholder={`Price (${currency.symbol})`} />
                  <Input value={editData.duration || ""} onChange={(e) => setEditData((p) => ({ ...p, duration: e.target.value }))} placeholder="Duration (e.g. 15 min)" />
                </div>
                <textarea
                  value={(editData.features || []).join("\n")}
                  onChange={(e) => setEditData((p) => ({ ...p, features: e.target.value.split("\n").filter(Boolean) }))}
                  rows={4}
                  placeholder="One feature per line"
                  className="w-full rounded-lg bg-secondary border border-border text-foreground text-sm p-3 placeholder:text-muted-foreground resize-none"
                />
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Popular</Label>
                    <Switch checked={editData.popular || false} onCheckedChange={(popular) => setEditData((p) => ({ ...p, popular }))} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">VAT Exempt</Label>
                    <Switch checked={editData.vatExempt || false} onCheckedChange={(vatExempt) => setEditData((p) => ({ ...p, vatExempt }))} />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"><Save className="w-3 h-3" />Save</button>
                  <button onClick={() => setEditingId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"><X className="w-3 h-3" />Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h3 className="text-xl font-bold text-foreground tracking-tight">{pkg.name}</h3>
                  <p className="text-3xl font-extrabold text-primary leading-none whitespace-nowrap">
                    {formatPrice(pkg.price)}
                  </p>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-5 flex-1">
                  {description(pkg)}
                </p>

                <div className="flex items-center gap-5 text-sm text-muted-foreground mb-5">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {pkg.duration || "—"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Tag className="w-4 h-4" />
                    {formatPrice(pkg.price)}
                  </span>
                </div>

                {currency.vatEnabled && !pkg.vatExempt && (
                  <p className="text-xs text-muted-foreground -mt-3 mb-4">
                    +{formatPrice(calcVat(pkg.price))} VAT = {formatPrice(calcTotal(pkg.price))}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(pkg)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm font-semibold hover:bg-secondary transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => setPendingDelete(pkg)}
                    className="w-11 h-11 inline-flex items-center justify-center rounded-lg border border-border text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete service"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {(pkg.popular || (currency.vatEnabled && pkg.vatExempt)) && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {pkg.popular && <span className="status-badge bg-primary/10 text-primary">Most Popular</span>}
                    {currency.vatEnabled && pkg.vatExempt && (
                      <span className="status-badge bg-warning/10 text-warning">VAT Exempt</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Add new service card */}
      {addOpen && (
        <div className="glass-card p-6 flex flex-col space-y-3 border-primary/40">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">New service</h3>
            <button
              onClick={() => { setNewDraft(emptyDraft); onAddOpenChange?.(false); }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <Input value={newDraft.name || ""} onChange={(e) => setNewDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Service name" />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" value={newDraft.price ?? ""} onChange={(e) => setNewDraft((p) => ({ ...p, price: Number(e.target.value) }))} placeholder={`Price (${currency.symbol})`} />
            <Input value={newDraft.duration || ""} onChange={(e) => setNewDraft((p) => ({ ...p, duration: e.target.value }))} placeholder="Duration (e.g. 15 min)" />
          </div>
          <textarea
            value={(newDraft.features || []).join("\n")}
            onChange={(e) => setNewDraft((p) => ({ ...p, features: e.target.value.split("\n").filter(Boolean) }))}
            rows={3}
            placeholder="Description / features (one per line)"
            className="w-full rounded-lg bg-secondary border border-border text-foreground text-sm p-3 placeholder:text-muted-foreground resize-none"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Popular</Label>
              <Switch checked={newDraft.popular || false} onCheckedChange={(popular) => setNewDraft((p) => ({ ...p, popular }))} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">VAT Exempt</Label>
              <Switch checked={newDraft.vatExempt || false} onCheckedChange={(vatExempt) => setNewDraft((p) => ({ ...p, vatExempt }))} />
            </div>
          </div>
          <button
            onClick={saveNew}
            disabled={!newDraft.name}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            Add service
          </button>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this service?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  This will permanently remove <strong className="text-foreground">{pendingDelete.name}</strong> from your wash packages. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
