/**
 * AndroidUpdateDialog.tsx
 *
 * Shows a bottom sheet dialog when a new APK version is available.
 * Only renders on Android. On Mac/Windows/iOS it returns null.
 *
 * Usage in Index.tsx:
 *   import { AndroidUpdateDialog } from "@/components/AndroidUpdateDialog";
 *   // Inside your layout JSX:
 *   <AndroidUpdateDialog />
 */

import { Download, X, Smartphone } from "lucide-react";
import { useAndroidUpdater } from "@/hooks/useAndroidUpdater";

export function AndroidUpdateDialog() {
  const { updateInfo, acceptUpdate, dismissUpdate } = useAndroidUpdater();

  if (!updateInfo) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={dismissUpdate}
      />

      {/* Bottom sheet */}
      <div className="relative w-full max-w-lg mx-4 mb-4 z-10">
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Update Available</p>
                <p className="text-xs text-muted-foreground">
                  Washflow {updateInfo.latestVersion}
                </p>
              </div>
            </div>
            <button
              onClick={dismissUpdate}
              className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 pb-2">
            <p className="text-sm text-muted-foreground">
              You are running{" "}
              <span className="font-medium text-foreground">
                v{updateInfo.currentVersion}
              </span>
              . A new version is available with the latest features and fixes.
            </p>

            {updateInfo.releaseNotes && (
              <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground font-medium mb-1">
                  What's new:
                </p>
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {updateInfo.releaseNotes}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-3">
              Tap "Download Update" to get the latest APK. After downloading,
              open the file to install.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 px-5 py-4">
            <button
              onClick={dismissUpdate}
              className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              Later
            </button>
            <button
              onClick={acceptUpdate}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              Download Update
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
