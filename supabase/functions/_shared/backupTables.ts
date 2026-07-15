// Shared list of tenant-scoped tables used by backup / restore / export.
// Order matters for restore:
//   RESTORE_DELETE_ORDER = child tables first (safe to delete)
//   RESTORE_INSERT_ORDER = parent tables first (safe to insert)
// Any table not FK-referenced by another in the list can appear anywhere.

export const BACKUP_TABLES = [
  "tenant_settings",
  "receipt_settings",
  "role_permissions",
  "user_roles",
  "tenant_members",
  "customers",
  "suppliers",
  "product_types",
  "inventory_categories",
  "inventory_items",
  "services",
  "orders",
  "expenses",
  "expense_categories",
  "inventory_transactions",
  "loyalty_transactions",
  "shifts",
  "shift_templates",
  "time_off_requests",
  "staff_pins",
  "staff_face_enrollments",
  "staff_compensation",
  "staff_active_status",
  "attendance_records",
] as const;

// Delete child rows first to avoid FK violations.
export const RESTORE_DELETE_ORDER = [
  "attendance_records",
  "staff_active_status",
  "staff_compensation",
  "staff_face_enrollments",
  "staff_pins",
  "time_off_requests",
  "shifts",
  "shift_templates",
  "loyalty_transactions",
  "inventory_transactions",
  "expenses",
  "expense_categories",
  "orders",
  "services",
  "inventory_items",
  "inventory_categories",
  "product_types",
  "suppliers",
  "customers",
  "receipt_settings",
  "tenant_settings",
  "role_permissions",
  // user_roles and tenant_members are intentionally NOT deleted — keeps user access.
] as const;

export const RESTORE_INSERT_ORDER = [
  "tenant_settings",
  "receipt_settings",
  "role_permissions",
  "customers",
  "suppliers",
  "product_types",
  "inventory_categories",
  "inventory_items",
  "services",
  "orders",
  "expense_categories",
  "expenses",
  "inventory_transactions",
  "loyalty_transactions",
  "shift_templates",
  "shifts",
  "time_off_requests",
  "staff_pins",
  "staff_face_enrollments",
  "staff_compensation",
  "staff_active_status",
  "attendance_records",
] as const;

// Inline-snapshot cap; larger payloads spill to Supabase Storage.
export const INLINE_SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

// Retention: keep newest N nightlies; keep newest of each month; keep all manual/pre_restore.
export const NIGHTLY_RETAIN = 14;
export const MONTHLY_RETAIN = 12;
