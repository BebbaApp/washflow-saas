import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { db } from "@/offline/db";

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
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_TENANT_KEY = "lovable.active_tenant_id";
const REMEMBER_KEY = "wf_remember_me";
const SESSION_ACTIVE_KEY = "wf_session_active";
const LAST_ACTIVITY_KEY = "wf_last_activity";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

function activeTenantIdFor(authUser: User): string | null {
  const claim = (authUser.app_metadata as any)?.active_tenant_id;
  if (typeof claim === "string" && claim) return claim;
  try { return localStorage.getItem(ACTIVE_TENANT_KEY); } catch { return null; }
}

async function isInactiveLocally(authUser: User) {
  const tenantId = activeTenantIdFor(authUser);
  if (!tenantId) return false;
  try {
    const row = await db.staff_active_status
      .where("tenant_id")
      .equals(tenantId)
      .and((r: any) => r.user_id === authUser.id)
      .first();
    return (row as any)?.is_active === false;
  } catch { return false; }
}

function useAuthInternal(): AuthContextValue {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const resolvedUserIdRef = useRef<string | null>(null);
  const userRef = useRef<StaffUser | null>(null);

  const setResolvedUser = useCallback((next: StaffUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  const fetchProfile = useCallback(async (authUser: User): Promise<StaffUser | null> => {
    const CACHE_KEY = `wf_user_profile_${authUser.id}`;

    // Offline short-circuit: rehydrate from the last successful fetch so the
    // app stays usable (Dexie mirror) without a network round-trip. Without
    // this, refreshing the tab offline drops the user back to the login screen.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) return (await isInactiveLocally(authUser)) ? null : JSON.parse(raw) as StaffUser;
      } catch { /* ignore */ }
    }

    let profileRes: any, rolesRes: any, superAdminRes: any, platformAdminRes: any;
    try {
      [profileRes, rolesRes, superAdminRes, platformAdminRes] = await Promise.all([
        supabase.from("profiles").select("name").eq("user_id", authUser.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", authUser.id),
        supabase.from("super_admins" as any).select("user_id").eq("user_id", authUser.id).maybeSingle(),
        supabase.from("platform_admins" as any).select("user_id").eq("user_id", authUser.id).maybeSingle(),
      ]);
    } catch (e) {
      // Network failure mid-fetch: fall back to cached profile if available.
      console.warn("[useAuth] profile fetch network error, using cache", e);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) return JSON.parse(raw) as StaffUser;
      } catch { /* ignore */ }
      return null;
    }
    const { data: profile, error: profileError } = profileRes;
    const { data: roleRows, error: rolesError } = rolesRes;
    const { data: superAdmin } = superAdminRes;
    const { data: platformAdmin } = platformAdminRes;

    const meta = (authUser.user_metadata ?? {}) as Record<string, any>;
    const isBootstrapSuperAdmin = authUser.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    const isGlobalAdmin = !!superAdmin || !!platformAdmin || isBootstrapSuperAdmin;
    const makeUser = (role: StaffRole): StaffUser => ({
      id: authUser.id,
      email: authUser.email || "",
      name: profile?.name || meta.name || authUser.email || "",
      role,
      phone: (meta.phone as string) || authUser.phone || null,
    });

    const persist = (u: StaffUser) => {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(u)); } catch { /* ignore */ }
      return u;
    };

    if (profileError || rolesError) {
      console.error("[useAuth] Failed to load staff profile:", profileError || rolesError);
      if (isGlobalAdmin) return persist(makeUser("admin"));
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) return JSON.parse(raw) as StaffUser;
      } catch { /* ignore */ }
      return null;
    }

    if (isGlobalAdmin) return persist(makeUser("admin"));

    const activeTenantId = activeTenantIdFor(authUser);
    if (activeTenantId) {
      const { data: activeRow } = await (supabase as any)
        .from("staff_active_status")
        .select("is_active")
        .eq("tenant_id", activeTenantId)
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (activeRow?.is_active === false) {
        try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
        return null;
      }
    }

    const priority: StaffRole[] = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];
    const userRoles = (roleRows ?? []).map((r: any) => r.role as StaffRole);
    const bestRole = priority.find((r) => userRoles.includes(r));

    if (bestRole) return persist(makeUser(bestRole));
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;

    const resolveSession = (session: Session | null) => {
      const currentRequest = ++requestId;
      if (!session?.user) {
        resolvedUserIdRef.current = null;
        setAuthedUserId(null);
        setAuthedEmail(null);
        setResolvedUser(null);
        setLoading(false);
        return;
      }
      const authUser = session.user;
      setAuthedUserId(authUser.id);
      setAuthedEmail(authUser.email ?? null);
      if (resolvedUserIdRef.current === authUser.id && userRef.current) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setTimeout(() => {
        // Validate the session is still alive server-side. Stale JWTs (session
        // deleted in Supabase) keep returning 401/403 on every protected call
        // until we explicitly sign out.
        //
        // IMPORTANT: skip the round-trip when the browser reports offline —
        // otherwise a refresh while offline would force-sign-out the user and
        // they would be unable to sign back in until connectivity returns.
        const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        const validate = isOffline
          ? Promise.resolve({ error: null as any })
          : supabase.auth.getUser();
        validate.then(({ error: validateErr }) => {
          if (cancelled || currentRequest !== requestId) return;
          // Treat network failures as "offline" — keep the local session intact
          // so the app can continue working from the Dexie mirror.
          const isNetworkErr = validateErr && /fetch|network|failed to fetch|load failed/i.test(validateErr.message || "");
          if (validateErr && !isNetworkErr) {
            console.warn("[useAuth] Stale session detected, signing out:", validateErr.message);
            supabase.auth.signOut().finally(() => {
              if (!cancelled && currentRequest === requestId) {
                setAuthedEmail(null);
                resolvedUserIdRef.current = null;
                setResolvedUser(null);
                setLoading(false);
              }
            });
            return;
          }
          fetchProfile(authUser)
            .then((staffUser) => {
              if (!cancelled && currentRequest === requestId) {
                resolvedUserIdRef.current = authUser.id;
                setResolvedUser(staffUser);
              }
            })
            .catch((error) => {
              console.error("[useAuth] Failed to resolve authenticated user:", error);
              if (!cancelled && currentRequest === requestId) {
                resolvedUserIdRef.current = null;
                setResolvedUser(null);
              }
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
      if (event === "TOKEN_REFRESHED") {
        if (session?.user) {
          setAuthedUserId(session.user.id);
          setAuthedEmail(session.user.email ?? null);
        }
        return;
      }
      resolveSession(session);
    });

    // Remember-me + inactivity gate: if the user opted out of "Remember me",
    // clear any persisted Supabase session when a brand-new browser session
    // starts (no tab-scoped marker). Also enforce the 1-hour inactivity limit
    // across reloads by inspecting the last-activity timestamp.
    (async () => {
      try {
        const rememberMe = localStorage.getItem(REMEMBER_KEY) !== "false";
        const hasSessionMarker = sessionStorage.getItem(SESSION_ACTIVE_KEY) === "1";
        const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
        const inactiveTooLong = lastActivity > 0 && (Date.now() - lastActivity) > INACTIVITY_LIMIT_MS;
        if ((!rememberMe && !hasSessionMarker) || inactiveTooLong) {
          await supabase.auth.signOut();
          try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch { /* ignore */ }
        }
        try { sessionStorage.setItem(SESSION_ACTIVE_KEY, "1"); } catch { /* ignore */ }
      } catch { /* ignore */ }
    })();

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
  }, [fetchProfile, setResolvedUser]);

  // Auto-logout after 1 hour of inactivity. Any interaction resets the timer
  // and the timestamp is persisted so that a refresh mid-inactivity still
  // enforces the limit (see the mount effect above).
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ }
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch { /* ignore */ }
        await supabase.auth.signOut();
        resolvedUserIdRef.current = null;
        setAuthedUserId(null);
        setAuthedEmail(null);
        setResolvedUser(null);
      }, INACTIVITY_LIMIT_MS);
    };
    bump();
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "visibilitychange"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, bump));
    };
  }, [user, setResolvedUser]);



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
    setUser((prev) => {
      const next = prev ? { ...prev, name: updates.name ?? prev.name, phone: updates.phone ?? prev.phone } : prev;
      userRef.current = next;
      return next;
    });
    return null;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    resolvedUserIdRef.current = null;
    setAuthedUserId(null);
    setResolvedUser(null);
  }, [setResolvedUser]);

  const refresh = useCallback(async () => {
    try {
      await supabase.auth.refreshSession();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        resolvedUserIdRef.current = null;
        setResolvedUser(null);
        setAuthedUserId(null);
        setAuthedEmail(null);
        return;
      }
      setAuthedUserId(authUser.id);
      setAuthedEmail(authUser.email ?? null);
      const staffUser = await fetchProfile(authUser);
      resolvedUserIdRef.current = authUser.id;
      setResolvedUser(staffUser);
    } catch (e) {
      console.warn("[useAuth] refresh failed:", e);
    }
  }, [fetchProfile, setResolvedUser]);

  return {
    user, authedUserId, authedEmail, loading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    authedNoRole: !!authedEmail && !user,
    login, signup, logout, updateProfile, refresh,
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
