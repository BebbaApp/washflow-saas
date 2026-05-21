import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type TenantRole = "owner" | "admin" | "member";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  trial_ends_at: string;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  plan_id: string | null;
}

export interface TenantMembership {
  id: string;
  name: string;
  slug: string;
  tenant_role: TenantRole;
}

interface TenantContextValue {
  tenant: Tenant | null;
  memberships: TenantMembership[];
  myRole: TenantRole | null;
  loading: boolean;
  licenseActive: boolean;
  daysUntilTrialEnd: number | null;
  switchError: string | null;
  refresh: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  clearSwitchError: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);
const LS_KEY = "lovable.active_tenant_id";

function readStoredTenant(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function writeStoredTenant(id: string | null) {
  try { id ? localStorage.setItem(LS_KEY, id) : localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, authedEmail } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [myRole, setMyRole] = useState<TenantRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Wait for auth to settle before resolving tenant state. This prevents the
    // "No workspace found" flash on every refresh while the session is being restored.
    if (authLoading || authedEmail) {
      // Either still resolving, or session exists but profile not yet loaded.
      if (!user) { setLoading(true); return; }
    }
    if (!user) {
      setTenant(null); setMemberships([]); setMyRole(null); setLoading(false);
      return;
    }
    setLoading(true);

    const { data: members } = await supabase
      .from("tenant_members" as any)
      .select("tenant_id, tenant_role, tenants(id, name, slug)")
      .eq("user_id", user.id);

    const rows = ((members as any) ?? []) as Array<{
      tenant_id: string;
      tenant_role: TenantRole;
      tenants: { id: string; name: string; slug: string } | null;
    }>;
    const list: TenantMembership[] = rows
      .filter((r) => r.tenants)
      .map((r) => ({ id: r.tenants!.id, name: r.tenants!.name, slug: r.tenants!.slug, tenant_role: r.tenant_role }));
    setMemberships(list);

    if (list.length === 0) {
      setTenant(null); setMyRole(null); setLoading(false);
      writeStoredTenant(null);
      return;
    }

    // Priority: JWT claim → localStorage → first membership
    const jwtId = (user as any)?.app_metadata?.active_tenant_id as string | undefined;
    const storedId = readStoredTenant();
    const activeId =
      (jwtId && list.find((m) => m.id === jwtId)?.id) ??
      (storedId && list.find((m) => m.id === storedId)?.id) ??
      list[0].id;
    const activeRow = list.find((m) => m.id === activeId) ?? list[0];
    writeStoredTenant(activeRow.id);

    const { data } = await supabase
      .from("tenants" as any)
      .select("*")
      .eq("id", activeRow.id)
      .maybeSingle();
    setTenant((data as any) ?? null);
    setMyRole(activeRow.tenant_role);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`tenant_${tenant.id}_${Math.random()}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "tenants", filter: `id=eq.${tenant.id}` },
        (payload) => setTenant(payload.new as Tenant))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id]);

  const switchTenant = useCallback(async (tenantId: string) => {
    setSwitchError(null);
    // Optimistic: persist immediately so a refresh mid-switch lands on the
    // intended workspace even if the JWT refresh fails.
    writeStoredTenant(tenantId);
    try {
      const { error } = await supabase.functions.invoke("switch-tenant", { body: { tenant_id: tenantId } });
      if (error) throw new Error(error.message || "Server rejected the switch");
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        throw new Error(
          `Workspace selected, but session refresh failed: ${refreshErr.message}. Please sign out and back in.`
        );
      }
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      setSwitchError(msg);
      // Re-sync local state in case partial success
      await load();
      throw new Error(msg);
    }
  }, [load]);

  const clearSwitchError = useCallback(() => setSwitchError(null), []);

  const value = useMemo<TenantContextValue>(() => {
    const now = Date.now();
    const licenseActive = !!tenant && (
      tenant.status === "trialing" ||
      tenant.status === "active" ||
      (tenant.status === "past_due" &&
        !!tenant.grace_period_ends_at &&
        new Date(tenant.grace_period_ends_at).getTime() > now)
    );
    const daysUntilTrialEnd = tenant?.trial_ends_at
      ? Math.ceil((new Date(tenant.trial_ends_at).getTime() - now) / 86_400_000)
      : null;
    return {
      tenant, memberships, myRole, loading, licenseActive, daysUntilTrialEnd,
      switchError, refresh: load, switchTenant, clearSwitchError,
    };
  }, [tenant, memberships, myRole, loading, switchError, load, switchTenant, clearSwitchError]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
