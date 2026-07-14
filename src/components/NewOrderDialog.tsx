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
import { toast } from "sonner";

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { customer: string; customerPhone: string; vehicle: string; plate: string; service: string; servicePrice: number }) => void;
}

export const NewOrderDialog = ({ open, onOpenChange, onSubmit }: NewOrderDialogProps) => {
  const { services } = useServices();
  const { formatPrice } = useCurrency();
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState<Vehicle | "">("");
  const [serviceId, setServiceId] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !make || !model || !plate || !vehicleType || !serviceId) return;
    const err = validatePhone(customerPhone, { required: false });
    if (err) {
      setPhoneError(err);
      toast.error(err);
      return;
    }
    const picked = services.find((s) => s.id === serviceId);
    if (!picked) return;
    // Append vehicle type so downstream matchVehicle() can auto-deduct.
    const vehicle = `${make} ${model}`.trim() + ` · ${vehicleType}`;
    const phone = normalizePhone(customerPhone);
    onSubmit({ customer, customerPhone: phone, vehicle, plate, service: picked.name, servicePrice: picked.price });
    setCustomer("");
    setCustomerPhone("");
    setMake("");
    setModel("");
    setPlate("");
    setVehicleType("");
    setServiceId("");
    setPhoneError(null);
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
              <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model" className="text-sm text-secondary-foreground">Car Model</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Camry" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
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
          <button type="submit" className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
            Create Order
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
