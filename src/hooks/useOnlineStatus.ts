import { useEffect, useState } from "react";

/**
 * Tracks the browser's online/offline state. Defaults to `true` during SSR.
 * Note: `navigator.onLine` reports network reachability, not whether Supabase
 * is actually responsive — but for tablet-on-wifi-down it's accurate enough.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  return online;
}
