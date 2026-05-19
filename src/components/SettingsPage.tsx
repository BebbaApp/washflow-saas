import { useState, useEffect, useCallback, useRef } from "react";
import { Sun, Moon, Plus, Trash2, Edit2, Save, X, Users, Palette, Package, Phone, DollarSign, Loader2, KeyRound, Shield, Mail, Upload, Camera, Image as ImageIcon, ShieldCheck, Smartphone } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";

type WorkerRole = "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";

const ROLE_OPTIONS: { value: WorkerRole; label: string }[] = [
  { value: "washer", label: "Washer" },
  { value: "driver", label: "Driver" },
  { value: "cashier", label: "Cashier" },
  { value: "supervisor", label: "Supervisor" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

export function SettingsPage() {
  const { can } = usePermissions();
  const tabs = ([
    { id: "workers" as const, label: "Workers", icon: Users, perm: "settings.workers" },
    { id: "permissions" as const, label: "Role Permissions", icon: ShieldCheck, perm: "settings.permissions" },
    { id: "theme" as const, label: "Appearance", icon: Palette, perm: "settings.appearance" },
    { id: "services" as const, label: "Services", icon: Package, perm: "services.view" },
    { id: "currency" as const, label: "Currency", icon: DollarSign, perm: "settings.currency" },
  ]).filter((t) => can(t.perm));

  const [section, setSection] = useState<"workers" | "permissions" | "theme" | "services" | "currency">(
    (tabs[0]?.id as any) ?? "workers",
  );

  // If permissions change and current section is no longer allowed, jump to
  // the first allowed tab.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === section)) setSection(tabs[0].id);
  }, [tabs, section]);

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
      {/* Section Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
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
}

function WorkersSection() {
  const { toast } = useToast();
  const { can } = usePermissions();
  const canDeleteWorkers = can("settings.workers.delete");

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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
    if (!pinPhone.trim() || !/^\d{4,6}$/.test(newPin)) {
      toast({ title: "Enter a phone number and a 4-6 digit PIN", variant: "destructive" });
      return;
    }
    setSavingPin(true);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "set_pin", user_id: pinTarget.id, phone: pinPhone.trim(), pin: newPin },
    });
    setSavingPin(false);
    if (res.error || res.data?.error) {
      toast({ title: "Could not set PIN", description: res.data?.error || res.error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "PIN updated", description: `${pinTarget.name || pinTarget.email} can now log in with phone + PIN` });
    setUsers((prev) => prev.map((x) => x.id === pinTarget.id ? { ...x, phone: pinPhone.trim(), has_pin: true } : x));
    setPinTarget(null);
  };

  const handleClearPin = async () => {
    if (!pinTarget) return;
    if (!confirm(`Remove phone + PIN login for ${pinTarget.name || pinTarget.email}?`)) return;
    setSavingPin(true);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "clear_pin", user_id: pinTarget.id },
    });
    setSavingPin(false);
    if (res.error || res.data?.error) {
      toast({ title: "Could not remove PIN", description: res.data?.error || res.error?.message, variant: "destructive" });
      return;
    }
    toast({ title: "PIN removed" });
    setUsers((prev) => prev.map((x) => x.id === pinTarget.id ? { ...x, phone: null, has_pin: false } : x));
    setPinTarget(null);
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const res = await supabase.functions.invoke("manage-staff", { body: { action: "list" } });
    if (res.error || res.data?.error) {
      toast({ title: "Could not load staff", description: res.data?.error || res.error?.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setUsers(res.data.users ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleRoleChange = async (userId: string, newRole: WorkerRole) => {
    setSavingId(userId);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "update_role", user_id: userId, role: newRole },
    });
    setSavingId(null);
    if (res.error || res.data?.error) {
      toast({ title: "Failed to update role", description: res.data?.error || res.error?.message, variant: "destructive" });
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    toast({ title: "Role updated" });
  };

  const handleDelete = async (u: StaffUser) => {
    if (!confirm(`Delete ${u.name || u.email}? This cannot be undone.`)) return;
    setDeletingId(u.id);
    const res = await supabase.functions.invoke("manage-staff", {
      body: { action: "delete", user_id: u.id },
    });
    setDeletingId(null);
    if (res.error || res.data?.error) {
      toast({ title: "Delete failed", description: res.data?.error || res.error?.message, variant: "destructive" });
      return;
    }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    toast({ title: "User deleted" });
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
        body: { email: email.trim(), password, name: name.trim(), role, phone: phone.trim(), pin: pin.trim() || undefined },
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
          return (
            <div key={u.id} className="glass-card p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground truncate">{u.name || "Unnamed"}</p>
                  {isAdminUser && (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      <Shield className="w-3 h-3" /> Admin
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
                disabled={savingId === u.id}
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
                    <p className="text-sm font-bold text-foreground leading-tight">AquaWash</p>
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
