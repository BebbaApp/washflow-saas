import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TenantStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

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

interface TenantContextValue {
  tenant: Tenant | null;
  loading: boolean;
  licenseActive: boolean;
  daysUntilTrialEnd: number | null;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setTenant(null); setLoading(false); return; }
    setLoading(true);
    // Membership → tenant (RLS scopes to current user's tenants)
    const { data: members } = await supabase
      .from("tenant_members" as any)
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1);
    const tenantId = (members as any)?.[0]?.tenant_id;
    if (!tenantId) { setTenant(null); setLoading(false); return; }

    const { data } = await supabase
      .from("tenants" as any)
      .select("*")
      .eq("id", tenantId)
      .maybeSingle();
    setTenant((data as any) ?? null);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

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
    return { tenant, loading, licenseActive, daysUntilTrialEnd, refresh: load };
  }, [tenant, loading]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
