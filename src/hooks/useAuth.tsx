import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type StaffRole = "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";

const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  phone: string | null;
}

interface AuthContextValue {
  user: StaffUser | null;
  authedUserId: string | null;
  authedEmail: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  authedNoRole: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  signup: (email: string, password: string, name: string, phone?: string, companyName?: string) => Promise<string | null>;
  logout: () => Promise<void>;
  updateProfile: (updates: { name?: string; phone?: string }) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuthInternal(): AuthContextValue {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (authUser: User): Promise<StaffUser | null> => {
    const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }, { data: superAdmin }] = await Promise.all([
      supabase
        .from("profiles")
        .select("name")
        .eq("user_id", authUser.id)
        .maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authUser.id),
      supabase
        .from("super_admins" as any)
        .select("user_id")
        .eq("user_id", authUser.id)
        .maybeSingle(),
    ]);

    const meta = (authUser.user_metadata ?? {}) as Record<string, any>;
    const isBootstrapSuperAdmin = authUser.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    const makeUser = (role: StaffRole): StaffUser => ({
      id: authUser.id,
      email: authUser.email || "",
      name: profile?.name || meta.name || authUser.email || "",
      role,
      phone: (meta.phone as string) || authUser.phone || null,
    });

    if (profileError || rolesError) {
      console.error("[useAuth] Failed to load staff profile:", profileError || rolesError);
      return superAdmin || isBootstrapSuperAdmin ? makeUser("admin") : null;
    }

    const priority: StaffRole[] = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];
    const userRoles = (roleRows ?? []).map((r) => r.role as StaffRole);
    const bestRole = priority.find((r) => userRoles.includes(r));

    if (bestRole) {
      return makeUser(bestRole);
    }
    return superAdmin || isBootstrapSuperAdmin ? makeUser("admin") : null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;

    const resolveSession = (session: Session | null) => {
      const currentRequest = ++requestId;
      if (!session?.user) {
        setAuthedUserId(null);
        setAuthedEmail(null);
        setUser(null);
        setLoading(false);
        return;
      }
      const authUser = session.user;
      setAuthedUserId(authUser.id);
      setAuthedEmail(authUser.email ?? null);
      setLoading(true);
      setTimeout(() => {
        // Validate the session is still alive server-side. Stale JWTs (session
        // deleted in Supabase) keep returning 401/403 on every protected call
        // until we explicitly sign out.
        supabase.auth.getUser().then(({ error: validateErr }) => {
          if (cancelled || currentRequest !== requestId) return;
          if (validateErr) {
            console.warn("[useAuth] Stale session detected, signing out:", validateErr.message);
            supabase.auth.signOut().finally(() => {
              if (!cancelled && currentRequest === requestId) {
                setAuthedEmail(null);
                setUser(null);
                setLoading(false);
              }
            });
            return;
          }
          fetchProfile(authUser)
            .then((staffUser) => {
              if (!cancelled && currentRequest === requestId) setUser(staffUser);
            })
            .catch((error) => {
              console.error("[useAuth] Failed to resolve authenticated user:", error);
              if (!cancelled && currentRequest === requestId) setUser(null);
            })
            .finally(() => {
              if (!cancelled && currentRequest === requestId) setLoading(false);
            });
        });
      }, 0);
    };


    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code && window.location.pathname !== "/reset-password" && window.location.pathname !== "/auth/callback") {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search);
        }
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
        window.location.replace("/reset-password" + window.location.search + window.location.hash);
        return;
      }
      resolveSession(session);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      resolveSession(session);
    }).catch((error) => {
      console.error("[useAuth] Failed to restore session:", error);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    return null;
  }, []);

  const signup = useCallback(async (
    email: string, password: string, name: string, phone?: string, companyName?: string,
  ): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({
      email, password, phone: phone || undefined,
      options: {
        data: { name, ...(phone ? { phone } : {}), ...(companyName ? { company_name: companyName } : {}) },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) return error.message;
    return null;
  }, []);

  const updateProfile = useCallback(async (updates: { name?: string; phone?: string }): Promise<string | null> => {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return "Not signed in";
    const meta = { ...(authUser.user_metadata ?? {}), ...updates };
    const { error: authErr } = await supabase.auth.updateUser({ data: meta });
    if (authErr) return authErr.message;
    if (updates.name !== undefined) {
      const { error: profErr } = await supabase
        .from("profiles").update({ name: updates.name }).eq("user_id", authUser.id);
      if (profErr) return profErr.message;
    }
    setUser((prev) => prev ? { ...prev, name: updates.name ?? prev.name, phone: updates.phone ?? prev.phone } : prev);
    return null;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthedUserId(null);
    setUser(null);
  }, []);

  return {
    user, authedUserId, authedEmail, loading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    authedNoRole: !!authedEmail && !user,
    login, signup, logout, updateProfile,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthInternal();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
