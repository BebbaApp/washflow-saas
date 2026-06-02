import { useMemo, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { UserPlus, UserCheck, ChevronsUpDown, Check, Search } from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { useCurrency } from "@/hooks/useCurrency";
import { useLoyalty } from "@/hooks/useLoyalty";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone, normalizePhone, phoneDigits, validatePhone } from "@/lib/phone";
import { VEHICLES, type Vehicle } from "@/lib/vehicleUsage";
import { cn } from "@/lib/utils";
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

export const NewOrderDialog = ({ open, onOpenChange, onSubmit }: NewOrderDialogProps) => {
  const { services } = useServices();
  const { formatPrice } = useCurrency();
  const { customers, refetch: refetchCustomers } = useLoyalty();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState<Vehicle | "">("");
  const [serviceId, setServiceId] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const sortedCustomers = useMemo(
    () => [...customers].sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  // Filtered customer list — match by name (case-insensitive) or by phone digits.
  const filteredCustomers = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return sortedCustomers.slice(0, 50);
    const qDigits = phoneDigits(pickerQuery);
    return sortedCustomers
      .filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true;
        if (qDigits.length >= 3 && phoneDigits(c.phone).includes(qDigits)) return true;
        return false;
      })
      .slice(0, 50);
  }, [pickerQuery, sortedCustomers]);

  const linkedCustomer = customerId
    ? customers.find((c) => c.id === customerId) ?? null
    : null;

  const hasExactMatch = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return false;
    return sortedCustomers.some((c) => c.name.toLowerCase() === q);
  }, [pickerQuery, sortedCustomers]);

  // Sync picker into form fields when user picks an existing customer.
  const pickExisting = (id: string) => {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    setCustomerId(id);
    setCustomer(c.name);
    setCustomerPhone(c.phone ? formatPhone(c.phone) : "");
    setPhoneError(null);
    setPickerOpen(false);
    setPickerQuery("");
  };

  // Fallback: caller typed a name that doesn't match any existing customer.
  // We seed the form fields and leave customerId blank — submit-time logic
  // will create a customer row (online) or carry the free-text through.
  const pickNew = (name: string) => {
    setCustomerId(null);
    setCustomer(name);
    setPickerOpen(false);
    setPickerQuery("");
  };

  const clearLink = () => {
    setCustomerId(null);
  };

  const reset = () => {
    setCustomerId(null);
    setCustomer("");
    setCustomerPhone("");
    setMake("");
    setModel("");
    setPlate("");
    setVehicleType("");
    setServiceId("");
    setPhoneError(null);
    setPickerQuery("");
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
    let resolvedId: string | undefined = customerId ?? undefined;

    if (!resolvedId) {
      // Best-effort auto-match: phone first (more reliable), then exact name.
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
        // Create a new customer row so loyalty earn can fire on completion.
        const { data, error } = await supabase
          .from("customers")
          .insert({ name: customer, phone: phone || null })
          .select("id")
          .single();
        if (!error && data) {
          resolvedId = data.id;
          refetchCustomers();
          toast.success(`Created new customer: ${customer}`);
        } else if (error) {
          console.warn("[NewOrderDialog] customer auto-create failed", error);
          toast.warning("Could not create customer record", {
            description: "Order will go through, but loyalty points won't be tracked.",
          });
        }
      } else {
        // Offline + no match — order will still go through, but no loyalty.
        toast.warning("Customer not linked (offline)", {
          description: "Loyalty points won't be earned. Link customer later from the order.",
        });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">New Wash Order</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-sm text-secondary-foreground">Customer</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full inline-flex items-center justify-between gap-2 rounded-md bg-secondary border border-border px-3 py-2 text-sm text-left text-foreground hover:bg-secondary/80 transition-colors"
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    {linkedCustomer ? (
                      <>
                        <UserCheck className="w-4 h-4 text-success shrink-0" />
                        <span className="truncate">
                          {linkedCustomer.name}
                          {linkedCustomer.phone ? ` · ${formatPhone(linkedCustomer.phone)}` : ""}
                        </span>
                      </>
                    ) : customer ? (
                      <>
                        <UserPlus className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">New: {customer}</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">Search or add a customer…</span>
                      </>
                    )}
                  </span>
                  <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-card border-border" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Type a name or phone…"
                    value={pickerQuery}
                    onValueChange={setPickerQuery}
                  />
                  <CommandList>
                    {filteredCustomers.length === 0 && (
                      <CommandEmpty>
                        {pickerQuery.trim()
                          ? "No matching customers."
                          : "No customers yet."}
                      </CommandEmpty>
                    )}
                    {filteredCustomers.length > 0 && (
                      <CommandGroup heading="Existing customers">
                        {filteredCustomers.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={c.id}
                            onSelect={() => pickExisting(c.id)}
                            className="flex items-center gap-2"
                          >
                            <Check
                              className={cn(
                                "w-3.5 h-3.5",
                                customerId === c.id ? "opacity-100 text-success" : "opacity-0",
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm truncate">{c.name}</p>
                              {c.phone && (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {formatPhone(c.phone)} · {c.loyaltyPoints} pts
                                </p>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {pickerQuery.trim() && !hasExactMatch && (
                      <CommandGroup heading="Add new">
                        <CommandItem
                          value={`__new__:${pickerQuery}`}
                          onSelect={() => pickNew(pickerQuery.trim())}
                          className="flex items-center gap-2"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-primary" />
                          <span className="text-sm">
                            Create new customer “{pickerQuery.trim()}”
                          </span>
                        </CommandItem>
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {linkedCustomer ? (
              <p className="text-[11px] text-success inline-flex items-center gap-1">
                <UserCheck className="w-3 h-3" />
                Loyalty linked · {linkedCustomer.loyaltyPoints} pts
                <button
                  type="button"
                  onClick={clearLink}
                  className="ml-2 text-muted-foreground hover:text-foreground underline"
                >
                  unlink
                </button>
              </p>
            ) : customer ? (
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <UserPlus className="w-3 h-3" />
                Will be created on submit so loyalty points are tracked.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Tip: linking a customer lets them earn loyalty points on this wash.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer" className="text-sm text-secondary-foreground">Customer Name</Label>
            <Input
              id="customer"
              value={customer}
              onChange={(e) => { setCustomer(e.target.value); if (customerId) setCustomerId(null); }}
              placeholder="John Smith"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
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
                if (customerId) setCustomerId(null);
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
