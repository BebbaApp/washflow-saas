import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import {
  PERMISSIONS_STORAGE_KEY,
  PermissionMatrix,
  cacheMatrix,
  checkPermission,
  loadMatrix,
} from "@/lib/permissions";

const BROADCAST_CHANNEL_NAME = "aquawash:permissions";

/**
 * Runtime permission hook. The matrix is stored per-tenant in the
 * `role_permissions` table and cached in localStorage for instant boot.
 * Updates from any device propagate via Supabase realtime + a local
 * broadcast channel for other tabs in the same browser.
 */
export function usePermissions() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;
  const [matrix, setMatrix] = useState<PermissionMatrix>(() => loadMatrix(tenantId));
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Reload cache when tenant changes.
  useEffect(() => { setMatrix(loadMatrix(tenantId)); }, [tenantId]);

  // Fetch from DB whenever tenant changes.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("role_permissions" as any)
        .select("matrix")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (cancelled) return;
      const next = (data as any)?.matrix as PermissionMatrix | undefined;
      if (next && typeof next === "object") {
        cacheMatrix(tenantId, next);
        setMatrix(loadMatrix(tenantId));
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Realtime subscription for cross-device updates.
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`role_perms_${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permissions", filter: `tenant_id=eq.${tenantId}` },
        (payload: any) => {
          const next = payload?.new?.matrix as PermissionMatrix | undefined;
          if (next) {
            cacheMatrix(tenantId, next);
            setMatrix(loadMatrix(tenantId));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  // Cross-tab + same-tab refresh hooks.
  useEffect(() => {
    const reload = () => setMatrix(loadMatrix(tenantId));

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith(PERMISSIONS_STORAGE_KEY)) reload();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") reload();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("aquawash:permissions-changed", reload);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisibility);

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
  }, [tenantId]);

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
 * Notify every listener in this browser that the matrix changed.
 * Cross-device updates are handled by the Supabase realtime channel above.
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
