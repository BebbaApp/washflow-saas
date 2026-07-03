import { useEffect, useMemo, useState } from "react";

const RELEASES_API =
  "https://api.github.com/repos/BebbaApp/washflow-saas/releases/latest";
const CACHE_KEY = "wf_released_version";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const BUILD_VERSION: string = __APP_VERSION__;

function stripLeadingV(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function parseSemver(version: string): [number, number, number] {
  const parts = stripLeadingV(version).split(".");
  return [
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    parseInt(parts[2], 10) || 0,
  ];
}

function compareSemver(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] - bv[i];
  }
  return 0;
}

interface CachedVersion {
  version: string;
  fetchedAt: number;
}

function getCachedVersion(): CachedVersion | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedVersion;
    if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

function setCachedVersion(version: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version, fetchedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

/**
 * Returns the best app version to display.
 *
 * - Build-time version comes from `__APP_VERSION__` (tauri.conf.json → package.json → "dev").
 * - At runtime we fetch the latest GitHub release so the label tracks published updates
 *   even when the web build / service worker is holding onto an older bundle.
 */
export function useAppVersion() {
  const [releasedVersion, setReleasedVersion] = useState<string>(BUILD_VERSION);

  useEffect(() => {
    let cancelled = false;

    const cached = getCachedVersion();
    if (cached?.version) {
      setReleasedVersion(cached.version);
    }

    fetch(`${RELEASES_API}?_=${Date.now()}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.tag_name) return;
        const latest = stripLeadingV(data.tag_name);
        if (cancelled) return;
        setReleasedVersion(latest);
        setCachedVersion(latest);
      })
      .catch(() => {
        // Offline or API failure: keep build version / cached value
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayVersion = releasedVersion || BUILD_VERSION;
  const isOutdated = useMemo(
    () => compareSemver(BUILD_VERSION, displayVersion) < 0,
    [displayVersion]
  );

  return {
    buildVersion: BUILD_VERSION,
    releasedVersion: displayVersion,
    version: displayVersion,
    isOutdated,
  };
}
