import { useState, useEffect, useCallback, useRef } from "react";
import { Sun, Moon, Plus, Trash2, Edit2, Save, X, Users, Palette, Package, Phone, DollarSign, Loader2, KeyRound, Shield, Mail, MailCheck, Upload, Camera, Image as ImageIcon, ShieldCheck, Smartphone, Printer, Bluetooth, BluetoothOff, FileText, Eye, CheckCircle2, AlertCircle, CloudOff, Cloud, RefreshCw, CreditCard, Building2, ChevronDown, Wallet } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { VEHICLES } from "@/lib/vehicleUsage";
import { BillingSection } from "@/components/BillingSection";
import { TenantManagementSection } from "@/components/TenantManagementSection";
import { useReceiptSettings } from "@/hooks/useReceiptSettings";
import { buildReceiptModel, isBluetoothSupported, pairPrinter, forgetPrinter, getSavedPrinter, getSavedPrinterName, probePrinterConnection, getPrinterEvents, renderReceiptBytes, sendToPrinter, type ReceiptSettings as ReceiptSettingsType, type PrinterEvent } from "@/lib/thermalPrinter";
import { ReceiptPreview } from "@/components/ReceiptPreview";
import type { WashOrder } from "@/hooks/useOrders";
import { toast as sonnerToast } from "sonner";
import { RolePermissions } from "@/components/RolePermissions";
import { useAppLogo } from "@/hooks/useAppLogo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTheme, themePresets } from "@/hooks/useTheme";

import { useServices, type ServicePackage } from "@/hooks/useServices";
import { useCurrency, CURRENCY_PRESETS } from "@/hooks/useCurrency";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useTenant } from "@/hooks/useTenant";

type WorkerRole = "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";

const ROLE_OPTIONS: { value: WorkerRole; label: string }[] = [
  { value: "washer", label: "Washer" },
  { value: "driver", label: "Driver" },
  { value: "cashier", label: "Cashier" },
  { value: "supervisor", label: "Supervisor" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

async function extractFnError(res: { error: any; data: any }): Promise<{ message: string; version?: string; accepted?: string[] }> {
  let payload: any = res.data && res.data.error ? res.data : null;
  if (!payload && res.error) {
    try {
      const resp = (res.error as any)?.context?.response ?? (res.error as any)?.context;
      if (resp && typeof resp.json === "function") payload = await resp.clone().json();
      else if (resp && typeof resp.text === "function") payload = JSON.parse(await resp.clone().text());
    } catch { /* ignore */ }
  }
  const message = payload?.error || res.error?.message || "Unknown error";
  return { message, version: payload?.function_version, accepted: payload?.accepted_actions };
}

function fnErrorDescription(info: { message: string; version?: string; accepted?: string[] }): string {
  const parts = [info.message];
  if (info.version) parts.push(`version: ${info.version}`);
  if (info.accepted?.length) parts.push(`accepts: ${info.accepted.join(", ")}`);
  return parts.join(" • ");
}

export function SettingsPage() {
  const { can } = usePermissions();
  type TabId = "workers" | "permissions" | "theme" | "services" | "currency" | "receipt" | "printer" | "billing" | "workspace";
  type GroupId = "administration" | "operations";

  const allTabs: { id: TabId; label: string; icon: any; perm: string; group: GroupId }[] = [
    // Administration
    { id: "workers", label: "Workers", icon: Users, perm: "settings.workers", group: "administration" },
    { id: "services", label: "Services", icon: Package, perm: "services.view", group: "administration" },
    { id: "permissions", label: "Role Permissions", icon: ShieldCheck, perm: "settings.permissions", group: "administration" },
    { id: "currency", label: "Currency", icon: DollarSign, perm: "settings.currency", group: "administration" },
    // Operations
    { id: "theme", label: "Appearance", icon: Palette, perm: "settings.appearance", group: "operations" },
    { id: "receipt", label: "Receipt", icon: FileText, perm: "settings.receipt", group: "operations" },
    { id: "printer", label: "Printer", icon: Printer, perm: "settings.printer", group: "operations" },
    { id: "billing", label: "Billing", icon: CreditCard, perm: "settings.billing", group: "operations" },
    { id: "workspace", label: "Workspace", icon: Building2, perm: "settings.workspace", group: "operations" },
  ];

  const tabs = allTabs.filter((t) => can(t.perm));
  const groups: { id: GroupId; label: string }[] = [
    { id: "administration", label: "Administration" },
    { id: "operations", label: "Operations" },
  ].filter((g) => tabs.some((t) => t.group === g.id)) as { id: GroupId; label: string }[];

  const [group, setGroup] = useState<GroupId>(groups[0]?.id ?? "administration");
  const groupTabs = tabs.filter((t) => t.group === group);
  const [section, setSection] = useState<TabId>((groupTabs[0]?.id as TabId) ?? "workers");

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groups.some((g) => g.id === group)) setGroup(groups[0].id);
  }, [groups, group]);

  useEffect(() => {
    if (groupTabs.length === 0) return;
    if (!groupTabs.some((t) => t.id === section)) setSection(groupTabs[0].id);
  }, [groupTabs, section]);

  if (tabs.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-foreground">No settings access</h3>
        <p className="text-sm text-muted-foreground mt-1">Your role doesn't have permission to view any settings sections.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Group Tabs */}
      {groups.length > 1 && (
        <div className="inline-flex p-1 rounded-xl bg-secondary">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                group === g.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groupTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSection(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              section === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {section === "workers" && <WorkersSection />}
      {section === "permissions" && <RolePermissions />}
      {section === "theme" && <ThemeSection />}
      {section === "services" && <ServicesSection />}
      {section === "currency" && <CurrencySection />}
      {section === "receipt" && <ReceiptSection />}
      {section === "printer" && <PrinterSection />}
      {section === "billing" && <BillingSection />}
      {section === "workspace" && <TenantManagementSection />}
    </div>
  );
}


/* ───── Workers ───── */
interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: WorkerRole | null;
  email_confirmed: boolean;
  created_at: string;
  phone?: string | null;
  has_pin?: boolean;
  is_global_admin?: boolean;
  is_super_admin?: boolean;
}

function WorkersSection() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const { user: authUser, loading: authLoading, isAuthenticated } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const canDeleteWorkers = can("settings.workers.delete");

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const [togglingActive, setTogglingActive] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  type Compensation = { pay_type: "salary" | "wage" | "hourly"; base_rate: number; busy_day_rate: number; quiet_day_rate: number };
  const emptyComp = (): Compensation => ({ pay_type: "salary", base_rate: 0, busy_day_rate: 0, quiet_day_rate: 0 });
  const [compMap, setCompMap] = useState<Record<string, Compensation>>({});
  const [savingComp, setSavingComp] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<WorkerRole>("washer");
  const [creating, setCreating] = useState(false);

  // PIN management for existing workers
  const [pinTarget, setPinTarget] = useState<StaffUser | null>(null);
  const [pinPhone, setPinPhone] = useState("");
  const [newPin, setNewPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  const openPinDialog = (u: StaffUser) => {
    setPinTarget(u);
    setPinPhone(u.phone ?? "");
    setNewPin("");
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinTarget) return;
    if (!tenant?.id) {
      toast({ title: "Workspace is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    if (!pinPhone.trim() || !/^\d{4,6}$/.test(newPin)) {
      toast({ title: "Enter a phone number and a 4-6 digit PIN", variant: "destructive" });
      return;
    }
    setSavingPin(true);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "set_pin", tenant_id: tenant?.id, user_id: pinTarget.id, phone: pinPhone.trim(), pin: newPin },
    });
    setSavingPin(false);
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      toast({ title: "Could not set PIN", description: fnErrorDescription(info), variant: "destructive" });
      return;
    }
    toast({ title: "PIN updated", description: `${pinTarget.name || pinTarget.email} can now log in with phone + PIN` });
    setUsers((prev) => prev.map((x) => x.id === pinTarget.id ? { ...x, phone: pinPhone.trim(), has_pin: true } : x));
    setPinTarget(null);
  };

  const handleClearPin = async () => {
    if (!pinTarget) return;
    if (!tenant?.id) {
      toast({ title: "Workspace is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    if (!confirm(`Remove phone + PIN login for ${pinTarget.name || pinTarget.email}?`)) return;
    setSavingPin(true);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "clear_pin", tenant_id: tenant?.id, user_id: pinTarget.id },
    });
    setSavingPin(false);
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      toast({ title: "Could not remove PIN", description: fnErrorDescription(info), variant: "destructive" });
      return;
    }
    toast({ title: "PIN removed" });
    setUsers((prev) => prev.map((x) => x.id === pinTarget.id ? { ...x, phone: null, has_pin: false } : x));
    setPinTarget(null);
  };

  const loadUsers = useCallback(async (silent = false) => {
    if (!isAuthenticated || !authUser) return;
    if (!tenant?.id) {
      setLoading(tenantLoading);
      return;
    }
    if (!silent) setLoading(true);
    setCurrentUserId(authUser.id);

    const res = await supabase.functions.invoke("manage-staff", { body: { action: "list", tenant_id: tenant?.id } });
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      if (!silent) {
        toast({ title: "Could not load staff", description: fnErrorDescription(info), variant: "destructive" });
        setLoading(false);
      }
      return;
    }
    setUsers(res.data.users ?? []);
    // Load active/inactive status (defaults to active if no row exists)
    const { data: statusRows } = await (supabase as any)
      .from("staff_active_status")
      .select("user_id,is_active");
    const m: Record<string, boolean> = {};
    (statusRows || []).forEach((r: any) => { m[r.user_id] = !!r.is_active; });
    setActiveMap(m);
    // Load compensation settings
    const { data: compRows } = await (supabase as any)
      .from("staff_compensation")
      .select("user_id,pay_type,base_rate,busy_day_rate,quiet_day_rate");
    const cm: Record<string, Compensation> = {};
    (compRows || []).forEach((r: any) => {
      cm[r.user_id] = {
        pay_type: (r.pay_type ?? "salary") as Compensation["pay_type"],
        base_rate: Number(r.base_rate ?? 0),
        busy_day_rate: Number(r.busy_day_rate ?? 0),
        quiet_day_rate: Number(r.quiet_day_rate ?? 0),
      };
    });
    setCompMap(cm);
    setLoading(false);
  }, [toast, isAuthenticated, authUser, tenant?.id, tenantLoading]);

  const updateCompLocal = (userId: string, patch: Partial<Compensation>) => {
    setCompMap((m) => ({ ...m, [userId]: { ...(m[userId] ?? emptyComp()), ...patch } }));
  };
  const saveCompensation = async (u: StaffUser) => {
    if (!tenant?.id) return;
    setSavingComp(u.id);
    const cur = compMap[u.id] ?? emptyComp();
    const { data: { user: caller } } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from("staff_compensation")
      .upsert(
        {
          tenant_id: tenant.id,
          user_id: u.id,
          pay_type: cur.pay_type,
          base_rate: cur.base_rate,
          busy_day_rate: cur.busy_day_rate,
          quiet_day_rate: cur.quiet_day_rate,
          updated_at: new Date().toISOString(),
          updated_by: caller?.id ?? null,
        },
        { onConflict: "tenant_id,user_id" }
      );
    setSavingComp(null);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Compensation saved" });
  };

  const toggleActive = async (u: StaffUser, next: boolean) => {
    if (!tenant?.id) return;
    setTogglingActive(u.id);
    const prev = activeMap[u.id] !== false;
    setActiveMap((m) => ({ ...m, [u.id]: next }));
    const { data: { user: caller } } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from("staff_active_status")
      .upsert(
        { tenant_id: tenant.id, user_id: u.id, is_active: next, updated_at: new Date().toISOString(), updated_by: caller?.id ?? null },
        { onConflict: "tenant_id,user_id" }
      );
    setTogglingActive(null);
    if (error) {
      setActiveMap((m) => ({ ...m, [u.id]: prev }));
      toast({ title: "Could not update status", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: next ? "Marked active" : "Marked inactive", description: next ? "Will appear in the day log" : "Hidden from the day log" });
  };

  useEffect(() => {
    if (authLoading || tenantLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    loadUsers();
  }, [authLoading, tenantLoading, isAuthenticated, loadUsers]);

  const handleRoleChange = async (userId: string, newRole: WorkerRole) => {
    if (!tenant?.id) {
      toast({ title: "Workspace is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    setSavingId(userId);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "update_role", tenant_id: tenant?.id, user_id: userId, role: newRole },
    });
    setSavingId(null);
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      toast({ title: "Failed to update role", description: fnErrorDescription(info), variant: "destructive" });
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    toast({ title: "Role updated" });
  };

  const handleDelete = async (u: StaffUser) => {
    if (!tenant?.id) {
      toast({ title: "Workspace is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete ${u.name || u.email}? This cannot be undone.`)) return;
    setDeletingId(u.id);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "delete", tenant_id: tenant?.id, user_id: u.id },
    });
    setDeletingId(null);
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      toast({ title: "Delete failed", description: fnErrorDescription(info), variant: "destructive" });
      return;
    }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    toast({ title: "User deleted" });
  };

  const handleResendVerification = async (u: StaffUser) => {
    if (!tenant?.id) {
      toast({ title: "Workspace is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    setResendingId(u.id);
    const res = await supabase.functions.invoke("manage-staff", {
      body: {
        action: "resend_verification",
        tenant_id: tenant?.id,
        user_id: u.id,
        redirect_to: `${window.location.origin}/auth/callback`,
      },
    });
    setResendingId(null);
    if (res.error || res.data?.error) {
      const info = await extractFnError(res);
      toast({ title: "Failed to send", description: fnErrorDescription(info), variant: "destructive" });
      return;
    }
    toast({ title: "Verification email sent", description: `Sent to ${u.email}` });
  };



  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      toast({ title: "Name, email and password are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await supabase.functions.invoke("create-worker", {
        body: { tenant_id: tenant?.id, email: email.trim(), password, name: name.trim(), role, phone: phone.trim(), pin: pin.trim() || undefined },
      });
      if (res.error || res.data?.error) {
        toast({ title: "Error creating user", description: res.data?.error || res.error?.message || "Unknown error", variant: "destructive" });
        setCreating(false);
        return;
      }
      toast({ title: "Worker created", description: `${name.trim()} can now log in with ${email.trim()}` });
      setName(""); setPhone(""); setEmail(""); setPassword(""); setPin(""); setRole("washer");
      setDialogOpen(false);
      loadUsers();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setCreating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
        </p>
        <button onClick={() => setDialogOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add Worker
        </button>
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
      {!loading && users.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No users yet.</p>}

      <div className="space-y-3">
        {users.map((u) => {
          const isAdminUser = u.role === "admin";
          const isSelf = u.id === currentUserId;
          const isGlobalAdmin = !!u.is_global_admin;
          const isSuperAdminUser = !!u.is_super_admin;
          return (
            <Collapsible
              key={u.id}
              open={openRow === u.id}
              onOpenChange={(o) => setOpenRow(o ? u.id : null)}
              className="glass-card"
            >
              <div className="p-4 flex items-center gap-4 flex-wrap">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    title={openRow === u.id ? "Collapse" : "Expand pay settings"}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${openRow === u.id ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{u.name || "Unnamed"}</p>
                    {isAdminUser && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                        <Shield className="w-3 h-3" /> {isSuperAdminUser ? "Super Admin" : "Admin"}
                      </span>
                    )}
                    {!u.email_confirmed && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">Unverified</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3" /> {u.email}
                  </p>
                  {u.has_pin && u.phone && (
                    <p className="text-[11px] text-primary flex items-center gap-1 truncate mt-0.5">
                      <Smartphone className="w-3 h-3" /> PIN login: {u.phone}
                    </p>
                  )}
                </div>

                {!u.email_confirmed && (
                  <button
                    onClick={() => handleResendVerification(u)}
                    disabled={resendingId === u.id}
                    title="Send verification email"
                    className="h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-warning/10 text-warning hover:bg-warning/20 transition-colors disabled:opacity-60"
                  >
                    {resendingId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailCheck className="w-3.5 h-3.5" />}
                    {resendingId === u.id ? "Sending…" : "Send verification"}
                  </button>
                )}

                <button
                  onClick={() => openPinDialog(u)}
                  title={u.has_pin ? "Edit PIN login" : "Set up PIN login"}
                  className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors ${
                    u.has_pin
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {u.has_pin ? "PIN set" : "Set PIN"}
                </button>


                <Select
                  value={u.role ?? ""}
                  onValueChange={(v: WorkerRole) => handleRoleChange(u.id, v)}
                  disabled={savingId === u.id || isGlobalAdmin}
                >
                  <SelectTrigger className="w-32 h-9 bg-secondary border-border text-foreground">
                    {savingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <SelectValue placeholder="No role" />}
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Active/Inactive toggle — controls visibility in the Day Log & Staff Check-in */}
                {(() => {
                  const isActive = activeMap[u.id] !== false;
                  return (
                    <div className="flex items-center gap-2" title={isActive ? "Active — shown in Day Log & Check-in" : "Inactive — hidden from Day Log & Check-in"}>
                      <span className={`text-[10px] uppercase tracking-wide font-semibold ${isActive ? "text-success" : "text-muted-foreground"}`}>
                        {isActive ? "Active" : "Inactive"}
                      </span>
                      <Switch
                        checked={isActive}
                        disabled={togglingActive === u.id}
                        onCheckedChange={(v) => toggleActive(u, v)}
                      />
                    </div>
                  );
                })()}

                {canDeleteWorkers && (
                  <button
                    onClick={() => handleDelete(u)}
                    disabled={isAdminUser || isSelf || deletingId === u.id}
                    title={isAdminUser ? "Admin users cannot be deleted" : isSelf ? "You cannot delete your own account" : "Delete user"}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                  >
                    {deletingId === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>

              <CollapsibleContent>
                {(() => {
                  const comp = compMap[u.id] ?? emptyComp();
                  const payTypeLabel = comp.pay_type === "salary" ? "Monthly salary" : comp.pay_type === "wage" ? "Daily wage" : "Hourly rate";
                  return (
                    <div className="px-4 pb-4 pt-2 border-t border-border space-y-4">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                        <Wallet className="w-3.5 h-3.5" /> Remuneration
                      </div>

                      {/* Pay type toggles */}
                      <div className="grid sm:grid-cols-3 gap-3">
                        {(["salary","wage","hourly"] as const).map((pt) => {
                          const labels: Record<typeof pt, string> = { salary: "Salary", wage: "Wage", hourly: "Hourly rate" } as any;
                          const checked = comp.pay_type === pt;
                          return (
                            <label
                              key={pt}
                              className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                checked ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40"
                              }`}
                            >
                              <span className="text-sm font-medium text-foreground">{labels[pt]}</span>
                              <Switch checked={checked} onCheckedChange={(v) => v && updateCompLocal(u.id, { pay_type: pt })} />
                            </label>
                          );
                        })}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">{payTypeLabel}</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={comp.base_rate}
                            onChange={(e) => updateCompLocal(u.id, { base_rate: parseFloat(e.target.value) || 0 })}
                            className="bg-secondary border-border"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Rate per vehicle category (for remuneration calculation)</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {VEHICLES.map((v) => (
                            <div key={v} className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">{v}</Label>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={comp.category_rates[v] ?? ""}
                                placeholder="0"
                                onChange={(e) => updateCategoryRate(u.id, v, parseFloat(e.target.value))}
                                className="bg-secondary border-border h-9"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={() => saveCompensation(u)}
                          disabled={savingComp === u.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                        >
                          {savingComp === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Save pay settings
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Add Worker</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Role</Label>
              <Select value={role} onValueChange={(v: WorkerRole) => setRole(v)}>
                <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <KeyRound className="w-4 h-4 text-primary" />
                Login Credentials
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Email *</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="worker@example.com" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Password *</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">PIN (optional, for phone login)</Label>
                <Input type="text" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4-6 digits" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Requires phone number above. Worker can log in with phone + PIN.</p>
              </div>
            </div>

            <button type="submit" disabled={creating} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50">
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              {creating ? "Creating..." : "Add Worker"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pinTarget} onOpenChange={(open) => !open && setPinTarget(null)}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              {pinTarget?.has_pin ? "Update PIN login" : "Set up PIN login"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSavePin} className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              Allow <span className="text-foreground font-medium">{pinTarget?.name || pinTarget?.email}</span> to log in with a phone number and PIN instead of email + password.
            </p>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Phone Number</Label>
              <Input
                value={pinPhone}
                onChange={(e) => setPinPhone(e.target.value)}
                placeholder="+1 234 567 8900"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">New PIN</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                placeholder="4-6 digits"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground tracking-widest"
              />
              <p className="text-xs text-muted-foreground">The PIN is hashed before being stored. The worker won't see the old PIN.</p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={savingPin}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {savingPin && <Loader2 className="w-4 h-4 animate-spin" />}
                {savingPin ? "Saving..." : "Save PIN"}
              </button>
              {pinTarget?.has_pin && (
                <button
                  type="button"
                  onClick={handleClearPin}
                  disabled={savingPin}
                  className="px-3 py-2.5 rounded-lg bg-secondary text-destructive font-medium text-sm hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───── Logo Uploader ───── */
const LOGO_TARGET = 256;
const LOGO_MIN_DIM = 64;
const LOGO_MAX_ASPECT_SKEW = 4;

type LogoBg = "transparent" | "white" | "black" | "primary" | "custom";

function renderLogo(
  img: HTMLImageElement,
  bg: LogoBg,
  customColor: string,
  size = LOGO_TARGET,
): string {
  const { width: w, height: h } = img;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  if (bg !== "transparent") {
    let fill = customColor;
    if (bg === "white") fill = "#ffffff";
    else if (bg === "black") fill = "#000000";
    else if (bg === "primary") {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      fill = v ? `hsl(${v})` : "#0ea5e9";
    }
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  // PNG keeps transparency when bg=transparent.
  let dataUrl = canvas.toDataURL("image/png");
  if (bg !== "transparent" && dataUrl.length > 350_000) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  }
  return dataUrl;
}

function LogoUploader() {
  const { logo, setLogo } = useAppLogo();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<{ img: HTMLImageElement; objectUrl: string } | null>(null);
  const [bg, setBg] = useState<LogoBg>("transparent");
  const [customColor, setCustomColor] = useState("#0ea5e9");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) { setPreviewUrl(null); return; }
    try {
      setPreviewUrl(renderLogo(pending.img, bg, customColor));
    } catch (err: any) {
      toast({ title: "Preview failed", description: err?.message, variant: "destructive" });
    }
  }, [pending, bg, customColor, toast]);

  const closePreview = () => {
    if (pending) URL.revokeObjectURL(pending.objectUrl);
    setPending(null);
    setPreviewUrl(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 5MB before resizing.", variant: "destructive" });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { width: w, height: h } = img;
      if (w < LOGO_MIN_DIM || h < LOGO_MIN_DIM) {
        URL.revokeObjectURL(objectUrl);
        toast({ title: "Image too small", description: `${w}×${h} — minimum ${LOGO_MIN_DIM}×${LOGO_MIN_DIM}.`, variant: "destructive" });
        return;
      }
      const aspect = Math.max(w / h, h / w);
      if (aspect > LOGO_MAX_ASPECT_SKEW) {
        URL.revokeObjectURL(objectUrl);
        toast({ title: "Aspect ratio too extreme", description: `${w}×${h} — use a roughly square image.`, variant: "destructive" });
        return;
      }
      // Default: keep alpha for PNG/SVG/WebP, use white for opaque JPEGs.
      setBg(file.type === "image/jpeg" ? "white" : "transparent");
      setPending({ img, objectUrl });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      toast({ title: "Could not decode image", variant: "destructive" });
    };
    img.src = objectUrl;
  };

  const confirmSave = () => {
    if (!previewUrl) return;
    setLogo(previewUrl);
    toast({
      title: "Logo updated",
      description: `${LOGO_TARGET}×${LOGO_TARGET} • ${bg === "transparent" ? "transparent" : "solid"} background`,
    });
    closePreview();
  };

  const bgChoices: { id: LogoBg; label: string; swatch?: string }[] = [
    { id: "transparent", label: "Transparent" },
    { id: "white", label: "White", swatch: "#ffffff" },
    { id: "black", label: "Black", swatch: "#000000" },
    { id: "primary", label: "Brand" },
    { id: "custom", label: "Custom" },
  ];

  const checkerStyle = {
    backgroundImage:
      "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)",
    backgroundSize: "10px 10px",
    backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0",
  };

  return (
    <div className="glass-card p-4 space-y-4">
      <div className="flex items-center gap-3">
        <ImageIcon className="w-5 h-5 text-primary" />
        <div>
          <p className="text-sm font-medium text-foreground">App Logo</p>
          <p className="text-xs text-muted-foreground">Replaces the sidebar/header logo. Auto center-cropped to {LOGO_TARGET}×{LOGO_TARGET} — preview before saving.</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-xl border border-border flex items-center justify-center overflow-hidden shrink-0" style={checkerStyle}>
          {logo ? (
            <img src={logo} alt="Logo preview" className="w-full h-full object-contain" />
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap gap-2 flex-1">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            <Upload className="w-4 h-4" /> Attach
          </button>
          <button onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            <Camera className="w-4 h-4" /> Camera
          </button>
          {logo && (
            <button onClick={() => { setLogo(null); toast({ title: "Logo removed" }); }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="w-4 h-4" /> Remove
            </button>
          )}
        </div>
      </div>

      <Dialog open={!!pending} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">Confirm logo</DialogTitle></DialogHeader>

          <div className="space-y-4 mt-2">
            {pending && (() => {
              const w = pending.img.width;
              const h = pending.img.height;
              const side = Math.min(w, h);
              const left = ((w - side) / 2 / w) * 100;
              const top = ((h - side) / 2 / h) * 100;
              const dimW = (side / w) * 100;
              const dimH = (side / h) * 100;
              return (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Original: {w}×{h} — the highlighted square shows what will be kept.
                  </p>
                  <div className="relative inline-block max-w-full rounded-lg overflow-hidden border border-border" style={checkerStyle}>
                    <img src={pending.objectUrl} alt="Source" className="block max-h-56 max-w-full" />
                    <div className="absolute inset-0 bg-background/60 pointer-events-none" />
                    <div
                      className="absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0)] pointer-events-none"
                      style={{ left: `${left}%`, top: `${top}%`, width: `${dimW}%`, height: `${dimH}%`, boxShadow: "0 0 0 2000px rgba(0,0,0,0)", outline: "none" }}
                    >
                      <img
                        src={pending.objectUrl}
                        alt=""
                        aria-hidden
                        className="block w-full h-full object-cover"
                        style={{ objectPosition: "center" }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Background</Label>
              <div className="flex flex-wrap gap-2">
                {bgChoices.map((c) => (
                  <button key={c.id} type="button" onClick={() => setBg(c.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      bg === c.id ? "border-primary text-foreground bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
                    }`}>
                    {c.id === "transparent" ? (
                      <span className="w-4 h-4 rounded border border-border" style={checkerStyle} />
                    ) : c.id === "primary" ? (
                      <span className="w-4 h-4 rounded bg-primary" />
                    ) : c.id === "custom" ? (
                      <span className="w-4 h-4 rounded border border-border" style={{ background: customColor }} />
                    ) : (
                      <span className="w-4 h-4 rounded border border-border" style={{ background: c.swatch }} />
                    )}
                    {c.label}
                  </button>
                ))}
              </div>
              {bg === "custom" && (
                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)}
                  className="h-9 w-16 rounded border border-border bg-secondary cursor-pointer" />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Preview at display sizes</Label>
              <div className="flex items-end gap-4 flex-wrap">
                {[32, 44, 64].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <div className="rounded-xl border border-border overflow-hidden flex items-center justify-center" style={{ width: s, height: s, ...checkerStyle }}>
                      {previewUrl && <img src={previewUrl} alt="Preview" className="w-full h-full object-contain" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{s}px</span>
                  </div>
                ))}
                <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
                  <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center overflow-hidden">
                    {previewUrl && <img src={previewUrl} alt="Sidebar preview" className="w-full h-full object-cover" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground leading-tight">Washflow Saas</p>
                    <p className="text-xs text-muted-foreground leading-tight">Sidebar look</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={closePreview}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button onClick={confirmSave} disabled={!previewUrl}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                Save logo
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───── Theme ───── */
function ThemeSection() {
  const { themeId, mode, selectTheme, toggleMode } = useTheme();

  return (
    <div className="space-y-6">
      <LogoUploader />

      {/* Mode Toggle */}
      <div className="glass-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {mode === "dark" ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-warning" />}
          <div>
            <p className="text-sm font-medium text-foreground">{mode === "dark" ? "Dark" : "Light"} Mode</p>
            <p className="text-xs text-muted-foreground">Toggle appearance</p>
          </div>
        </div>
        <Switch checked={mode === "dark"} onCheckedChange={toggleMode} />
      </div>

      {/* Theme Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {themePresets.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTheme(t.id)}
            className={`rounded-xl p-3 border-2 transition-all ${
              themeId === t.id ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-muted-foreground/30"
            }`}
          >
            <div className="flex gap-1 mb-2">
              <div className="w-6 h-6 rounded-full" style={{ backgroundColor: t.preview.primary }} />
              <div className="w-6 h-6 rounded-full" style={{ backgroundColor: t.preview.bg }} />
              <div className="w-6 h-6 rounded-full" style={{ backgroundColor: t.preview.card }} />
            </div>
            <p className="text-xs font-medium text-foreground text-left">{t.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───── Services ───── */
function ServicesSection() {
  const { services, updateService, addService, removeService } = useServices();
  const { formatPrice, currency } = useCurrency();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ServicePackage>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newFeatures, setNewFeatures] = useState("");

  const startEdit = (s: ServicePackage) => {
    setEditingId(s.id);
    setEditData({ name: s.name, price: s.price, duration: s.duration, features: s.features, popular: s.popular, vatExempt: s.vatExempt });
  };

  const saveEdit = () => {
    if (editingId && editData.name && editData.price) {
      updateService(editingId, editData);
      setEditingId(null);
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPrice) return;
    addService({
      name: newName.trim(),
      price: Number(newPrice),
      duration: newDuration.trim() || "30 min",
      features: newFeatures.split("\n").map((f) => f.trim()).filter(Boolean),
    });
    setNewName(""); setNewPrice(""); setNewDuration(""); setNewFeatures("");
    setAddOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{services.length} service{services.length !== 1 ? "s" : ""}</p>
        <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add Service
        </button>
      </div>

      <div className="space-y-3">
        {services.map((s) => (
          <div key={s.id} className="glass-card p-4">
            {editingId === s.id ? (
              <div className="space-y-3">
                <Input value={editData.name || ""} onChange={(e) => setEditData((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                <div className="grid grid-cols-2 gap-3">
                  <Input type="number" value={editData.price ?? ""} onChange={(e) => setEditData((p) => ({ ...p, price: Number(e.target.value) }))} placeholder={`Price (${currency.symbol})`} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                  <Input value={editData.duration || ""} onChange={(e) => setEditData((p) => ({ ...p, duration: e.target.value }))} placeholder="Duration" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                </div>
                <textarea
                  value={(editData.features || []).join("\n")}
                  onChange={(e) => setEditData((p) => ({ ...p, features: e.target.value.split("\n") }))}
                  rows={4}
                  placeholder="One feature per line"
                  className="w-full rounded-lg bg-secondary border border-border text-foreground text-sm p-3 placeholder:text-muted-foreground resize-none"
                />
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Popular</Label>
                    <Switch checked={editData.popular || false} onCheckedChange={(popular) => setEditData((p) => ({ ...p, popular }))} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">VAT Exempt</Label>
                    <Switch checked={editData.vatExempt || false} onCheckedChange={(vatExempt) => setEditData((p) => ({ ...p, vatExempt }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium"><Save className="w-3 h-3" />Save</button>
                  <button onClick={() => setEditingId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"><X className="w-3 h-3" />Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{s.name}</p>
                    {s.popular && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Popular</span>}
                    {s.vatExempt && <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded-full font-medium">VAT Exempt</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatPrice(s.price)} · {s.duration} · {s.features.length} feature{s.features.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => startEdit(s)} className="text-muted-foreground hover:text-foreground transition-colors"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => removeService(s.id)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">Add Service</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Service Name *</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Express Wash" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Price ({currency.symbol}) *</Label>
                <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder={currency.symbol} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Duration</Label>
                <Input value={newDuration} onChange={(e) => setNewDuration(e.target.value)} placeholder="30 min" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Features (one per line)</Label>
              <textarea value={newFeatures} onChange={(e) => setNewFeatures(e.target.value)} rows={4} placeholder={"Exterior wash\nInterior vacuum\nTire shine"} className="w-full rounded-lg bg-secondary border border-border text-foreground text-sm p-3 placeholder:text-muted-foreground resize-none" />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">Add Service</button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───── Currency ───── */
function CurrencySection() {
  const { currency, setCurrency } = useCurrency();

  const handlePreset = (code: string) => {
    const preset = CURRENCY_PRESETS.find((p) => p.code === code);
    if (preset) setCurrency({ ...currency, symbol: preset.symbol, code: preset.code });
  };

  return (
    <div className="space-y-4">
      {/* Currency Selection */}
      <div className="glass-card p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">Currency</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Preset</Label>
            <Select value={currency.code} onValueChange={handlePreset}>
              <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                {CURRENCY_PRESETS.map((p) => (
                  <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Symbol</Label>
            <Input
              value={currency.symbol}
              onChange={(e) => setCurrency({ ...currency, symbol: e.target.value })}
              placeholder="Symbol"
              maxLength={5}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* VAT Settings */}
      <div className="glass-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">VAT / Tax</p>
            <p className="text-xs text-muted-foreground">Apply tax on services</p>
          </div>
          <Switch
            checked={currency.vatEnabled}
            onCheckedChange={(vatEnabled) => setCurrency({ ...currency, vatEnabled })}
          />
        </div>

        {currency.vatEnabled && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">VAT Percentage (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={currency.vatPercent}
              onChange={(e) => setCurrency({ ...currency, vatPercent: Number(e.target.value) })}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="glass-card p-4">
        <p className="text-xs text-muted-foreground mb-2">Preview (on a {currency.symbol}100 service)</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-secondary-foreground">
            <span>Subtotal</span>
            <span className="font-mono">{currency.symbol}100.00</span>
          </div>
          {currency.vatEnabled && (
            <div className="flex justify-between text-secondary-foreground">
              <span>VAT ({currency.vatPercent}%)</span>
              <span className="font-mono">{currency.symbol}{(100 * currency.vatPercent / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-foreground font-semibold border-t border-border pt-1 mt-1">
            <span>Total</span>
            <span className="font-mono">{currency.symbol}{(100 + (currency.vatEnabled ? 100 * currency.vatPercent / 100 : 0)).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ───── Receipt content ───── */
const SAMPLE_ORDER: WashOrder = {
  id: "sample",
  orderNumber: "W-1042",
  customer: "Sample Customer",
  customerPhone: "+27 82 123 4567",
  vehicle: "Toyota Hilux",
  plate: "CA 123-456",
  service: "Premium Wash",
  servicePrice: 250,
  status: "completed",
  createdAt: new Date(Date.now() - 25 * 60_000).toISOString(),
  completedAt: new Date().toISOString(),
  waitMinutes: 25,
  notes: "Extra attention to alloy wheels.",
};

function ReceiptSection() {
  const { settings, update, reset, status, error } = useReceiptSettings();
  const { currency } = useCurrency();

  const model = buildReceiptModel(SAMPLE_ORDER, {
    settings,
    currencySymbol: currency.symbol,
    vatPercent: currency.vatEnabled ? currency.vatPercent : 0,
  });

  const statusBadge =
    status === "loading"
      ? { icon: Loader2, text: "Loading from database…", cls: "text-muted-foreground", spin: true }
      : status === "saving"
        ? { icon: Loader2, text: "Saving to database…", cls: "text-primary", spin: true }
        : status === "error"
          ? { icon: AlertCircle, text: error || "Save failed", cls: "text-destructive", spin: false }
          : { icon: CheckCircle2, text: "Saved to database", cls: "text-success", spin: false };
  const StatusIcon = statusBadge.icon;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="glass-card p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Receipt content
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Stored in your Supabase database and shared across every device.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Reset
          </button>
        </div>

        <div className={`flex items-center gap-2 text-xs ${statusBadge.cls}`}>
          <StatusIcon className={`w-3.5 h-3.5 ${statusBadge.spin ? "animate-spin" : ""}`} />
          <span>{statusBadge.text}</span>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-secondary-foreground">Business name</Label>
          <Input
            value={settings.businessName}
            onChange={(e) => update({ businessName: e.target.value })}
            placeholder="Washflow Saas"
            maxLength={32}
            className="bg-secondary border-border text-foreground"
          />
          <p className="text-[11px] text-muted-foreground">Printed large + bold at the top.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-secondary-foreground">Tagline / second line</Label>
          <Input
            value={settings.businessLine2}
            onChange={(e) => update({ businessLine2: e.target.value })}
            placeholder="Premium Car Wash"
            maxLength={48}
            className="bg-secondary border-border text-foreground"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-secondary-foreground">Footer message</Label>
          <textarea
            value={settings.footer}
            onChange={(e) => update({ footer: e.target.value })}
            placeholder="Thank you for your business!"
            rows={3}
            maxLength={240}
            className="w-full rounded-md bg-secondary border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
          <p className="text-[11px] text-muted-foreground">
            Printed centered after the totals. Use this for return policies, social handles, or
            promo codes.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">VAT line on receipt</span>
            <span className={`font-semibold ${currency.vatEnabled ? "text-success" : "text-muted-foreground"}`}>
              {currency.vatEnabled ? `On (${currency.vatPercent}%)` : "Off"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            VAT is controlled in the Currency tab. When enabled, the receipt shows Subtotal + VAT
            lines above the total.
          </p>
        </div>
      </div>

      <div className="glass-card p-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" /> Live preview (sample order)
          </h3>
          <PrintSampleButton model={model} />
        </div>
        <div className="bg-muted/40 rounded-md py-4">
          <ReceiptPreview model={model} />
        </div>
      </div>
    </div>
  );
}

function PrintSampleButton({ model }: { model: ReturnType<typeof buildReceiptModel> }) {
  const [busy, setBusy] = useState(false);
  const savedName = getSavedPrinterName();
  const handleClick = async () => {
    if (!isBluetoothSupported()) {
      sonnerToast.error("Bluetooth printing not supported", {
        description: "Open this app in Chrome on Android/desktop, or Bluefy on iOS.",
      });
      return;
    }
    setBusy(true);
    try {
      const name = await sendToPrinter(renderReceiptBytes(model));
      sonnerToast.success(`Sample sent to ${name}`);
    } catch (err: any) {
      const msg = err?.message || "Failed to print sample";
      if (!/cancelled|user cancel/i.test(msg)) {
        sonnerToast.error("Print failed", { description: msg });
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
      {busy ? "Sending…" : savedName ? `Print sample · ${savedName}` : "Print sample"}
    </button>
  );
}


/* ───── Printer ───── */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

function PrinterSection() {
  const [saved, setSaved] = useState(() => getSavedPrinter());
  const [pairing, setPairing] = useState(false);
  const supported = isBluetoothSupported();
  const [probe, setProbe] = useState<{ paired: boolean; permitted: boolean; connected: boolean; deviceName?: string }>({
    paired: !!saved, permitted: false, connected: false, deviceName: saved?.name,
  });
  const [events, setEvents] = useState<PrinterEvent[]>(() => getPrinterEvents());

  const refreshProbe = useCallback(async () => {
    const p = await probePrinterConnection();
    setProbe(p);
  }, []);

  useEffect(() => {
    refreshProbe();
    const interval = window.setInterval(refreshProbe, 4000);
    const onEvent = () => {
      setEvents(getPrinterEvents());
      setSaved(getSavedPrinter());
      refreshProbe();
    };
    window.addEventListener("printer-event", onEvent);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("printer-event", onEvent);
    };
  }, [refreshProbe]);

  const handlePair = async () => {
    setPairing(true);
    try {
      const name = await pairPrinter();
      setSaved(getSavedPrinter());
      setEvents(getPrinterEvents());
      refreshProbe();
      sonnerToast.success(`Paired with ${name}`);
    } catch (err: any) {
      const msg = err?.message || "Pairing failed";
      if (!/cancelled|user cancel/i.test(msg)) sonnerToast.error("Pairing failed", { description: msg });
    } finally {
      setPairing(false);
    }
  };

  const handleForget = () => {
    forgetPrinter();
    setSaved(null);
    setEvents(getPrinterEvents());
    refreshProbe();
    sonnerToast.success("Printer forgotten");
  };

  const statusInfo = !supported
    ? { label: "Bluetooth unavailable", cls: "bg-warning/10 text-warning border-warning/30", Icon: BluetoothOff, dot: "bg-warning" }
    : !probe.paired
      ? { label: "Not paired", cls: "bg-muted text-muted-foreground border-border", Icon: BluetoothOff, dot: "bg-muted-foreground/40" }
      : probe.connected
        ? { label: "Connected", cls: "bg-success/10 text-success border-success/30", Icon: Bluetooth, dot: "bg-success animate-pulse" }
        : probe.permitted
          ? { label: "In range · idle", cls: "bg-primary/10 text-primary border-primary/30", Icon: Bluetooth, dot: "bg-primary" }
          : { label: "Paired · out of range", cls: "bg-warning/10 text-warning border-warning/30", Icon: BluetoothOff, dot: "bg-warning" };
  const StatusIcon = statusInfo.Icon;

  const lastEvent = events[0];
  const recent = events.slice(0, 5);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="glass-card p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Printer className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">Bluetooth thermal printer</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Pair an 80mm ESC/POS Bluetooth printer to send receipts after a wash is completed.
            </p>
          </div>
        </div>

        <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${statusInfo.cls}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
            <StatusIcon className="w-4 h-4" />
            <div className="text-sm font-semibold leading-tight">
              {statusInfo.label}
              {probe.deviceName && (
                <span className="block text-[11px] font-normal opacity-80">{probe.deviceName}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={refreshProbe}
            title="Refresh status"
            className="p-1.5 rounded-md hover:bg-foreground/5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {!supported && (
          <p className="text-xs text-muted-foreground">
            Web Bluetooth is <b>not available</b> here. Use Chrome on Android or desktop. On iOS,
            install <b>Bluefy</b> and open the app there.
          </p>
        )}

        <div className="rounded-lg border border-border bg-secondary/40 p-4 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Currently paired</p>
          {saved?.name ? (
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground flex items-center gap-2">
                <Bluetooth className="w-4 h-4 text-primary" />
                {saved.name}
              </p>
              {saved.pairedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Paired {new Date(saved.pairedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No printer paired yet.</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handlePair}
              disabled={!supported || pairing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bluetooth className="w-4 h-4" />}
              {saved?.name ? "Pair different printer" : "Pair new printer"}
            </button>
            {saved?.name && (
              <button
                type="button"
                onClick={handleForget}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm font-semibold hover:bg-destructive/20 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Forget printer
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> Last activity
        </h3>

        {lastEvent ? (
          <div
            className={`rounded-lg border p-3 ${
              lastEvent.kind === "print_ok" || lastEvent.kind === "paired"
                ? "border-success/30 bg-success/5"
                : lastEvent.kind === "print_failed"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-secondary/40"
            }`}
          >
            <div className="flex items-center gap-2">
              {lastEvent.kind === "print_ok" && <CheckCircle2 className="w-4 h-4 text-success" />}
              {lastEvent.kind === "paired" && <Bluetooth className="w-4 h-4 text-success" />}
              {lastEvent.kind === "print_failed" && <AlertCircle className="w-4 h-4 text-destructive" />}
              {lastEvent.kind === "forgotten" && <Trash2 className="w-4 h-4 text-muted-foreground" />}
              <p className="text-sm font-semibold text-foreground">
                {lastEvent.kind === "print_ok" && `Printed to ${lastEvent.device ?? "printer"}`}
                {lastEvent.kind === "paired" && `Paired with ${lastEvent.device ?? "printer"}`}
                {lastEvent.kind === "print_failed" && "Last print failed"}
                {lastEvent.kind === "forgotten" && `Forgot ${lastEvent.device ?? "printer"}`}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {relativeTime(lastEvent.at)} · {new Date(lastEvent.at).toLocaleTimeString()}
            </p>
            {lastEvent.message && (
              <p className="text-xs text-destructive mt-2 break-words">{lastEvent.message}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No print activity yet.</p>
        )}

        {recent.length > 1 && (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">History</p>
            <ul className="space-y-1.5">
              {recent.slice(1).map((e, i) => (
                <li key={i} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {e.kind === "print_ok" && <CheckCircle2 className="w-3 h-3 text-success" />}
                    {e.kind === "paired" && <Bluetooth className="w-3 h-3 text-success" />}
                    {e.kind === "print_failed" && <AlertCircle className="w-3 h-3 text-destructive" />}
                    {e.kind === "forgotten" && <Trash2 className="w-3 h-3" />}
                    <span className="text-foreground">
                      {e.kind === "print_ok" ? "Print" : e.kind === "print_failed" ? "Failed" : e.kind === "paired" ? "Paired" : "Forgotten"}
                    </span>
                    {e.device && <span>· {e.device}</span>}
                  </span>
                  <span className="text-muted-foreground">{relativeTime(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border pt-3 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Tips</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Status updates every few seconds; tap refresh to recheck immediately.</li>
            <li>"In range · idle" means the printer is reachable but no active session is open.</li>
            <li>Receipts are 80mm (48 characters). Customise the header & footer in the Receipt tab.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
