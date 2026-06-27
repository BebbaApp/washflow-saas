import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { perfMark } from "@/lib/perf";


export type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type TenantRole = "owner" | "admin" | "member";

const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

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
  /** Feature toggle map from the tenant's plan (`plans.features`).
   *  `null` when no plan is attached. Empty object means "no restrictions configured". */
  planFeatures: Record<string, boolean> | null;
  /** True when the current user is a platform admin (cross-tenant console access). */
  isPlatformAdmin: boolean;
  /** True when the current user is a super admin (bypasses plan gating everywhere). */
  isSuperAdmin: boolean;
  refresh: (preferredTenantId?: string) => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  clearSwitchError: () => void;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);
const LS_KEY = "lovable.active_tenant_id";
const LS_TENANT_CACHE = "lovable.active_tenant_cache";
const LS_MEMBERSHIPS_CACHE = "lovable.memberships_cache";

function readStoredTenant(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function writeStoredTenant(id: string | null) {
  try { id ? localStorage.setItem(LS_KEY, id) : localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
function readCachedTenant(): Tenant | null {
  try { const raw = localStorage.getItem(LS_TENANT_CACHE); return raw ? JSON.parse(raw) as Tenant : null; } catch { return null; }
}
function writeCachedTenant(t: Tenant | null) {
  try { t ? localStorage.setItem(LS_TENANT_CACHE, JSON.stringify(t)) : localStorage.removeItem(LS_TENANT_CACHE); } catch { /* ignore */ }
}
function readCachedMemberships(): TenantMembership[] {
  try { const raw = localStorage.getItem(LS_MEMBERSHIPS_CACHE); return raw ? JSON.parse(raw) as TenantMembership[] : []; } catch { return []; }
}
function writeCachedMemberships(list: TenantMembership[]) {
  try { localStorage.setItem(LS_MEMBERSHIPS_CACHE, JSON.stringify(list)); } catch { /* ignore */ }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, authedEmail, authedUserId } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(() => readCachedTenant());
  const [memberships, setMemberships] = useState<TenantMembership[]>(() => readCachedMemberships());
  const [myRole, setMyRole] = useState<TenantRole | null>(null);
  // If we have a cached tenant we don't need a loading flash on boot.
  const [loading, setLoading] = useState(() => !readCachedTenant());
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [planFeatures, setPlanFeatures] = useState<Record<string, boolean> | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const tenantRef = useRef<Tenant | null>(tenant);
  useEffect(() => { tenantRef.current = tenant; }, [tenant]);


  const load = useCallback(async (preferredTenantId?: string) => {
    const loadStart = performance.now();
    perfMark("tenant:load:start");
    // Wait for auth to settle before resolving tenant state. This prevents the
    // "No workspace found" flash on every refresh while the session is being restored.
    if (authLoading || authedEmail) {
      // Either still resolving, or session exists but profile not yet loaded.
      if (!user) { setLoading(true); return; }
    }
    if (!authedUserId) {
      setTenant(null); setMemberships([]); setMyRole(null); setLoading(false);
      writeCachedTenant(null);
      writeCachedMemberships([]);
      return;
    }
    // Don't toggle loading=true if we already have a cached tenant — keep
    // the UI populated while we revalidate in the background.
    if (!tenantRef.current) setLoading(true);



    // Super-admin status must be resolved before tenant membership checks so
    // global admins can reach /platform even if they are not members of a tenant.
    const adminT0 = performance.now();
    const [{ data: pa }, { data: sa }] = await Promise.all([
      supabase.from("platform_admins" as any).select("user_id").eq("user_id", authedUserId).maybeSingle(),
      supabase.from("super_admins" as any).select("user_id").eq("user_id", authedUserId).maybeSingle(),
    ]);
    perfMark(`tenant:admin-check (${(performance.now() - adminT0).toFixed(0)}ms)`);
    const superAdmin = !!sa || authedEmail?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    setIsPlatformAdmin(!!pa || superAdmin);
    setIsSuperAdmin(superAdmin);

    const membershipsT0 = performance.now();
    const { data: members } = await supabase
      .from("tenant_members" as any)
      .select("tenant_id, tenant_role, tenants(id, name, slug)")
      .eq("user_id", authedUserId);
    perfMark(`tenant:memberships-loaded (${(performance.now() - membershipsT0).toFixed(0)}ms)`);


    const rows = ((members as any) ?? []) as Array<{
      tenant_id: string;
      tenant_role: TenantRole;
      tenants: { id: string; name: string; slug: string } | null;
    }>;
    let list: TenantMembership[] = rows
      .filter((r) => r.tenants)
      .map((r) => ({ id: r.tenants!.id, name: r.tenants!.name, slug: r.tenants!.slug, tenant_role: r.tenant_role }));

    if (superAdmin) {
      let allTenantRows: Array<{ id: string; name: string; slug: string }> = [];
      const { data: allTenants } = await supabase
        .from("tenants" as any)
        .select("id, name, slug")
        .order("name", { ascending: true });
      allTenantRows = ((allTenants as any) ?? []) as Array<{ id: string; name: string; slug: string }>;
      if (allTenantRows.length === 0 && authedEmail?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL) {
        const { data: platformData } = await supabase.functions.invoke("platform-admin", { body: { action: "list_tenants" } });
        allTenantRows = (((platformData as any)?.tenants ?? []) as Array<{ id: string; name: string; slug: string }>);
      }
      list = allTenantRows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        tenant_role: "owner" as TenantRole,
      }));
    }
    setMemberships(list);
    writeCachedMemberships(list);

    if (list.length === 0) {
      setTenant(null); setMyRole(null); setPlanFeatures(null); setLoading(false);
      writeStoredTenant(null);
      return;
    }

    // Priority: ?tenant=<slug> URL param → JWT claim → localStorage → first membership
    let urlSlug: string | null = null;
    try { urlSlug = new URLSearchParams(window.location.search).get("tenant"); } catch { /* ignore */ }
    const urlMatchId = urlSlug ? list.find((m) => m.slug === urlSlug)?.id : undefined;
    const jwtId = (user as any)?.app_metadata?.active_tenant_id as string | undefined;
    const storedId = readStoredTenant();
    const activeId =
      urlMatchId ??
      (preferredTenantId && list.find((m) => m.id === preferredTenantId)?.id) ??
      (jwtId && list.find((m) => m.id === jwtId)?.id) ??
      (storedId && list.find((m) => m.id === storedId)?.id) ??
      list[0].id;
    const activeRow = list.find((m) => m.id === activeId) ?? list[0];
    writeStoredTenant(activeRow.id);
    setMyRole(activeRow.tenant_role);

    // If we already have a cached tenant for this id, surface it immediately
    // so all data hooks unblock; otherwise paint as much as we can from the
    // membership row while the full tenant record loads.
    const cached = tenantRef.current;
    if (!cached || cached.id !== activeRow.id) {
      const stub: Tenant = {
        id: activeRow.id,
        name: activeRow.name,
        slug: activeRow.slug,
        status: (cached?.status ?? "active") as TenantStatus,
        trial_ends_at: cached?.trial_ends_at ?? new Date().toISOString(),
        current_period_end: cached?.current_period_end ?? null,
        grace_period_ends_at: cached?.grace_period_ends_at ?? null,
        plan_id: cached?.plan_id ?? null,
      };
      setTenant(stub);
    }
    perfMark(`tenant:hydrated (${(performance.now() - loadStart).toFixed(0)}ms total)`);
    setLoading(false);


    // ---- Background revalidation (does not block the UI) ----
    void (async () => {
      // Sync server-side active tenant when JWT claim is out of date.
      const needsClaimSync =
        (superAdmin && jwtId !== activeRow.id) ||
        (urlMatchId && urlMatchId !== jwtId);
      if (needsClaimSync) {
        try {
          await supabase.functions.invoke("switch-tenant", { body: { tenant_id: activeRow.id } });
          await supabase.auth.refreshSession();
        } catch (e) {
          console.warn("tenant claim sync failed", e);
        }
      }
      if (urlMatchId) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("tenant");
          window.history.replaceState({}, "", url.toString());
        } catch { /* ignore */ }
      }

      const { data } = await supabase
        .from("tenants" as any)
        .select("*")
        .eq("id", activeRow.id)
        .maybeSingle();
      const tenantRow = ((data as any) ?? null) as Tenant | null;
      if (tenantRow) {
        setTenant(tenantRow);
        writeCachedTenant(tenantRow);
      }

      if (tenantRow?.plan_id) {
        const { data: planRow } = await supabase
          .from("plans" as any)
          .select("features")
          .eq("id", tenantRow.plan_id)
          .maybeSingle();
        const raw = (planRow as any)?.features;
        setPlanFeatures(raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {});
      } else {
        setPlanFeatures(null);
      }
    })();
  }, [user, authLoading, authedEmail, authedUserId]);

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
      await load(tenantId);
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
      switchError, planFeatures, isPlatformAdmin, isSuperAdmin,
      refresh: load, switchTenant, clearSwitchError,
    };
  }, [tenant, memberships, myRole, loading, switchError, planFeatures, isPlatformAdmin, isSuperAdmin, load, switchTenant, clearSwitchError]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
