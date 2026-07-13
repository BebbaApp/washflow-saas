/**
 * useAndroidUpdater.ts
 *
 * Checks GitHub releases for a newer APK version and prompts
 * the user to download it. Only runs on Android (Tauri mobile).
 *
 * Usage: Call useAndroidUpdater() in your App.tsx or Index.tsx
 */

import { useEffect, useState, useCallback } from "react";

const GITHUB_API = "https://api.github.com/repos/BebbaApp/washflow-saas/releases/latest";
const APK_DOWNLOAD_BASE = "https://github.com/BebbaApp/washflow-saas/releases/download";

// Detect if running on Android via Tauri
function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("android") && !!(window as any).__TAURI__;
}

// Get current app version from Tauri
async function getCurrentVersion(): Promise<string> {
  try {
    // Try Tauri app version API
    const tauri = (window as any).__TAURI__;
    if (tauri?.app?.getVersion) {
      return await tauri.app.getVersion();
    }
    // Fallback: read from meta tag or hardcoded
    const meta = document.querySelector('meta[name="app-version"]');
    if (meta) return meta.getAttribute('content') || "0.0.0";
    return "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Compare semver: returns true if remote > current
function isNewer(current: string, remote: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [cMaj, cMin, cPat] = parse(current);
  const [rMaj, rMin, rPat] = parse(remote);
  if (rMaj !== cMaj) return rMaj > cMaj;
  if (rMin !== cMin) return rMin > cMin;
  return rPat > cPat;
}

// Open URL in Android browser
async function openUrl(url: string) {
  try {
    const tauri = (window as any).__TAURI__;
    if (tauri?.shell?.open) {
      await tauri.shell.open(url);
    } else {
      window.open(url, "_blank");
    }
  } catch {
    window.open(url, "_blank");
  }
}

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
}

export function useAndroidUpdater() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (!isAndroid()) return;
    if (checking) return;

    setChecking(true);
    try {
      const [currentVersion, response] = await Promise.all([
        getCurrentVersion(),
        fetch(GITHUB_API, {
          headers: { Accept: "application/vnd.github.v3+json" },
        }),
      ]);

      if (!response.ok) return;
      const release = await response.json();
      const latestVersion = (release.tag_name || "").replace(/^v/, "");

      if (!latestVersion || !isNewer(currentVersion, latestVersion)) {
        console.log(`[AndroidUpdater] Up to date (${currentVersion})`);
        return;
      }

      // Find the APK asset
      const apkAsset = (release.assets || []).find(
        (a: any) =>
          a.name.endsWith(".apk") &&
          !a.name.includes("unsigned") &&
          !a.name.endsWith(".sig")
      );

      const downloadUrl = apkAsset
        ? apkAsset.browser_download_url
        : `${APK_DOWNLOAD_BASE}/v${latestVersion}/Washflow-signed.apk`;

      const releaseNotes =
        release.body?.split("\n").slice(0, 3).join("\n") ||
        "Bug fixes and improvements";

      console.log(`[AndroidUpdater] New version available: ${latestVersion}`);
      setUpdateInfo({
        available: true,
        currentVersion,
        latestVersion,
        downloadUrl,
        releaseNotes,
      });
    } catch (e) {
      console.error("[AndroidUpdater] Check failed:", e);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  // Check on mount with a small delay
  useEffect(() => {
    if (!isAndroid()) return;
    const timer = setTimeout(() => checkForUpdate(), 5000);
    return () => clearTimeout(timer);
  }, []);

  const acceptUpdate = useCallback(async () => {
    if (!updateInfo) return;
    await openUrl(updateInfo.downloadUrl);
    setDismissed(true);
  }, [updateInfo]);

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    updateInfo: dismissed ? null : updateInfo,
    checking,
    acceptUpdate,
    dismissUpdate,
    checkForUpdate,
  };
}
