export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_conversations: {
        Row: {
          contexto_datos_json: Json | null
          cost_usd: number | null
          ended_at: string | null
          id: string
          messages_json: Json
          model_used: string | null
          started_at: string
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          contexto_datos_json?: Json | null
          cost_usd?: number | null
          ended_at?: string | null
          id?: string
          messages_json?: Json
          model_used?: string | null
          started_at?: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          contexto_datos_json?: Json | null
          cost_usd?: number | null
          ended_at?: string | null
          id?: string
          messages_json?: Json
          model_used?: string | null
          started_at?: string
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          accion_sugerida: string | null
          canal_afectado: Database["public"]["Enums"]["channel"] | null
          cuerpo_markdown: string
          dismissed_at: string | null
          dismissed_by: string | null
          feedback: string | null
          feedback_at: string | null
          generado_at: string
          generado_por_modelo: string | null
          id: string
          master_skus_afectados: string[]
          payload_json: Json | null
          prompt_version: string | null
          revisado_por_usuario: string | null
          severity: string
          titulo: string
          type: string
        }
        Insert: {
          accion_sugerida?: string | null
          canal_afectado?: Database["public"]["Enums"]["channel"] | null
          cuerpo_markdown: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          feedback?: string | null
          feedback_at?: string | null
          generado_at?: string
          generado_por_modelo?: string | null
          id?: string
          master_skus_afectados?: string[]
          payload_json?: Json | null
          prompt_version?: string | null
          revisado_por_usuario?: string | null
          severity?: string
          titulo: string
          type: string
        }
        Update: {
          accion_sugerida?: string | null
          canal_afectado?: Database["public"]["Enums"]["channel"] | null
          cuerpo_markdown?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          feedback?: string | null
          feedback_at?: string | null
          generado_at?: string
          generado_por_modelo?: string | null
          id?: string
          master_skus_afectados?: string[]
          payload_json?: Json | null
          prompt_version?: string | null
          revisado_por_usuario?: string | null
          severity?: string
          titulo?: string
          type?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          at: string
          id: string
          payload_json: Json | null
          role_at_time: Database["public"]["Enums"]["user_role"] | null
          target_id: string | null
          target_table: string
          user_id: string | null
        }
        Insert: {
          action: string
          at?: string
          id?: string
          payload_json?: Json | null
          role_at_time?: Database["public"]["Enums"]["user_role"] | null
          target_id?: string | null
          target_table: string
          user_id?: string | null
        }
        Update: {
          action?: string
          at?: string
          id?: string
          payload_json?: Json | null
          role_at_time?: Database["public"]["Enums"]["user_role"] | null
          target_id?: string | null
          target_table?: string
          user_id?: string | null
        }
        Relationships: []
      }
      category_mappings: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          created_at: string
          external_category: string
          id: string
          master_category_id: string
          updated_at: string
          validado_humano: boolean
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_category: string
          id?: string
          master_category_id: string
          updated_at?: string
          validado_humano?: boolean
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_category?: string
          id?: string
          master_category_id?: string
          updated_at?: string
          validado_humano?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "category_mappings_master_category_id_fkey"
            columns: ["master_category_id"]
            isOneToOne: false
            referencedRelation: "master_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_runs: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          completed_at: string | null
          duration_ms: number | null
          errors_json: Json | null
          id: string
          kind: Database["public"]["Enums"]["connector_run_kind"]
          metadata_json: Json | null
          records_failed: number
          records_processed: number
          retry_count: number
          started_at: string
          status: string
          upload_id: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          completed_at?: string | null
          duration_ms?: number | null
          errors_json?: Json | null
          id?: string
          kind?: Database["public"]["Enums"]["connector_run_kind"]
          metadata_json?: Json | null
          records_failed?: number
          records_processed?: number
          retry_count?: number
          started_at?: string
          status?: string
          upload_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          completed_at?: string | null
          duration_ms?: number | null
          errors_json?: Json | null
          id?: string
          kind?: Database["public"]["Enums"]["connector_run_kind"]
          metadata_json?: Json | null
          records_failed?: number
          records_processed?: number
          retry_count?: number
          started_at?: string
          status?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_runs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      csv_mapping_profiles: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          column_map_json: Json
          creado_por: string | null
          created_at: string
          id: string
          is_active: boolean
          nombre: string
          reglas_json: Json | null
          tipo: string
          updated_at: string
          version: number
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          column_map_json: Json
          creado_por?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          nombre: string
          reglas_json?: Json | null
          tipo: string
          updated_at?: string
          version?: number
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          column_map_json?: Json
          creado_por?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          nombre?: string
          reglas_json?: Json | null
          tipo?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      csv_reprocess_history: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          errors_json: Json | null
          id: string
          mapping_profile_id_after: string
          mapping_profile_id_before: string | null
          rows_failed: number
          rows_processed: number
          status: string
          triggered_at: string
          triggered_by: string | null
          upload_id: string
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          errors_json?: Json | null
          id?: string
          mapping_profile_id_after: string
          mapping_profile_id_before?: string | null
          rows_failed?: number
          rows_processed?: number
          status?: string
          triggered_at?: string
          triggered_by?: string | null
          upload_id: string
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          errors_json?: Json | null
          id?: string
          mapping_profile_id_after?: string
          mapping_profile_id_before?: string | null
          rows_failed?: number
          rows_processed?: number
          status?: string
          triggered_at?: string
          triggered_by?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_reprocess_history_mapping_profile_id_after_fkey"
            columns: ["mapping_profile_id_after"]
            isOneToOne: false
            referencedRelation: "csv_mapping_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_reprocess_history_mapping_profile_id_before_fkey"
            columns: ["mapping_profile_id_before"]
            isOneToOne: false
            referencedRelation: "csv_mapping_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_reprocess_history_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      customer_external_links: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          created_at: string
          customer_id: string
          external_customer_id: string
          external_identifier_type: string
          id: string
          merged_method: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          created_at?: string
          customer_id: string
          external_customer_id: string
          external_identifier_type: string
          id?: string
          merged_method: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          created_at?: string
          customer_id?: string
          external_customer_id?: string
          external_identifier_type?: string
          id?: string
          merged_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_merge_log: {
        Row: {
          id: string
          merged_at: string
          merged_from: string
          merged_into: string
          method: string
          reason: string | null
          validated_by: string | null
        }
        Insert: {
          id?: string
          merged_at?: string
          merged_from: string
          merged_into: string
          method: string
          reason?: string | null
          validated_by?: string | null
        }
        Update: {
          id?: string
          merged_at?: string
          merged_from?: string
          merged_into?: string
          method?: string
          reason?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customers: {
        Row: {
          channels_purchased: string[]
          created_at: string
          customer_id: string
          displayed_name: string | null
          document_id: string | null
          email: string | null
          first_purchase_at: string | null
          last_purchase_at: string | null
          notes: string | null
          phone: string | null
          tags: string[]
          total_purchases: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          channels_purchased?: string[]
          created_at?: string
          customer_id?: string
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          total_purchases?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          channels_purchased?: string[]
          created_at?: string
          customer_id?: string
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          total_purchases?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: []
      }
      dead_letter_queue: {
        Row: {
          attempts: number
          canal: Database["public"]["Enums"]["channel"]
          created_at: string
          error: string
          id: string
          last_attempted_at: string
          payload_json: Json
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string
        }
        Insert: {
          attempts?: number
          canal: Database["public"]["Enums"]["channel"]
          created_at?: string
          error: string
          id?: string
          last_attempted_at?: string
          payload_json: Json
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source: string
        }
        Update: {
          attempts?: number
          canal?: Database["public"]["Enums"]["channel"]
          created_at?: string
          error?: string
          id?: string
          last_attempted_at?: string
          payload_json?: Json
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
        }
        Relationships: []
      }
      inventory_snapshots: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          cantidad: number
          captured_at: string
          id: string
          master_sku: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          cantidad: number
          captured_at?: string
          id?: string
          master_sku: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          cantidad?: number
          captured_at?: string
          id?: string
          master_sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_snapshots_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_cannibalization: {
        Row: {
          canales: string[]
          customer_id: string
          master_sku: string
          refreshed_at: string
          total_compras: number
          ventana: string
        }
        Insert: {
          canales: string[]
          customer_id: string
          master_sku: string
          refreshed_at?: string
          total_compras?: number
          ventana: string
        }
        Update: {
          canales?: string[]
          customer_id?: string
          master_sku?: string
          refreshed_at?: string
          total_compras?: number
          ventana?: string
        }
        Relationships: [
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_channel_performance: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          growth_pct: number | null
          ingresos: number
          margen_est: number | null
          mes: string
          num_ordenes: number
          refreshed_at: string
          ticket_promedio: number
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          growth_pct?: number | null
          ingresos?: number
          margen_est?: number | null
          mes: string
          num_ordenes?: number
          refreshed_at?: string
          ticket_promedio?: number
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          growth_pct?: number | null
          ingresos?: number
          margen_est?: number | null
          mes?: string
          num_ordenes?: number
          refreshed_at?: string
          ticket_promedio?: number
        }
        Relationships: []
      }
      mart_days_of_inventory: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          dias_inventario: number
          master_sku: string
          refreshed_at: string
          stock_actual: number
          unidades_dia_avg: number
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          dias_inventario: number
          master_sku: string
          refreshed_at?: string
          stock_actual: number
          unidades_dia_avg: number
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          dias_inventario?: number
          master_sku?: string
          refreshed_at?: string
          stock_actual?: number
          unidades_dia_avg?: number
        }
        Relationships: [
          {
            foreignKeyName: "mart_days_of_inventory_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_dead_stock: {
        Row: {
          dias_sin_venta: number
          master_sku: string
          promotion_score: number | null
          razon: string | null
          refreshed_at: string
          stock_actual: number
          ultimo_movimiento: string | null
        }
        Insert: {
          dias_sin_venta: number
          master_sku: string
          promotion_score?: number | null
          razon?: string | null
          refreshed_at?: string
          stock_actual: number
          ultimo_movimiento?: string | null
        }
        Update: {
          dias_sin_venta?: number
          master_sku?: string
          promotion_score?: number | null
          razon?: string | null
          refreshed_at?: string
          stock_actual?: number
          ultimo_movimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mart_dead_stock_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: true
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_product_velocity: {
        Row: {
          master_sku: string
          refreshed_at: string
          tendencia: string | null
          unidades: number
          unidades_dia: number
          ventana: string
        }
        Insert: {
          master_sku: string
          refreshed_at?: string
          tendencia?: string | null
          unidades?: number
          unidades_dia?: number
          ventana: string
        }
        Update: {
          master_sku?: string
          refreshed_at?: string
          tendencia?: string | null
          unidades?: number
          unidades_dia?: number
          ventana?: string
        }
        Relationships: [
          {
            foreignKeyName: "mart_product_velocity_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_top_products_by_window: {
        Row: {
          computed_at: string
          ingresos: number
          master_sku: string
          ranking: number
          refreshed_at: string
          score: number
          unidades: number
          ventana: string
        }
        Insert: {
          computed_at: string
          ingresos?: number
          master_sku: string
          ranking: number
          refreshed_at?: string
          score?: number
          unidades?: number
          ventana: string
        }
        Update: {
          computed_at?: string
          ingresos?: number
          master_sku?: string
          ranking?: number
          refreshed_at?: string
          score?: number
          unidades?: number
          ventana?: string
        }
        Relationships: [
          {
            foreignKeyName: "mart_top_products_by_window_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      master_categories: {
        Row: {
          created_at: string
          depth: number
          id: string
          is_active: boolean
          nombre: string
          parent_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          depth?: number
          id?: string
          is_active?: boolean
          nombre: string
          parent_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          depth?: number
          id?: string
          is_active?: boolean
          nombre?: string
          parent_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "master_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      master_products: {
        Row: {
          attributes_json: Json
          barcode: string | null
          brand: string | null
          category: string | null
          confidence_score: number
          costo_promedio: number | null
          created_at: string
          estado: string
          imagen_principal: string | null
          master_category_id: string | null
          master_sku: string
          nombre_canonico: string
          precio_sugerido: number | null
          supplier_code: string | null
          updated_at: string
        }
        Insert: {
          attributes_json?: Json
          barcode?: string | null
          brand?: string | null
          category?: string | null
          confidence_score?: number
          costo_promedio?: number | null
          created_at?: string
          estado?: string
          imagen_principal?: string | null
          master_category_id?: string | null
          master_sku?: string
          nombre_canonico: string
          precio_sugerido?: number | null
          supplier_code?: string | null
          updated_at?: string
        }
        Update: {
          attributes_json?: Json
          barcode?: string | null
          brand?: string | null
          category?: string | null
          confidence_score?: number
          costo_promedio?: number | null
          created_at?: string
          estado?: string
          imagen_principal?: string | null
          master_category_id?: string | null
          master_sku?: string
          nombre_canonico?: string
          precio_sugerido?: number | null
          supplier_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_products_master_category_id_fkey"
            columns: ["master_category_id"]
            isOneToOne: false
            referencedRelation: "master_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_log: {
        Row: {
          channel: string
          cost_usd: number | null
          created_at: string
          delivered_at: string | null
          direction: string
          error: string | null
          id: string
          payload_json: Json
          provider_message_id: string | null
          read_at: string | null
          recipient: string | null
          sender: string | null
          sent_at: string | null
          status: string
          template_name: string | null
        }
        Insert: {
          channel?: string
          cost_usd?: number | null
          created_at?: string
          delivered_at?: string | null
          direction: string
          error?: string | null
          id?: string
          payload_json: Json
          provider_message_id?: string | null
          read_at?: string | null
          recipient?: string | null
          sender?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
        }
        Update: {
          channel?: string
          cost_usd?: number | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error?: string | null
          id?: string
          payload_json?: Json
          provider_message_id?: string | null
          read_at?: string | null
          recipient?: string | null
          sender?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
        }
        Relationships: []
      }
      product_mappings: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          created_at: string
          external_id: string
          external_name: string | null
          external_sku: string | null
          id: string
          master_sku: string
          match_method: Database["public"]["Enums"]["match_method"]
          score: number
          updated_at: string
          validado_humano: boolean
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_id: string
          external_name?: string | null
          external_sku?: string | null
          id?: string
          master_sku: string
          match_method: Database["public"]["Enums"]["match_method"]
          score: number
          updated_at?: string
          validado_humano?: boolean
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          created_at?: string
          external_id?: string
          external_name?: string | null
          external_sku?: string | null
          id?: string
          master_sku?: string
          match_method?: Database["public"]["Enums"]["match_method"]
          score?: number
          updated_at?: string
          validado_humano?: boolean
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_mappings_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      product_variants: {
        Row: {
          atributos_json: Json
          created_at: string
          master_sku: string
          master_variant_sku: string
          updated_at: string
        }
        Insert: {
          atributos_json?: Json
          created_at?: string
          master_sku: string
          master_variant_sku?: string
          updated_at?: string
        }
        Update: {
          atributos_json?: Json
          created_at?: string
          master_sku?: string
          master_variant_sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      raw_csv_rows: {
        Row: {
          error: string | null
          id: number
          mapping_profile_id_used: string | null
          payload_json: Json
          processed: boolean
          processed_at: string | null
          row_number: number
          superseded_at: string | null
          target_table: string | null
          upload_id: string
        }
        Insert: {
          error?: string | null
          id?: number
          mapping_profile_id_used?: string | null
          payload_json: Json
          processed?: boolean
          processed_at?: string | null
          row_number: number
          superseded_at?: string | null
          target_table?: string | null
          upload_id: string
        }
        Update: {
          error?: string | null
          id?: number
          mapping_profile_id_used?: string | null
          payload_json?: Json
          processed?: boolean
          processed_at?: string | null
          row_number?: number
          superseded_at?: string | null
          target_table?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_csv_rows_mapping_profile_id_used_fkey"
            columns: ["mapping_profile_id_used"]
            isOneToOne: false
            referencedRelation: "csv_mapping_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_csv_rows_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      raw_csv_uploads: {
        Row: {
          bytes: number
          canal_declarado: Database["public"]["Enums"]["channel"]
          error_log_json: Json | null
          filename: string
          mapping_profile_id: string | null
          row_count: number
          status: Database["public"]["Enums"]["csv_upload_status"]
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          tipo: string
          upload_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          bytes: number
          canal_declarado: Database["public"]["Enums"]["channel"]
          error_log_json?: Json | null
          filename: string
          mapping_profile_id?: string | null
          row_count?: number
          status?: Database["public"]["Enums"]["csv_upload_status"]
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          tipo: string
          upload_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          bytes?: number
          canal_declarado?: Database["public"]["Enums"]["channel"]
          error_log_json?: Json | null
          filename?: string
          mapping_profile_id?: string | null
          row_count?: number
          status?: Database["public"]["Enums"]["csv_upload_status"]
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          tipo?: string
          upload_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_csv_uploads_mapping_profile_id_fkey"
            columns: ["mapping_profile_id"]
            isOneToOne: false
            referencedRelation: "csv_mapping_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_csv_uploads_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      raw_events: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at: string
          id: string
          ocurrido_at: string
          payload_json: Json
          tipo_evento: string
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          ocurrido_at: string
          payload_json: Json
          tipo_evento: string
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          ocurrido_at?: string
          payload_json?: Json
          tipo_evento?: string
        }
        Relationships: []
      }
      raw_orders: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at: string
          id: string
          payload_json: Json
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          payload_json: Json
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          payload_json?: Json
        }
        Relationships: []
      }
      raw_products: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at: string
          id: string
          payload_json: Json
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          payload_json: Json
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          fetched_at?: string
          id?: string
          payload_json?: Json
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          created_at: string
          external_product_id: string | null
          external_sku: string | null
          id: string
          line_discount: number
          line_total: number
          master_sku: string | null
          master_variant_sku: string | null
          product_name: string
          quantity: number
          sale_id: string
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          external_product_id?: string | null
          external_sku?: string | null
          id?: string
          line_discount?: number
          line_total: number
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name: string
          quantity: number
          sale_id: string
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          created_at?: string
          external_product_id?: string | null
          external_sku?: string | null
          id?: string
          line_discount?: number
          line_total?: number
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
          {
            foreignKeyName: "sale_items_master_variant_sku_fkey"
            columns: ["master_variant_sku"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["master_variant_sku"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_admin"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_analista"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_manager"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      sales: {
        Row: {
          canal: Database["public"]["Enums"]["channel"]
          costo_envio: number
          created_at: string
          customer_city: string | null
          customer_email: string | null
          customer_external_id: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          descuento: number
          estado: string
          external_order_id: string
          fecha: string
          hora: string | null
          moneda: string
          notes: string | null
          payment_method: string | null
          punto_venta_id: string | null
          raw_payload_ref: Json | null
          sale_id: string
          subtotal: number
          total: number
          updated_at: string
          upload_id: string | null
        }
        Insert: {
          canal: Database["public"]["Enums"]["channel"]
          costo_envio?: number
          created_at?: string
          customer_city?: string | null
          customer_email?: string | null
          customer_external_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          descuento?: number
          estado?: string
          external_order_id: string
          fecha: string
          hora?: string | null
          moneda?: string
          notes?: string | null
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
          upload_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"]
          costo_envio?: number
          created_at?: string
          customer_city?: string | null
          customer_email?: string | null
          customer_external_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          descuento?: number
          estado?: string
          external_order_id?: string
          fecha?: string
          hora?: string | null
          moneda?: string
          notes?: string | null
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
    }
    Views: {
      audit_log_view_admin: {
        Row: {
          action: string | null
          at: string | null
          id: string | null
          payload_json: Json | null
          role_at_time: Database["public"]["Enums"]["user_role"] | null
          target_id: string | null
          target_table: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          at?: string | null
          id?: string | null
          payload_json?: Json | null
          role_at_time?: Database["public"]["Enums"]["user_role"] | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          at?: string | null
          id?: string | null
          payload_json?: Json | null
          role_at_time?: Database["public"]["Enums"]["user_role"] | null
          target_id?: string | null
          target_table?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      customer_external_links_view_admin: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          created_at: string | null
          customer_id: string | null
          external_customer_id: string | null
          external_identifier_type: string | null
          id: string | null
          merged_method: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_external_links_view_analista: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          created_at: string | null
          customer_id: string | null
          external_customer_id: string | null
          external_identifier_type: string | null
          id: string | null
          merged_method: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_external_links_view_manager: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          created_at: string | null
          customer_id: string | null
          external_customer_id: string | null
          external_identifier_type: string | null
          id: string | null
          merged_method: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          created_at?: string | null
          customer_id?: string | null
          external_customer_id?: string | null
          external_identifier_type?: string | null
          id?: string | null
          merged_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_external_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_merge_log_view_admin: {
        Row: {
          id: string | null
          merged_at: string | null
          merged_from: string | null
          merged_into: string | null
          method: string | null
          reason: string | null
          validated_by: string | null
        }
        Insert: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Update: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_merge_log_view_analista: {
        Row: {
          id: string | null
          merged_at: string | null
          merged_from: string | null
          merged_into: string | null
          method: string | null
          reason: string | null
          validated_by: string | null
        }
        Insert: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Update: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customer_merge_log_view_manager: {
        Row: {
          id: string | null
          merged_at: string | null
          merged_from: string | null
          merged_into: string | null
          method: string | null
          reason: string | null
          validated_by: string | null
        }
        Insert: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Update: {
          id?: string | null
          merged_at?: string | null
          merged_from?: string | null
          merged_into?: string | null
          method?: string | null
          reason?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_from_fkey"
            columns: ["merged_from"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_merge_log_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customers_view_admin: {
        Row: {
          channels_purchased: string[] | null
          created_at: string | null
          customer_id: string | null
          displayed_name: string | null
          document_id: string | null
          email: string | null
          first_purchase_at: string | null
          last_purchase_at: string | null
          notes: string | null
          phone: string | null
          tags: string[] | null
          total_purchases: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customers_view_analista: {
        Row: {
          channels_purchased: string[] | null
          created_at: string | null
          customer_id: string | null
          displayed_name: string | null
          document_id: string | null
          email: string | null
          first_purchase_at: string | null
          last_purchase_at: string | null
          notes: string | null
          phone: string | null
          tags: string[] | null
          total_purchases: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customers_view_manager: {
        Row: {
          channels_purchased: string[] | null
          created_at: string | null
          customer_id: string | null
          displayed_name: string | null
          document_id: string | null
          email: string | null
          first_purchase_at: string | null
          last_purchase_at: string | null
          notes: string | null
          phone: string | null
          tags: string[] | null
          total_purchases: number | null
          total_spent: number | null
          updated_at: string | null
        }
        Insert: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Update: {
          channels_purchased?: string[] | null
          created_at?: string | null
          customer_id?: string | null
          displayed_name?: string | null
          document_id?: string | null
          email?: string | null
          first_purchase_at?: string | null
          last_purchase_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[] | null
          total_purchases?: number | null
          total_spent?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mart_cannibalization_view_admin: {
        Row: {
          canales: string[] | null
          customer_id: string | null
          master_sku: string | null
          refreshed_at: string | null
          total_compras: number | null
          ventana: string | null
        }
        Insert: {
          canales?: string[] | null
          customer_id?: string | null
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: number | null
          ventana?: string | null
        }
        Update: {
          canales?: string[] | null
          customer_id?: string | null
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: number | null
          ventana?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "mart_cannibalization_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_cannibalization_view_analista: {
        Row: {
          canales: string[] | null
          customer_id: string | null
          master_sku: string | null
          refreshed_at: string | null
          total_compras: number | null
          ventana: string | null
        }
        Insert: {
          canales?: string[] | null
          customer_id?: never
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: never
          ventana?: string | null
        }
        Update: {
          canales?: string[] | null
          customer_id?: never
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: never
          ventana?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mart_cannibalization_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      mart_cannibalization_view_manager: {
        Row: {
          canales: string[] | null
          customer_id: string | null
          master_sku: string | null
          refreshed_at: string | null
          total_compras: number | null
          ventana: string | null
        }
        Insert: {
          canales?: string[] | null
          customer_id?: never
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: number | null
          ventana?: string | null
        }
        Update: {
          canales?: string[] | null
          customer_id?: never
          master_sku?: string | null
          refreshed_at?: string | null
          total_compras?: number | null
          ventana?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mart_cannibalization_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
        ]
      }
      sale_items_view_admin: {
        Row: {
          created_at: string | null
          external_product_id: string | null
          external_sku: string | null
          id: string | null
          line_discount: number | null
          line_total: number | null
          master_sku: string | null
          master_variant_sku: string | null
          product_name: string | null
          quantity: number | null
          sale_id: string | null
          unit_cost: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: number | null
          line_total?: number | null
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: number | null
          line_total?: number | null
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
          {
            foreignKeyName: "sale_items_master_variant_sku_fkey"
            columns: ["master_variant_sku"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["master_variant_sku"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_admin"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_analista"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_manager"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      sale_items_view_analista: {
        Row: {
          created_at: string | null
          external_product_id: string | null
          external_sku: string | null
          id: string | null
          line_discount: number | null
          line_total: number | null
          master_sku: string | null
          master_variant_sku: string | null
          product_name: string | null
          quantity: number | null
          sale_id: string | null
          unit_cost: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: never
          line_total?: never
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: never
          unit_price?: never
        }
        Update: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: never
          line_total?: never
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: never
          unit_price?: never
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
          {
            foreignKeyName: "sale_items_master_variant_sku_fkey"
            columns: ["master_variant_sku"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["master_variant_sku"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_admin"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_analista"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_manager"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      sale_items_view_manager: {
        Row: {
          created_at: string | null
          external_product_id: string | null
          external_sku: string | null
          id: string | null
          line_discount: number | null
          line_total: number | null
          master_sku: string | null
          master_variant_sku: string | null
          product_name: string | null
          quantity: number | null
          sale_id: string | null
          unit_cost: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: number | null
          line_total?: number | null
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          external_product_id?: string | null
          external_sku?: string | null
          id?: string | null
          line_discount?: number | null
          line_total?: number | null
          master_sku?: string | null
          master_variant_sku?: string | null
          product_name?: string | null
          quantity?: number | null
          sale_id?: string | null
          unit_cost?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_master_sku_fkey"
            columns: ["master_sku"]
            isOneToOne: false
            referencedRelation: "master_products"
            referencedColumns: ["master_sku"]
          },
          {
            foreignKeyName: "sale_items_master_variant_sku_fkey"
            columns: ["master_variant_sku"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["master_variant_sku"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_admin"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_analista"
            referencedColumns: ["sale_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales_view_manager"
            referencedColumns: ["sale_id"]
          },
        ]
      }
      sales_view_admin: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          costo_envio: number | null
          created_at: string | null
          customer_city: string | null
          customer_email: string | null
          customer_external_id: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          descuento: number | null
          estado: string | null
          external_order_id: string | null
          fecha: string | null
          hora: string | null
          moneda: string | null
          notes: string | null
          payment_method: string | null
          punto_venta_id: string | null
          raw_payload_ref: Json | null
          sale_id: string | null
          subtotal: number | null
          total: number | null
          updated_at: string | null
          upload_id: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: number | null
          created_at?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_external_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          descuento?: number | null
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: string | null
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: number | null
          total?: number | null
          updated_at?: string | null
          upload_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: number | null
          created_at?: string | null
          customer_city?: string | null
          customer_email?: string | null
          customer_external_id?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          descuento?: number | null
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: string | null
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: number | null
          total?: number | null
          updated_at?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_admin"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_analista"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers_view_manager"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "sales_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      sales_view_analista: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          costo_envio: number | null
          created_at: string | null
          customer_city: string | null
          customer_email: string | null
          customer_external_id: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          descuento: number | null
          estado: string | null
          external_order_id: string | null
          fecha: string | null
          hora: string | null
          moneda: string | null
          notes: string | null
          payment_method: string | null
          punto_venta_id: string | null
          raw_payload_ref: Json | null
          sale_id: string | null
          subtotal: number | null
          total: number | null
          updated_at: string | null
          upload_id: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: never
          created_at?: string | null
          customer_city?: never
          customer_email?: never
          customer_external_id?: never
          customer_id?: never
          customer_name?: never
          customer_phone?: never
          descuento?: never
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: never
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: never
          total?: never
          updated_at?: string | null
          upload_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: never
          created_at?: string | null
          customer_city?: never
          customer_email?: never
          customer_external_id?: never
          customer_id?: never
          customer_name?: never
          customer_phone?: never
          descuento?: never
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: never
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: never
          total?: never
          updated_at?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
      sales_view_manager: {
        Row: {
          canal: Database["public"]["Enums"]["channel"] | null
          costo_envio: number | null
          created_at: string | null
          customer_city: string | null
          customer_email: string | null
          customer_external_id: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          descuento: number | null
          estado: string | null
          external_order_id: string | null
          fecha: string | null
          hora: string | null
          moneda: string | null
          notes: string | null
          payment_method: string | null
          punto_venta_id: string | null
          raw_payload_ref: Json | null
          sale_id: string | null
          subtotal: number | null
          total: number | null
          updated_at: string | null
          upload_id: string | null
        }
        Insert: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: number | null
          created_at?: string | null
          customer_city?: never
          customer_email?: never
          customer_external_id?: never
          customer_id?: never
          customer_name?: never
          customer_phone?: never
          descuento?: number | null
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: never
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: number | null
          total?: number | null
          updated_at?: string | null
          upload_id?: string | null
        }
        Update: {
          canal?: Database["public"]["Enums"]["channel"] | null
          costo_envio?: number | null
          created_at?: string | null
          customer_city?: never
          customer_email?: never
          customer_external_id?: never
          customer_id?: never
          customer_name?: never
          customer_phone?: never
          descuento?: number | null
          estado?: string | null
          external_order_id?: string | null
          fecha?: string | null
          hora?: string | null
          moneda?: string | null
          notes?: never
          payment_method?: string | null
          punto_venta_id?: string | null
          raw_payload_ref?: Json | null
          sale_id?: string | null
          subtotal?: number | null
          total?: number | null
          updated_at?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "raw_csv_uploads"
            referencedColumns: ["upload_id"]
          },
        ]
      }
    }
    Functions: {
      current_role_claim: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      channel:
        | "wordpress"
        | "mercadolibre"
        | "dropi"
        | "pos"
        | "pos1"
        | "pos2"
        | "whatsapp"
        | "csv-upload"
        | "falabella"
      connector_run_kind: "channel" | "cron-heartbeat"
      csv_upload_status: "uploaded" | "validating" | "processed" | "failed"
      match_method:
        | "barcode_exact"
        | "supplier_code_exact"
        | "sku_exact"
        | "normalized_name_exact"
        | "embeddings_high"
        | "embeddings_mid"
        | "llm_arbiter_match"
        | "llm_arbiter_reject"
        | "unresolved"
      user_role: "super_admin" | "admin" | "manager" | "analista"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      channel: [
        "wordpress",
        "mercadolibre",
        "dropi",
        "pos",
        "pos1",
        "pos2",
        "whatsapp",
        "csv-upload",
        "falabella",
      ],
      connector_run_kind: ["channel", "cron-heartbeat"],
      csv_upload_status: ["uploaded", "validating", "processed", "failed"],
      match_method: [
        "barcode_exact",
        "supplier_code_exact",
        "sku_exact",
        "normalized_name_exact",
        "embeddings_high",
        "embeddings_mid",
        "llm_arbiter_match",
        "llm_arbiter_reject",
        "unresolved",
      ],
      user_role: ["super_admin", "admin", "manager", "analista"],
    },
  },
} as const

