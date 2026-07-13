// Tunable auth/session timing. Defaults are safe for production; override
// via localStorage key "wf_session_config" (JSON) or by editing the DEFAULTS
// below. All values are in milliseconds.
//
// Example (paste into DevTools console):
//   localStorage.setItem("wf_session_config", JSON.stringify({
//     inactivityLimitMs: 20 * 60 * 1000,
//     warningMs: 90 * 1000,
//     keepaliveMs: 5 * 60 * 1000,
//   }));

export interface SessionConfig {
  /** Total idle time before auto-logout. */
  inactivityLimitMs: number;
  /** How long the warning modal is shown before the logout fires. */
  warningMs: number;
  /** How often to proactively refresh the Supabase JWT while active. */
  keepaliveMs: number;
  /** Throttle for the activity "bump" handler. */
  bumpThrottleMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  inactivityLimitMs: 15 * 60 * 1000, // 15 minutes
  warningMs: 90 * 1000,              // 90-second warning
  keepaliveMs: 4 * 60 * 1000,        // refresh JWT every 4 minutes
  bumpThrottleMs: 1000,
};

const STORAGE_KEY = "wf_session_config";

export function loadSessionConfig(): SessionConfig {
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION_CONFIG;
    const parsed = JSON.parse(raw) as Partial<SessionConfig>;
    return {
      inactivityLimitMs: Number(parsed.inactivityLimitMs) || DEFAULT_SESSION_CONFIG.inactivityLimitMs,
      warningMs: Number(parsed.warningMs) || DEFAULT_SESSION_CONFIG.warningMs,
      keepaliveMs: Number(parsed.keepaliveMs) || DEFAULT_SESSION_CONFIG.keepaliveMs,
      bumpThrottleMs: Number(parsed.bumpThrottleMs) || DEFAULT_SESSION_CONFIG.bumpThrottleMs,
    };
  } catch {
    return DEFAULT_SESSION_CONFIG;
  }
}

export function saveSessionConfig(cfg: Partial<SessionConfig>) {
  try {
    const merged = { ...loadSessionConfig(), ...cfg };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
}

/** Shared key for cross-tab activity sync (also used as fallback via storage event). */
export const LAST_ACTIVITY_KEY = "wf_last_activity";
/** BroadcastChannel name used to keep tabs in sync. */
export const SESSION_CHANNEL = "wf_session";
