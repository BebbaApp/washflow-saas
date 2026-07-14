import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import {
  ScrollText,
  Loader2,
  RefreshCw,
  UserCog,
  ShoppingCart,
  Package,
  Clock,
  CreditCard,
  Building2,
  ReceiptText,
  Shield,
  Filter,
} from "lucide-react";

/* ─────────── Types ─────────── */
type LogSource =
  | "member"
  | "order"
  | "inventory"
  | "attendance"
  | "license"
  | "receipt"
  | "tenant";

type UnifiedLog = {
  id: string;
  source: LogSource;
  action: string;
  detail: string;
  actorUserId: string | null;
  actorName: string | null;
  targetName: string | null;
  createdAt: string;
};

const SOURCE_META: Record<LogSource, { label: string; icon: any; tint: string }> = {
  member: { label: "Members", icon: UserCog, tint: "text-blue-500" },
  order: { label: "Orders", icon: ShoppingCart, tint: "text-emerald-500" },
  inventory: { label: "Inventory", icon: Package, tint: "text-amber-500" },
  attendance: { label: "Attendance", icon: Clock, tint: "text-purple-500" },
  license: { label: "Billing", icon: CreditCard, tint: "text-pink-500" },
  receipt: { label: "Receipt", icon: ReceiptText, tint: "text-cyan-500" },
  tenant: { label: "Workspace", icon: Building2, tint: "text-indigo-500" },
};

const SOURCE_FILTERS: (LogSource | "all")[] = [
  "all",
  "order",
  "inventory",
  "member",
  "attendance",
  "license",
  "receipt",
  "tenant",
];

/* ─────────── Section ─────────── */
export function ActivityLogsSection() {
  const { tenantId } = useTenant();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<UnifiedLog[]>([]);
  const [filter, setFilter] = useState<LogSource | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const LIMIT = 300;
      const [members, orders, inv, att, lic, rec, tenantRow] = await Promise.all([
        supabase
          .from("membership_audit_log" as any)
          .select("id, created_at, action, actor_user_id, actor_email, target_user_id, target_email, from_role, to_role, payload")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("orders")
          .select("id, order_number, status, created_at, updated_at, completed_at, created_by, customer, vehicle, service")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("inventory_transactions")
          .select("id, created_at, type, delta, item_name, source, notes, total_cost")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("attendance_audit_log")
          .select("id, created_at, action, reason, acted_by, target_user_id, original_status")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("license_events" as any)
          .select("id, created_at, kind, payload")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("receipt_settings")
          .select("updated_at, updated_by, business_name")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("tenants")
          .select("id, name, created_at, current_period_end")
          .eq("id", tenantId)
          .maybeSingle(),
      ]);

      // Collect all user ids to resolve names in one shot
      const userIds = new Set<string>();
      const collect = (id: string | null | undefined) => id && userIds.add(id);
      (members.data ?? []).forEach((m: any) => {
        collect(m.actor_user_id);
        collect(m.target_user_id);
      });
      (orders.data ?? []).forEach((o: any) => collect(o.created_by));
      (att.data ?? []).forEach((a: any) => {
        collect(a.acted_by);
        collect(a.target_user_id);
      });
      if (rec.data?.updated_by) collect(rec.data.updated_by);

      let nameMap = new Map<string, string>();
      if (userIds.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, name")
          .in("user_id", Array.from(userIds));
        (profs ?? []).forEach((p: any) => nameMap.set(p.user_id, p.name));
      }

      const nameOf = (id: string | null | undefined, fallback?: string | null) =>
        (id && nameMap.get(id)) || fallback || (id ? id.slice(0, 8) : null);

      const unified: UnifiedLog[] = [];

      (members.data ?? []).forEach((m: any) => {
        let detail = m.action.replace(/^member\.|^tenant\.|^platform_admin\.|^receipt_settings\./, "").replace(/_/g, " ");
        if (m.from_role || m.to_role) detail += ` (${m.from_role ?? "?"} → ${m.to_role ?? "?"})`;
        const source: LogSource = m.action.startsWith("receipt_settings")
          ? "receipt"
          : m.action.startsWith("tenant.")
            ? "tenant"
            : "member";
        unified.push({
          id: `m-${m.id}`,
          source,
          action: m.action,
          detail,
          actorUserId: m.actor_user_id,
          actorName: nameOf(m.actor_user_id, m.actor_email),
          targetName: nameOf(m.target_user_id, m.target_email),
          createdAt: m.created_at,
        });
      });

      (orders.data ?? []).forEach((o: any) => {
        // Create event
        unified.push({
          id: `o-c-${o.id}`,
          source: "order",
          action: "order.created",
          detail: `Created ${o.order_number} · ${o.customer} · ${o.vehicle} · ${o.service}`,
          actorUserId: o.created_by,
          actorName: nameOf(o.created_by),
          targetName: o.order_number,
          createdAt: o.created_at,
        });
        // Completion event
        if (o.completed_at) {
          unified.push({
            id: `o-x-${o.id}`,
            source: "order",
            action: "order.completed",
            detail: `Completed ${o.order_number} · ${o.customer}`,
            actorUserId: o.created_by,
            actorName: nameOf(o.created_by),
            targetName: o.order_number,
            createdAt: o.completed_at,
          });
        } else if (o.status === "cancelled") {
          unified.push({
            id: `o-k-${o.id}`,
            source: "order",
            action: "order.cancelled",
            detail: `Cancelled ${o.order_number} · ${o.customer}`,
            actorUserId: o.created_by,
            actorName: nameOf(o.created_by),
            targetName: o.order_number,
            createdAt: o.updated_at,
          });
        }
      });

      (inv.data ?? []).forEach((t: any) => {
        const sign = t.delta > 0 ? "+" : "";
        const money = t.total_cost ? ` · ${t.total_cost}` : "";
        unified.push({
          id: `i-${t.id}`,
          source: "inventory",
          action: `inventory.${t.type}`,
          detail: `${t.type} ${sign}${t.delta} of ${t.item_name}${money}${t.notes ? ` · ${t.notes}` : ""}`,
          actorUserId: null,
          actorName: t.source ?? null,
          targetName: t.item_name,
          createdAt: t.created_at,
        });
      });

      (att.data ?? []).forEach((a: any) => {
        unified.push({
          id: `a-${a.id}`,
          source: "attendance",
          action: `attendance.${a.action}`,
          detail: `${a.action}${a.original_status ? ` (was ${a.original_status})` : ""} · ${a.reason ?? ""}`,
          actorUserId: a.acted_by,
          actorName: nameOf(a.acted_by),
          targetName: nameOf(a.target_user_id),
          createdAt: a.created_at,
        });
      });

      (lic.data ?? []).forEach((l: any) => {
        unified.push({
          id: `l-${l.id}`,
          source: "license",
          action: `license.${l.kind}`,
          detail: l.kind.replace(/_/g, " "),
          actorUserId: null,
          actorName: "system",
          targetName: null,
          createdAt: l.created_at,
        });
      });

      if (rec.data?.updated_at) {
        unified.push({
          id: `r-${rec.data.updated_at}`,
          source: "receipt",
          action: "receipt.settings_updated",
          detail: `Receipt settings updated (${rec.data.business_name})`,
          actorUserId: rec.data.updated_by ?? null,
          actorName: nameOf(rec.data.updated_by),
          targetName: null,
          createdAt: rec.data.updated_at,
        });
      }

      if (tenantRow.data) {
        unified.push({
          id: `t-${tenantRow.data.id}`,
          source: "tenant",
          action: "tenant.created",
          detail: `Workspace "${tenantRow.data.name}" created`,
          actorUserId: null,
          actorName: "system",
          targetName: tenantRow.data.name,
          createdAt: tenantRow.data.created_at,
        });
      }

      unified.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setLogs(unified);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter !== "all" && l.source !== filter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.detail.toLowerCase().includes(q) ||
        (l.actorName ?? "").toLowerCase().includes(q) ||
        (l.targetName ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, filter, search]);

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-primary" />
              Activity Log
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Every recorded action across your workspace — members, orders, inventory, attendance, billing and workspace settings — with user, date and time.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </div>
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : SOURCE_META[f].label}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action or detail…"
            className="ml-auto min-w-[200px] flex-1 max-w-xs px-3 py-1.5 rounded-md bg-secondary text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {error && (
        <div className="glass-card p-4 border-destructive/40 text-sm text-destructive flex items-center gap-2">
          <Shield className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="glass-card overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No activity recorded yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((l) => {
              const meta = SOURCE_META[l.source];
              const Icon = meta.icon;
              const dt = new Date(l.createdAt);
              return (
                <li key={l.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors">
                  <div className={`shrink-0 mt-0.5 ${meta.tint}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                        {meta.label}
                      </span>
                      <span className="text-sm font-medium text-foreground truncate">{l.action}</span>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">{l.detail}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      {l.actorName && (
                        <span>
                          by <span className="text-foreground font-medium">{l.actorName}</span>
                        </span>
                      )}
                      {l.targetName && l.targetName !== l.actorName && (
                        <span>
                          → <span className="text-foreground">{l.targetName}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums leading-tight">
                    <div>{dt.toLocaleDateString()}</div>
                    <div>{dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
