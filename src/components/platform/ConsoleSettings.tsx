import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface Settings {
  currency: string;
  vat_rate: number;
  company_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
}

const EMPTY: Settings = {
  currency: "USD", vat_rate: 0, company_name: "", contact_email: "", contact_phone: "", address: "",
};

export function ConsoleSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "get_platform_settings" },
    });
    if (error) {
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    } else {
      const s = (data as any)?.settings ?? {};
      setSettings({ ...EMPTY, ...s, vat_rate: Number(s.vat_rate ?? 0) });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: { action: "update_platform_settings", ...settings },
      });
      if (error) throw error;
      toast({ title: "Settings saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  if (loading) {
    return <div className="glass-card p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="glass-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Console settings</h2>
          <p className="text-sm text-muted-foreground">
            Defaults applied across the platform console. Tenants can still override their own values.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Default currency</Label>
            <Input value={settings.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} placeholder="USD" />
          </div>
          <div className="space-y-1">
            <Label>VAT rate (%)</Label>
            <Input type="number" min={0} max={100} step={0.1}
              value={settings.vat_rate}
              onChange={(e) => set("vat_rate", Number(e.target.value))} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Company name</Label>
          <Input value={settings.company_name} onChange={(e) => set("company_name", e.target.value)} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Contact email</Label>
            <Input type="email" value={settings.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Contact phone</Label>
            <Input value={settings.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Address</Label>
          <Textarea rows={3} value={settings.address} onChange={(e) => set("address", e.target.value)} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Save settings</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
