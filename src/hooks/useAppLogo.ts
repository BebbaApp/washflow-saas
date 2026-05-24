import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

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
  const { tenant } = useTenant();
  const [logo, setLogoState] = useState<string | null>(() => read());
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    const onChange = () => setLogoState(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // Hydrate from DB
  useEffect(() => {
    if (!tenant?.id || hydratedFor.current === tenant.id) return;
    hydratedFor.current = tenant.id;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_settings")
        .select("logo_data_url")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error || !data) return;
      const dbLogo: string | null = data.logo_data_url ?? null;
      try {
        if (dbLogo) window.localStorage.setItem(STORAGE_KEY, dbLogo);
        else window.localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setLogoState(dbLogo);
      window.dispatchEvent(new Event(EVENT));
    })();
  }, [tenant?.id]);

  const setLogo = useCallback((dataUrl: string | null) => {
    try {
      if (dataUrl) window.localStorage.setItem(STORAGE_KEY, dataUrl);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota errors */
    }
    window.dispatchEvent(new Event(EVENT));
    setLogoState(dataUrl);

    if (tenant?.id) {
      (supabase as any)
        .from("tenant_settings")
        .upsert({ tenant_id: tenant.id, logo_data_url: dataUrl }, { onConflict: "tenant_id" })
        .then(({ error }: { error: any }) => {
          if (error) console.warn("Failed to persist logo:", error.message);
        });
    }
  }, [tenant?.id]);

  return { logo, setLogo };
}
