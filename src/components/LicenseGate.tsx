import { ReactNode, useState, useEffect } from "react";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Lock, Loader2, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const OFFLINE_TENANT_KEY = "wf_last_known_tenant";
const OFFLINE_LICENSE_KEY = "wf_last_known_license";

/**
 * Wraps the app. Blocks UI when the tenant license is not active.
 * When OFFLINE — always allows access using the last known license state.
 * This means staff can work without internet as long as they've logged in before.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const { tenant, loading, licenseActive, daysUntilTrialEnd, isSuperAdmin, memberships, switchTenant } = useTenant();
  const { logout } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [autoSwitching, setAutoSwitching] = useState(false);

  // Super-admin auto-redirect: if the currently-selected tenant is suspended/inactive,
  // hop to the first available active tenant instead of showing the license wall.
  useEffect(() => {
    if (!isOnline || loading || autoSwitching) return;
    if (!isSuperAdmin || !tenant || licenseActive) return;
    const candidate = memberships.find((m) => m.id !== tenant.id);
    if (!candidate) return;
    setAutoSwitching(true);
    (async () => {
      try {
        toast({
          title: "Workspace suspended",
          description: `Switching to ${candidate.name} instead.`,
        });
        await switchTenant(candidate.id);
      } catch (e: any) {
        console.warn("auto tenant switch failed", e);
      } finally {
        setAutoSwitching(false);
      }
    })();
  }, [isOnline, loading, isSuperAdmin, tenant, licenseActive, memberships, switchTenant, autoSwitching]);

  // Track online/offline state
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Cache the last known good license state when online
  useEffect(() => {
    if (isOnline && tenant && licenseActive) {
      try {
        localStorage.setItem(OFFLINE_TENANT_KEY, JSON.stringify(tenant));
        localStorage.setItem(OFFLINE_LICENSE_KEY, "true");
      } catch { /* ignore */ }
    }
  }, [isOnline, tenant, licenseActive]);

  // When offline — use cached license state
  const offlineTenant = (() => {
    try {
      const raw = localStorage.getItem(OFFLINE_TENANT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();
  const offlineLicenseActive = localStorage.getItem(OFFLINE_LICENSE_KEY) === "true";

  // Still loading — show spinner but timeout quickly when offline
  if (loading && isOnline) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  // OFFLINE MODE — use cached state
  if (!isOnline) {
    if (offlineTenant && offlineLicenseActive) {
      // Allow full access offline using cached license
      return (
        <div className="flex min-h-screen flex-col">
          <div className="bg-amber-500/15 text-amber-900 dark:text-amber-200 px-4 py-2 text-sm flex items-center gap-2 justify-center">
            <WifiOff className="h-4 w-4" />
            Working offline — all changes will sync when reconnected
          </div>
          <div className="flex-1">{children}</div>
        </div>
      );
    }
    // Never logged in before offline — can't proceed
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5" />
              No internet connection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Please connect to the internet to log in for the first time.
              Once logged in, the app will work offline.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ONLINE — normal license checks
  if (!tenant) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>No workspace found</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your account is not linked to any workspace. Ask your administrator to invite you,
              or contact support.
            </p>
            <Button variant="outline" onClick={() => logout()}>Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const openBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-portal", {
        body: { tenant_id: tenant?.id, return_url: window.location.origin },
      });
      if (error || !data?.url) {
        toast({
          title: "Billing not available yet",
          description: "Stripe billing isn't configured for this workspace. Contact support to renew.",
          variant: "destructive",
        });
        return;
      }
      window.location.href = data.url as string;
    } catch (e: any) {
      toast({ title: "Could not open billing portal", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  if (!licenseActive) {
    if (autoSwitching) {
      return (
        <div className="flex h-screen items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Switching to an active workspace…
        </div>
      );
    }
    const isCancelled = tenant.status === "cancelled";
    const isPastDueExpired = tenant.status === "past_due";
    const title = isCancelled ? "Workspace cancelled" : isPastDueExpired ? "Access paused — payment overdue" : "Workspace suspended";
    const body = isCancelled
      ? "Your subscription has been cancelled. Renew billing to restore access to your data."
      : isPastDueExpired
        ? "Your grace period ended without a successful payment. Update billing to restore access."
        : `${tenant.name} is currently ${tenant.status}. Renew your subscription to restore access.`;
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <Card className="max-w-md w-full border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-destructive" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{body}</p>
            <div className="flex gap-2">
              <Button onClick={openBillingPortal} disabled={portalLoading}>
                {portalLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Manage billing
              </Button>
              <Button variant="outline" onClick={() => logout()}>Sign out</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const showTrialBanner = tenant.status === "trialing" && daysUntilTrialEnd !== null && daysUntilTrialEnd <= 7;
  const showPastDueBanner = tenant.status === "past_due";

  return (
    <div className="flex min-h-screen flex-col">
      {showTrialBanner && (
        <div className="bg-amber-500/15 text-amber-900 dark:text-amber-200 px-4 py-2 text-sm flex items-center gap-2 justify-center">
          <AlertTriangle className="h-4 w-4" />
          Trial ends in {daysUntilTrialEnd} day{daysUntilTrialEnd === 1 ? "" : "s"}.
          <button onClick={openBillingPortal} className="underline font-medium" disabled={portalLoading}>Add billing</button>
        </div>
      )}
      {showPastDueBanner && (
        <div className="bg-destructive/15 text-destructive px-4 py-2 text-sm flex items-center gap-2 justify-center">
          <AlertTriangle className="h-4 w-4" />
          Payment failed. Update billing to avoid losing access.
          <button onClick={openBillingPortal} className="underline font-medium" disabled={portalLoading}>Update billing</button>
        </div>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}
