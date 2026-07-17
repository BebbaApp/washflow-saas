import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { broadcastPermissionsChanged } from "@/hooks/usePermissions";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  PERMISSION_GROUPS,
  PermGroup,
  PermissionMatrix,
  Role,
  cacheMatrix,
  getDefaultMatrix,
  loadMatrix,
} from "@/lib/permissions";

const ROLES: { id: Role; label: string; color: string; access: string }[] = [
  { id: "admin", label: "Admin", color: "bg-red-500", access: "Full access" },
  { id: "manager", label: "Manager", color: "bg-sky-500", access: "High access" },
  { id: "supervisor", label: "Supervisor", color: "bg-amber-500", access: "Moderate access" },
  { id: "cashier", label: "Cashier", color: "bg-emerald-500", access: "Basic access" },
];

export function RolePermissions() {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id ?? null;
  const defaults = useMemo(() => getDefaultMatrix(), []);
  const [matrix, setMatrix] = useState<PermissionMatrix>(() => loadMatrix(tenantId));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  // Load from DB whenever tenant changes.
  useEffect(() => {
    if (!tenantId) return;
    hydratedRef.current = false;
    setLoading(true);
    setMatrix(loadMatrix(tenantId));
    (async () => {
      const { data, error } = await supabase
        .from("role_permissions" as any)
        .select("matrix")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!error && data && (data as any).matrix) {
        const next = { ...defaults, ...((data as any).matrix as PermissionMatrix) };
        setMatrix(next);
        cacheMatrix(tenantId, next);
      }
      setLoading(false);
      setTimeout(() => { hydratedRef.current = true; }, 0);
    })();
  }, [tenantId, defaults]);

  // Debounced save to DB + broadcast.
  useEffect(() => {
    if (!tenantId || !hydratedRef.current) return;
    cacheMatrix(tenantId, matrix);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      setSaving(true);
      const { error } = await supabase
        .from("role_permissions" as any)
        .upsert(
          { tenant_id: tenantId, matrix, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
          { onConflict: "tenant_id" },
        );
      setSaving(false);
      if (error) {
        toast({ title: "Failed to save permissions", description: error.message, variant: "destructive" });
      } else {
        broadcastPermissionsChanged();
      }
    }, 500);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [matrix, tenantId, user?.id, toast]);

  const toggle = (key: string, role: Role) => {
    setMatrix((m) => ({ ...m, [key]: { ...m[key], [role]: !m[key]?.[role] } }));
  };

  const toggleGroup = (group: PermGroup, role: Role) => {
    const allOn = group.items.every((it) => matrix[it.key]?.[role]);
    setMatrix((m) => {
      const next = { ...m };
      for (const it of group.items) {
        next[it.key] = { ...next[it.key], [role]: !allOn };
      }
      return next;
    });
  };

  const collapseAll = () => {
    const allCollapsed = PERMISSION_GROUPS.every((g) => collapsed[g.key]);
    const next: Record<string, boolean> = {};
    for (const g of PERMISSION_GROUPS) next[g.key] = !allCollapsed;
    setCollapsed(next);
  };

  const reset = () => {
    if (!confirm("Reset all role permissions to defaults?")) return;
    setMatrix(defaults);
    toast({ title: "Permissions reset to defaults" });
  };

  const totalPerms = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Role Permissions
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define which permissions each role level has. Click checkboxes to enable/disable permissions.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {(loading || saving) && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {loading ? "Loading…" : "Saving…"}
            </span>
          )}

          <button
            onClick={collapseAll}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity w-full sm:w-auto"
          >
            <ChevronDown className="w-4 h-4" /> Collapse All
          </button>
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity w-full sm:w-auto"
          >
            <RotateCcw className="w-4 h-4" /> Reset to Defaults
          </button>
        </div>
      </div>

      {/* Role legend */}
      <div className="glass-card p-3 flex items-center gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">Role Colors:</span>
        {ROLES.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className={`w-4 h-4 rounded-sm ${r.color}`} />
            <span className="text-foreground font-medium">{r.label}</span>
          </div>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {totalPerms} permissions across {PERMISSION_GROUPS.length} categories
        </span>
      </div>

      {/* Permission matrix */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40">
              <tr>
                <th className="text-left font-medium text-muted-foreground px-4 py-3 min-w-[260px]">Permission</th>
                {ROLES.map((r) => (
                  <th key={r.id} className="px-3 py-3 text-center min-w-[120px]">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold text-white ${r.color}`}>
                      {r.label}
                    </span>
                    <div className="text-[11px] text-muted-foreground mt-1">{r.access}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => {
                const isCollapsed = !!collapsed[group.key];
                return (
                  <Fragment key={group.key}>
                    <tr className="bg-secondary/20 border-t border-border">
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                          className="flex items-center gap-2 text-foreground font-semibold"
                        >
                          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {group.label}
                          <span className="text-xs text-muted-foreground font-normal">({group.items.length})</span>
                        </button>
                      </td>
                      {ROLES.map((r) => {
                        const allOn = group.items.every((it) => matrix[it.key]?.[r.id]);
                        const someOn = group.items.some((it) => matrix[it.key]?.[r.id]);
                        return (
                          <td key={r.id} className="px-3 py-2.5 text-center">
                            <Checkbox
                              checked={allOn ? true : someOn ? "indeterminate" : false}
                              onCheckedChange={() => toggleGroup(group, r.id)}
                              aria-label={`Toggle all ${group.label} for ${r.label}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {!isCollapsed && group.items.map((it) => (
                      <tr key={it.key} className="border-t border-border/60 hover:bg-secondary/20">
                        <td className="px-4 py-2 pl-10 text-foreground">{it.label}</td>
                        {ROLES.map((r) => (
                          <td key={r.id} className="px-3 py-2 text-center">
                            <Checkbox
                              checked={!!matrix[it.key]?.[r.id]}
                              onCheckedChange={() => toggle(it.key, r.id)}
                              aria-label={`${it.label} for ${r.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Permissions are stored per workspace in the database and sync to every signed-in device in real time. They control which UI controls are exposed; server-side enforcement is handled by RLS policies and edge function role checks.
      </p>
    </div>
  );
}
