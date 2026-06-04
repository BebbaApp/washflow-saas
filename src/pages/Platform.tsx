import { Link, Navigate } from "react-router-dom";
import { useState } from "react";
import { Building2, Users, ScrollText, Shield, Loader2, LayoutDashboard, Settings as SettingsIcon, Receipt, Package } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { TenantsAdmin } from "@/components/platform/TenantsAdmin";
import { UsersAdmin } from "@/components/platform/UsersAdmin";
import { LicenseEventsAdmin } from "@/components/LicenseEventsAdmin";
import { ConsoleDashboard } from "@/components/platform/ConsoleDashboard";
import { ConsoleSettings } from "@/components/platform/ConsoleSettings";
import { ConsoleExpenses } from "@/components/platform/ConsoleExpenses";
import { ConsolePlans } from "@/components/platform/ConsolePlans";
import { UserMenu } from "@/components/UserMenu";
import { HeaderClock } from "@/components/HeaderClock";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";

type Tab = "dashboard" | "tenants" | "plans" | "users" | "expenses" | "events" | "settings";

const items: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "tenants", label: "Tenants", icon: Building2 },
  { id: "plans", label: "Plans", icon: Package },
  { id: "users", label: "Users", icon: Users },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "events", label: "Events", icon: ScrollText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function PlatformSidebar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-3 py-4 border-b border-sidebar-border flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold text-sidebar-foreground leading-tight">Platform</div>
              <div className="text-[10px] text-muted-foreground">Super-admin console</div>
            </div>
          )}
        </div>
        <SidebarGroup>
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton isActive={tab === item.id} onClick={() => setTab(item.id)}>
                      <Icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function Platform() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { isSuperAdmin, loading } = useTenant();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/" replace />;

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card p-8 max-w-md text-center space-y-3">
          <Shield className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-lg font-bold text-foreground">Platform access only</h1>
          <p className="text-sm text-muted-foreground">
            This area is restricted to super administrators.
          </p>
          <Link to="/" className="inline-block text-sm text-primary hover:underline">← Back to app</Link>
        </div>
      </div>
    );
  }

  const activeLabel = items.find((i) => i.id === tab)?.label ?? "";

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <PlatformSidebar tab={tab} setTab={setTab} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-14 bg-card/80 backdrop-blur border-b border-border flex items-center gap-3 px-4">
            <SidebarTrigger />
            <h1 className="text-sm font-semibold text-foreground">{activeLabel}</h1>
            <div className="flex-1" />
            <UserMenu showAppLink />
            <HeaderClock />
          </header>
          <main className="flex-1 p-6 overflow-x-hidden">
            {tab === "dashboard" && <ConsoleDashboard />}
            {tab === "tenants" && <TenantsAdmin />}
            {tab === "plans" && <ConsolePlans />}
            {tab === "users" && <UsersAdmin />}
            {tab === "expenses" && <ConsoleExpenses />}
            {tab === "events" && <LicenseEventsAdmin />}
            {tab === "settings" && <ConsoleSettings />}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
