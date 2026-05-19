import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type StaffRole = "admin" | "supervisor" | "washer" | "driver" | "manager" | "cashier";

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

export function useAuth() {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (authUser: User): Promise<StaffUser | null> => {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("name")
      .eq("user_id", authUser.id)
      .maybeSingle();

    const { data: roleRows, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authUser.id);

    if (profileError || rolesError) {
      console.error("[useAuth] Failed to load staff profile:", profileError || rolesError);
      return null;
    }

    // Pick the highest-privilege role if the user has multiple
    const priority: StaffRole[] = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];
    const userRoles = (roleRows ?? []).map((r) => r.role as StaffRole);
    const bestRole = priority.find((r) => userRoles.includes(r));

    if (bestRole) {
      return {
        id: authUser.id,
        email: authUser.email || "",
        name: profile?.name || authUser.email || "",
        role: bestRole,
      };
    }

    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;

    const resolveSession = (session: Session | null) => {
      const currentRequest = ++requestId;

      if (!session?.user) {
        setAuthedEmail(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const authUser = session.user;
      setAuthedEmail(authUser.email ?? null);
      setLoading(true);

      setTimeout(() => {
        fetchProfile(authUser)
          .then((staffUser) => {
            if (!cancelled && currentRequest === requestId) {
              setUser(staffUser);
            }
          })
          .catch((error) => {
            console.error("[useAuth] Failed to resolve authenticated user:", error);
            if (!cancelled && currentRequest === requestId) {
              setUser(null);
            }
          })
          .finally(() => {
            if (!cancelled && currentRequest === requestId) {
              setLoading(false);
            }
          });
      }, 0);
    };

    // Exchange ?code= from email-confirmation links into a session
    // (the /reset-password page handles its own exchange).
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code && window.location.pathname !== "/reset-password") {
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

  const signup = useCallback(async (email: string, password: string, name: string): Promise<string | null> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) return error.message;
    return null;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const isAdmin = user?.role === "admin";
  const authedNoRole = !!authedEmail && !user;

  return { user, login, signup, logout, isAuthenticated: !!user, isAdmin, loading, authedEmail, authedNoRole };
}
