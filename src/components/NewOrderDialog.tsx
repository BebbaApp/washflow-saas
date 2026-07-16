import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServices } from "@/hooks/useServices";
import { useCurrency } from "@/hooks/useCurrency";
import { formatPhone, normalizePhone, validatePhone } from "@/lib/phone";
import { VEHICLES, type Vehicle } from "@/lib/vehicleUsage";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { DiscountAuthorizeDialog, type AuthorizerIdentity } from "@/components/DiscountAuthorizeDialog";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PendingDiscount } from "@/hooks/useOrders";
import { toast } from "sonner";

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    customer: string;
    customerPhone: string;
    vehicle: string;
    plate: string;
    service: string;
    servicePrice: number;
    discount: number;
    pendingDiscount?: PendingDiscount;
  }) => void;
}

export const NewOrderDialog = ({ open, onOpenChange, onSubmit }: NewOrderDialogProps) => {
  const { services } = useServices();
  const { formatPrice, currency } = useCurrency();
  const { can } = usePermissions();
  const { user } = useAuth();
  const canAuthorize = can("queue.approveDiscount");
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState<Vehicle | "">("");
  const [serviceId, setServiceId] = useState("");
  const [discountStr, setDiscountStr] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [authorizedBy, setAuthorizedBy] = useState<AuthorizerIdentity | null>(null);

  const picked = services.find((s) => s.id === serviceId);
  const discount = Math.max(0, Number(discountStr) || 0);
  const clampedDiscount = picked ? Math.min(discount, picked.price) : discount;
  const willApplyDiscount = canAuthorize || !!authorizedBy;
  const finalPrice = picked ? Math.max(0, picked.price - (willApplyDiscount ? clampedDiscount : 0)) : 0;

  const capitalizeWords = (v: string) => v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

  const resetForm = () => {
    setCustomer("");
    setCustomerPhone("");
    setMake("");
    setModel("");
    setPlate("");
    setVehicleType("");
    setServiceId("");
    setDiscountStr("");
    setPhoneError(null);
    setAuthorizedBy(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !make || !model || !plate || !vehicleType || !serviceId) return;
    const err = validatePhone(customerPhone, { required: false });
    if (err) {
      setPhoneError(err);
      toast.error(err);
      return;
    }
    if (!picked) return;
    const vehicle = `${make} ${model}`.trim() + ` · ${vehicleType}`;
    const phone = normalizePhone(customerPhone);

    // If a discount was entered but the current user isn't authorized AND no
    // manager has approved via PIN, submit at full price with a pending
    // discount request so a manager can approve it later from the card.
    const needsPending =
      clampedDiscount > 0 && !willApplyDiscount && !!user;

    const pendingDiscount: PendingDiscount | undefined = needsPending
      ? {
          amount: clampedDiscount,
          requestedById: user!.id,
          requestedByName: user!.name || user!.email || "Staff",
          requestedAt: new Date().toISOString(),
        }
      : undefined;

    onSubmit({
      customer,
      customerPhone: phone,
      vehicle,
      plate,
      service: picked.name,
      servicePrice: picked.price,
      discount: willApplyDiscount ? clampedDiscount : 0,
      pendingDiscount,
    });
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">New Wash Order</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="customer" className="text-sm text-secondary-foreground">Customer Name</Label>
            <Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value.replace(/\b\p{L}/gu, (c) => c.toUpperCase()))} placeholder="John Smith" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoCapitalize="words" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerPhone" className="text-sm text-secondary-foreground">Cell Phone Number</Label>
            <Input
              id="customerPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              onBlur={() => {
                if (!customerPhone) return;
                const err = validatePhone(customerPhone);
                setPhoneError(err);
                if (!err) setCustomerPhone(formatPhone(customerPhone));
              }}
              placeholder="082 123 4567"
              aria-invalid={!!phoneError}
              className={`bg-secondary border-border text-foreground placeholder:text-muted-foreground ${phoneError ? "border-destructive focus-visible:ring-destructive" : ""}`}
            />
            {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="make" className="text-sm text-secondary-foreground">Car Make</Label>
              <Input id="make" value={make} onChange={(e) => setMake(capitalizeWords(e.target.value))} placeholder="Toyota" autoCapitalize="words" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model" className="text-sm text-secondary-foreground">Car Model</Label>
              <Input id="model" value={model} onChange={(e) => setModel(capitalizeWords(e.target.value))} placeholder="Camry" autoCapitalize="words" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="plate" className="text-sm text-secondary-foreground">License Plate</Label>
              <Input id="plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="ABC1234" maxLength={10} autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono uppercase tracking-wider" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Vehicle Type</Label>
              <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as Vehicle)}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {VEHICLES.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm text-secondary-foreground">Service Package</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger className="bg-secondary border-border text-foreground">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} — {formatPrice(s.price)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="discount" className="text-sm text-secondary-foreground">
                Discount ({currency?.symbol ?? ""})
              </Label>
              {!canAuthorize && (
                authorizedBy ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Authorized by {authorizedBy.name}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={clampedDiscount <= 0}
                    onClick={() => setAuthorizeOpen(true)}
                    className="h-7 gap-1 text-xs"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Override
                  </Button>
                )
              )}
            </div>
            <Input
              id="discount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={discountStr}
              onChange={(e) => {
                setDiscountStr(e.target.value.replace(/[^0-9.]/g, ""));
                // Editing the amount invalidates a previous authorization
                // so managers can't approve one figure and cashier changes it.
                if (authorizedBy) setAuthorizedBy(null);
              }}
              placeholder="0.00"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
            {picked && clampedDiscount > 0 && (
              <div className="space-y-1 pt-1">
                {willApplyDiscount ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Service {formatPrice(picked.price)} − {formatPrice(clampedDiscount)} discount</span>
                    <span className="font-semibold text-foreground">Final: {formatPrice(finalPrice)}</span>
                  </div>
                ) : (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Pending manager approval
                    </div>
                    <p className="mt-1 text-warning/90">
                      Order will be created at full price ({formatPrice(picked.price)}). A
                      manager can approve the {formatPrice(clampedDiscount)} discount from
                      the order card before completion.
                    </p>
                  </div>
                )}
              </div>
            )}
            {picked && clampedDiscount === 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>Service {formatPrice(picked.price)}</span>
                <span className="font-semibold text-foreground">Total: {formatPrice(picked.price)}</span>
              </div>
            )}
          </div>
          <button type="submit" className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
            Create Order
          </button>
        </form>
      </DialogContent>

      <DiscountAuthorizeDialog
        open={authorizeOpen}
        onOpenChange={setAuthorizeOpen}
        onAuthorized={(auth) => setAuthorizedBy(auth)}
        description={`A manager or admin must enter their PIN to approve the ${
          picked && clampedDiscount > 0 ? formatPrice(clampedDiscount) : ""
        } discount.`}
      />
    </Dialog>
  );
};
