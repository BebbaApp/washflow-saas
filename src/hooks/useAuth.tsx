import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import { db } from "@/offline/db";
import {
  LAST_ACTIVITY_KEY,
  SESSION_CHANNEL,
  loadSessionConfig,
  saveSessionConfig,
  type SessionConfig,
} from "@/lib/auth/sessionConfig";

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
  /** True while the idle-warning modal should be visible. */
  idleWarning: boolean;
  /** Seconds remaining before auto-logout when the warning is shown. */
  idleSecondsLeft: number;
  /** One-click extend: resets the idle timer across all tabs. */
  extendSession: () => void;
  /** Current tunables (from localStorage or DEFAULT_SESSION_CONFIG). */
  sessionConfig: SessionConfig;
  /** Update tunables at runtime; persists to localStorage. */
  updateSessionConfig: (cfg: Partial<SessionConfig>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_TENANT_KEY = "lovable.active_tenant_id";
const REMEMBER_KEY = "wf_remember_me";
const SESSION_ACTIVE_KEY = "wf_session_active";

/** Fire-and-forget audit row into public.auth_events. Silently ignores errors
 *  (e.g. if the table hasn't been provisioned yet in this environment). */
async function logAuthEvent(kind: "sign_in" | "sign_out" | "sign_up" | "password_reset",
                            userId: string | null | undefined,
                            email: string | null | undefined) {
  if (!userId) return;
  try {
    let tenantId: string | null = null;
    try { tenantId = localStorage.getItem(ACTIVE_TENANT_KEY); } catch { /* ignore */ }
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
    await (supabase as any).from("auth_events").insert({
      user_id: userId,
      email: email ?? null,
      tenant_id: tenantId,
      kind,
      user_agent: ua,
    });
  } catch { /* ignore — audit is best-effort */ }
}

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

  const [sessionConfig, setSessionConfig] = useState<SessionConfig>(() => loadSessionConfig());
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(0);
  const idleWarningRef = useRef(false);
  const bumpRef = useRef<(force?: boolean) => void>(() => {});


  const setResolvedUser = useCallback((next: StaffUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  const updateSessionConfig = useCallback((cfg: Partial<SessionConfig>) => {
    saveSessionConfig(cfg);
    setSessionConfig((prev) => ({ ...prev, ...cfg }));
  }, []);

  const extendSession = useCallback(() => {
    bumpRef.current(true);
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
        const inactiveTooLong = lastActivity > 0 && (Date.now() - lastActivity) > sessionConfig.inactivityLimitMs;
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

  // Idle lifecycle: activity listeners, cross-tab sync, warning modal, and
  // JWT keepalive. Any real user interaction in ANY tab defers logout in ALL
  // tabs via BroadcastChannel + a shared localStorage timestamp (fallback
  // storage event). A warning modal appears `warningMs` before the logout
  // fires so the user can extend the session with one click.
  useEffect(() => {
    if (!user) return;
    const { inactivityLimitMs, warningMs, keepaliveMs, bumpThrottleMs } = sessionConfig;

    let logoutTimer: ReturnType<typeof setTimeout> | null = null;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let lastBump = 0;

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(SESSION_CHANNEL);
    } catch { /* ignore */ }

    const clearTimers = () => {
      if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null; }
      if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    };

    const scheduleFrom = (activityTs: number) => {
      clearTimers();
      const elapsed = Date.now() - activityTs;
      const untilWarn = Math.max(0, inactivityLimitMs - warningMs - elapsed);
      const untilLogout = Math.max(0, inactivityLimitMs - elapsed);

      warnTimer = setTimeout(() => {
        setIdleWarning(true);
        idleWarningRef.current = true;
        setIdleSecondsLeft(Math.ceil(warningMs / 1000));
        countdownTimer = setInterval(() => {
          setIdleSecondsLeft((s) => (s > 0 ? s - 1 : 0));
        }, 1000);
      }, untilWarn);


      logoutTimer = setTimeout(async () => {
        try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch { /* ignore */ }
        setIdleWarning(false);
        await supabase.auth.signOut();
        resolvedUserIdRef.current = null;
        setAuthedUserId(null);
        setAuthedEmail(null);
        setResolvedUser(null);
      }, untilLogout);
    };

    const applyActivity = (ts: number, broadcast: boolean) => {
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(ts)); } catch { /* ignore */ }
      setIdleWarning(false);
      idleWarningRef.current = false;
      setIdleSecondsLeft(0);
      scheduleFrom(ts);
      if (broadcast) {
        try { channel?.postMessage({ type: "activity", ts }); } catch { /* ignore */ }
      }
    };

    const bump = (force = false) => {
      // Once the idle-warning dialog is showing, ignore ambient activity
      // (mousemove, scroll, etc.) — otherwise moving the cursor toward the
      // "Stay signed in" button silently dismisses the dialog before the
      // click lands. Only an explicit extendSession() call (force=true)
      // clears the warning.
      if (idleWarningRef.current && !force) return;
      const now = Date.now();
      if (!force && now - lastBump < bumpThrottleMs) return;
      lastBump = now;
      applyActivity(now, true);
    };

    // Expose bump() for the one-click "Stay signed in" extend action.
    bumpRef.current = bump;


    const onRemoteActivity = (ts: number) => {
      if (!Number.isFinite(ts)) return;
      lastBump = ts; // treat as recent so local bumps stay throttled
      setIdleWarning(false);
      setIdleSecondsLeft(0);
      scheduleFrom(ts);
    };

    const onChannelMessage = (ev: MessageEvent) => {
      if (ev?.data?.type === "activity") onRemoteActivity(Number(ev.data.ts));
    };
    channel?.addEventListener("message", onChannelMessage);

    // Fallback for browsers without BroadcastChannel: listen to storage events.
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== LAST_ACTIVITY_KEY || !ev.newValue) return;
      onRemoteActivity(Number(ev.newValue));
    };
    window.addEventListener("storage", onStorage);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        bump();
        supabase.auth.refreshSession().catch(() => { /* ignore */ });
      }
    };

    // Seed from the shared timestamp if another tab was recently active,
    // otherwise start a fresh window now.
    const seed = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
    if (seed && Date.now() - seed < inactivityLimitMs) {
      scheduleFrom(seed);
    } else {
      applyActivity(Date.now(), true);
    }

    const winEvents = [
      "mousemove", "mousedown", "mouseup", "click",
      "keydown", "keyup",
      "touchstart", "touchmove", "touchend",
      "pointerdown", "pointermove",
      "wheel", "scroll",
      "focus",
    ] as const;
    const listenerOpts: AddEventListenerOptions = { passive: true, capture: true };
    const bumpListener: EventListener = () => bump();
    winEvents.forEach((ev) => window.addEventListener(ev, bumpListener, listenerOpts));

    document.addEventListener("visibilitychange", onVisibility);

    // Keepalive: refresh the Supabase access token on a schedule so background
    // sync/polling never hits a 401 from an expired JWT.
    const keepalive = setInterval(() => {
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
      if (last && Date.now() - last > inactivityLimitMs) return;
      supabase.auth.refreshSession().catch(() => { /* ignore transient errors */ });
    }, keepaliveMs);

    return () => {
      clearTimers();
      clearInterval(keepalive);
      winEvents.forEach((ev) => window.removeEventListener(ev, bump, listenerOpts));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      channel?.removeEventListener("message", onChannelMessage);
      try { channel?.close(); } catch { /* ignore */ }
    };
  }, [user, setResolvedUser, sessionConfig]);



  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    void logAuthEvent("sign_in", data.user?.id ?? null, data.user?.email ?? email);
    return null;
  }, []);

  const signup = useCallback(async (
    email: string, password: string, name: string, phone?: string, companyName?: string,
  ): Promise<string | null> => {
    const { data, error } = await supabase.auth.signUp({
      email, password, phone: phone || undefined,
      options: {
        data: { name, ...(phone ? { phone } : {}), ...(companyName ? { company_name: companyName } : {}) },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) return error.message;
    void logAuthEvent("sign_up", data.user?.id ?? null, data.user?.email ?? email);
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
    const uid = authedUserId;
    const em = authedEmail;
    // Log BEFORE signOut — the auth_events RLS insert policy requires an
    // authenticated session (user_id = auth.uid()). Awaiting ensures the
    // insert flushes before the bearer token is cleared.
    await logAuthEvent("sign_out", uid, em);
    await supabase.auth.signOut();
    resolvedUserIdRef.current = null;
    setAuthedUserId(null);
    setResolvedUser(null);
  }, [setResolvedUser, authedUserId, authedEmail]);

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
    idleWarning, idleSecondsLeft, extendSession, sessionConfig, updateSessionConfig,
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
