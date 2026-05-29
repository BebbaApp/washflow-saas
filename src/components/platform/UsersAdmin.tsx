import { useEffect, useMemo, useState } from "react";
import { Loader2, Shield, ShieldOff, Search, Crown, ChevronDown, Building2, Users as UsersIcon, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/useTenant";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const NO_WORKSPACE = "__none__";

export function UsersAdmin() {
  const { toast } = useToast();
  const { isSuperAdmin } = useTenant();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

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

  const matchesSearch = (u: PlatformUser) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s);
  };

  const { superAdmins, byWorkspace } = useMemo(() => {
    const supers: PlatformUser[] = [];
    const map = new Map<string, PlatformUser[]>();
    for (const u of users) {
      if (!matchesSearch(u)) continue;
      if (u.is_super_admin) {
        supers.push(u);
        continue;
      }
      if (u.memberships.length === 0) {
        const arr = map.get(NO_WORKSPACE) ?? [];
        arr.push(u);
        map.set(NO_WORKSPACE, arr);
      } else {
        for (const m of u.memberships) {
          const arr = map.get(m.tenant_id) ?? [];
          arr.push(u);
          map.set(m.tenant_id, arr);
        }
      }
    }
    // sort workspaces by name
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === NO_WORKSPACE) return 1;
      if (b[0] === NO_WORKSPACE) return -1;
      return tenantName(a[0]).localeCompare(tenantName(b[0]));
    });
    return { superAdmins: supers, byWorkspace: entries };
  }, [users, search, tenants]);

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

  const toggle = (key: string) =>
    setOpenMap((m) => ({ ...m, [key]: !(m[key] ?? false) }));
  const isOpen = (key: string) => openMap[key] ?? false;

  // Assign user dialog state
  const [assignTenantId, setAssignTenantId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignRole, setAssignRole] = useState<"owner" | "admin" | "member">("member");
  const [assigning, setAssigning] = useState(false);

  const openAssign = (tid: string) => {
    setAssignTenantId(tid);
    setAssignEmail("");
    setAssignRole("member");
  };

  const submitAssign = async () => {
    if (!assignTenantId) return;
    const email = assignEmail.trim().toLowerCase();
    if (!email) return;
    setAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "invite_user_to_tenant",
          tenant_id: assignTenantId,
          email,
          tenant_role: assignRole,
          redirect_to: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      const invited = (data as any)?.invited;
      toast({
        title: invited ? "Invite email sent" : "User assigned",
        description: invited
          ? `${email} will receive an email to set up credentials.`
          : `${email} added to the workspace.`,
      });
      setAssignTenantId(null);
      await load();
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    } finally {
      setAssigning(false);
    }
  };


  const renderUserRow = (u: PlatformUser, ctxRole?: string) => (
    <li key={`${u.id}-${ctxRole ?? "super"}`} className="grid grid-cols-[2fr_2fr_1fr_120px_140px] gap-2 px-3 py-3 items-center text-sm">
      <div className="min-w-0">
        <div className="font-medium text-foreground truncate flex items-center gap-1.5">
          {u.name || u.email}
          {u.is_super_admin && <Crown className="w-3 h-3 text-amber-500" aria-label="Super admin" />}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
      </div>
      <div className="text-xs text-muted-foreground">
        {ctxRole ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground capitalize">
            {ctxRole}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
            Platform-wide access
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "Never"}
      </div>
      <div className="flex justify-end">
        {u.is_platform_admin ? (
          <Button
            size="sm" variant="outline" disabled={busy === u.id || u.is_super_admin}
            title={u.is_super_admin ? "Revoke super admin first" : undefined}
            onClick={() => action({ action: "revoke_platform_admin", user_id: u.id }, u.id, "Platform admin revoked")}
          >
            <ShieldOff className="w-3.5 h-3.5 mr-1" /> Revoke
          </Button>
        ) : (
          <Button
            size="sm" variant="ghost" disabled={busy === u.id}
            onClick={() => action({ action: "grant_platform_admin", user_id: u.id }, u.id, "Platform admin granted")}
          >
            <Shield className="w-3.5 h-3.5 mr-1" /> Make admin
          </Button>
        )}
      </div>
      <div className="flex justify-end">
        {isSuperAdmin && (
          u.is_super_admin ? (
            <Button
              size="sm" variant="outline" disabled={busy === u.id}
              onClick={() => action({ action: "revoke_super_admin", user_id: u.id }, u.id, "Super admin revoked")}
            >
              <ShieldOff className="w-3.5 h-3.5 mr-1" /> Revoke
            </Button>
          ) : (
            <Button
              size="sm" variant="ghost" disabled={busy === u.id}
              onClick={() => action({ action: "grant_super_admin", user_id: u.id }, u.id, "Super admin granted")}
            >
              <Crown className="w-3.5 h-3.5 mr-1" /> Make super
            </Button>
          )
        )}
      </div>
    </li>
  );

  const headerRow = (
    <div className="grid grid-cols-[2fr_2fr_1fr_120px_140px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
      <div>User</div>
      <div>Role</div>
      <div>Last seen</div>
      <div className="text-right">Platform</div>
      <div className="text-right">Super admin</div>
    </div>
  );

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Email or name…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-8 w-64"
          />
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {/* Super Admins */}
      <div className="border border-amber-500/30 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10">
          <Crown className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-foreground">Super Admins</h3>
          <span className="text-[11px] text-muted-foreground">({superAdmins.length})</span>
        </div>
        {headerRow}
        {superAdmins.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">No super admins.</div>
        ) : (
          <ul className="divide-y divide-border">{superAdmins.map((u) => renderUserRow(u))}</ul>
        )}
      </div>

      {/* Workspaces */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <UsersIcon className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Users by Workspace</h3>
        </div>
        {loading && byWorkspace.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
        ) : byWorkspace.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground border border-border rounded-lg">
            No users match.
          </div>
        ) : (
          byWorkspace.map(([tid, list]) => {
            const label = tid === NO_WORKSPACE ? "No workspace" : tenantName(tid);
            const open = isOpen(tid);
            // dedupe in case of multiple roles (shouldn't happen but safe)
            const seen = new Set<string>();
            const unique = list.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
            return (
              <Collapsible key={tid} open={open} onOpenChange={() => toggle(tid)}>
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors">
                    <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left">
                      <ChevronDown className={`w-4 h-4 transition-transform ${open ? "" : "-rotate-90"}`} />
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {unique.length} {unique.length === 1 ? "user" : "users"}
                      </span>
                    </CollapsibleTrigger>
                    {tid !== NO_WORKSPACE && (
                      <Button
                        size="sm" variant="ghost" className="h-7"
                        onClick={(e) => { e.stopPropagation(); openAssign(tid); }}
                      >
                        <UserPlus className="w-3.5 h-3.5 mr-1" /> Assign user
                      </Button>
                    )}
                  </div>
                  <CollapsibleContent>
                    {headerRow}
                    <ul className="divide-y divide-border">
                      {unique.map((u) => {
                        const role = tid === NO_WORKSPACE
                          ? undefined
                          : u.memberships.find((m) => m.tenant_id === tid)?.tenant_role;
                        return renderUserRow(u, role ?? "—");
                      })}
                    </ul>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {isSuperAdmin
          ? "Super admins bypass plan-based feature gating in every tenant and appear in the top table only. Granting super admin also grants platform admin."
          : "Only super admins can grant or revoke the super-admin role."}
        {" "}Changes take effect on the affected user's next page load or tenant switch.
      </p>

      <Dialog open={!!assignTenantId} onOpenChange={(o) => !o && setAssignTenantId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign user to workspace</DialogTitle>
            <DialogDescription>
              {assignTenantId && `Add a user to ${tenantName(assignTenantId)}. If they don't have an account yet, they'll receive an email to set up login credentials.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="assign-email" className="text-xs">Email</Label>
              <Input
                id="assign-email" type="email" placeholder="user@example.com"
                value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Workspace role</Label>
              <Select value={assignRole} onValueChange={(v) => setAssignRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignTenantId(null)} disabled={assigning}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={assigning || !assignEmail.trim()}>
              {assigning ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
              Assign & send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
