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
  refresh: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [myRole, setMyRole] = useState<TenantRole | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setTenant(null); setMemberships([]); setMyRole(null); setLoading(false);
      return;
    }
    setLoading(true);

    // All tenants the user belongs to
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
      return;
    }

    // Prefer JWT claim, else first membership
    const activeId =
      (user as any)?.app_metadata?.active_tenant_id ??
      list[0].id;
    const activeRow = list.find((m) => m.id === activeId) ?? list[0];

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
    const { error } = await supabase.functions.invoke("switch-tenant", { body: { tenant_id: tenantId } });
    if (error) throw new Error(error.message);
    await supabase.auth.refreshSession();
    await load();
  }, [load]);

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
    return { tenant, memberships, myRole, loading, licenseActive, daysUntilTrialEnd, refresh: load, switchTenant };
  }, [tenant, memberships, myRole, loading, load, switchTenant]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
