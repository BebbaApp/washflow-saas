import { useEffect, useMemo, useState } from "react";
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
import { UserPlus, UserCheck } from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { useCurrency } from "@/hooks/useCurrency";
import { useLoyalty } from "@/hooks/useLoyalty";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, normalizePhone, validatePhone } from "@/lib/phone";
import { VEHICLES, type Vehicle } from "@/lib/vehicleUsage";
import { toast } from "sonner";

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    customer: string;
    customerId?: string;
    customerPhone: string;
    vehicle: string;
    plate: string;
    service: string;
    servicePrice: number;
  }) => void;
}

const NEW_CUSTOMER = "__new__";

export const NewOrderDialog = ({ open, onOpenChange, onSubmit }: NewOrderDialogProps) => {
  const { services } = useServices();
  const { formatPrice } = useCurrency();
  const { customers, refetch: refetchCustomers } = useLoyalty();
  const [customerId, setCustomerId] = useState<string>(NEW_CUSTOMER);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState<Vehicle | "">("");
  const [serviceId, setServiceId] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  // When picking an existing customer, prefill name & phone.
  useEffect(() => {
    if (customerId === NEW_CUSTOMER) return;
    const c = customers.find((x) => x.id === customerId);
    if (!c) return;
    setCustomer(c.name);
    setCustomerPhone(c.phone ? formatPhone(c.phone) : "");
    setPhoneError(null);
  }, [customerId, customers]);

  const reset = () => {
    setCustomerId(NEW_CUSTOMER);
    setCustomer("");
    setCustomerPhone("");
    setMake("");
    setModel("");
    setPlate("");
    setVehicleType("");
    setServiceId("");
    setPhoneError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    const phone = normalizePhone(customerPhone);
    let resolvedId: string | undefined =
      customerId !== NEW_CUSTOMER ? customerId : undefined;

    // No explicit pick → try to match an existing customer by phone or name
    // so loyalty earn can attribute the wash. Best-effort; offline OK.
    if (!resolvedId) {
      const byPhone = phone
        ? customers.find((c) => c.phone && normalizePhone(c.phone) === phone)
        : null;
      const byName = !byPhone
        ? customers.find((c) => c.name.trim().toLowerCase() === customer.trim().toLowerCase())
        : null;
      const matched = byPhone ?? byName;
      if (matched) {
        resolvedId = matched.id;
      } else if (typeof navigator !== "undefined" && navigator.onLine) {
        // Create a new customer row so the order can carry customer_id and
        // loyalty earn fires on completion.
        const { data, error } = await supabase
          .from("customers")
          .insert({ name: customer, phone: phone || null })
          .select("id")
          .single();
        if (!error && data) {
          resolvedId = data.id;
          refetchCustomers();
        } else if (error) {
          // Non-fatal: order still goes through without a customerId
          console.warn("[NewOrderDialog] customer auto-create failed", error);
        }
      }
    }

    const vehicle = `${make} ${model}`.trim() + ` · ${vehicleType}`;
    onSubmit({
      customer,
      customerId: resolvedId,
      customerPhone: phone,
      vehicle,
      plate,
      service: picked.name,
      servicePrice: picked.price,
    });
    reset();
    onOpenChange(false);
  };

  const linkedCustomer = customerId !== NEW_CUSTOMER
    ? customers.find((c) => c.id === customerId)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">New Wash Order</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-sm text-secondary-foreground">Customer</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="bg-secondary border-border text-foreground">
                <SelectValue placeholder="New customer" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-72">
                <SelectItem value={NEW_CUSTOMER}>
                  <span className="inline-flex items-center gap-2">
                    <UserPlus className="w-3.5 h-3.5" />
                    New customer
                  </span>
                </SelectItem>
                {sortedCustomers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkedCustomer && (
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-success" />
                Loyalty linked · {linkedCustomer.loyaltyPoints} pts
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer" className="text-sm text-secondary-foreground">Customer Name</Label>
            <Input id="customer" value={customer} onChange={(e) => { setCustomer(e.target.value); if (customerId !== NEW_CUSTOMER) setCustomerId(NEW_CUSTOMER); }} placeholder="John Smith" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
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
                if (customerId !== NEW_CUSTOMER) setCustomerId(NEW_CUSTOMER);
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
              <Input id="plate" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC 1234" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
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
