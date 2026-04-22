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
      assets_reference: {
        Row: {
          coingecko_id: string
          symbol: string
          name: string
          market_cap_rank: number | null
          updated_at: string | null
        }
        Insert: {
          coingecko_id: string
          symbol: string
          name: string
          market_cap_rank?: number | null
          updated_at?: string | null
        }
        Update: {
          coingecko_id?: string
          symbol?: string
          name?: string
          market_cap_rank?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          asset_symbol: string
          coingecko_id: string | null
          direction: 'long' | 'short'
          entry_price: number
          entry_size: number
          leverage: number | null
          venue: string
          narrative_tag: string | null
          setup_type: string | null
          thesis: string | null
          entry_at: string
          exit_price: number | null
          exit_size: number | null
          exit_at: string | null
          pnl: number | null
          outcome: 'win' | 'loss' | 'breakeven' | 'open'
          lesson: string | null
          source: 'manual' | 'hyperliquid' | 'coinbase' | 'onchain'
          external_id: string | null
          risk_amount_gbp: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          asset_symbol: string
          coingecko_id?: string | null
          direction: 'long' | 'short'
          entry_price: number
          entry_size: number
          leverage?: number | null
          venue: string
          narrative_tag?: string | null
          setup_type?: string | null
          thesis?: string | null
          entry_at?: string
          exit_price?: number | null
          exit_size?: number | null
          exit_at?: string | null
          pnl?: number | null
          outcome?: 'win' | 'loss' | 'breakeven' | 'open'
          lesson?: string | null
          source?: 'manual' | 'hyperliquid' | 'coinbase' | 'onchain'
          external_id?: string | null
          risk_amount_gbp?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          asset_symbol?: string
          coingecko_id?: string | null
          direction?: 'long' | 'short'
          entry_price?: number
          entry_size?: number
          leverage?: number | null
          venue?: string
          narrative_tag?: string | null
          setup_type?: string | null
          thesis?: string | null
          entry_at?: string
          exit_price?: number | null
          exit_size?: number | null
          exit_at?: string | null
          pnl?: number | null
          outcome?: 'win' | 'loss' | 'breakeven' | 'open'
          lesson?: string | null
          source?: 'manual' | 'hyperliquid' | 'coinbase' | 'onchain'
          external_id?: string | null
          risk_amount_gbp?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      universe: {
        Row: {
          id: string
          symbol: string
          coingecko_id: string | null
          is_watchlist: boolean
          is_active: boolean
          added_at: string | null
          added_by: string | null
        }
        Insert: {
          id?: string
          symbol: string
          coingecko_id?: string | null
          is_watchlist?: boolean
          is_active?: boolean
          added_at?: string | null
          added_by?: string | null
        }
        Update: {
          id?: string
          symbol?: string
          coingecko_id?: string | null
          is_watchlist?: boolean
          is_active?: boolean
          added_at?: string | null
          added_by?: string | null
        }
        Relationships: []
      }
      market_snapshots: {
        Row: {
          id: number
          symbol: string
          mark_price: number | null
          funding: number | null
          open_interest: number | null
          day_notional_volume: number | null
          captured_at: string
        }
        Insert: {
          id?: number
          symbol: string
          mark_price?: number | null
          funding?: number | null
          open_interest?: number | null
          day_notional_volume?: number | null
          captured_at?: string
        }
        Update: {
          id?: number
          symbol?: string
          mark_price?: number | null
          funding?: number | null
          open_interest?: number | null
          day_notional_volume?: number | null
          captured_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          id: string
          tenant_id: string | null
          framework_id: string
          symbol: string
          coingecko_id: string | null
          triggered_at: string
          condition_values: Record<string, unknown>
          suggested_direction: 'long' | 'short' | null
          suggested_entry: number | null
          suggested_stop: number | null
          suggested_target: number | null
          is_watchlist: boolean
          trade_id: string | null
          dismissed: boolean
          dismissed_at: string | null
          notified_telegram: boolean
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          framework_id: string
          symbol: string
          coingecko_id?: string | null
          triggered_at?: string
          condition_values?: Record<string, unknown>
          suggested_direction?: 'long' | 'short' | null
          suggested_entry?: number | null
          suggested_stop?: number | null
          suggested_target?: number | null
          is_watchlist?: boolean
          trade_id?: string | null
          dismissed?: boolean
          dismissed_at?: string | null
          notified_telegram?: boolean
        }
        Update: {
          id?: string
          tenant_id?: string | null
          framework_id?: string
          symbol?: string
          coingecko_id?: string | null
          triggered_at?: string
          condition_values?: Record<string, unknown>
          suggested_direction?: 'long' | 'short' | null
          suggested_entry?: number | null
          suggested_stop?: number | null
          suggested_target?: number | null
          is_watchlist?: boolean
          trade_id?: string | null
          dismissed?: boolean
          dismissed_at?: string | null
          notified_telegram?: boolean
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
