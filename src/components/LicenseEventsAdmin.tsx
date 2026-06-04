import { useEffect, useMemo, useState } from "react";
import { Loader2, Filter, RefreshCw, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LicenseEvent {
  id: string;
  tenant_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface TenantRow {
  id: string;
  name: string;
}

const PAGE_SIZE = 100;

export function LicenseEventsAdmin() {
  const { toast } = useToast();
  const [events, setEvents] = useState<LicenseEvent[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [resyncing, setResyncing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tenants" as any)
        .select("id, name")
        .order("name");
      setTenants(((data as any) ?? []) as TenantRow[]);
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("license_events" as any)
      .select("id, tenant_id, kind, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (tenantFilter !== "all") q = q.eq("tenant_id", tenantFilter);
    if (kindFilter !== "all") q = q.eq("kind", kindFilter);
    if (from) q = q.gte("created_at", `${from}T00:00:00Z`);
    if (to) q = q.lte("created_at", `${to}T23:59:59Z`);

    const { data, error } = await q;
    if (error) {
      toast({ title: "Load failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rows = ((data as any) ?? []) as LicenseEvent[];
    setEvents(rows);
    // Refresh known event types from results
    setEventTypes((prev) => {
      const merged = new Set([...prev, ...rows.map((r) => r.kind)]);
      return [...merged].sort();
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantFilter, kindFilter, from, to]);

  const tenantName = useMemo(() => {
    const map = new Map(tenants.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? map.get(id) ?? id.slice(0, 8) : "—");
  }, [tenants]);

  const resyncCurrent = async () => {
    if (tenantFilter === "all") {
      toast({
        title: "Pick a tenant",
        description: "Filter by a specific tenant before resyncing.",
        variant: "destructive",
      });
      return;
    }
    setResyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("resync-tenant-billing", {
        body: { tenant_id: tenantFilter },
      });
      if (error) throw error;
      toast({
        title: "Resync complete",
        description: `Synced ${(data as any)?.summary?.invoices_synced ?? 0} invoices, ${(data as any)?.summary?.subscriptions_found ?? 0} subs.`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Resync failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setResyncing(false);
    }
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">License events</h4>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={resyncCurrent}
            disabled={resyncing || tenantFilter === "all"}
            title={tenantFilter === "all" ? "Filter by a tenant first" : "Resync this tenant from Stripe"}
          >
            {resyncing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
            Resync from Stripe
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <div>
          <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Tenant
          </label>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tenants</SelectItem>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Event type</label>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypes.map((k) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[160px_140px_1fr_80px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
          <div>When</div>
          <div>Tenant</div>
          <div>Event</div>
          <div className="text-right">Details</div>
        </div>
        {loading && events.length === 0 ? (
          <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : events.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No events match these filters.</div>
        ) : (
          <ul className="divide-y divide-border max-h-[480px] overflow-y-auto">
            {events.map((ev) => (
              <li key={ev.id} className="text-xs">
                <button
                  onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  className="w-full grid grid-cols-[160px_140px_1fr_80px] gap-2 px-3 py-2 items-center hover:bg-muted/30 text-left"
                >
                  <span className="text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>
                  <span className="truncate text-foreground">{tenantName(ev.tenant_id)}</span>
                  <span className="font-mono text-foreground truncate">{ev.kind}</span>
                  <span className="text-right text-primary">{expanded === ev.id ? "Hide" : "Show"}</span>
                </button>
                {expanded === ev.id && (
                  <pre className="px-3 pb-3 text-[11px] font-mono text-muted-foreground bg-muted/10 overflow-x-auto">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Showing up to {PAGE_SIZE} most-recent events. Use filters to narrow further.
      </p>
    </div>
  );
}
