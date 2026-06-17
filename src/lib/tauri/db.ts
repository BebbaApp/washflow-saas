/**
 * Washflow Tauri Database Bridge
 * 
 * Detects whether the app is running inside Tauri (desktop)
 * and routes all database calls to the local SQLite via Tauri invoke(),
 * or falls back to Supabase for web/browser use.
 * 
 * This means ONE codebase works for:
 *   - Tauri desktop app → SQLite (local, offline-first)
 *   - Browser / Lovable preview → Supabase (online)
 */

import { supabase } from '@/integrations/supabase/client';

// Check if running inside Tauri
export const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// Lazily import Tauri invoke only when in Tauri context
let tauriInvoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function getInvoke() {
  if (tauriInvoke) return tauriInvoke;
  if (!isTauri) return null;
  const tauri = await import('@tauri-apps/api/core');
  tauriInvoke = tauri.invoke;
  return tauriInvoke;
}

/**
 * Core invoke wrapper — calls Tauri command or throws if not in Tauri
 */
export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  const fn_ = await getInvoke();
  if (!fn_) throw new Error('Not running in Tauri');
  return fn_(command, args) as Promise<T>;
}

// ─── Type definitions ─────────────────────────────────────────────────────────

export interface DbOrder {
  id: string;
  tenant_id: string;
  order_number: string;
  customer: string;
  customer_id?: string;
  customer_phone?: string;
  vehicle: string;
  plate: string;
  service: string;
  service_price: number;
  status: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  wait_minutes?: number;
  _dirty?: number;
  _deleted?: number;
}

export interface DbCustomer {
  id: string;
  tenant_id: string;
  name: string;
  phone?: string;
  email?: string;
  loyalty_points: number;
  total_washes: number;
  created_at: string;
}

export interface DbService {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  duration: string;
  features: string; // JSON string in SQLite
  popular: number;
  vat_exempt: number;
  sort_order: number;
}

export interface DbExpense {
  id: string;
  tenant_id: string;
  description: string;
  amount: number;
  category: string;
  subcategory?: string;
  vendor?: string;
  notes?: string;
  date: string;
  created_at: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

export interface DbInfo {
  tables: string[];
  record_counts: Record<string, number>;
}

// ─── Database API ─────────────────────────────────────────────────────────────

export const db = {

  // ── Orders ──────────────────────────────────────────────────────────────────

  async getOrders(tenantId: string): Promise<DbOrder[]> {
    if (isTauri) {
      return invoke<DbOrder[]>('get_orders', { tenant_id: tenantId });
    }
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbOrder[];
  },

  async createOrder(params: {
    tenantId: string;
    customer: string;
    customerPhone?: string;
    customerId?: string;
    vehicle: string;
    plate: string;
    service: string;
    servicePrice: number;
    createdBy?: string;
  }): Promise<DbOrder> {
    if (isTauri) {
      return invoke<DbOrder>('create_order', {
        tenant_id: params.tenantId,
        customer: params.customer,
        customer_phone: params.customerPhone ?? null,
        customer_id: params.customerId ?? null,
        vehicle: params.vehicle,
        plate: params.plate,
        service: params.service,
        service_price: params.servicePrice,
        created_by: params.createdBy ?? null,
      });
    }
    const { data: orderNum } = await supabase.rpc('next_order_number');
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_number: orderNum || `W-${Date.now()}`,
        tenant_id: params.tenantId,
        customer: params.customer,
        customer_phone: params.customerPhone,
        customer_id: params.customerId,
        vehicle: params.vehicle,
        plate: params.plate,
        service: params.service,
        service_price: params.servicePrice,
        status: 'waiting',
      })
      .select()
      .single();
    if (error) throw error;
    return data as DbOrder;
  },

  async updateOrderStatus(id: string, status: string, tenantId: string): Promise<void> {
    if (isTauri) {
      return invoke<void>('update_order_status', { id, status, tenant_id: tenantId });
    }
    const updates: Record<string, unknown> = { status };
    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }
    const { error } = await supabase.from('orders').update(updates).eq('id', id);
    if (error) throw error;
  },

  // ── Customers ────────────────────────────────────────────────────────────────

  async getCustomers(tenantId: string): Promise<DbCustomer[]> {
    if (isTauri) {
      return invoke<DbCustomer[]>('get_customers', { tenant_id: tenantId });
    }
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name');
    if (error) throw error;
    return (data ?? []) as DbCustomer[];
  },

  async upsertCustomer(params: {
    tenantId: string;
    id?: string;
    name: string;
    phone?: string;
    email?: string;
  }): Promise<DbCustomer> {
    if (isTauri) {
      return invoke<DbCustomer>('upsert_customer', {
        tenant_id: params.tenantId,
        id: params.id ?? null,
        name: params.name,
        phone: params.phone ?? null,
        email: params.email ?? null,
      });
    }
    const { data, error } = await supabase
      .from('customers')
      .upsert({ id: params.id, tenant_id: params.tenantId, name: params.name, phone: params.phone, email: params.email })
      .select()
      .single();
    if (error) throw error;
    return data as DbCustomer;
  },

  // ── Services ─────────────────────────────────────────────────────────────────

  async getServices(tenantId: string): Promise<DbService[]> {
    if (isTauri) {
      return invoke<DbService[]>('get_services', { tenant_id: tenantId });
    }
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order');
    if (error) throw error;
    return (data ?? []) as DbService[];
  },

  async upsertService(tenantId: string, service: Record<string, unknown>): Promise<DbService> {
    if (isTauri) {
      return invoke<DbService>('upsert_service', { tenant_id: tenantId, service });
    }
    const { data, error } = await supabase
      .from('services')
      .upsert({ ...service, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data as DbService;
  },

  // ── Expenses ─────────────────────────────────────────────────────────────────

  async getExpenses(tenantId: string): Promise<DbExpense[]> {
    if (isTauri) {
      return invoke<DbExpense[]>('get_expenses', { tenant_id: tenantId });
    }
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbExpense[];
  },

  async createExpense(tenantId: string, expense: Record<string, unknown>): Promise<DbExpense> {
    if (isTauri) {
      return invoke<DbExpense>('create_expense', { tenant_id: tenantId, expense });
    }
    const { data, error } = await supabase
      .from('expenses')
      .insert({ ...expense, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data as DbExpense;
  },

  // ── Generic query (power users / reports) ────────────────────────────────────

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (isTauri) {
      return invoke<T[]>('db_query', { sql, params });
    }
    throw new Error('Raw SQL query only available in Tauri desktop app');
  },

  // ── Sync ─────────────────────────────────────────────────────────────────────

  async triggerSync(supabaseUrl: string, supabaseKey: string): Promise<SyncResult> {
    if (!isTauri) return { synced: 0, failed: 0, remaining: 0 };
    return invoke<SyncResult>('trigger_sync', {
      supabase_url: supabaseUrl,
      supabase_key: supabaseKey,
    });
  },

  async getPendingSyncCount(): Promise<number> {
    if (!isTauri) return 0;
    return invoke<number>('get_pending_sync_count');
  },

  async bulkUpsert(table: string, records: Record<string, unknown>[]): Promise<number> {
    if (!isTauri) return 0;
    return invoke<number>('bulk_upsert', { table, records });
  },

  // ── Meta ─────────────────────────────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    if (!isTauri) return null;
    return invoke<string | null>('get_meta', { key });
  },

  async setMeta(key: string, value: string): Promise<void> {
    if (!isTauri) return;
    return invoke<void>('set_meta', { key, value });
  },

  async getDbInfo(): Promise<DbInfo | null> {
    if (!isTauri) return null;
    return invoke<DbInfo>('get_db_info');
  },
};
