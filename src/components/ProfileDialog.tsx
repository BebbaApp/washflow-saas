import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  initialPhone: string;
  email: string;
  onSave: (updates: { name?: string; phone?: string }) => Promise<string | null>;
  reason?: "missing_phone" | "edit";
}

export function ProfileDialog({ open, onOpenChange, initialName, initialPhone, email, onSave, reason = "edit" }: ProfileDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone(initialPhone);
    }
  }, [open, initialName, initialPhone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast({ title: "Phone number is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const err = await onSave({
      name: name.trim() !== initialName ? name.trim() : undefined,
      phone: phone.trim() !== initialPhone ? phone.trim() : undefined,
    });
    setSaving(false);
    if (err) {
      toast({ title: "Could not update profile", description: err, variant: "destructive" });
      return;
    }
    toast({ title: "Profile updated" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {reason === "missing_phone" ? "Complete your profile" : "Edit profile"}
          </DialogTitle>
          <DialogDescription>
            {reason === "missing_phone"
              ? "Please add a phone number to your account so admins can reach you."
              : "Update your account details."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label className="text-sm text-secondary-foreground">Email</Label>
            <Input value={email} disabled className="bg-secondary border-border text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prof-name" className="text-sm text-secondary-foreground">Full Name</Label>
            <Input id="prof-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="bg-secondary border-border text-foreground" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prof-phone" className="text-sm text-secondary-foreground">Phone Number *</Label>
            <Input id="prof-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="bg-secondary border-border text-foreground" autoComplete="tel" />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
