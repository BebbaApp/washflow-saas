import { useEffect, useState } from 'react';
import { useTauriSync } from '@/lib/tauri/sync';
import { WifiOff, RefreshCw, CloudOff, Clock, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isImmersive, toggleImmersive } from '@/lib/tauri/immersive';

export function TauriStatusBar() {
  const { isOnline, isSyncing, pendingCount, lastSyncTime, isTauriApp, forceSync } = useTauriSync();
  const [immersive, setImmersive] = useState(false);

  useEffect(() => {
    if (!isTauriApp) return;
    isImmersive().then(setImmersive).catch(() => {});
  }, [isTauriApp]);

  // Only show in Tauri desktop app
  if (!isTauriApp) return null;

  const handleToggleImmersive = async () => {
    const next = await toggleImmersive();
    setImmersive(next);
  };

  const ImmersiveFab = (
    <button
      onClick={handleToggleImmersive}
      title={immersive ? 'Exit fullscreen (F11 / Esc)' : 'Enter fullscreen (F11)'}
      aria-label={immersive ? 'Exit fullscreen' : 'Enter fullscreen'}
      className="fixed top-3 right-3 z-[60] w-9 h-9 rounded-full bg-background/80 backdrop-blur border border-border shadow-md flex items-center justify-center text-foreground hover:bg-background transition-colors"
    >
      {immersive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
    </button>
  );

  // All good — show only the immersive toggle
  if (isOnline && !isSyncing && pendingCount === 0) return ImmersiveFab;

  const formatTime = (d: Date | null) => {
    if (!d) return 'Never';
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return d.toLocaleTimeString([], { hour12: false });
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
