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
      aircraft_types: {
        Row: {
          burn_kg_per_min: number
          code: string
          created_at: string
          name: string
          updated_at: string
        }
        Insert: {
          burn_kg_per_min: number
          code: string
          created_at?: string
          name: string
          updated_at?: string
        }
        Update: {
          burn_kg_per_min?: number
          code?: string
          created_at?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      airlines: {
        Row: {
          code: string
          created_at: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          name?: string
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          author: string | null
          author_label: string
          author_role: string
          created_at: string
          id: string
          severity: string
          text: string
        }
        Insert: {
          author?: string | null
          author_label: string
          author_role: string
          created_at?: string
          id?: string
          severity?: string
          text: string
        }
        Update: {
          author?: string | null
          author_label?: string
          author_role?: string
          created_at?: string
          id?: string
          severity?: string
          text?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          author: string | null
          author_label: string
          author_role: string
          created_at: string
          edited_at: string | null
          id: string
          text: string
          upr_id: string
        }
        Insert: {
          author?: string | null
          author_label: string
          author_role: string
          created_at?: string
          edited_at?: string | null
          id?: string
          text: string
          upr_id: string
        }
        Update: {
          author?: string | null
          author_label?: string
          author_role?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          text?: string
          upr_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_upr_id_fkey"
            columns: ["upr_id"]
            isOneToOne: false
            referencedRelation: "uprs"
            referencedColumns: ["id"]
          },
        ]
      }
      firs: {
        Row: {
          code: string
          created_at: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          name?: string
        }
        Relationships: []
      }
      flight_reports: {
        Row: {
          author: string | null
          author_label: string
          base_route: string
          block_off: string | null
          block_on: string | null
          cost_savings_usd: number
          created_at: string
          flight_date: string | null
          id: string
          image_paths: string[]
          incident_description: string
          incident_rating: number | null
          incident_severity: string
          landing: string | null
          notes: string
          party: string
          party_scope: string
          projected_co2_kg: number
          projected_fuel_kg: number
          projected_time_min: number
          realised_co2_kg: number
          realised_fuel_kg: number
          realised_time_min: number
          takeoff: string | null
          trial_stage: string
          upr_id: string
          upr_route: string
        }
        Insert: {
          author?: string | null
          author_label: string
          base_route?: string
          block_off?: string | null
          block_on?: string | null
          cost_savings_usd?: number
          created_at?: string
          flight_date?: string | null
          id?: string
          image_paths?: string[]
          incident_description?: string
          incident_rating?: number | null
          incident_severity?: string
          landing?: string | null
          notes?: string
          party: string
          party_scope?: string
          projected_co2_kg?: number
          projected_fuel_kg?: number
          projected_time_min?: number
          realised_co2_kg?: number
          realised_fuel_kg?: number
          realised_time_min?: number
          takeoff?: string | null
          trial_stage?: string
          upr_id: string
          upr_route?: string
        }
        Update: {
          author?: string | null
          author_label?: string
          base_route?: string
          block_off?: string | null
          block_on?: string | null
          cost_savings_usd?: number
          created_at?: string
          flight_date?: string | null
          id?: string
          image_paths?: string[]
          incident_description?: string
          incident_rating?: number | null
          incident_severity?: string
          landing?: string | null
          notes?: string
          party?: string
          party_scope?: string
          projected_co2_kg?: number
          projected_fuel_kg?: number
          projected_time_min?: number
          realised_co2_kg?: number
          realised_fuel_kg?: number
          realised_time_min?: number
          takeoff?: string | null
          trial_stage?: string
          upr_id?: string
          upr_route?: string
        }
        Relationships: [
          {
            foreignKeyName: "flight_reports_upr_id_fkey"
            columns: ["upr_id"]
            isOneToOne: false
            referencedRelation: "uprs"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          author: string
          author_label: string
          created_at: string
          description: string
          id: string
          image_paths: string[]
          party: string
          party_scope: string
          rating: number | null
          severity: string
          upr_id: string
        }
        Insert: {
          author: string
          author_label: string
          created_at?: string
          description: string
          id?: string
          image_paths?: string[]
          party: string
          party_scope: string
          rating?: number | null
          severity: string
          upr_id: string
        }
        Update: {
          author?: string
          author_label?: string
          created_at?: string
          description?: string
          id?: string
          image_paths?: string[]
          party?: string
          party_scope?: string
          rating?: number | null
          severity?: string
          upr_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_upr_id_fkey"
            columns: ["upr_id"]
            isOneToOne: false
            referencedRelation: "uprs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          rejected: boolean
          rejected_at: string | null
          rejected_reason: string | null
          requested_role: Database["public"]["Enums"]["app_role"] | null
          requested_scope: string | null
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email: string
          full_name: string
          id: string
          rejected?: boolean
          rejected_at?: string | null
          rejected_reason?: string | null
          requested_role?: Database["public"]["Enums"]["app_role"] | null
          requested_scope?: string | null
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          rejected?: boolean
          rejected_at?: string | null
          rejected_reason?: string | null
          requested_role?: Database["public"]["Enums"]["app_role"] | null
          requested_scope?: string | null
        }
        Relationships: []
      }
      segments: {
        Row: {
          amendment_name: string | null
          amendment_path: string | null
          amendment_size: number | null
          entry: string
          exit: string
          fir_code: string
          fl: string
          id: string
          note: string | null
          order_idx: number
          reason: string | null
          revision: number
          status: string
          updated_at: string
          upr_id: string
        }
        Insert: {
          amendment_name?: string | null
          amendment_path?: string | null
          amendment_size?: number | null
          entry: string
          exit: string
          fir_code: string
          fl: string
          id?: string
          note?: string | null
          order_idx: number
          reason?: string | null
          revision?: number
          status?: string
          updated_at?: string
          upr_id: string
        }
        Update: {
          amendment_name?: string | null
          amendment_path?: string | null
          amendment_size?: number | null
          entry?: string
          exit?: string
          fir_code?: string
          fl?: string
          id?: string
          note?: string | null
          order_idx?: number
          reason?: string | null
          revision?: number
          status?: string
          updated_at?: string
          upr_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segments_fir_code_fkey"
            columns: ["fir_code"]
            isOneToOne: false
            referencedRelation: "firs"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "segments_upr_id_fkey"
            columns: ["upr_id"]
            isOneToOne: false
            referencedRelation: "uprs"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          end_at: string
          id: string
          notes: string
          stage: string
          start_at: string
          upr_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_at: string
          id?: string
          notes?: string
          stage: string
          start_at: string
          upr_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_at?: string
          id?: string
          notes?: string
          stage?: string
          start_at?: string
          upr_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_schedules_upr_id_fkey"
            columns: ["upr_id"]
            isOneToOne: false
            referencedRelation: "uprs"
            referencedColumns: ["id"]
          },
        ]
      }
      uprs: {
        Row: {
          aircraft: string
          airline_code: string
          arr: string
          baseline_minutes: number
          burn_kg_per_min: number
          callsign: string
          created_at: string
          created_by: string
          dep: string
          flight_no: string
          flight_plan_name: string | null
          flight_plan_path: string | null
          flight_plan_size: number | null
          id: string
          optimized_minutes: number
          trial_at: string | null
        }
        Insert: {
          aircraft: string
          airline_code: string
          arr: string
          baseline_minutes?: number
          burn_kg_per_min?: number
          callsign: string
          created_at?: string
          created_by: string
          dep: string
          flight_no: string
          flight_plan_name?: string | null
          flight_plan_path?: string | null
          flight_plan_size?: number | null
          id?: string
          optimized_minutes?: number
          trial_at?: string | null
        }
        Update: {
          aircraft?: string
          airline_code?: string
          arr?: string
          baseline_minutes?: number
          burn_kg_per_min?: number
          callsign?: string
          created_at?: string
          created_by?: string
          dep?: string
          flight_no?: string
          flight_plan_name?: string | null
          flight_plan_path?: string | null
          flight_plan_size?: number | null
          id?: string
          optimized_minutes?: number
          trial_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "uprs_airline_code_fkey"
            columns: ["airline_code"]
            isOneToOne: false
            referencedRelation: "airlines"
            referencedColumns: ["code"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          scope: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          scope?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          scope?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_add_fir: {
        Args: { _code: string; _name: string }
        Returns: undefined
      }
      admin_upsert_aircraft: {
        Args: { _burn: number; _code: string; _name: string }
        Returns: undefined
      }
      approve_user: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _scope: string
          _user_id: string
        }
        Returns: undefined
      }
      claim_first_admin: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_regulator: { Args: { _uid: string }; Returns: boolean }
      register_airline: {
        Args: { _code: string; _name: string }
        Returns: undefined
      }
      reject_user: {
        Args: { _reason?: string; _user_id: string }
        Returns: undefined
      }
      user_scope: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "airline" | "ansp" | "admin" | "regulator"
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
      app_role: ["airline", "ansp", "admin", "regulator"],
    },
  },
} as const
