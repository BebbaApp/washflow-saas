import { useState, useEffect } from "react";
import { AndroidUpdateDialog } from "@/components/AndroidUpdateDialog";
import {
  Droplets, Plus, Menu, X, LayoutDashboard, ListOrdered, Package, BarChart3,
  LogOut, Loader2, Gift, Users, History as HistoryIcon, Boxes, Receipt,
  Settings as SettingsIcon, Sun, Moon, ChevronDown, User as UserIcon, Fingerprint, AlertCircle,
} from "lucide-react";
import { ProfileDialog } from "@/components/ProfileDialog";
import type { StaffRole } from "@/hooks/useAuth";
import { DashboardOverview } from "@/components/DashboardOverview";
import { WashQueue } from "@/components/WashQueue";
import { ServicePackages } from "@/components/ServicePackages";
import { NewOrderDialog } from "@/components/NewOrderDialog";
import { ReportsDashboard } from "@/components/ReportsDashboard";
import { LoyaltyDashboard } from "@/components/LoyaltyDashboard";
import { SchedulingDashboard } from "@/components/SchedulingDashboard";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { ComingSoon } from "@/components/ComingSoon";
import { HistoryPage } from "@/components/HistoryPage";
import { InventoryPage } from "@/components/InventoryPage";
import { ExpensesPage } from "@/components/ExpensesPage";
import { AttendancePage } from "@/components/AttendancePage";
import { SettingsPage } from "@/components/SettingsPage";
import { CompleteWashDialog } from "@/components/CompleteWashDialog";
import { ReceiptPreviewDialog } from "@/components/ReceiptPreviewDialog";
import { useOrders } from "@/hooks/useOrders";
import { useInventory } from "@/hooks/useInventory";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useAppLogo } from "@/hooks/useAppLogo";
import { useAppVersion } from "@/hooks/useAppVersion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Login from "@/pages/Login";
import { usePermissions } from "@/hooks/usePermissions";
import { useTenant } from "@/hooks/useTenant";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { HeaderClock } from "@/components/HeaderClock";
import { SyncStatusPill } from "@/components/SyncStatusPill";
import { MobileBottomNav, type BottomNavItem } from "@/components/MobileBottomNav";

// Each nav item maps to the permission key that gates its visibility, plus a
// list of legacy roles that always retain access (washer/driver field staff
// and any role not configurable in the matrix).
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
  { id: "settings", label: "Settings", icon: SettingsIcon, permission: "settings.view" },
];

const getInitialTab = () => {
  const fallback = "dashboard";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl) return fromUrl;
    return localStorage.getItem("washflow:lastTab") || fallback;
  } catch {
    return fallback;
  }
};


const Index = () => {
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [addInventoryOpen, setAddInventoryOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [employeeExpenseOpen, setEmployeeExpenseOpen] = useState(false);
  const [pendingComplete, setPendingComplete] = useState<null | { id: string; service: string; orderNumber: string; customer: string; vehicle?: string }>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [printPreviewId, setPrintPreviewId] = useState<string | null>(null);
  const { orders, addOrder, updateStatus, updateNotes, approveDiscount, rejectDiscount } = useOrders();
  const { user, login, signup, logout, updateProfile, isAuthenticated, isAdmin, loading, authedEmail, authedNoRole } = useAuth();
  const { mode, toggleMode } = useTheme();
  const { processCompletedOrders } = useInventory();
  const { logo } = useAppLogo();
  const { can } = usePermissions();
  const { tenant, daysUntilTrialEnd, isSuperAdmin } = useTenant();
  const { version: appVersion, isOutdated } = useAppVersion();
  const workspaceName = tenant?.name || "Washflow Saas";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();


  // Auto-deduct inventory when orders are completed (idempotent fallback for
  // orders completed outside the confirmation flow, e.g. legacy/imported data).
  useEffect(() => {
    if (orders.length > 0) processCompletedOrders(orders);
  }, [orders, processCompletedOrders]);

  // Read active tab from URL query param first, then fall back to the last
  // tab the user was browsing (persisted in localStorage) so a refresh keeps
  // them on the same page.
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) {
      setActiveTab((current) => (current === tab ? current : tab));
    }
  }, [searchParams]);

  // Persist the active tab + reflect it in the URL so refresh / deep-link work.
  // IMPORTANT: use react-router's setSearchParams (not window.history.replaceState)
  // so nested components reading useSearchParams see the current `tab`. Otherwise
  // a child that copies searchParams to update its own sub-param (e.g. AttendancePage)
  // would clobber `tab` with the stale value react-router still holds.
  useEffect(() => {
    if (!activeTab) return;
    try { localStorage.setItem("washflow:lastTab", activeTab); } catch {}
    if (searchParams.get("tab") !== activeTab || (activeTab !== "attendance" && searchParams.has("sub"))) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      if (activeTab !== "attendance") next.delete("sub");
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, setSearchParams]);

  // Intercept the wash START transition to deduct inventory up front
  // (service recipe + vehicle-type usage). Completion is then a plain status change.
  const handleStatusUpdate = (id: string, status: import("@/hooks/useOrders").WashStatus) => {
    if (status === "in-progress") {
      const o = orders.find((x) => x.id === id);
      if (o && o.status === "waiting") {
        setPendingComplete({ id: o.id, service: o.service, orderNumber: o.orderNumber, customer: o.customer, vehicle: o.vehicle });
        return;
      }
    }
    return updateStatus(id, status);
  };

  const openFaceEnroll = () => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "attendance");
    next.set("sub", "enroll");
    setActiveTab("attendance");
    setSearchParams(next, { replace: false });
  };

  const navItems = allNavItems.filter((item) => {
    if (!user) return false;
    if (item.alwaysRoles?.includes(user.role)) return true;
    return can(item.permission);
  });

  // If the active tab is no longer permitted (e.g. permissions changed), fall
  // back to the first allowed nav item so we never render a hidden section.
  useEffect(() => {
    if (!user || navItems.length === 0) return;
    if (!navItems.some((n) => n.id === activeTab)) {
      setActiveTab(navItems[0].id);
    }
  }, [user, navItems, activeTab]);


  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (authedNoRole) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm glass-card p-6 text-center space-y-4">
          <h1 className="text-lg font-bold text-foreground">Account pending approval</h1>
          <p className="text-sm text-muted-foreground">
            Your email <strong className="text-foreground">{authedEmail}</strong> is verified, but no staff role has been assigned yet. Please ask an administrator to assign you a role in Settings → Workers.
          </p>
          <button
            onClick={logout}
            className="w-full py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={login} onSignup={signup} />;
  }

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
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const handleClick = () => {
            setActiveTab(item.id);
            onNavigate?.();
          };
          return (
            <button
              key={item.id}
              onClick={handleClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>


    </>
  );

  const headerFor: Record<string, { title: string; subtitle: string }> = {
    queue: { title: "Wash Queue", subtitle: "Manage current wash jobs" },
    services: { title: "Services", subtitle: "Manage your wash packages" },
    history: { title: "History", subtitle: "All completed and cancelled wash jobs" },
    loyalty: { title: "Loyalty Program", subtitle: "Reward frequent customers — free wash every 10 visits" },
    staff: { title: "Staff", subtitle: "Scheduling & performance tracking" },
    inventory: { title: "Inventory", subtitle: "Track supplies and stock levels" },
    reports: { title: "Reports", subtitle: "Revenue, throughput & wait time analytics" },
    expenses: { title: "Expenses", subtitle: "Track costs and calculate net profit" },
    attendance: { title: "Attendance", subtitle: "Clock in/out with face verification" },
  };

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-card border-r border-border p-4 h-full overflow-y-auto">
        {renderSidebarBody()}
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center overflow-hidden shrink-0">
            {logo ? (
              <img src={logo} alt="App logo" className="w-full h-full object-contain" />
            ) : (
              <Droplets className="w-4 h-4 text-primary-foreground" />
            )}
          </div>
          <span className="font-bold text-foreground truncate" title={workspaceName}>{workspaceName}</span>
          {tenant?.status === "trialing" && daysUntilTrialEnd !== null && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Trial · {Math.max(daysUntilTrialEnd, 0)}d
            </span>
          )}
          {tenant?.status === "past_due" && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
              Past due
            </span>
          )}
        </div>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-foreground shrink-0">
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-card pt-16 px-4 pb-4 flex flex-col">
          {renderSidebarBody(() => setMobileMenuOpen(false))}
          {can("queue.create") && (
            <button
              onClick={() => { setNewOrderOpen(true); setMobileMenuOpen(false); }}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold"
            >
              <Plus className="w-4 h-4" />
              New Order
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 lg:pt-0 pt-16 overflow-auto pb-44 md:pb-52 lg:pb-0">
        {/* Top Nav Bar */}
        <div className="hidden lg:flex sticky top-0 z-30 h-14 items-center justify-between gap-3 px-6 bg-card/80 backdrop-blur border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-foreground truncate" title={workspaceName}>{workspaceName}</span>
            {tenant?.status === "trialing" && daysUntilTrialEnd !== null && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                Trial · {Math.max(daysUntilTrialEnd, 0)}d left
              </span>
            )}
            {tenant?.status === "past_due" && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                Payment past due
              </span>
            )}
            <SyncStatusPill className="hidden sm:inline-flex" />
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Washflow Saas v{appVersion}
              {isOutdated && (
                <span className="inline-flex items-center px-1.5 py-0 rounded-full bg-primary/10 text-primary text-[10px]" title="An update is available">
                  update
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="text-left leading-tight">
                <p className="font-medium text-foreground">{user?.name || user?.email}</p>
                <p className="text-[11px] text-muted-foreground capitalize">{user?.role}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-card border-border">
              <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                <UserIcon className="w-4 h-4 mr-2" /> My profile
              </DropdownMenuItem>
              {can("settings.view") && (
                <DropdownMenuItem onClick={() => setActiveTab("settings")}>
                  <SettingsIcon className="w-4 h-4 mr-2" /> Settings
                </DropdownMenuItem>
              )}
              {isSuperAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/platform"><SettingsIcon className="w-4 h-4 mr-2" /> Platform console</Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={toggleMode}
            className="hidden md:inline-flex w-8 h-8 rounded-lg items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={mode === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {mode === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <HeaderClock />
          </div>
        </div>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {user && !user.phone && (
            <div className="mb-4 glass-card p-4 flex items-center gap-3 border-l-4 border-warning bg-warning/5">
              <AlertCircle className="w-5 h-5 text-warning shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Your profile is missing a phone number</p>
                <p className="text-xs text-muted-foreground">Add one so admins and teammates can reach you.</p>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Update details
              </button>
            </div>
          )}
          {activeTab === "dashboard" && (
            <DashboardOverview
              orders={orders}
              onUpdateStatus={handleStatusUpdate}
              onUpdateNotes={updateNotes}
              onViewAll={() => setActiveTab("queue")}
            />
          )}

          {activeTab !== "dashboard" && headerFor[activeTab] && (
            <header className="mb-8 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-3xl font-bold text-foreground tracking-tight">{headerFor[activeTab].title}</h2>
                <p className="text-muted-foreground text-sm mt-1">{headerFor[activeTab].subtitle}</p>
              </div>
              {(activeTab === "queue") && can("queue.create") && (
                <button
                  onClick={() => setNewOrderOpen(true)}
                  className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  New Job
                </button>
              )}
              {activeTab === "services" && can("services.create") && (
                <button
                  onClick={() => setAddServiceOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  Add Service
                </button>
              )}
              {activeTab === "inventory" && can("inventory.create") && (
                <button
                  onClick={() => setAddInventoryOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </button>
              )}
              {activeTab === "expenses" && can("expenses.create") && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setEmployeeExpenseOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border text-foreground font-medium text-sm hover:bg-muted transition-colors"
                  >
                    <Users className="w-4 h-4" />
                    Employee Expense
                  </button>
                  <button
                    onClick={() => setAddExpenseOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                    Add Expense
                  </button>
                </div>
              )}
            </header>
          )}

          {activeTab === "queue" && <WashQueue orders={orders} onUpdateStatus={handleStatusUpdate} onUpdateNotes={updateNotes} onApproveDiscount={approveDiscount} onRejectDiscount={rejectDiscount} />}
          {activeTab === "services" && <ServicePackages addOpen={addServiceOpen} onAddOpenChange={setAddServiceOpen} />}
          {activeTab === "history" && <HistoryPage orders={orders} />}
          {activeTab === "loyalty" && <LoyaltyDashboard />}
          {activeTab === "staff" && <SchedulingDashboard isAdmin={isAdmin} onOpenFaceEnroll={openFaceEnroll} />}
          {activeTab === "inventory" && (
            <InventoryPage addOpen={addInventoryOpen} onAddOpenChange={setAddInventoryOpen} />
          )}
          {activeTab === "reports" && <ReportsDashboard orders={orders} />}
          {activeTab === "expenses" && (
            <ExpensesPage
              orders={orders}
              addOpen={addExpenseOpen}
              onAddOpenChange={setAddExpenseOpen}
              employeeExpenseOpen={employeeExpenseOpen}
              onEmployeeExpenseOpenChange={setEmployeeExpenseOpen}
            />
          )}
          {activeTab === "attendance" && <AttendancePage />}
          {activeTab === "settings" && <SettingsPage />}
        </div>
      </main>

      {/* Mobile + Tablet bottom navigation (iOS-style with center FAB) */}
      {(() => {
        const desiredPrimary = ["queue", "history", "loyalty", "staff"];
        const primaryItems: BottomNavItem[] = desiredPrimary
          .map((id) => navItems.find((n) => n.id === id))
          .filter((n): n is typeof navItems[number] => !!n)
          .map((n) => ({ id: n.id, label: n.label, icon: n.icon }));
        const overflowItems: BottomNavItem[] = navItems
          .filter((n) => !desiredPrimary.includes(n.id))
          .map((n) => ({ id: n.id, label: n.label, icon: n.icon }));
        return (
          <MobileBottomNav
            primary={primaryItems}
            overflow={overflowItems}
            activeId={activeTab}
            onSelect={setActiveTab}
            onNewOrder={() => setNewOrderOpen(true)}
            showNewOrder={can("queue.create")}
            onLogout={logout}
          />
        );
      })()}

      <NewOrderDialog open={newOrderOpen} onOpenChange={setNewOrderOpen} onSubmit={addOrder} />

      <CompleteWashDialog
        order={pendingComplete}
        onCancel={() => setPendingComplete(null)}
        onConfirmed={async () => {
          if (!pendingComplete) return;
          const id = pendingComplete.id;
          const customer = pendingComplete.customer;
          setPendingComplete(null);
          await updateStatus(id, "in-progress");
          const { toast } = await import("sonner");
          toast.success(`Wash started for ${customer}`, {
            description: "Inventory deducted automatically.",
            duration: 4000,
          });
        }}
      />

      <ReceiptPreviewDialog
        order={printPreviewId ? orders.find((o) => o.id === printPreviewId) ?? null : null}
        open={!!printPreviewId}
        onOpenChange={(o) => { if (!o) setPrintPreviewId(null); }}
      />

      {user && (
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          initialName={user.name || ""}
          initialPhone={user.phone || ""}
          email={user.email}
          onSave={updateProfile}
          reason={user.phone ? "edit" : "missing_phone"}
        />
      )}
      <AndroidUpdateDialog />
    </div>
  );
};

export default Index;
