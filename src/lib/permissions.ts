export type Role = "admin" | "manager" | "supervisor" | "cashier" | "washer" | "driver";

export interface PermItem { key: string; label: string; }
export interface PermGroup { key: string; label: string; items: PermItem[]; }

export const CONFIGURABLE_ROLES: Role[] = ["admin", "manager", "supervisor", "cashier"];

export const PERMISSION_GROUPS: PermGroup[] = [
  {
    key: "general",
    label: "General",
    items: [
      { key: "dashboard.view", label: "Dashboard" },
      { key: "dashboard.revenue", label: "Dashboard: Revenue" },
      { key: "dashboard.inventory", label: "Dashboard: Inventory" },
      { key: "dashboard.expenses", label: "Dashboard: Expenses" },
      { key: "dashboard.kpis", label: "Dashboard: KPIs" },
      { key: "dashboard.activity", label: "Dashboard: Recent Activity" },
    ],
  },
  {
    key: "queue",
    label: "Wash Queue",
    items: [
      { key: "queue.view", label: "View Queue" },
      { key: "queue.create", label: "Create New Order" },
      { key: "queue.start", label: "Start Wash" },
      { key: "queue.complete", label: "Complete Wash" },
      { key: "queue.recordExtras", label: "Record Extra Products at Completion" },
      { key: "queue.cancel", label: "Cancel Order" },
      { key: "queue.editNotes", label: "Edit Order Notes" },
      { key: "queue.delete", label: "Delete Order" },
    ],
  },
  {
    key: "services",
    label: "Services",
    items: [
      { key: "services.view", label: "View Services" },
      { key: "services.create", label: "Add Service" },
      { key: "services.edit", label: "Edit Service" },
      { key: "services.delete", label: "Delete Service" },
      { key: "services.vat", label: "Manage VAT Settings" },
    ],
  },
  {
    key: "history",
    label: "History",
    items: [
      { key: "history.view", label: "View History" },
      { key: "history.filters", label: "Use Advanced Filters" },
      { key: "history.export", label: "Export History" },
    ],
  },
  {
    key: "loyalty",
    label: "Loyalty Program",
    items: [
      { key: "loyalty.view", label: "View Loyalty Dashboard" },
      { key: "loyalty.redeem", label: "Redeem Rewards" },
      { key: "loyalty.adjust", label: "Manually Adjust Points" },
      { key: "loyalty.sms", label: "Send Loyalty SMS" },
    ],
  },
  {
    key: "staff",
    label: "Staff & Scheduling",
    items: [
      { key: "staff.view", label: "View Staff Schedule" },
      { key: "staff.daylog", label: "View Day Log" },
      { key: "staff.employees", label: "View Employees" },
      { key: "staff.performance", label: "View Performance" },
      { key: "staff.timeOff.request", label: "Request Time Off" },
      { key: "staff.timeOff.approve", label: "Approve Time Off" },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    items: [
      { key: "inventory.view", label: "View Inventory" },
      { key: "inventory.create", label: "Add Item" },
      { key: "inventory.edit", label: "Edit Item" },
      { key: "inventory.delete", label: "Delete Item" },
      { key: "inventory.adjust", label: "Adjust Stock Levels" },
      { key: "inventory.usageGuide", label: "View Usage Guide & Calculator" },
      { key: "inventory.mapping", label: "Manage Auto-Deduct Mapping" },
      { key: "inventory.bundles", label: "Apply Bundle Presets" },
      { key: "inventory.recordWash", label: "Record Manual Wash Usage" },
      { key: "inventory.history", label: "View Transaction History" },
      { key: "inventory.exportUsage", label: "Export Wash Usage CSV" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    items: [
      { key: "reports.view", label: "View Reports" },
      { key: "reports.revenue", label: "Revenue Reports" },
      { key: "reports.attendance", label: "Attendance Summary" },
      { key: "reports.lateness", label: "Lateness & Hours Worked" },
      { key: "reports.vat", label: "VAT Audit Report" },
      { key: "reports.export", label: "Export Reports" },
    ],
  },
  {
    key: "expenses",
    label: "Expenses",
    items: [
      { key: "expenses.view", label: "View Expenses" },
      { key: "expenses.create", label: "Add Expense" },
      { key: "expenses.edit", label: "Edit Expense" },
      { key: "expenses.delete", label: "Delete Expense" },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    items: [
      { key: "attendance.view", label: "View Attendance" },
      { key: "attendance.clock", label: "Clock In / Out (self)" },
      { key: "attendance.viewAll", label: "View All Records" },
      { key: "attendance.enroll", label: "Enroll Staff Faces" },
      { key: "attendance.assisted", label: "Assisted Check-in/out (others)" },
      { key: "attendance.manualOverride", label: "Manual Override (with reason)" },
      { key: "attendance.audit", label: "View Attendance Audit Log" },
      { key: "attendance.export", label: "Export Attendance CSV" },
      { key: "attendance.recordDetails", label: "View Selfie & Match Details" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "settings.view", label: "View Settings" },
      { key: "settings.workers", label: "Manage Workers" },
      { key: "settings.workers.delete", label: "Delete Workers" },
      { key: "settings.workers.compensation", label: "Manage Staff Pay & Compensation" },
      { key: "settings.workers.pin", label: "Manage Staff PIN Login" },
      { key: "settings.appearance", label: "Manage Appearance" },
      { key: "settings.currency", label: "Manage Currency & VAT" },
      { key: "settings.receipt", label: "Manage Receipt Settings" },
      { key: "settings.printer", label: "Manage Printer Settings" },
      { key: "settings.billing", label: "Manage Billing & Subscription" },
      { key: "settings.workspace", label: "Manage Workspace Details" },
      { key: "settings.permissions", label: "Manage Role Permissions" },
    ],
  },

];

export type PermissionMatrix = Record<string, Record<Role, boolean>>;

export const PERMISSIONS_STORAGE_KEY = "aquawash:role-permissions:v1";

export function getDefaultMatrix(): PermissionMatrix {
  const m: PermissionMatrix = {};
  for (const g of PERMISSION_GROUPS) {
    for (const it of g.items) {
      m[it.key] = { admin: true, manager: true, supervisor: true, cashier: false, washer: false, driver: false };
    }
  }
  const allow = (role: Role, keys: string[]) =>
    keys.forEach((k) => { if (m[k]) m[k][role] = true; });
  const deny = (role: Role, keys: string[]) =>
    keys.forEach((k) => { if (m[k]) m[k][role] = false; });

  allow("cashier", [
    "dashboard.view", "dashboard.activity",
    "queue.view", "queue.create", "queue.start", "queue.complete",
    "services.view",
    "history.view",
    "loyalty.view", "loyalty.redeem",
    "staff.view", "staff.timeOff.request",
    "attendance.view", "attendance.clock",
  ]);

  allow("washer", [
    "dashboard.view", "queue.view", "queue.start", "queue.complete",
    "staff.view", "staff.timeOff.request",
    "attendance.view", "attendance.clock",
  ]);
  allow("driver", [
    "dashboard.view", "queue.view", "queue.start", "queue.complete",
    "staff.view", "staff.timeOff.request",
    "attendance.view", "attendance.clock",
  ]);

  deny("supervisor", [
    "services.delete", "inventory.delete", "expenses.delete",
    "staff.timeOff.approve",
    "settings.view", "settings.workers", "settings.workers.delete",
    "settings.workers.compensation", "settings.workers.pin",
    "settings.appearance", "settings.currency", "settings.permissions",
    "settings.receipt", "settings.printer", "settings.billing", "settings.workspace",
    "reports.export",
    "attendance.viewAll", "attendance.enroll",
    "attendance.manualOverride", "attendance.audit",
    "inventory.bundles", "inventory.mapping",
  ]);

  allow("supervisor", ["attendance.assisted"]);
  allow("manager", ["attendance.assisted"]);


  deny("manager", [
    "settings.workers.delete", "settings.workers.compensation",
    "settings.permissions", "settings.billing", "settings.workspace",
    "queue.delete",
    "attendance.enroll", "attendance.manualOverride",
  ]);

  allow("cashier", ["queue.recordExtras"]);

  return m;
}

export function loadMatrix(tenantId?: string | null): PermissionMatrix {
  const defaults = getDefaultMatrix();
  const keys = tenantId
    ? [tenantCacheKey(tenantId), PERMISSIONS_STORAGE_KEY]
    : [PERMISSIONS_STORAGE_KEY];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PermissionMatrix;
      const merged: PermissionMatrix = { ...defaults };
      for (const k of Object.keys(parsed)) {
        merged[k] = {
          ...defaults[k],
          ...parsed[k],
          washer: defaults[k]?.washer ?? false,
          driver: defaults[k]?.driver ?? false,
        };
      }
      return merged;
    } catch { /* ignore */ }
  }
  return defaults;
}

export function tenantCacheKey(tenantId: string) {
  return `${PERMISSIONS_STORAGE_KEY}:${tenantId}`;
}

export function cacheMatrix(tenantId: string | null | undefined, matrix: PermissionMatrix) {
  try {
    const key = tenantId ? tenantCacheKey(tenantId) : PERMISSIONS_STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(matrix));
  } catch { /* ignore */ }
}


export function checkPermission(
  matrix: PermissionMatrix,
  role: Role | null | undefined,
  key: string,
  planFeatures?: Record<string, boolean> | null,
  isSuperAdmin?: boolean,
): boolean {
  if (!role) return false;
  // Super admins bypass plan gating entirely. Platform admins do NOT — they
  // are subject to the plan of whichever tenant they are currently viewing.
  if (
    planFeatures &&
    Object.keys(planFeatures).length > 0 &&
    !isSuperAdmin &&
    planFeatures[key] !== true
  ) {
    return false;
  }
  if (role === "admin") return true;
  return !!matrix[key]?.[role];
}
