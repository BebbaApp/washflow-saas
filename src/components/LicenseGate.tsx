import { ReactNode } from "react";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Lock } from "lucide-react";

/**
 * Wraps the app. Blocks UI when the tenant license is not active.
 * Shows a banner during trial countdown and past_due grace period.
 */
export function LicenseGate({ children }: { children: ReactNode }) {
  const { tenant, loading, licenseActive, daysUntilTrialEnd } = useTenant();
  const { logout } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading workspace…</div>;
  }

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

  if (!licenseActive) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <Card className="max-w-md w-full border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-destructive" />
              Workspace suspended
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>{tenant.name}</strong> is currently <em>{tenant.status}</em>.
              Renew your subscription to restore access.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => window.location.href = "/settings/billing"}>
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
          <a href="/settings/billing" className="underline font-medium">Add billing</a>
        </div>
      )}
      {showPastDueBanner && (
        <div className="bg-destructive/15 text-destructive px-4 py-2 text-sm flex items-center gap-2 justify-center">
          <AlertTriangle className="h-4 w-4" />
          Payment failed. Update billing to avoid losing access.
          <a href="/settings/billing" className="underline font-medium">Update billing</a>
        </div>
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}
