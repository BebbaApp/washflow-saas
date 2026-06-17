import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: { id: string; name: string; slug: string } | null;
  onSaved?: () => void;
}

export function EditTenantDialog({ open, onOpenChange, tenant, onSaved }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tenant) { setName(tenant.name); setSlug(tenant.slug); }
  }, [tenant]);

  const save = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: { action: "update_tenant", tenant_id: tenant.id, name, slug },
      });
      if (error) throw error;
      toast({ title: "Tenant updated" });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tenant</DialogTitle>
          <DialogDescription>Update the workspace name and URL slug.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            />
            <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, and dashes only.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name || !slug}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
