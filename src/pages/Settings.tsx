import { useState, useEffect } from "react";
import {
  Droplets, Menu, X, LayoutDashboard, ListOrdered, Package, BarChart3,
  LogOut, Loader2, Gift, Users, History as HistoryIcon, Boxes, Receipt,
  Settings as SettingsIcon, Sun, Moon, ChevronDown, User as UserIcon, Fingerprint,
  ArrowLeft,
} from "lucide-react";
import type { StaffRole } from "@/hooks/useAuth";
import { SettingsPage } from "@/components/SettingsPage";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useAppLogo } from "@/hooks/useAppLogo";
import { usePermissions } from "@/hooks/usePermissions";
import { useTenant } from "@/hooks/useTenant";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { Link, useNavigate } from "react-router-dom";

const allNavItems: { id: string; label: string; icon: typeof LayoutDashboard; permission: string; alwaysRoles?: StaffRole[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view", alwaysRoles: ["washer", "driver"] },
  { id: "queue", label: "Queue", icon: ListOrdered, permission: "queue.view", alwaysRoles: ["washer", "driver"] },
  { id: "services", label: "Services", icon: Package, permission: "services.view" },
  { id: "history", label: "History", icon: HistoryIcon, permission: "history.view" },
  { id: "loyalty", label: "Loyalty", icon: Gift, permission: "loyalty.view" },
  { id: "staff", label: "Staff", icon: Users, permission: "staff.view", alwaysRoles: ["washer", "driver"] },
  { id: "inventory", label: "Inventory", icon: Boxes, permission: "inventory.view" },
  { id: "reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
  { id: "expenses", label: "Expenses", icon: Receipt, permission: "expenses.view" },
  { id: "attendance", label: "Attendance", icon: Fingerprint, permission: "attendance.view", alwaysRoles: ["washer", "driver", "cashier"] },
];

export default function Settings() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout, isAuthenticated, isAdmin, loading, authedEmail, authedNoRole } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { logo } = useAppLogo();
  const { can } = usePermissions();
  const { tenant, daysUntilTrialEnd } = useTenant();
  const { isPlatformAdmin } = usePlatformAdmin();
  const workspaceName = tenant?.name || "AquaWash";
  const navigate = useNavigate();

  const navItems = allNavItems.filter((item) => {
    if (!user) return false;
    if (item.alwaysRoles?.includes(user.role)) return true;
    return can(item.permission);
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/", { replace: true });
  }, [loading, isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const renderSidebarBody = (onNavigate?: () => void) => (
    <>
      <div className="flex items-center gap-3 px-2 py-2 mb-4">
        <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shadow-sm overflow-hidden">
          {logo ? (
            <img src={logo} alt="App logo" className="w-full h-full object-contain" />
          ) : (
            <Droplets className="w-5 h-5 text-primary-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-foreground leading-tight truncate" title={workspaceName}>{workspaceName}</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {tenant?.status === "trialing" && daysUntilTrialEnd !== null
              ? `Trial · ${Math.max(daysUntilTrialEnd, 0)}d left`
              : "Management"}
          </p>
        </div>
      </div>
      <div className="px-2 mb-4">
        <TenantSwitcher compact />
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {navItems.map((item) => (
          <Link
            key={item.id}
            to={`/?tab=${item.id}`}
            onClick={() => onNavigate?.()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </Link>
        ))}

        {/* Settings — active */}
        {can("settings.view") && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground shadow-sm">
            <SettingsIcon className="w-4 h-4" />
            Settings
          </div>
        )}
      </nav>

      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <div className="flex items-center justify-between px-2">
          <p className="text-xs text-muted-foreground">AquaWash v1.0</p>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMode}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title={mode === "dark" ? "Switch to light" : "Switch to dark"}
            >
              {mode === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => { logout(); onNavigate?.(); }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-card border-r border-border p-4">
        {renderSidebarBody()}
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center overflow-hidden shrink-0">
            {logo ? (
              <img src={logo} alt="App logo" className="w-full h-full object-contain" />
            ) : (
              <Droplets className="w-4 h-4 text-primary-foreground" />
            )}
          </div>
          <span className="font-bold text-foreground truncate" title={workspaceName}>{workspaceName}</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50 md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-[70] w-72 bg-card border-r border-border p-4 flex flex-col md:hidden">
            {renderSidebarBody(() => setMobileMenuOpen(false))}
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-4 md:p-8 pt-16 md:pt-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate("/")}
              className="w-9 h-9 rounded-lg bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity flex items-center justify-center shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-foreground">Settings</h2>
              <p className="text-muted-foreground text-sm mt-0.5">Manage workers, appearance, and services</p>
            </div>
          </div>
          <SettingsPage />
        </div>
      </main>
    </div>
  );
}
