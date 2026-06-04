import { useEffect, useState } from "react";
import { Save, Loader2, Mail, Trash2, Copy, UserPlus, Crown, ShieldCheck, User as UserIcon, Building2, Truck, Plus, Pencil, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant, TenantRole } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MembershipAuditLog } from "@/components/MembershipAuditLog";
import { useSuppliers, Supplier } from "@/hooks/useSuppliers";

interface MemberRow {
  user_id: string;
  tenant_role: TenantRole;
  created_at: string;
  email?: string;
  name?: string;
}

interface InviteRow {
  id: string;
  email: string;
  tenant_role: TenantRole;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

const ROLE_ICON: Record<TenantRole, JSX.Element> = {
  owner: <Crown className="w-3.5 h-3.5 text-amber-500" />,
  admin: <ShieldCheck className="w-3.5 h-3.5 text-primary" />,
  member: <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />,
};

export function TenantManagementSection() {
  const { tenant, myRole, refresh } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();

  const canManage = myRole === "owner" || myRole === "admin";
  const canRename = myRole === "owner";

  const [name, setName] = useState(tenant?.name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TenantRole>("member");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { setName(tenant?.name ?? ""); }, [tenant?.name]);

  const loadLists = async () => {
    if (!tenant) return;
    setLoadingLists(true);
    const [memRes, invRes] = await Promise.all([
      supabase.from("tenant_members" as any)
        .select("user_id, tenant_role, created_at")
        .eq("tenant_id", tenant.id),
      supabase.from("tenant_invitations" as any)
        .select("id, email, tenant_role, token, created_at, expires_at, accepted_at")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false }),
    ]);
    const rawMembers = ((memRes.data as any) ?? []) as MemberRow[];
    const ids = rawMembers.map((m) => m.user_id);
    let nameMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles" as any)
        .select("user_id, name")
        .in("user_id", ids);
      for (const p of (profs as any[]) ?? []) {
        if (p?.name && String(p.name).trim()) nameMap[p.user_id] = p.name;
      }
    }
    setMembers(rawMembers.map((m) => ({ ...m, name: nameMap[m.user_id] })));
    setInvites(((invRes.data as any) ?? []) as InviteRow[]);
    setLoadingLists(false);
  };

  useEffect(() => { loadLists(); /* eslint-disable-next-line */ }, [tenant?.id]);

  const saveName = async () => {
    if (!tenant || !canRename) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingName(true);
    const { error } = await supabase
      .from("tenants" as any)
      .update({ name: trimmed } as any)
      .eq("id", tenant.id);
    setSavingName(false);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Workspace renamed" });
    refresh();
  };

  const sendInvite = async () => {
    if (!tenant) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-member", {
        body: {
          tenant_id: tenant.id,
          email,
          tenant_role: inviteRole,
          accept_url_base: window.location.origin,
        },
      });
      if (error) throw new Error(error.message);
      setInviteEmail("");
      const link = (data as any)?.accept_url as string | undefined;
      const status = (data as any)?.email_status as "sent" | "skipped" | "failed" | undefined;
      const emailErr = (data as any)?.email_error as string | undefined;

      if (status === "sent") {
        toast({ title: "Invite emailed", description: `Sent to ${email}.` });
      } else if (status === "failed") {
        if (link) { try { await navigator.clipboard.writeText(link); } catch { /* ignore */ } }
        toast({
          title: "Email failed — link copied",
          description: emailErr ?? "Send the copied link manually.",
          variant: "destructive",
        });
      } else {
        if (link) { try { await navigator.clipboard.writeText(link); } catch { /* ignore */ } }
        toast({ title: "Invite created", description: "Email not configured — accept link copied to clipboard." });
      }
      loadLists();
    } catch (e: any) {
      toast({ title: "Invite failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const revokeInvite = async (inv: InviteRow) => {
    if (!tenant) return;
    setBusyId(inv.id);
    const { error } = await supabase.from("tenant_invitations" as any).delete().eq("id", inv.id);
    if (!error) {
      await supabase.from("membership_audit_log" as any).insert({
        tenant_id: tenant.id,
        actor_user_id: user?.id,
        actor_email: user?.email,
        target_email: inv.email,
        action: "invite.revoked",
        to_role: inv.tenant_role,
        payload: { invitation_id: inv.id },
      } as any);
    }
    setBusyId(null);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Invite revoked" });
    loadLists();
  };

  const copyLink = async (inv: InviteRow) => {
    const url = `${window.location.origin}/accept-invite?token=${inv.token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", description: url, variant: "destructive" });
    }
  };

  const changeRole = async (m: MemberRow, role: TenantRole) => {
    if (!tenant) return;
    setBusyId(m.user_id);
    const { error } = await supabase
      .from("tenant_members" as any)
      .update({ tenant_role: role } as any)
      .eq("tenant_id", tenant.id)
      .eq("user_id", m.user_id);
    setBusyId(null);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    loadLists();
  };

  const removeMember = async (m: MemberRow) => {
    if (!tenant) return;
    if (!confirm("Remove this member from the workspace?")) return;
    setBusyId(m.user_id);
    const { error } = await supabase
      .from("tenant_members" as any)
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("user_id", m.user_id);
    setBusyId(null);
    if (error) {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Member removed" });
    loadLists();
  };

  if (!tenant) {
    return <div className="glass-card p-8 text-center text-muted-foreground text-sm">No workspace found.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Workspace name */}
      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Workspace</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canRename} maxLength={80} />
            <p className="text-[11px] text-muted-foreground mt-1">Slug: <span className="font-mono">{tenant.slug}</span></p>
          </div>
          <Button onClick={saveName} disabled={!canRename || savingName || name.trim() === tenant.name}>
            {savingName ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-2" />}
            Save
          </Button>
        </div>
        {!canRename && (
          <p className="text-[11px] text-muted-foreground">Only workspace owners can rename.</p>
        )}
      </div>

      {/* Members */}
      <div className="glass-card p-6 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Members ({members.length})</h3>
        {loadingLists ? (
          <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => {
              const isSelf = m.user_id === user?.id;
              return (
                <li key={m.user_id} className="py-2 flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {ROLE_ICON[m.tenant_role]}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {m.name ?? (isSelf ? "You" : m.user_id.slice(0, 8) + "…")}
                        {isSelf && m.name && <span className="ml-1 text-[11px] text-muted-foreground">(you)</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Joined {new Date(m.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <Select
                    value={m.tenant_role}
                    onValueChange={(v) => changeRole(m, v as TenantRole)}
                    disabled={!canManage || (isSelf && myRole === "owner" && members.filter((x) => x.tenant_role === "owner").length === 1)}
                  >
                    <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner" disabled={myRole !== "owner"}>Owner</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMember(m)}
                    disabled={busyId === m.user_id || (!canManage && !isSelf) || (isSelf && myRole === "owner" && members.filter((x) => x.tenant_role === "owner").length === 1)}
                    title={isSelf ? "Leave workspace" : "Remove member"}
                  >
                    {busyId === m.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Suppliers */}
      <SuppliersSection canManage={canManage} />



      {/* Invitations */}
      {canManage && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" /> Invitations
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TenantRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {myRole === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <UserPlus className="w-3.5 h-3.5 mr-2" />}
              Invite
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Invitees receive an email with an accept link. If email isn't configured (or the send fails), the link is copied to your clipboard as a fallback.
          </p>

          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_90px_120px_120px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
              <div>Email</div><div>Role</div><div>Status</div><div className="text-right">Actions</div>
            </div>
            {invites.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">No invitations yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at).getTime() < Date.now();
                  const status = inv.accepted_at ? "Accepted" : expired ? "Expired" : "Pending";
                  return (
                    <li key={inv.id} className="grid grid-cols-[1fr_90px_120px_120px] gap-2 px-3 py-2 items-center text-xs">
                      <span className="truncate" title={inv.email}>{inv.email}</span>
                      <span className="capitalize text-muted-foreground">{inv.tenant_role}</span>
                      <span className={
                        status === "Accepted" ? "text-emerald-600 dark:text-emerald-400" :
                        status === "Expired" ? "text-destructive" : "text-foreground"
                      }>{status}</span>
                      <div className="flex justify-end gap-1">
                        {!inv.accepted_at && !expired && (
                          <Button size="icon" variant="ghost" onClick={() => copyLink(inv)} title="Copy invite link">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!inv.accepted_at && (
                          <Button size="icon" variant="ghost" onClick={() => revokeInvite(inv)} disabled={busyId === inv.id} title="Revoke">
                            {busyId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {canManage && <MembershipAuditLog />}
    </div>
  );
}

// --------------------------- Suppliers section ---------------------------

function SuppliersSection({ canManage }: { canManage: boolean }) {
  const { suppliers, loading, addSupplier, updateSupplier, deleteSupplier } = useSuppliers();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Supplier, "id">>({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" });
  const [adding, setAdding] = useState(false);

  const startAdd = () => {
    setEditingId(null);
    setDraft({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" });
    setAdding(true);
  };
  const startEdit = (s: Supplier) => {
    setAdding(false);
    setEditingId(s.id);
    setDraft({
      name: s.name,
      contactName: s.contactName ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
  };
  const cancel = () => { setAdding(false); setEditingId(null); };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (editingId) {
      await updateSupplier(editingId, draft);
      toast({ title: "Supplier updated" });
    } else {
      const created = await addSupplier(draft);
      if (!created) { toast({ title: "Could not add supplier", variant: "destructive" }); return; }
      toast({ title: "Supplier added" });
    }
    cancel();
  };

  const remove = async (s: Supplier) => {
    if (!confirm(`Remove supplier "${s.name}"?`)) return;
    await deleteSupplier(s.id);
    toast({ title: "Supplier removed" });
  };

  const formOpen = adding || editingId !== null;

  return (
    <div className="glass-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Truck className="w-4 h-4 text-primary" /> Suppliers ({suppliers.length})
        </h3>
        {canManage && !formOpen && (
          <Button size="sm" onClick={startAdd}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add supplier
          </Button>
        )}
      </div>

      {formOpen && (
        <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Name *</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Contact name</Label>
              <Input value={draft.contactName ?? ""} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} maxLength={120} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} maxLength={40} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input type="email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} maxLength={160} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Address</Label>
              <Input value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} maxLength={240} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} maxLength={240} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancel}>
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
            <Button size="sm" onClick={save}>
              <Check className="w-3.5 h-3.5 mr-1" /> {editingId ? "Save changes" : "Add"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : suppliers.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No suppliers yet. {canManage && "Click \"Add supplier\" to create one — they'll appear in the inventory item form."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {suppliers.map((s) => (
            <li key={s.id} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "No contact details"}
                </div>
              </div>
              {canManage && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(s)} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s)} title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

