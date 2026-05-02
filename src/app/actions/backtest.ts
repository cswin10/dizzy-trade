'use server'

import { revalidatePath } from 'next/cache'

import { runBacktest } from '@/lib/backtest/engine'
import {
  computeMetrics,
  computeSplitMetrics,
  isInTrainPeriod,
} from '@/lib/backtest/metrics'
import type { BacktestConfig, BacktestTimeframe } from '@/lib/backtest/types'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  backtestConfigInputSchema,
  type BacktestConfigInput,
} from '@/lib/validations/backtest'

export type BacktestActionResult = {
  ok: boolean
  message?: string
  id?: string
}

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (membershipError)
    return { ok: false as const, error: membershipError.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }

  return { ok: true as const, user, tenantId }
}

function firstMessage(error: { errors?: { message: string }[] }): string {
  return error.errors?.[0]?.message ?? 'Invalid backtest config'
}

// Inserts the run row in `pending` status and returns its id. The
// engine kicks off in a separate action so this insert never blocks
// on a long-running simulation.
export async function createBacktestRunAction(
  input: BacktestConfigInput,
): Promise<BacktestActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const parsed = backtestConfigInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }
  const cfg = parsed.data

  const service = createServiceClient()

  // Composable runs snapshot the strategy_definition at create
  // time so a later edit or delete of the source row does not
  // retroactively change historical results. The engine reads
  // from the snapshot column, never from the live row.
  let strategySnapshot: Record<string, unknown> | null = null
  if (cfg.strategy_definition_id) {
    const { data: defRow, error: defError } = await service
      .from('strategy_definitions')
      .select('definition')
      .eq('id', cfg.strategy_definition_id)
      .eq('tenant_id', ctx.tenantId)
      .single()
    if (defError || !defRow) {
      return {
        ok: false,
        message: defError?.message ?? 'Strategy definition not found',
      }
    }
    strategySnapshot = defRow.definition as Record<string, unknown>
  }

  const { data, error } = await service
    .from('backtest_runs')
    .insert({
      tenant_id: ctx.tenantId,
      name: cfg.name,
      framework_id: cfg.framework_id ?? null,
      framework_thresholds: cfg.framework_thresholds ?? {},
      strategy_definition_id: cfg.strategy_definition_id ?? null,
      strategy_definition_snapshot: strategySnapshot,
      timeframe: cfg.timeframe,
      pairs: cfg.pairs,
      risk_amount_gbp: cfg.risk_amount_gbp,
      min_rr: cfg.min_rr,
      max_concurrent_positions: cfg.max_concurrent_positions,
      max_daily_loss_gbp: cfg.max_daily_loss_gbp,
      max_consecutive_losers: cfg.max_consecutive_losers,
      date_range_start: cfg.date_range_start.toISOString(),
      date_range_end: cfg.date_range_end.toISOString(),
      slippage_pct: cfg.slippage_pct,
      maker_fee_pct: cfg.maker_fee_pct,
      taker_fee_pct: cfg.taker_fee_pct,
      assume_taker: cfg.assume_taker,
      enable_train_test_split: cfg.enable_train_test_split,
      train_split_pct: cfg.train_split_pct,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) return { ok: false, message: error.message }

  revalidatePath('/backtest')
  return { ok: true, id: data?.id }
}

// Loads a run, executes the engine against its config, writes the
// resulting trades and aggregate metrics back to the run row. Marks
// the run failed (with the error message) if anything throws so the
// UI can surface it cleanly. Caller should treat this as a
// long-running action and show a loading state.
export async function executeBacktestRunAction(
  runId: string,
): Promise<BacktestActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data: run, error: loadError } = await service
    .from('backtest_runs')
    .select('*')
    .eq('id', runId)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (loadError || !run) {
    return { ok: false, message: loadError?.message ?? 'Run not found' }
  }
  if (run.status === 'running') {
    return { ok: false, message: 'Run is already in progress' }
  }
  if (run.status === 'completed') {
    return { ok: true, id: runId }
  }

  await service
    .from('backtest_runs')
    .update({
      status: 'running',
      run_started_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', runId)

  try {
    const config: BacktestConfig = {
      framework_id: run.framework_id ?? undefined,
      framework_thresholds: run.framework_thresholds,
      strategy_definition_id: run.strategy_definition_id ?? undefined,
      strategy_definition_snapshot: run.strategy_definition_snapshot
        ? (run.strategy_definition_snapshot as unknown as StrategyDefinition)
        : undefined,
      timeframe: run.timeframe as BacktestTimeframe,
      pairs: run.pairs,
      risk_amount_gbp: Number(run.risk_amount_gbp),
      min_rr: Number(run.min_rr),
      max_concurrent_positions: run.max_concurrent_positions,
      max_daily_loss_gbp:
        run.max_daily_loss_gbp == null ? null : Number(run.max_daily_loss_gbp),
      max_consecutive_losers: run.max_consecutive_losers,
      date_range_start: new Date(run.date_range_start),
      date_range_end: new Date(run.date_range_end),
      slippage_pct: Number(run.slippage_pct),
      maker_fee_pct: Number(run.maker_fee_pct),
      taker_fee_pct: Number(run.taker_fee_pct),
      assume_taker: run.assume_taker,
    }

    const result = await runBacktest(config)
    const tradeRows = result.trades.map((trade) => ({
      backtest_run_id: runId,
      pair: trade.pair,
      direction: trade.direction,
      entry_at: trade.entry_at.toISOString(),
      entry_price: trade.entry_price,
      stop_price: trade.stop_price,
      target_price: trade.target_price,
      exit_at: trade.exit_at ? trade.exit_at.toISOString() : null,
      exit_price: trade.exit_price,
      exit_reason: trade.exit_reason,
      size_coin: trade.size_coin,
      size_usd: trade.size_usd,
      pnl_usd: trade.pnl_usd,
      pnl_gbp: trade.pnl_gbp,
      r_multiple: trade.r_multiple,
      outcome: trade.outcome,
      in_train_period: run.enable_train_test_split
        ? isInTrainPeriod(
            trade.entry_at,
            config.date_range_start,
            config.date_range_end,
            Number(run.train_split_pct),
          )
        : null,
      conditions_at_signal: trade.conditions_at_signal,
      gbp_usd_rate_used: result.gbp_usd_rate_used,
    }))
    if (tradeRows.length > 0) {
      const chunkSize = 500
      for (let i = 0; i < tradeRows.length; i += chunkSize) {
        const chunk = tradeRows.slice(i, i + chunkSize)
        const { error: insertError } = await service
          .from('backtest_trades')
          .insert(chunk)
        if (insertError) throw new Error(insertError.message)
      }
    }

    const metrics = computeMetrics(result.trades, run.timeframe)

    let trainMetrics: Record<string, unknown> | null = null
    let testMetrics: Record<string, unknown> | null = null
    let overfit: boolean | null = null
    if (run.enable_train_test_split) {
      const split = computeSplitMetrics(
        result.trades,
        config.date_range_start,
        config.date_range_end,
        Number(run.train_split_pct),
        run.timeframe,
      )
      trainMetrics = split.train as unknown as Record<string, unknown>
      testMetrics = split.test as unknown as Record<string, unknown>
      overfit = split.overfit_warning_triggered
    }

    const { error: updateError } = await service
      .from('backtest_runs')
      .update({
        status: 'completed',
        run_completed_at: new Date().toISOString(),
        total_signals: result.signals_total,
        total_trades: metrics.total_trades,
        wins: metrics.wins,
        losses: metrics.losses,
        breakevens: metrics.breakevens,
        win_rate: metrics.win_rate,
        avg_r: metrics.avg_r,
        total_pnl_gbp: metrics.total_pnl_gbp,
        max_drawdown_gbp: metrics.max_drawdown_gbp,
        max_drawdown_pct: metrics.max_drawdown_pct,
        sharpe_ratio: metrics.sharpe_ratio,
        longest_losing_streak: metrics.longest_losing_streak,
        expectancy_per_trade_gbp: metrics.expectancy_per_trade_gbp,
        train_metrics: trainMetrics,
        test_metrics: testMetrics,
        overfit_warning_triggered: overfit,
        gbp_usd_rate_used: result.gbp_usd_rate_used,
        diagnostics: result.diagnostics,
      })
      .eq('id', runId)
    if (updateError) throw new Error(updateError.message)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await service
      .from('backtest_runs')
      .update({
        status: 'failed',
        error_message: message,
        run_completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
    return { ok: false, message, id: runId }
  }

  revalidatePath('/backtest')
  revalidatePath(`/backtest/${runId}`)
  return { ok: true, id: runId }
}

export async function deleteBacktestRunAction(
  runId: string,
): Promise<BacktestActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { error } = await service
    .from('backtest_runs')
    .delete()
    .eq('id', runId)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/backtest')
  return { ok: true, id: runId }
}
