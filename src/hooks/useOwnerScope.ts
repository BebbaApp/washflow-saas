import { useMemo } from "react";
import { useTenant } from "@/hooks/useTenant";

export function useOwnerScope() {
  const { memberships, isSuperAdmin } = useTenant();
  return useMemo(() => {
    const owned = memberships.filter((m) => m.tenant_role === "owner" || m.tenant_role === "admin");
    const isOwnerOfMultiple = isSuperAdmin || owned.length >= 2;
    return { owned, isOwnerOfMultiple, isSuperAdmin };
  }, [memberships, isSuperAdmin]);
}
