import { useEffect, useState } from "react";

/** Live `navigator.onLine` value. Note: the browser only flips this when the
 *  OS-level network drops — fetch failures while "online" are handled separately
 *  by the sync engine's error/backoff logic. */
export function useOnline() {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
