import { useTauriSync } from '@/lib/tauri/sync';
import { WifiOff, RefreshCw, CloudOff, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TauriStatusBar() {
  const { isOnline, isSyncing, pendingCount, lastSyncTime, isTauriApp, forceSync } = useTauriSync();

  // Only show in Tauri desktop app
  if (!isTauriApp) return null;

  // All good — no banner
  if (isOnline && !isSyncing && pendingCount === 0) return null;

  const formatTime = (d: Date | null) => {
    if (!d) return 'Never';
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return d.toLocaleTimeString();
  };

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shadow-md">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4" />
          <span>Working offline — data saved to local database</span>
          {pendingCount > 0 && (
            <span className="bg-amber-700 rounded-full px-2 py-0.5 text-xs">
              {pendingCount} change{pendingCount !== 1 ? 's' : ''} to sync
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-amber-100 text-xs">
          <Clock className="w-3 h-3" />
          <span>Last sync: {formatTime(lastSyncTime)}</span>
        </div>
      </div>
    );
  }

  if (isSyncing) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white px-4 py-2 flex items-center gap-2 text-sm font-medium shadow-md">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Syncing with cloud...</span>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shadow-md">
        <div className="flex items-center gap-2">
          <CloudOff className="w-4 h-4" />
          <span>{pendingCount} change{pendingCount !== 1 ? 's' : ''} not yet synced</span>
        </div>
        <Button size="sm" variant="ghost" className="text-white hover:bg-orange-600 h-7 text-xs" onClick={forceSync}>
          <RefreshCw className="w-3 h-3 mr-1" />
          Sync now
        </Button>
      </div>
    );
  }

  return null;
}
