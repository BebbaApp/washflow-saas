import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "aquawash_app_logo";
const EVENT = "aquawash:logo-changed";

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useAppLogo() {
  const [logo, setLogoState] = useState<string | null>(() => read());

  useEffect(() => {
    const onChange = () => setLogoState(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setLogo = useCallback((dataUrl: string | null) => {
    try {
      if (dataUrl) window.localStorage.setItem(STORAGE_KEY, dataUrl);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota errors */
    }
    window.dispatchEvent(new Event(EVENT));
    setLogoState(dataUrl);
  }, []);

  return { logo, setLogo };
}
