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
    PostgrestVersion: "14.1"
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
        }
        Relationships: []
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
          total_washes: number
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          loyalty_points?: number
          name: string
          phone?: string | null
          total_washes?: number
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          loyalty_points?: number
          name?: string
          phone?: string | null
          total_washes?: number
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          customer_id: string
          description: string | null
          id: string
          order_id: string | null
          points: number
          type: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          description?: string | null
          id?: string
          order_id?: string | null
          points: number
          type: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points?: number
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
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
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
          updated_at?: string
          vat_exempt?: boolean
        }
        Relationships: []
      }
      shift_templates: {
        Row: {
          color: string
          created_at: string
          end_time: string
          id: string
          name: string
          start_time: string
        }
        Insert: {
          color?: string
          created_at?: string
          end_time: string
          id?: string
          name: string
          start_time: string
        }
        Update: {
          color?: string
          created_at?: string
          end_time?: string
          id?: string
          name?: string
          start_time?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_face_enrollments: {
        Row: {
          created_at: string
          enrolled_by: string | null
          id: string
          image_url: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          enrolled_by?: string | null
          id?: string
          image_url: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          enrolled_by?: string | null
          id?: string
          image_url?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: []
      }
      staff_pins: {
        Row: {
          created_at: string
          id: string
          phone: string
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_order_number: { Args: never; Returns: string }
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
    },
  },
} as const
