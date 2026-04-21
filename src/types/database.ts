// Placeholder until we generate real types with:
//   supabase gen types typescript --linked > src/types/database.ts
//
// Until codegen lands, we hand-declare only the surface that typed callers
// need right now. The shape matches what `supabase gen` would emit so the
// switch-over is drop-in.
export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tenant_members: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          role: string
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          role?: string
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          role?: string
          created_at?: string | null
        }
        Relationships: []
      }
      user_secrets: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          integration: 'hyperliquid' | 'coinbase' | 'anthropic' | 'alchemy'
          vault_secret_id: string
          masked_preview: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          integration: 'hyperliquid' | 'coinbase' | 'anthropic' | 'alchemy'
          vault_secret_id: string
          masked_preview: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          integration?: 'hyperliquid' | 'coinbase' | 'anthropic' | 'alchemy'
          vault_secret_id?: string
          masked_preview?: string
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      store_user_secret: {
        Args: {
          p_integration: string
          p_secret: string
          p_masked_preview: string
          p_tenant_id?: string | null
          p_user_id?: string | null
        }
        Returns: string
      }
      get_user_secret: {
        Args: {
          p_integration: string
          p_tenant_id?: string | null
        }
        Returns: string | null
      }
      delete_user_secret: {
        Args: {
          p_integration: string
          p_tenant_id?: string | null
        }
        Returns: void
      }
      current_tenant_id: {
        Args: Record<string, never>
        Returns: string | null
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
