import { useEffect, useState } from "react";
import { Loader2, History, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Row {
  id: string;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  from_role: string | null;
  to_role: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const ACTIONS = [
  "all",
  "invite.created", "invite.accepted", "invite.revoked",
  "member.role_updated", "member.removed", "member.left",
  "tenant.settings_updated", "tenant.billing_updated",
  "platform_admin.granted", "platform_admin.revoked",
  "receipt_settings.updated",
] as const;

const LABEL: Record<string, string> = {
  "invite.created": "Invite created",
  "invite.accepted": "Invite accepted",
  "invite.revoked": "Invite revoked",
  "invite.expired": "Invite expired",
  "member.role_updated": "Role updated",
  "member.removed": "Member removed",
  "member.left": "Member left",
  "tenant.settings_updated": "Workspace settings updated",
  "tenant.billing_updated": "Billing / plan updated",
  "platform_admin.granted": "Platform admin granted",
  "platform_admin.revoked": "Platform admin revoked",
  "receipt_settings.updated": "Receipt settings updated",
};

export function MembershipAuditLog() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<typeof ACTIONS[number]>("all");

  useEffect(() => {
    if (!tenant) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      let q = supabase.from("membership_audit_log" as any)
        .select("*").eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false }).limit(200);
      if (filter !== "all") q = q.eq("action", filter);
      const { data } = await q;
      if (!cancel) { setRows(((data as any) ?? []) as Row[]); setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [tenant?.id, filter]);

  if (!tenant) return null;

  return (
    <div className="glass-card p-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> Membership activity
        </h3>
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a === "all" ? "All actions" : LABEL[a] ?? a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">No activity yet.</div>
      ) : (
        <ul className="divide-y divide-border max-h-[420px] overflow-auto">
          {rows.map((r) => (
            <li key={r.id} className="py-2 grid grid-cols-[1fr_auto] gap-2 text-xs">
              <div className="min-w-0">
                <div className="text-foreground font-medium truncate">{LABEL[r.action] ?? r.action}</div>
                <div className="text-muted-foreground truncate">
                  {r.actor_email ?? "system"}
                  {" → "}
                  {r.target_email ?? (r.target_user_id ? r.target_user_id.slice(0, 8) + "…" : "—")}
                  {r.from_role && r.to_role ? ` (${r.from_role} → ${r.to_role})` : r.to_role ? ` (${r.to_role})` : ""}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                {new Date(r.created_at).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
