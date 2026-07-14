import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserMinus } from "lucide-react";

type Row = { tenant_id: string; user_id: string; tenant_role: "owner" | "admin" | "member" };
type Tenant = { id: string; name: string; slug: string };
type Profile = { user_id: string; name: string | null };

async function fetchStaff() {
  const { data, error } = await supabase.functions.invoke("owner-staff", { body: { action: "list" } });
  if (error) throw error;
  return data as { tenants: Tenant[]; members: Row[]; profiles: Profile[]; emails: Record<string, string> };
}

export function OwnerGlobalStaff() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["owner-staff"], queryFn: fetchStaff });
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!data) return [];
    const nameOf = new Map(data.profiles.map((p) => [p.user_id, p.name ?? ""]));
    const byUser = new Map<string, { user_id: string; name: string; email: string; roles: Map<string, Row["tenant_role"]> }>();
    for (const m of data.members) {
      const entry = byUser.get(m.user_id) ?? {
        user_id: m.user_id,
        name: nameOf.get(m.user_id) || "",
        email: data.emails[m.user_id] || "",
        roles: new Map<string, Row["tenant_role"]>(),
      };
      entry.roles.set(m.tenant_id, m.tenant_role);
      byUser.set(m.user_id, entry);
    }
    let list = Array.from(byUser.values());
    if (roleFilter !== "all") list = list.filter((u) => Array.from(u.roles.values()).includes(roleFilter as any));
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
    }
    return list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [data, q, roleFilter]);

  const call = async (body: any, label: string) => {
    setBusy(label);
    try {
      const { error } = await supabase.functions.invoke("owner-staff", { body });
      if (error) throw error;
      toast({ title: "Updated" });
      await qc.invalidateQueries({ queryKey: ["owner-staff"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading staff…</div>;
  const tenants = data?.tenants ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left p-3">User</th>
              {tenants.map((t) => <th key={t.id} className="text-left p-3">{t.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {grouped.map((u) => (
              <tr key={u.user_id} className="border-t border-border/50 align-top">
                <td className="p-3">
                  <p className="font-medium">{u.name || u.email || u.user_id.slice(0, 8)}</p>
                  <p className="text-[11px] text-muted-foreground">{u.email}</p>
                </td>
                {tenants.map((t) => {
                  const role = u.roles.get(t.id);
                  const key = `${u.user_id}-${t.id}`;
                  if (!role) return <td key={t.id} className="p-3 text-muted-foreground text-xs">—</td>;
                  return (
                    <td key={t.id} className="p-3">
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={role}
                          onValueChange={(v) => call(
                            { action: "update_role", tenant_id: t.id, user_id: u.user_id, tenant_role: v },
                            key,
                          )}
                        >
                          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                          onClick={() => call({ action: "remove", tenant_id: t.id, user_id: u.user_id }, key + "-rm")}
                          disabled={busy === key + "-rm"}
                          title="Remove from this workspace"
                        >
                          {busy === key + "-rm" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {grouped.length === 0 && (
              <tr><td className="p-6 text-center text-muted-foreground text-sm" colSpan={tenants.length + 1}>No staff found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
