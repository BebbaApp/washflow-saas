export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance_audit_log: {
        Row: {
          acted_by: string
          action: string
          attendance_id: string | null
          created_at: string
          id: string
          original_score: number | null
          original_status: string | null
          reason: string
          target_user_id: string
          tenant_id: string
        }
        Insert: {
          acted_by: string
          action: string
          attendance_id?: string | null
          created_at?: string
          id?: string
          original_score?: number | null
          original_status?: string | null
          reason: string
          target_user_id: string
          tenant_id?: string
        }
        Update: {
          acted_by?: string
          action?: string
          attendance_id?: string | null
          created_at?: string
          id?: string
          original_score?: number | null
          original_status?: string | null
          reason?: string
          target_user_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          created_at: string
          id: string
          kind: string
          match_score: number | null
          notes: string | null
          selfie_url: string | null
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          match_score?: number | null
          notes?: string | null
          selfie_url?: string | null
          status?: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          match_score?: number | null
          notes?: string | null
          selfie_url?: string | null
          status?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_events: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip: string | null
          kind: string
          tenant_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string | null
          kind: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string | null
          kind?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          loyalty_points: number
          name: string
          phone: string | null
          tenant_id: string
          total_washes: number
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          loyalty_points?: number
          name: string
          phone?: string | null
          tenant_id?: string
          total_washes?: number
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          loyalty_points?: number
          name?: string
          phone?: string | null
          tenant_id?: string
          total_washes?: number
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          date: string
          description: string
          id: string
          notes: string | null
          subcategory: string | null
          tenant_id: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          date?: string
          description: string
          id?: string
          notes?: string | null
          subcategory?: string | null
          tenant_id?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          date?: string
          description?: string
          id?: string
          notes?: string | null
          subcategory?: string | null
          tenant_id?: string
          vendor?: string | null
        }
        Relationships: []
      }
      inventory_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_category_defaults: {
        Row: {
          category: string
          created_at: string
          expense_category: string
          id: string
          tenant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          expense_category: string
          id?: string
          tenant_id?: string
        }
        Update: {
          category?: string
          created_at?: string
          expense_category?: string
          id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          category: string
          created_at: string
          expense_category: string | null
          id: string
          name: string
          pack_size: number | null
          preset_id: string | null
          quantity: number
          recommended_max: number | null
          recommended_min: number | null
          subtype: string | null
          supplier_id: string | null
          tenant_id: string
          threshold: number
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          expense_category?: string | null
          id?: string
          name: string
          pack_size?: number | null
          preset_id?: string | null
          quantity?: number
          recommended_max?: number | null
          recommended_min?: number | null
          subtype?: string | null
          supplier_id?: string | null
          tenant_id?: string
          threshold?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          expense_category?: string | null
          id?: string
          name?: string
          pack_size?: number | null
          preset_id?: string | null
          quantity?: number
          recommended_max?: number | null
          recommended_min?: number | null
          subtype?: string | null
          supplier_id?: string | null
          tenant_id?: string
          threshold?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          balance: number
          created_at: string
          delta: number
          expense_id: string | null
          flow: string | null
          id: string
          item_id: string | null
          item_name: string
          notes: string | null
          source: string
          tenant_id: string
          total_cost: number | null
          type: string
          unit_cost: number | null
        }
        Insert: {
          balance: number
          created_at?: string
          delta: number
          expense_id?: string | null
          flow?: string | null
          id?: string
          item_id?: string | null
          item_name: string
          notes?: string | null
          source: string
          tenant_id?: string
          total_cost?: number | null
          type: string
          unit_cost?: number | null
        }
        Update: {
          balance?: number
          created_at?: string
          delta?: number
          expense_id?: string | null
          flow?: string | null
          id?: string
          item_id?: string | null
          item_name?: string
          notes?: string | null
          source?: string
          tenant_id?: string
          total_cost?: number | null
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_vehicle_map: {
        Row: {
          created_at: string
          id: string
          item_id: string
          key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          key: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          due_date: string | null
          hosted_url: string | null
          id: string
          paid_at: string | null
          status: string
          stripe_invoice_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_url?: string | null
          id?: string
          paid_at?: string | null
          status: string
          stripe_invoice_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          hosted_url?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      license_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "license_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          customer_id: string
          description: string | null
          id: string
          order_id: string | null
          points: number
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          description?: string | null
          id?: string
          order_id?: string | null
          points: number
          tenant_id?: string
          type: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points?: number
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          from_role: Database["public"]["Enums"]["tenant_role"] | null
          id: string
          payload: Json
          target_email: string | null
          target_user_id: string | null
          tenant_id: string
          to_role: Database["public"]["Enums"]["tenant_role"] | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_role?: Database["public"]["Enums"]["tenant_role"] | null
          id?: string
          payload?: Json
          target_email?: string | null
          target_user_id?: string | null
          tenant_id: string
          to_role?: Database["public"]["Enums"]["tenant_role"] | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          from_role?: Database["public"]["Enums"]["tenant_role"] | null
          id?: string
          payload?: Json
          target_email?: string | null
          target_user_id?: string | null
          tenant_id?: string
          to_role?: Database["public"]["Enums"]["tenant_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer: string
          customer_id: string | null
          customer_phone: string | null
          id: string
          notes: string | null
          order_number: string
          plate: string
          service: string
          service_price: number
          status: string
          tenant_id: string
          updated_at: string
          vehicle: string
          wait_minutes: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer: string
          customer_id?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          order_number: string
          plate: string
          service: string
          service_price?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle: string
          wait_minutes?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          customer_id?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          plate?: string
          service?: string
          service_price?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          vehicle?: string
          wait_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          features: Json
          id: string
          max_users: number | null
          name: string
          price_monthly_cents: number
          stripe_price_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          features?: Json
          id?: string
          max_users?: number | null
          name: string
          price_monthly_cents?: number
          stripe_price_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          features?: Json
          id?: string
          max_users?: number | null
          name?: string
          price_monthly_cents?: number
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          address: string
          company_name: string
          contact_email: string
          contact_phone: string
          currency: string
          id: boolean
          updated_at: string
          updated_by: string | null
          vat_rate: number
        }
        Insert: {
          address?: string
          company_name?: string
          contact_email?: string
          contact_phone?: string
          currency?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          vat_rate?: number
        }
        Update: {
          address?: string
          company_name?: string
          contact_email?: string
          contact_phone?: string
          currency?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          vat_rate?: number
        }
        Relationships: []
      }
      processed_stripe_events: {
        Row: {
          event_type: string
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      product_types: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          name: string
          recommended_max: number
          recommended_min: number
          sort_order: number
          unit: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          recommended_max?: number
          recommended_min?: number
          sort_order?: number
          unit: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          recommended_max?: number
          recommended_min?: number
          sort_order?: number
          unit?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string
          theme_id: string | null
          theme_mode: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          theme_id?: string | null
          theme_mode?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          theme_id?: string | null
          theme_mode?: string | null
          user_id?: string
        }
        Relationships: []
      }
      receipt_settings: {
        Row: {
          business_line2: string
          business_name: string
          footer: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_line2?: string
          business_name?: string
          footer?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_line2?: string
          business_name?: string
          footer?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          matrix: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          matrix?: Json
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          matrix?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          duration: string
          features: string[]
          id: string
          name: string
          popular: boolean
          price: number
          sort_order: number
          tenant_id: string
          updated_at: string
          vat_exempt: boolean
        }
        Insert: {
          created_at?: string
          duration?: string
          features?: string[]
          id?: string
          name: string
          popular?: boolean
          price?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          vat_exempt?: boolean
        }
        Update: {
          created_at?: string
          duration?: string
          features?: string[]
          id?: string
          name?: string
          popular?: boolean
          price?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          vat_exempt?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          color: string
          created_at: string
          end_time: string
          id: string
          name: string
          start_time: string
          tenant_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          end_time: string
          id?: string
          name: string
          start_time: string
          tenant_id?: string
        }
        Update: {
          color?: string
          created_at?: string
          end_time?: string
          id?: string
          name?: string
          start_time?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          end_time: string
          id: string
          notes: string | null
          shift_date: string
          staff_user_id: string
          start_time: string
          template_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          notes?: string | null
          shift_date: string
          staff_user_id: string
          start_time: string
          template_id?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          notes?: string | null
          shift_date?: string
          staff_user_id?: string
          start_time?: string
          template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_active_status: {
        Row: {
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_compensation: {
        Row: {
          base_rate: number
          busy_day_rate: number
          id: string
          pay_type: string
          quiet_day_rate: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          base_rate?: number
          busy_day_rate?: number
          id?: string
          pay_type?: string
          quiet_day_rate?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          base_rate?: number
          busy_day_rate?: number
          id?: string
          pay_type?: string
          quiet_day_rate?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_face_enrollments: {
        Row: {
          created_at: string
          enrolled_by: string | null
          id: string
          image_url: string
          is_active: boolean
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enrolled_by?: string | null
          id?: string
          image_url: string
          is_active?: boolean
          tenant_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enrolled_by?: string | null
          id?: string
          image_url?: string
          is_active?: boolean
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_face_enrollments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_face_enrollments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_pins: {
        Row: {
          created_at: string
          id: string
          phone: string
          pin_hash: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          pin_hash: string
          tenant_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          pin_hash?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_pins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_pins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at: string | null
          created_at: string
          current_period_end: string | null
          id: string
          plan_id: string | null
          status: string
          stripe_sub_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status: string
          stripe_sub_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan_id?: string | null
          status?: string
          stripe_sub_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          tenant_id: string
          tenant_role: Database["public"]["Enums"]["tenant_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          tenant_id: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          tenant_id?: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          tenant_id: string
          tenant_role: Database["public"]["Enums"]["tenant_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          tenant_id: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          tenant_id?: string
          tenant_role?: Database["public"]["Enums"]["tenant_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          created_at: string
          currency_code: string | null
          currency_symbol: string | null
          logo_data_url: string | null
          tenant_id: string
          updated_at: string
          vat_enabled: boolean | null
          vat_percent: number | null
        }
        Insert: {
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          logo_data_url?: string | null
          tenant_id: string
          updated_at?: string
          vat_enabled?: boolean | null
          vat_percent?: number | null
        }
        Update: {
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          logo_data_url?: string | null
          tenant_id?: string
          updated_at?: string
          vat_enabled?: boolean | null
          vat_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          current_period_end: string | null
          grace_period_ends_at: string | null
          id: string
          name: string
          plan_id: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id: string | null
          trial_ends_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name: string
          plan_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id?: string | null
          trial_ends_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          grace_period_ends_at?: string | null
          id?: string
          name?: string
          plan_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          stripe_customer_id?: string | null
          trial_ends_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          created_at: string
          end_date: string
          id: string
          reason: string | null
          reviewed_by: string | null
          staff_user_id: string
          start_date: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          reason?: string | null
          reviewed_by?: string | null
          staff_user_id: string
          start_date: string
          status?: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          reason?: string | null
          reviewed_by?: string | null
          staff_user_id?: string
          start_date?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "platform_tenants_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      platform_tenants_overview: {
        Row: {
          active_sub_count: number | null
          created_at: string | null
          current_period_end: string | null
          grace_period_ends_at: string | null
          id: string | null
          member_count: number | null
          name: string | null
          plan_code: string | null
          plan_id: string | null
          plan_name: string | null
          price_monthly_cents: number | null
          slug: string | null
          status: Database["public"]["Enums"]["tenant_status"] | null
          stripe_customer_id: string | null
          trial_ends_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_membership: {
        Args: { _tenant: string; _user: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: { _uid: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant: string }; Returns: boolean }
      next_order_number: { Args: never; Returns: string }
      tenant_has_role: {
        Args: {
          _role: Database["public"]["Enums"]["tenant_role"]
          _tenant: string
        }
        Returns: boolean
      }
      tenant_license_active: { Args: { _tenant: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "operator"
        | "supervisor"
        | "washer"
        | "driver"
        | "manager"
        | "cashier"
      tenant_role: "owner" | "admin" | "member"
      tenant_status:
        | "trialing"
        | "active"
        | "past_due"
        | "suspended"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "operator",
        "supervisor",
        "washer",
        "driver",
        "manager",
        "cashier",
      ],
      tenant_role: ["owner", "admin", "member"],
      tenant_status: [
        "trialing",
        "active",
        "past_due",
        "suspended",
        "cancelled",
      ],
    },
  },
} as const
