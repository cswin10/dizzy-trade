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
          hyperliquid_position_id: string | null
          hyperliquid_address: string | null
          live_status:
            | 'not_live'
            | 'pending_link'
            | 'live'
            | 'closed_auto'
            | 'closed_manual'
            | null
          linked_at: string | null
          last_synced_at: string | null
          btc_context_at_entry: 'up' | 'down' | 'ranging' | null
          analysis_text: string | null
          analysis_lesson_tag: string | null
          analysis_what_went_right: string | null
          analysis_what_went_wrong: string | null
          analysis_pattern_insight: string | null
          analysis_generated_at: string | null
          analysis_model: string | null
          analysis_prompt_version: number | null
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
          hyperliquid_position_id?: string | null
          hyperliquid_address?: string | null
          live_status?:
            | 'not_live'
            | 'pending_link'
            | 'live'
            | 'closed_auto'
            | 'closed_manual'
            | null
          linked_at?: string | null
          last_synced_at?: string | null
          btc_context_at_entry?: 'up' | 'down' | 'ranging' | null
          analysis_text?: string | null
          analysis_lesson_tag?: string | null
          analysis_what_went_right?: string | null
          analysis_what_went_wrong?: string | null
          analysis_pattern_insight?: string | null
          analysis_generated_at?: string | null
          analysis_model?: string | null
          analysis_prompt_version?: number | null
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
          hyperliquid_position_id?: string | null
          hyperliquid_address?: string | null
          live_status?:
            | 'not_live'
            | 'pending_link'
            | 'live'
            | 'closed_auto'
            | 'closed_manual'
            | null
          linked_at?: string | null
          last_synced_at?: string | null
          btc_context_at_entry?: 'up' | 'down' | 'ranging' | null
          analysis_text?: string | null
          analysis_lesson_tag?: string | null
          analysis_what_went_right?: string | null
          analysis_what_went_wrong?: string | null
          analysis_pattern_insight?: string | null
          analysis_generated_at?: string | null
          analysis_model?: string | null
          analysis_prompt_version?: number | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          id: string
          tenant_id: string
          analytics_layout: string[] | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          analytics_layout?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          analytics_layout?: string[] | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hyperliquid_position_snapshots: {
        Row: {
          id: string
          tenant_id: string
          trade_id: string
          coin: string
          size: number
          entry_px: number | null
          position_value: number | null
          unrealized_pnl: number | null
          liquidation_px: number | null
          captured_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          trade_id: string
          coin: string
          size: number
          entry_px?: number | null
          position_value?: number | null
          unrealized_pnl?: number | null
          liquidation_px?: number | null
          captured_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          trade_id?: string
          coin?: string
          size?: number
          entry_px?: number | null
          position_value?: number | null
          unrealized_pnl?: number | null
          liquidation_px?: number | null
          captured_at?: string
        }
        Relationships: []
      }
      user_hyperliquid_config: {
        Row: {
          id: string
          tenant_id: string
          main_address: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          main_address: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          main_address?: string
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
      framework_thresholds: {
        Row: {
          id: string
          framework_id: string
          key: string
          value: number
          description: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          framework_id: string
          key: string
          value: number
          description?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          framework_id?: string
          key?: string
          value?: number
          description?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      strategies: {
        Row: {
          id: string
          name: string
          framework_id: string
          timeframe: '15m' | '1h' | '4h' | '1d'
          pair_symbols: string[]
          risk_amount_gbp: number
          min_rr: number
          max_concurrent_positions: number
          max_daily_loss_gbp: number | null
          max_consecutive_losers: number | null
          deployment_status: 'draft' | 'live' | 'paused' | 'archived'
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          framework_id: string
          timeframe: '15m' | '1h' | '4h' | '1d'
          pair_symbols: string[]
          risk_amount_gbp: number
          min_rr?: number
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          deployment_status?: 'draft' | 'live' | 'paused' | 'archived'
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          framework_id?: string
          timeframe?: '15m' | '1h' | '4h' | '1d'
          pair_symbols?: string[]
          risk_amount_gbp?: number
          min_rr?: number
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          deployment_status?: 'draft' | 'live' | 'paused' | 'archived'
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      strategy_definitions: {
        Row: {
          id: string
          tenant_id: string
          name: string
          description: string | null
          definition: Record<string, unknown>
          schema_version: number
          is_archived: boolean
          created_at: string | null
          updated_at: string | null
          deployment_status: 'draft' | 'live' | 'paused' | 'archived'
          pairs: string[]
          timeframe: string
          max_concurrent_positions: number
          max_daily_loss_gbp: number | null
          max_consecutive_losers: number | null
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          description?: string | null
          definition: Record<string, unknown>
          schema_version?: number
          is_archived?: boolean
          created_at?: string | null
          updated_at?: string | null
          deployment_status?: 'draft' | 'live' | 'paused' | 'archived'
          pairs?: string[]
          timeframe?: string
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          description?: string | null
          definition?: Record<string, unknown>
          schema_version?: number
          is_archived?: boolean
          created_at?: string | null
          updated_at?: string | null
          deployment_status?: 'draft' | 'live' | 'paused' | 'archived'
          pairs?: string[]
          timeframe?: string
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
        }
        Relationships: []
      }
      narrative_tags: {
        Row: {
          id: string
          symbol: string
          heat_level: 'hot' | 'warm' | 'cool' | 'cold'
          note: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          symbol: string
          heat_level: 'hot' | 'warm' | 'cool' | 'cold'
          note?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          symbol?: string
          heat_level?: 'hot' | 'warm' | 'cool' | 'cold'
          note?: string | null
          updated_at?: string | null
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
          strategy_id: string | null
          position_size_coin: number | null
          position_size_usd: number | null
          leverage_implied: number | null
          valid_until: string | null
          risk_amount_gbp: number | null
          gbp_usd_rate: number | null
          rules_status: 'passed' | 'blocked' | 'warning' | null
          rules_violations: unknown
          alert_source: 'framework' | 'composable'
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
          strategy_id?: string | null
          position_size_coin?: number | null
          position_size_usd?: number | null
          leverage_implied?: number | null
          valid_until?: string | null
          risk_amount_gbp?: number | null
          gbp_usd_rate?: number | null
          rules_status?: 'passed' | 'blocked' | 'warning' | null
          rules_violations?: unknown
          alert_source?: 'framework' | 'composable'
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
          strategy_id?: string | null
          position_size_coin?: number | null
          position_size_usd?: number | null
          leverage_implied?: number | null
          valid_until?: string | null
          risk_amount_gbp?: number | null
          gbp_usd_rate?: number | null
          rules_status?: 'passed' | 'blocked' | 'warning' | null
          rules_violations?: unknown
          alert_source?: 'framework' | 'composable'
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          id: string
          tenant_id: string
          name: string
          created_at: string | null
          framework_id: string | null
          framework_thresholds: Record<string, number>
          timeframe: string
          pairs: string[]
          risk_amount_gbp: number
          min_rr: number
          max_concurrent_positions: number
          max_daily_loss_gbp: number | null
          max_consecutive_losers: number | null
          date_range_start: string
          date_range_end: string
          slippage_pct: number
          maker_fee_pct: number
          taker_fee_pct: number
          assume_taker: boolean
          enable_train_test_split: boolean
          train_split_pct: number
          status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          error_message: string | null
          run_started_at: string | null
          run_completed_at: string | null
          total_signals: number | null
          total_trades: number | null
          wins: number | null
          losses: number | null
          breakevens: number | null
          win_rate: number | null
          avg_r: number | null
          total_pnl_gbp: number | null
          max_drawdown_gbp: number | null
          max_drawdown_pct: number | null
          sharpe_ratio: number | null
          longest_losing_streak: number | null
          expectancy_per_trade_gbp: number | null
          train_metrics: Record<string, unknown> | null
          test_metrics: Record<string, unknown> | null
          overfit_warning_triggered: boolean | null
          gbp_usd_rate_used: number | null
          sweep_id: string | null
          sweep_combination_index: number | null
          sweep_combination_values: Record<string, unknown> | null
          strategy_definition_id: string | null
          strategy_definition_snapshot: Record<string, unknown> | null
          batch_run_id: string | null
          diagnostics: Record<string, unknown> | null
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          created_at?: string | null
          framework_id?: string | null
          framework_thresholds?: Record<string, number>
          timeframe: string
          pairs: string[]
          risk_amount_gbp: number
          min_rr: number
          max_concurrent_positions: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          date_range_start: string
          date_range_end: string
          slippage_pct?: number
          maker_fee_pct?: number
          taker_fee_pct?: number
          assume_taker?: boolean
          enable_train_test_split?: boolean
          train_split_pct?: number
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          error_message?: string | null
          run_started_at?: string | null
          run_completed_at?: string | null
          total_signals?: number | null
          total_trades?: number | null
          wins?: number | null
          losses?: number | null
          breakevens?: number | null
          win_rate?: number | null
          avg_r?: number | null
          total_pnl_gbp?: number | null
          max_drawdown_gbp?: number | null
          max_drawdown_pct?: number | null
          sharpe_ratio?: number | null
          longest_losing_streak?: number | null
          expectancy_per_trade_gbp?: number | null
          train_metrics?: Record<string, unknown> | null
          test_metrics?: Record<string, unknown> | null
          overfit_warning_triggered?: boolean | null
          gbp_usd_rate_used?: number | null
          sweep_id?: string | null
          sweep_combination_index?: number | null
          sweep_combination_values?: Record<string, unknown> | null
          strategy_definition_id?: string | null
          strategy_definition_snapshot?: Record<string, unknown> | null
          batch_run_id?: string | null
          diagnostics?: Record<string, unknown> | null
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          created_at?: string | null
          framework_id?: string | null
          framework_thresholds?: Record<string, number>
          timeframe?: string
          pairs?: string[]
          risk_amount_gbp?: number
          min_rr?: number
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          date_range_start?: string
          date_range_end?: string
          slippage_pct?: number
          maker_fee_pct?: number
          taker_fee_pct?: number
          assume_taker?: boolean
          enable_train_test_split?: boolean
          train_split_pct?: number
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          error_message?: string | null
          run_started_at?: string | null
          run_completed_at?: string | null
          total_signals?: number | null
          total_trades?: number | null
          wins?: number | null
          losses?: number | null
          breakevens?: number | null
          win_rate?: number | null
          avg_r?: number | null
          total_pnl_gbp?: number | null
          max_drawdown_gbp?: number | null
          max_drawdown_pct?: number | null
          sharpe_ratio?: number | null
          longest_losing_streak?: number | null
          expectancy_per_trade_gbp?: number | null
          train_metrics?: Record<string, unknown> | null
          test_metrics?: Record<string, unknown> | null
          overfit_warning_triggered?: boolean | null
          gbp_usd_rate_used?: number | null
          sweep_id?: string | null
          sweep_combination_index?: number | null
          sweep_combination_values?: Record<string, unknown> | null
          strategy_definition_id?: string | null
          strategy_definition_snapshot?: Record<string, unknown> | null
          batch_run_id?: string | null
          diagnostics?: Record<string, unknown> | null
        }
        Relationships: []
      }
      strategy_deployments: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          strategy_definition_id: string | null
          legacy_strategy_id: string | null
          live_risk_gbp: number
          live_pairs: string[]
          live_max_concurrent_positions: number
          live_max_daily_loss_gbp: number | null
          live_max_consecutive_losers: number | null
          live_order_lifetime_candles: number
          live_auto_execute_enabled: boolean
          source_backtest_run_id: string | null
          source_backtest_summary: Record<string, unknown> | null
          deployed_at: string
          paused_at: string | null
          resumed_at: string | null
          archived_at: string | null
          status: 'live' | 'paused' | 'archived'
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          strategy_definition_id?: string | null
          legacy_strategy_id?: string | null
          live_risk_gbp: number
          live_pairs: string[]
          live_max_concurrent_positions?: number
          live_max_daily_loss_gbp?: number | null
          live_max_consecutive_losers?: number | null
          live_order_lifetime_candles?: number
          live_auto_execute_enabled?: boolean
          source_backtest_run_id?: string | null
          source_backtest_summary?: Record<string, unknown> | null
          deployed_at?: string
          paused_at?: string | null
          resumed_at?: string | null
          archived_at?: string | null
          status?: 'live' | 'paused' | 'archived'
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          strategy_definition_id?: string | null
          legacy_strategy_id?: string | null
          live_risk_gbp?: number
          live_pairs?: string[]
          live_max_concurrent_positions?: number
          live_max_daily_loss_gbp?: number | null
          live_max_consecutive_losers?: number | null
          live_order_lifetime_candles?: number
          live_auto_execute_enabled?: boolean
          source_backtest_run_id?: string | null
          source_backtest_summary?: Record<string, unknown> | null
          deployed_at?: string
          paused_at?: string | null
          resumed_at?: string | null
          archived_at?: string | null
          status?: 'live' | 'paused' | 'archived'
        }
        Relationships: []
      }
      live_signals: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          deployment_id: string
          pair: string
          direction: 'long' | 'short'
          signal_at: string
          signal_close_price: number
          intended_entry_price: number
          intended_stop_price: number
          intended_target_price: number
          intended_size_coin: number
          intended_size_usd: number
          intended_risk_gbp: number
          intended_rr: number
          status:
            | 'pending_confirmation'
            | 'confirmed'
            | 'order_placed'
            | 'filled'
            | 'expired_unfilled'
            | 'cancelled'
            | 'closed_at_stop'
            | 'closed_at_target'
            | 'skipped_by_user'
            | 'skipped_max_positions'
            | 'skipped_daily_loss'
            | 'skipped_consecutive_losers'
            | 'failed'
          confirmed_at: string | null
          confirmation_source: 'telegram' | 'app' | 'auto' | null
          expires_at: string | null
          exchange_order_id: string | null
          exchange_stop_order_id: string | null
          exchange_target_order_id: string | null
          filled_at: string | null
          fill_price: number | null
          closed_at: string | null
          exit_price: number | null
          exit_reason: 'stop' | 'target' | 'manual' | 'expired' | null
          realised_pnl_gbp: number | null
          realised_r_multiple: number | null
          journal_trade_id: string | null
          notification_sent_at: string | null
          telegram_sent_at: string | null
          telegram_message_id: string | null
          failure_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          deployment_id: string
          pair: string
          direction: 'long' | 'short'
          signal_at: string
          signal_close_price: number
          intended_entry_price: number
          intended_stop_price: number
          intended_target_price: number
          intended_size_coin: number
          intended_size_usd: number
          intended_risk_gbp: number
          intended_rr: number
          status?:
            | 'pending_confirmation'
            | 'confirmed'
            | 'order_placed'
            | 'filled'
            | 'expired_unfilled'
            | 'cancelled'
            | 'closed_at_stop'
            | 'closed_at_target'
            | 'skipped_by_user'
            | 'skipped_max_positions'
            | 'skipped_daily_loss'
            | 'skipped_consecutive_losers'
            | 'failed'
          confirmed_at?: string | null
          confirmation_source?: 'telegram' | 'app' | 'auto' | null
          expires_at?: string | null
          exchange_order_id?: string | null
          exchange_stop_order_id?: string | null
          exchange_target_order_id?: string | null
          filled_at?: string | null
          fill_price?: number | null
          closed_at?: string | null
          exit_price?: number | null
          exit_reason?: 'stop' | 'target' | 'manual' | 'expired' | null
          realised_pnl_gbp?: number | null
          realised_r_multiple?: number | null
          journal_trade_id?: string | null
          notification_sent_at?: string | null
          telegram_sent_at?: string | null
          telegram_message_id?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          deployment_id?: string
          pair?: string
          direction?: 'long' | 'short'
          signal_at?: string
          signal_close_price?: number
          intended_entry_price?: number
          intended_stop_price?: number
          intended_target_price?: number
          intended_size_coin?: number
          intended_size_usd?: number
          intended_risk_gbp?: number
          intended_rr?: number
          status?:
            | 'pending_confirmation'
            | 'confirmed'
            | 'order_placed'
            | 'filled'
            | 'expired_unfilled'
            | 'cancelled'
            | 'closed_at_stop'
            | 'closed_at_target'
            | 'skipped_by_user'
            | 'skipped_max_positions'
            | 'skipped_daily_loss'
            | 'skipped_consecutive_losers'
            | 'failed'
          confirmed_at?: string | null
          confirmation_source?: 'telegram' | 'app' | 'auto' | null
          expires_at?: string | null
          exchange_order_id?: string | null
          exchange_stop_order_id?: string | null
          exchange_target_order_id?: string | null
          filled_at?: string | null
          fill_price?: number | null
          closed_at?: string | null
          exit_price?: number | null
          exit_reason?: 'stop' | 'target' | 'manual' | 'expired' | null
          realised_pnl_gbp?: number | null
          realised_r_multiple?: number | null
          journal_trade_id?: string | null
          notification_sent_at?: string | null
          telegram_sent_at?: string | null
          telegram_message_id?: string | null
          failure_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      exchange_credentials: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          exchange: 'hyperliquid'
          network: 'testnet' | 'mainnet'
          api_wallet_address: string
          encrypted_private_key: string
          vault_secret_id: string | null
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          exchange: 'hyperliquid'
          network?: 'testnet' | 'mainnet'
          api_wallet_address: string
          encrypted_private_key: string
          vault_secret_id?: string | null
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          exchange?: 'hyperliquid'
          network?: 'testnet' | 'mainnet'
          api_wallet_address?: string
          encrypted_private_key?: string
          vault_secret_id?: string | null
          enabled?: boolean
          created_at?: string
        }
        Relationships: []
      }
      batch_backtest_runs: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          name: string | null
          status: 'pending' | 'running' | 'completed' | 'failed'
          config: Record<string, unknown>
          strategy_definition_ids: string[]
          legacy_strategy_ids: string[]
          created_at: string
          completed_at: string | null
          error_message: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          name?: string | null
          status?: 'pending' | 'running' | 'completed' | 'failed'
          config: Record<string, unknown>
          strategy_definition_ids?: string[]
          legacy_strategy_ids?: string[]
          created_at?: string
          completed_at?: string | null
          error_message?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string
          name?: string | null
          status?: 'pending' | 'running' | 'completed' | 'failed'
          config?: Record<string, unknown>
          strategy_definition_ids?: string[]
          legacy_strategy_ids?: string[]
          created_at?: string
          completed_at?: string | null
          error_message?: string | null
        }
        Relationships: []
      }
      backtest_sweeps: {
        Row: {
          id: string
          tenant_id: string
          name: string
          created_at: string | null
          framework_id: string | null
          timeframe: string
          pairs: string[]
          date_range_start: string
          date_range_end: string
          max_concurrent_positions: number
          max_daily_loss_gbp: number | null
          max_consecutive_losers: number | null
          slippage_pct: number
          maker_fee_pct: number
          taker_fee_pct: number
          assume_taker: boolean
          enable_train_test_split: boolean
          train_split_pct: number
          sweep_dimensions: unknown
          total_combinations: number
          status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          combinations_completed: number
          combinations_failed: number
          run_started_at: string | null
          run_completed_at: string | null
          error_message: string | null
          strategy_definition_id: string | null
          strategy_definition_snapshot: Record<string, unknown> | null
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          created_at?: string | null
          framework_id?: string | null
          timeframe: string
          pairs: string[]
          date_range_start: string
          date_range_end: string
          max_concurrent_positions: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          slippage_pct: number
          maker_fee_pct: number
          taker_fee_pct: number
          assume_taker: boolean
          enable_train_test_split: boolean
          train_split_pct: number
          sweep_dimensions: unknown
          total_combinations: number
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          combinations_completed?: number
          combinations_failed?: number
          run_started_at?: string | null
          run_completed_at?: string | null
          error_message?: string | null
          strategy_definition_id?: string | null
          strategy_definition_snapshot?: Record<string, unknown> | null
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          created_at?: string | null
          framework_id?: string | null
          timeframe?: string
          pairs?: string[]
          date_range_start?: string
          date_range_end?: string
          max_concurrent_positions?: number
          max_daily_loss_gbp?: number | null
          max_consecutive_losers?: number | null
          slippage_pct?: number
          maker_fee_pct?: number
          taker_fee_pct?: number
          assume_taker?: boolean
          enable_train_test_split?: boolean
          train_split_pct?: number
          sweep_dimensions?: unknown
          total_combinations?: number
          status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
          combinations_completed?: number
          combinations_failed?: number
          run_started_at?: string | null
          run_completed_at?: string | null
          error_message?: string | null
          strategy_definition_id?: string | null
          strategy_definition_snapshot?: Record<string, unknown> | null
        }
        Relationships: []
      }
      backtest_trades: {
        Row: {
          id: string
          backtest_run_id: string
          pair: string
          direction: 'long' | 'short'
          entry_at: string
          entry_price: number
          stop_price: number
          target_price: number
          exit_at: string | null
          exit_price: number | null
          exit_reason:
            | 'target_hit'
            | 'stop_hit'
            | 'timeout'
            | 'rules_blocked'
            | 'open_at_period_end'
            | null
          size_coin: number
          size_usd: number
          pnl_usd: number | null
          pnl_gbp: number | null
          r_multiple: number | null
          outcome: 'win' | 'loss' | 'breakeven' | null
          in_train_period: boolean | null
          conditions_at_signal: Record<string, unknown> | null
          gbp_usd_rate_used: number | null
        }
        Insert: {
          id?: string
          backtest_run_id: string
          pair: string
          direction: 'long' | 'short'
          entry_at: string
          entry_price: number
          stop_price: number
          target_price: number
          exit_at?: string | null
          exit_price?: number | null
          exit_reason?:
            | 'target_hit'
            | 'stop_hit'
            | 'timeout'
            | 'rules_blocked'
            | 'open_at_period_end'
            | null
          size_coin: number
          size_usd: number
          pnl_usd?: number | null
          pnl_gbp?: number | null
          r_multiple?: number | null
          outcome?: 'win' | 'loss' | 'breakeven' | null
          in_train_period?: boolean | null
          conditions_at_signal?: Record<string, unknown> | null
          gbp_usd_rate_used?: number | null
        }
        Update: {
          id?: string
          backtest_run_id?: string
          pair?: string
          direction?: 'long' | 'short'
          entry_at?: string
          entry_price?: number
          stop_price?: number
          target_price?: number
          exit_at?: string | null
          exit_price?: number | null
          exit_reason?:
            | 'target_hit'
            | 'stop_hit'
            | 'timeout'
            | 'rules_blocked'
            | 'open_at_period_end'
            | null
          size_coin?: number
          size_usd?: number
          pnl_usd?: number | null
          pnl_gbp?: number | null
          r_multiple?: number | null
          outcome?: 'win' | 'loss' | 'breakeven' | null
          in_train_period?: boolean | null
          conditions_at_signal?: Record<string, unknown> | null
          gbp_usd_rate_used?: number | null
        }
        Relationships: []
      }
      backtest_candles: {
        Row: {
          id: string
          pair: string
          timeframe: string
          candle_open_at: string
          open: number
          high: number
          low: number
          close: number
          volume: number
        }
        Insert: {
          id?: string
          pair: string
          timeframe: string
          candle_open_at: string
          open: number
          high: number
          low: number
          close: number
          volume: number
        }
        Update: {
          id?: string
          pair?: string
          timeframe?: string
          candle_open_at?: string
          open?: number
          high?: number
          low?: number
          close?: number
          volume?: number
        }
        Relationships: []
      }
    }
    Views: {
      daily_pnl: {
        Row: {
          user_id: string | null
          tenant_id: string | null
          trade_date: string | null
          realised_pnl_gbp: number | null
          trades_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      consecutive_loser_count: {
        Args: { p_tenant_id: string }
        Returns: number
      }
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
