import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  PERMISSIONS_STORAGE_KEY,
  PermissionMatrix,
  checkPermission,
  loadMatrix,
} from "@/lib/permissions";

const BROADCAST_CHANNEL_NAME = "aquawash:permissions";

/**
 * Runtime permission hook. Reads the role-permissions matrix configured by
 * an admin in Settings → Role Permissions and combines it with the current
 * authenticated user's role.
 *
 * Changes made by an admin propagate instantly to:
 *  - the current tab (custom `aquawash:permissions-changed` event)
 *  - other tabs in the same browser (`storage` event + BroadcastChannel)
 *  - the same tab when it regains focus / becomes visible (covers the case
 *    where a different session updated the matrix while the tab was hidden).
 *
 * Components should treat `can()` as the source of truth for whether to show
 * a menu item, button or section. Server-side enforcement (RLS policies, edge
 * function role checks) is the actual security boundary — this hook only
 * controls what the UI exposes.
 */
export function usePermissions() {
  const { user } = useAuth();
  const [matrix, setMatrix] = useState<PermissionMatrix>(() => loadMatrix());
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const reload = () => setMatrix(loadMatrix());

    const onStorage = (e: StorageEvent) => {
      if (e.key === PERMISSIONS_STORAGE_KEY || e.key === null) reload();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") reload();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("aquawash:permissions-changed", reload);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisibility);

    // Cross-tab broadcast (works even when storage event is throttled).
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.onmessage = (ev) => {
        if (ev?.data?.type === "permissions-changed") reload();
      };
      channelRef.current = channel;
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("aquawash:permissions-changed", reload);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisibility);
      channel?.close();
      channelRef.current = null;
    };
  }, []);

  const role = user?.role ?? null;

  const can = useCallback(
    (key: string) => checkPermission(matrix, role, key),
    [matrix, role],
  );

  const canAny = useCallback(
    (keys: string[]) => keys.some((k) => checkPermission(matrix, role, k)),
    [matrix, role],
  );

  return { can, canAny, role, isAdmin: role === "admin" };
}

/**
 * Notify every listener (this tab, other tabs, other windows) that the
 * permission matrix has changed. Call this after writing the matrix to
 * localStorage from an admin UI.
 */
export function broadcastPermissionsChanged() {
  try {
    window.dispatchEvent(new Event("aquawash:permissions-changed"));
  } catch { /* ignore */ }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      ch.postMessage({ type: "permissions-changed", at: Date.now() });
      ch.close();
    }
  } catch { /* ignore */ }
}
