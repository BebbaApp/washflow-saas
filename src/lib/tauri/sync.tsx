/**
 * Tauri Sync Context
 * Manages sync between local SQLite and Supabase.
 * Runs automatically when online, queues when offline.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { db, isTauri } from './db';
import { useTenant } from '@/hooks/useTenant';
import { clearLocalSupabaseSession, supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SyncContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: Date | null;
  isTauriApp: boolean;
  forceSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
  isTauriApp: false,
  forceSync: async () => {},
});

// Tables to pull from Supabase into local SQLite on initial sync
const SYNC_TABLES = [
  { table: 'orders', filter: 'tenant' },
  { table: 'customers', filter: 'tenant' },
  { table: 'services', filter: 'tenant' },
  { table: 'expenses', filter: 'tenant' },
  { table: 'inventory_items', filter: 'tenant' },
  { table: 'shifts', filter: 'tenant' },
  { table: 'attendance_records', filter: 'tenant' },
  { table: 'loyalty_transactions', filter: 'tenant' },
  { table: 'expense_categories', filter: 'tenant' },
  { table: 'suppliers', filter: 'tenant' },
  { table: 'shift_templates', filter: 'tenant' },
  { table: 'services', filter: 'tenant' },
];

export function TauriSyncProvider({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get Supabase URL and anon key from env
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  const ensureSessionForTenant = useCallback(async () => {
    if (!tenant?.id) return null;
    const { data: initial, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    let session = initial.session;
    if (!session) return null;

    const validated = await supabase.auth.getUser(session.access_token);
    if (validated.error) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        await clearLocalSupabaseSession();
        throw new Error('Your session expired. Please sign in again, then retry sync.');
      }
      session = data.session;
    }

    const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
    if (expiresAtMs && expiresAtMs - Date.now() < 60_000) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      session = data.session;
      if (!session) return null;
    }

    try { localStorage.setItem('lovable.active_tenant_id', tenant.id); } catch { /* ignore */ }

    const activeClaim = (session.user.app_metadata as any)?.active_tenant_id;
    if (activeClaim !== tenant.id) {
      const { error } = await supabase.functions.invoke('switch-tenant', { body: { tenant_id: tenant.id } });
      if (error) throw error;
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      session = data.session;
    }

    return session;
  }, [tenant?.id]);

  // Pull all data from Supabase into SQLite
  const pullFromSupabase = useCallback(async (tenantId: string) => {
    if (!isTauri || !isOnline) return;
    console.log('[TauriSync] Pulling from Supabase...');

    for (const { table, filter } of SYNC_TABLES) {
      try {
        let query = supabase.from(table as any).select('*');
        if (filter === 'tenant') {
          query = query.eq('tenant_id', tenantId) as any;
        }
        const { data, error } = await query;
        if (error) {
          console.warn(`[TauriSync] Could not pull ${table}:`, error.message);
          continue;
        }
        if (data && data.length > 0) {
          await db.bulkUpsert(table, data as unknown as Record<string, unknown>[]);
          console.log(`[TauriSync] ${table}: pulled ${data.length} records`);
        }
      } catch (err) {
        console.warn(`[TauriSync] Error pulling ${table}:`, err);
      }
    }
  }, [isOnline]);

  // Push queued mutations to Supabase.
  // IMPORTANT: use the current user's access_token, not the anon key —
  // otherwise all writes are anonymous and RLS silently rejects them,
  // so approvals/edits made in the installed app never reach the database.
  const pushToSupabase = useCallback(async (): Promise<void> => {
    if (!isTauri || !isOnline) return;
    const session = await ensureSessionForTenant();
    const token = session?.access_token;
    if (!token) {
      console.warn('[TauriSync] Skipping push — no authenticated session');
      return;
    }
    const result = await db.triggerSync(supabaseUrl, token);
    setPendingCount(result.remaining);
    if (result.synced > 0) {
      console.log(`[TauriSync] Pushed ${result.synced} records`);
    }
  }, [isOnline, supabaseUrl, ensureSessionForTenant]);

  // Full sync: push queue first, then pull fresh data
  const forceSync = useCallback(async () => {
    if (!tenant?.id || !isOnline) return;
    setIsSyncing(true);
    try {
      await pushToSupabase();
      await pullFromSupabase(tenant.id);
      await db.setMeta('last_sync', new Date().toISOString());
      setLastSyncTime(new Date());
      toast.success('Sync complete', { duration: 2000 });
    } catch (err) {
      console.error('[TauriSync] Sync error:', err);
      toast.error('Sync failed — will retry');
    } finally {
      setIsSyncing(false);
    }
  }, [tenant?.id, isOnline, pushToSupabase, pullFromSupabase]);

  // Initial sync when tenant becomes available
  useEffect(() => {
    if (!isTauri || !tenant?.id) return;

    const init = async () => {
      // Load last sync time from metadata
      const lastSync = await db.getMeta('last_sync');
      if (lastSync) setLastSyncTime(new Date(lastSync));

      // Load pending count
      const pending = await db.getPendingSyncCount();
      setPendingCount(pending);

      // Do initial sync if online
      if (isOnline) {
        await forceSync();
      }
    };

    init();
  }, [tenant?.id]);

  // Auto-sync every 5 minutes while online
  useEffect(() => {
    if (!isTauri) return;

    if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    syncTimerRef.current = setInterval(() => {
      if (isOnline && tenant?.id && !isSyncing) {
        pushToSupabase();
      }
    }, 5 * 60 * 1000);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [isOnline, tenant?.id, isSyncing, pushToSupabase]);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      toast.success('Back online — syncing...', { duration: 3000 });
      if (tenant?.id) await forceSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('Working offline — all changes saved locally', { duration: 5000 });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [tenant?.id, forceSync]);

  return (
    <SyncContext.Provider value={{ isOnline, isSyncing, pendingCount, lastSyncTime, isTauriApp: isTauri, forceSync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useTauriSync() {
  return useContext(SyncContext);
}
