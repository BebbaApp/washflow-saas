import { useEffect, useMemo, useState } from "react";
import { Loader2, Shield, ShieldOff, Search, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/useTenant";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface PlatformUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_platform_admin: boolean;
  is_super_admin: boolean;
  memberships: Array<{ tenant_id: string; tenant_role: string }>;
}

interface TenantRow { id: string; name: string }

export function UsersAdmin() {
  const { toast } = useToast();
  const { isSuperAdmin } = useTenant();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "list_users" },
    });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setUsers(((data as any)?.users ?? []) as PlatformUser[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.from("tenants" as any).select("id, name").order("name")
      .then(({ data }) => setTenants(((data as any) ?? []) as TenantRow[]));
  }, []);

  const tenantName = useMemo(() => {
    const m = new Map(tenants.map((t) => [t.id, t.name]));
    return (id: string) => m.get(id) ?? id.slice(0, 8);
  }, [tenants]);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (tenantFilter !== "all" && !u.memberships.some((m) => m.tenant_id === tenantFilter)) return false;
      if (search) {
        const s = search.toLowerCase();
        return u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s);
      }
      return true;
    });
  }, [users, search, tenantFilter]);

  const action = async (body: Record<string, unknown>, id: string, msg: string) => {
    setBusy(id);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", { body });
      if (error) throw error;
      toast({ title: msg });
      await load();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const cols = isSuperAdmin
    ? "grid-cols-[2fr_2fr_1fr_120px_140px]"
    : "grid-cols-[2fr_2fr_1fr_120px]";

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Email or name…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-8 w-64"
            />
          </div>
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className={`grid ${cols} gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30`}>
          <div>User</div>
          <div>Workspaces</div>
          <div>Last seen</div>
          <div className="text-right">Platform</div>
          {isSuperAdmin && <div className="text-right">Super admin</div>}
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "No users match."}
          </div>
        ) : (
          <ul className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {filtered.map((u) => (
              <li key={u.id} className={`grid ${cols} gap-2 px-3 py-3 items-center text-sm`}>
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                    {u.name || u.email}
                    {u.is_super_admin && <Crown className="w-3 h-3 text-amber-500" aria-label="Super admin" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {u.memberships.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">No workspaces</span>
                  ) : u.memberships.map((m) => (
                    <span key={m.tenant_id}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                      {tenantName(m.tenant_id)} · {m.tenant_role}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "Never"}
                </div>
                <div className="flex justify-end">
                  {u.is_platform_admin ? (
                    <Button
                      size="sm" variant="outline" disabled={busy === u.id || u.is_super_admin}
                      title={u.is_super_admin ? "Revoke super admin first" : undefined}
                      onClick={() => action(
                        { action: "revoke_platform_admin", user_id: u.id }, u.id, "Platform admin revoked")}
                    >
                      <ShieldOff className="w-3.5 h-3.5 mr-1" /> Revoke
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="ghost" disabled={busy === u.id}
                      onClick={() => action(
                        { action: "grant_platform_admin", user_id: u.id }, u.id, "Platform admin granted")}
                    >
                      <Shield className="w-3.5 h-3.5 mr-1" /> Make admin
                    </Button>
                  )}
                </div>
                {isSuperAdmin && (
                  <div className="flex justify-end">
                    {u.is_super_admin ? (
                      <Button
                        size="sm" variant="outline" disabled={busy === u.id}
                        onClick={() => action(
                          { action: "revoke_super_admin", user_id: u.id }, u.id, "Super admin revoked")}
                      >
                        <ShieldOff className="w-3.5 h-3.5 mr-1" /> Revoke
                      </Button>
                    ) : (
                      <Button
                        size="sm" variant="ghost" disabled={busy === u.id}
                        onClick={() => action(
                          { action: "grant_super_admin", user_id: u.id }, u.id, "Super admin granted")}
                      >
                        <Crown className="w-3.5 h-3.5 mr-1" /> Make super
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {isSuperAdmin
          ? "Super admins bypass plan-based feature gating in every tenant. Granting super admin also grants platform admin."
          : "Only super admins can grant or revoke the super-admin role."}
        {" "}Changes take effect on the affected user's next page load or tenant switch.
      </p>
    </div>
  );
}
