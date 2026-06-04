import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function usePlatformAdmin() {
  const { user } = useAuth();
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setIsPlatformAdmin(false); setLoading(false); return; }
      const { data } = await supabase
        .from("platform_admins" as any)
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setIsPlatformAdmin(!!data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return { isPlatformAdmin, loading };
}
