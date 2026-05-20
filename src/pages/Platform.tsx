import { Link, Navigate } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Building2, Users, ScrollText, Shield, Loader2 } from "lucide-react";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useAuth } from "@/hooks/useAuth";
import { TenantsAdmin } from "@/components/platform/TenantsAdmin";
import { UsersAdmin } from "@/components/platform/UsersAdmin";
import { LicenseEventsAdmin } from "@/components/LicenseEventsAdmin";

type Tab = "tenants" | "users" | "events";

const tabs: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "tenants", label: "Tenants", icon: Building2 },
  { id: "users", label: "Users", icon: Users },
  { id: "events", label: "Events", icon: ScrollText },
];

export default function Platform() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isPlatformAdmin, loading } = usePlatformAdmin();
  const [tab, setTab] = useState<Tab>("tenants");

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/" replace />;

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card p-8 max-w-md text-center space-y-3">
          <Shield className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-lg font-bold text-foreground">Platform access only</h1>
          <p className="text-sm text-muted-foreground">
            This area is restricted to platform administrators. If you need access, ask an existing
            super-admin to grant you the role.
          </p>
          <Link to="/" className="inline-block text-sm text-primary hover:underline">← Back to app</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors" title="Back to app">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground leading-tight">Platform Console</h1>
              <p className="text-[11px] text-muted-foreground">Super-admin · cross-tenant controls</p>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === "tenants" && <TenantsAdmin />}
        {tab === "users" && <UsersAdmin />}
        {tab === "events" && <LicenseEventsAdmin />}
      </main>
    </div>
  );
}
