import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, X, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePlatformCurrency } from "@/hooks/usePlatformCurrency";

interface Plan {
  id: string;
  code: string;
  name: string;
  price_monthly_cents: number;
  max_users: number | null;
  features: Record<string, any>;
  stripe_price_id: string | null;
  created_at: string;
}

const EMPTY: Omit<Plan, "id" | "created_at"> = {
  code: "",
  name: "",
  price_monthly_cents: 0,
  max_users: null,
  features: {},
  stripe_price_id: null,
};

export function ConsolePlans() {
  const { toast } = useToast();
  const { format, currency } = usePlatformCurrency();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [priceInput, setPriceInput] = useState("0");
  const [featuresJson, setFeaturesJson] = useState("{}");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "list_plans" },
    });
    if (error) toast({ title: "Failed to load plans", description: error.message, variant: "destructive" });
    else setPlans(((data as any)?.plans ?? []) as Plan[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY);
    setPriceInput("0");
    setFeaturesJson("{}");
  };

  const openEdit = (p: Plan) => {
    setEditing(p);
    setDraft({
      code: p.code,
      name: p.name,
      price_monthly_cents: p.price_monthly_cents,
      max_users: p.max_users,
      features: p.features ?? {},
      stripe_price_id: p.stripe_price_id,
    });
    setPriceInput((p.price_monthly_cents / 100).toString());
    setFeaturesJson(JSON.stringify(p.features ?? {}, null, 2));
  };

  const closeDialog = () => {
    setEditing(null);
    setDraft(EMPTY);
  };

  const dialogOpen = editing !== null || draft !== EMPTY ? false : false; // controlled below

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (editing) setOpen(true);
  }, [editing]);

  const handleOpenCreate = () => {
    openCreate();
    setOpen(true);
  };

  const handleSave = async () => {
    let features: Record<string, any> = {};
    try {
      features = featuresJson.trim() ? JSON.parse(featuresJson) : {};
      if (typeof features !== "object" || Array.isArray(features)) throw new Error();
    } catch {
      toast({ title: "Invalid features JSON", variant: "destructive" });
      return;
    }
    const cents = Math.round(Number(priceInput) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast({ title: "Invalid price", variant: "destructive" });
      return;
    }
    if (!draft.code || !draft.name) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "upsert_plan",
          id: editing?.id,
          code: draft.code,
          name: draft.name,
          price_monthly_cents: cents,
          max_users: draft.max_users,
          features,
          stripe_price_id: draft.stripe_price_id || null,
        },
      });
      if (error) throw error;
      toast({ title: editing ? "Plan updated" : "Plan created" });
      setOpen(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: Plan) => {
    if (!confirm(`Delete plan "${p.name}"? This cannot be undone.`)) return;
    setBusyId(p.id);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: { action: "delete_plan", id: p.id },
      });
      if (error) throw error;
      toast({ title: "Plan deleted" });
      await load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Package className="w-5 h-5" /> Plan packages
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage subscription plans available to tenants. Prices shown in {currency}.
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-2" /> New plan
        </Button>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-right px-3 py-2">Price / month</th>
                <th className="text-right px-3 py-2">Max users</th>
                <th className="text-left px-3 py-2">Features</th>
                <th className="text-right px-3 py-2 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : plans.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No plans yet.</td></tr>
              ) : plans.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                  <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{p.code}</td>
                  <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    {format(p.price_monthly_cents / 100)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.max_users ?? "∞"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[260px]">
                    {Object.keys(p.features ?? {}).length === 0
                      ? "—"
                      : Object.entries(p.features)
                          .filter(([, v]) => v)
                          .map(([k]) => k)
                          .join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)} disabled={busyId === p.id}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(p)} disabled={busyId === p.id}>
                      {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-destructive" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit plan" : "New plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Code</Label>
                <Input
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                  placeholder="starter"
                  disabled={!!editing}
                />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Starter" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Price / month ({currency})</Label>
                <Input
                  type="number" min={0} step="0.01"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Max users (blank = unlimited)</Label>
                <Input
                  type="number" min={0}
                  value={draft.max_users ?? ""}
                  onChange={(e) => setDraft({ ...draft, max_users: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Stripe price ID (optional)</Label>
              <Input
                value={draft.stripe_price_id ?? ""}
                onChange={(e) => setDraft({ ...draft, stripe_price_id: e.target.value || null })}
                placeholder="price_..."
              />
            </div>
            <div className="space-y-1">
              <Label>Features (JSON)</Label>
              <Textarea
                rows={5}
                value={featuresJson}
                onChange={(e) => setFeaturesJson(e.target.value)}
                className="font-mono text-xs"
                placeholder='{"reports": true, "loyalty": false}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>
              <X className="w-4 h-4 mr-2" /> Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Save</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
