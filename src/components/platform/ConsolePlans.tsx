import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Pencil, Trash2, Save, Package, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { usePlatformCurrency } from "@/hooks/usePlatformCurrency";
import { PERMISSION_GROUPS } from "@/lib/permissions";

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

const PERMISSION_KEY_SET = new Set(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)),
);

export function ConsolePlans() {
  const { toast } = useToast();
  const { format, currency } = usePlatformCurrency();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("");
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);

  // metadata dialog (create / rename / price / max users / stripe)
  const [metaOpen, setMetaOpen] = useState(false);
  const [metaEditing, setMetaEditing] = useState<Plan | null>(null);
  const [metaDraft, setMetaDraft] = useState({
    code: "", name: "", price_input: "0",
    max_users: "" as string,
    stripe_price_id: "" as string,
  });
  const [metaSaving, setMetaSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "list_plans" },
    });
    if (error) {
      toast({ title: "Failed to load plans", description: error.message, variant: "destructive" });
    } else {
      const next = ((data as any)?.plans ?? []) as Plan[];
      setPlans(next);
      if (next.length && !next.find((p) => p.id === activeTab)) {
        setActiveTab(next[0].id);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openCreate = () => {
    setMetaEditing(null);
    setMetaDraft({ code: "", name: "", price_input: "0", max_users: "", stripe_price_id: "" });
    setMetaOpen(true);
  };

  const openEditMeta = (p: Plan) => {
    setMetaEditing(p);
    setMetaDraft({
      code: p.code,
      name: p.name,
      price_input: (p.price_monthly_cents / 100).toString(),
      max_users: p.max_users == null ? "" : String(p.max_users),
      stripe_price_id: p.stripe_price_id ?? "",
    });
    setMetaOpen(true);
  };

  const handleMetaSave = async () => {
    const cents = Math.round(Number(metaDraft.price_input) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast({ title: "Invalid price", variant: "destructive" });
      return;
    }
    if (!metaDraft.code || !metaDraft.name) {
      toast({ title: "Code and name are required", variant: "destructive" });
      return;
    }
    setMetaSaving(true);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "upsert_plan",
          id: metaEditing?.id,
          code: metaDraft.code,
          name: metaDraft.name,
          price_monthly_cents: cents,
          max_users: metaDraft.max_users === "" ? null : Number(metaDraft.max_users),
          features: metaEditing?.features ?? {},
          stripe_price_id: metaDraft.stripe_price_id || null,
        },
      });
      if (error) throw error;
      toast({ title: metaEditing ? "Plan updated" : "Plan created" });
      setMetaOpen(false);
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setMetaSaving(false);
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
      const next = plans.filter((x) => x.id !== p.id);
      if (activeTab === p.id) setActiveTab(next[0]?.id ?? "");
      await load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const togglePlanFeature = (planId: string, key: string, value: boolean) => {
    setPlans((prev) =>
      prev.map((p) =>
        p.id !== planId ? p : { ...p, features: { ...(p.features ?? {}), [key]: value } },
      ),
    );
  };

  const toggleGroup = (planId: string, keys: string[], value: boolean) => {
    setPlans((prev) =>
      prev.map((p) => {
        if (p.id !== planId) return p;
        const next = { ...(p.features ?? {}) };
        for (const k of keys) next[k] = value;
        return { ...p, features: next };
      }),
    );
  };

  const savePlanFeatures = async (plan: Plan) => {
    setSavingPlanId(plan.id);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "upsert_plan",
          id: plan.id,
          code: plan.code,
          name: plan.name,
          price_monthly_cents: plan.price_monthly_cents,
          max_users: plan.max_users,
          features: plan.features ?? {},
          stripe_price_id: plan.stripe_price_id,
        },
      });
      if (error) throw error;
      toast({ title: "Features saved", description: `Updated "${plan.name}"` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSavingPlanId(null);
    }
  };

  const activePlan = plans.find((p) => p.id === activeTab) ?? null;
  const customKeys = useMemo(() => {
    if (!activePlan) return [] as string[];
    return Object.keys(activePlan.features ?? {}).filter((k) => !PERMISSION_KEY_SET.has(k));
  }, [activePlan]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Package className="w-5 h-5" /> Plan packages
          </h2>
          <p className="text-sm text-muted-foreground">
            Each tab is a plan. Toggle which app features it unlocks. Prices shown in {currency}.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> New plan
        </Button>
      </div>

      {loading ? (
        <div className="glass-card py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : plans.length === 0 ? (
        <div className="glass-card py-16 text-center text-muted-foreground">
          No plans yet. Click <strong>New plan</strong> to create one.
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto p-1 gap-1">
            {plans.map((p) => (
              <TabsTrigger key={p.id} value={p.id} className="gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-[11px] opacity-70">{format(p.price_monthly_cents / 100)}/mo</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {plans.map((p) => {
            const featuresMap: Record<string, any> = p.features ?? {};
            const enabledCount = PERMISSION_GROUPS
              .flatMap((g) => g.items)
              .filter((it) => !!featuresMap[it.key]).length;
            const totalCount = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

            return (
              <TabsContent key={p.id} value={p.id} className="space-y-4">
                {/* Plan summary card */}
                <div className="glass-card p-5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">{p.name}</h3>
                      <span className="text-xs text-muted-foreground font-mono">{p.code}</span>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                      <span>{format(p.price_monthly_cents / 100)} / month</span>
                      <span>·</span>
                      <span>{p.max_users == null ? "Unlimited users" : `${p.max_users} users max`}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <ListChecks className="w-3.5 h-3.5" />
                        {enabledCount} / {totalCount} features
                      </span>
                      {p.stripe_price_id && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{p.stripe_price_id}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEditMeta(p)}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit details
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => handleDelete(p)}
                      disabled={busyId === p.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                      Delete
                    </Button>
                    <Button size="sm" onClick={() => savePlanFeatures(p)} disabled={savingPlanId === p.id}>
                      {savingPlanId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                      Save features
                    </Button>
                  </div>
                </div>

                {/* Feature toggle groups */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {PERMISSION_GROUPS.map((group) => {
                    const groupKeys = group.items.map((i) => i.key);
                    const enabledInGroup = groupKeys.filter((k) => !!featuresMap[k]).length;
                    const allOn = enabledInGroup === groupKeys.length;
                    return (
                      <div key={group.key} className="glass-card p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="font-semibold text-foreground">{group.label}</h4>
                            <p className="text-xs text-muted-foreground">
                              {enabledInGroup} of {groupKeys.length} enabled
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`grp-${p.id}-${group.key}`} className="text-xs text-muted-foreground">
                              {allOn ? "Disable all" : "Enable all"}
                            </Label>
                            <Switch
                              id={`grp-${p.id}-${group.key}`}
                              checked={allOn}
                              onCheckedChange={(v) => toggleGroup(p.id, groupKeys, !!v)}
                            />
                          </div>
                        </div>
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {group.items.map((it) => {
                            const checked = !!featuresMap[it.key];
                            return (
                              <li key={it.key} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-sm text-foreground truncate">{it.label}</p>
                                  <p className="text-[11px] text-muted-foreground font-mono truncate">{it.key}</p>
                                </div>
                                <Switch
                                  checked={checked}
                                  onCheckedChange={(v) => togglePlanFeature(p.id, it.key, !!v)}
                                  aria-label={`${it.label} for ${p.name}`}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {customKeys.length > 0 && p.id === activePlan?.id && (
                  <div className="glass-card p-4 space-y-2">
                    <h4 className="font-semibold text-foreground text-sm">Custom feature flags</h4>
                    <p className="text-xs text-muted-foreground">
                      Keys stored on this plan that are not in the app's permission matrix.
                    </p>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {customKeys.map((k) => (
                        <li key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="text-sm font-mono text-foreground truncate">{k}</span>
                          <Switch
                            checked={!!featuresMap[k]}
                            onCheckedChange={(v) => togglePlanFeature(p.id, k, !!v)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{metaEditing ? "Edit plan details" : "New plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Code</Label>
                <Input
                  value={metaDraft.code}
                  onChange={(e) =>
                    setMetaDraft({ ...metaDraft, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })
                  }
                  placeholder="starter"
                  disabled={!!metaEditing}
                />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={metaDraft.name}
                  onChange={(e) => setMetaDraft({ ...metaDraft, name: e.target.value })}
                  placeholder="Starter"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Price / month ({currency})</Label>
                <Input
                  type="number" min={0} step="0.01"
                  value={metaDraft.price_input}
                  onChange={(e) => setMetaDraft({ ...metaDraft, price_input: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Max users (blank = unlimited)</Label>
                <Input
                  type="number" min={0}
                  value={metaDraft.max_users}
                  onChange={(e) => setMetaDraft({ ...metaDraft, max_users: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Stripe price ID (optional)</Label>
              <Input
                value={metaDraft.stripe_price_id}
                onChange={(e) => setMetaDraft({ ...metaDraft, stripe_price_id: e.target.value })}
                placeholder="price_..."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Feature toggles are managed in the plan's tab after saving.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaOpen(false)}>Cancel</Button>
            <Button onClick={handleMetaSave} disabled={metaSaving}>
              {metaSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-2" />Save</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
