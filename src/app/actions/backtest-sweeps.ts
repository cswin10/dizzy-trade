'use server'

import { revalidatePath } from 'next/cache'

import { ensureCandles } from '@/lib/backtest/candles'
import { runBacktest } from '@/lib/backtest/engine'
import {
  computeMetrics,
  computeSplitMetrics,
  isInTrainPeriod,
} from '@/lib/backtest/metrics'
import {
  applyCombination,
  applyCombinationToDefinition,
  expandSweepDimensions,
  validateDimensionPaths,
  type SweepCombination,
  type SweepDimension,
} from '@/lib/backtest/sweep'
import { validateStrategyDefinition } from '@/lib/strategies/schema'
import {
  type BacktestConfig,
  type BacktestTimeframe,
} from '@/lib/backtest/types'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  sweepConfigInputSchema,
  type SweepConfigInput,
} from '@/lib/validations/backtest-sweeps'

export type SweepActionResult = {
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
  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false as const, error: error.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }
  return { ok: true as const, user, tenantId }
}

function firstMessage(error: { errors?: { message: string }[] }): string {
  return error.errors?.[0]?.message ?? 'Invalid sweep config'
}

// Creates the sweep row, expands the cartesian product, and
// pre-creates one backtest_runs row per combination so the
// orchestrator can simply pick the next pending run on each tick.
// All inserts go through the service role; RLS is enforced via the
// tenant_id we resolved up front.
export async function createSweepAction(
  input: SweepConfigInput,
): Promise<SweepActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const parsed = sweepConfigInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }
  const cfg = parsed.data

  let combinations: SweepCombination[]
  try {
    combinations = expandSweepDimensions(cfg.dimensions as SweepDimension[])
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const service = createServiceClient()

  // Composable sweeps need a snapshot of the source definition
  // taken at create time. Path validation is done up front: a
  // typo'd dimension path would silently produce identical runs
  // (every applyCombinationToDefinition would no-op), which is
  // worse than an error.
  let definitionSnapshot: Record<string, unknown> | undefined
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
    let parsedDef
    try {
      parsedDef = validateStrategyDefinition(defRow.definition)
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `Strategy definition is invalid: ${error.message}`
            : 'Strategy definition is invalid',
      }
    }
    const pathErrors = validateDimensionPaths(
      parsedDef,
      cfg.dimensions as SweepDimension[],
    )
    if (pathErrors.length > 0) {
      return { ok: false, message: pathErrors.join('; ') }
    }
    definitionSnapshot = parsedDef as unknown as Record<string, unknown>
  }

  const { data: sweep, error: sweepError } = await service
    .from('backtest_sweeps')
    .insert({
      tenant_id: ctx.tenantId,
      name: cfg.name,
      framework_id: cfg.framework_id ?? null,
      strategy_definition_id: cfg.strategy_definition_id ?? null,
      strategy_definition_snapshot: definitionSnapshot ?? null,
      timeframe: cfg.timeframe,
      pairs: cfg.pairs,
      date_range_start: cfg.date_range_start.toISOString(),
      date_range_end: cfg.date_range_end.toISOString(),
      max_concurrent_positions: cfg.max_concurrent_positions,
      max_daily_loss_gbp: cfg.max_daily_loss_gbp,
      max_consecutive_losers: cfg.max_consecutive_losers,
      slippage_pct: cfg.slippage_pct,
      maker_fee_pct: cfg.maker_fee_pct,
      taker_fee_pct: cfg.taker_fee_pct,
      assume_taker: cfg.assume_taker,
      enable_train_test_split: cfg.enable_train_test_split,
      train_split_pct: cfg.train_split_pct,
      sweep_dimensions: cfg.dimensions,
      total_combinations: combinations.length,
      status: 'pending',
    })
    .select('id')
    .single()
  if (sweepError || !sweep) {
    return { ok: false, message: sweepError?.message ?? 'Insert failed' }
  }

  // Materialise per-combination run rows. Two source-specific
  // branches: framework sweeps merge flat keys via applyCombination;
  // composable sweeps deep-merge into a fresh strategy_definition
  // snapshot via applyCombinationToDefinition.
  const runRows = combinations.map((combo, index) => {
    if (cfg.strategy_definition_id) {
      const variant = applyCombinationToDefinition(
        // definitionSnapshot is set whenever strategy_definition_id is
        validateStrategyDefinition(definitionSnapshot!),
        combo,
      )
      return {
        tenant_id: ctx.tenantId,
        name: `${cfg.name} #${index + 1}`,
        framework_id: null,
        strategy_definition_id: cfg.strategy_definition_id,
        strategy_definition_snapshot: variant as unknown as Record<
          string,
          unknown
        >,
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
        status: 'pending' as const,
        sweep_id: sweep.id,
        sweep_combination_index: index,
        sweep_combination_values: combo as Record<string, unknown>,
      }
    }
    const base = {
      framework_thresholds: cfg.framework_thresholds ?? {},
      risk_amount_gbp: cfg.risk_amount_gbp,
      min_rr: cfg.min_rr,
      max_concurrent_positions: cfg.max_concurrent_positions,
      max_daily_loss_gbp: cfg.max_daily_loss_gbp,
      max_consecutive_losers: cfg.max_consecutive_losers,
      slippage_pct: cfg.slippage_pct,
      maker_fee_pct: cfg.maker_fee_pct,
      taker_fee_pct: cfg.taker_fee_pct,
      assume_taker: cfg.assume_taker,
    }
    const merged = applyCombination(base, combo)
    return {
      tenant_id: ctx.tenantId,
      name: `${cfg.name} #${index + 1}`,
      framework_id: cfg.framework_id ?? null,
      strategy_definition_id: null,
      strategy_definition_snapshot: null,
      framework_thresholds: merged.framework_thresholds,
      timeframe: cfg.timeframe,
      pairs: cfg.pairs,
      risk_amount_gbp: merged.risk_amount_gbp,
      min_rr: merged.min_rr,
      max_concurrent_positions: merged.max_concurrent_positions,
      max_daily_loss_gbp: merged.max_daily_loss_gbp,
      max_consecutive_losers: merged.max_consecutive_losers,
      date_range_start: cfg.date_range_start.toISOString(),
      date_range_end: cfg.date_range_end.toISOString(),
      slippage_pct: merged.slippage_pct,
      maker_fee_pct: merged.maker_fee_pct,
      taker_fee_pct: merged.taker_fee_pct,
      assume_taker: merged.assume_taker,
      enable_train_test_split: cfg.enable_train_test_split,
      train_split_pct: cfg.train_split_pct,
      status: 'pending' as const,
      sweep_id: sweep.id,
      sweep_combination_index: index,
      sweep_combination_values: combo as Record<string, unknown>,
    }
  })

  // Insert in chunks: large sweeps could otherwise produce a single
  // 200-row insert payload that bumps into request size limits on
  // older clients. 50 is comfortable.
  const chunkSize = 50
  for (let i = 0; i < runRows.length; i += chunkSize) {
    const chunk = runRows.slice(i, i + chunkSize)
    const { error } = await service.from('backtest_runs').insert(chunk)
    if (error) {
      // Roll back: delete the sweep so the user can retry without
      // an orphaned half-built run set hanging around.
      await service.from('backtest_sweeps').delete().eq('id', sweep.id)
      return { ok: false, message: error.message }
    }
  }

  revalidatePath('/backtest')
  revalidatePath('/backtest/sweeps')
  return { ok: true, id: sweep.id }
}

// Runs one combination end-to-end: fetches the run row, executes the
// engine, writes trades and metrics. Mirrors executeBacktestRunAction
// but inlined so the sweep orchestrator does not have to chain server
// actions (Next.js does not parallelise nested server-action calls
// nicely, and we want Promise.all-style fan-out).
async function processSingleRun(
  runId: string,
  tenantId: string,
): Promise<{
  ok: boolean
  failed: boolean
  message?: string
}> {
  const service = createServiceClient()
  const { data: run, error: loadError } = await service
    .from('backtest_runs')
    .select('*')
    .eq('id', runId)
    .eq('tenant_id', tenantId)
    .single()
  if (loadError || !run) {
    return {
      ok: false,
      failed: true,
      message: loadError?.message ?? 'Run not found',
    }
  }
  if (run.status !== 'pending') {
    return { ok: true, failed: false, message: 'already processed' }
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
        const { error } = await service.from('backtest_trades').insert(chunk)
        if (error) throw new Error(error.message)
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
    return { ok: true, failed: false }
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
    return { ok: false, failed: true, message }
  }
}

// Picks the next batch of pending runs in this sweep and runs them
// in parallel. Returns the updated sweep snapshot so the client can
// re-render without an extra getSweep round trip.
//
// The orchestrator is intentionally pull-based: the client polls,
// triggers batches when there is work outstanding, and stops when
// the sweep is done. There is no server-side scheduler. If the user
// closes the tab the sweep simply pauses; on next visit, the polling
// resumes from wherever it left off.
export async function processNextSweepBatchAction(
  sweepId: string,
  batchSize = 5,
): Promise<SweepActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data: sweep, error: loadError } = await service
    .from('backtest_sweeps')
    .select(
      'id, status, combinations_completed, combinations_failed, total_combinations, pairs, timeframe, date_range_start, date_range_end',
    )
    .eq('id', sweepId)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (loadError || !sweep) {
    return { ok: false, message: loadError?.message ?? 'Sweep not found' }
  }
  if (sweep.status === 'cancelled' || sweep.status === 'completed') {
    return { ok: true, id: sweepId }
  }

  if (sweep.status === 'pending') {
    await service
      .from('backtest_sweeps')
      .update({ status: 'running', run_started_at: new Date().toISOString() })
      .eq('id', sweepId)
  }

  // Warm the candle cache before every batch, not just the first.
  // The cache lookup is near-instant once the data is populated, so
  // calling ensureCandles here is effectively free on subsequent
  // batches. The point is that any partial gap left over from a
  // previous warmup (e.g. a brief network burp on one pair) gets
  // filled here, serialised through this loop, rather than racing
  // across the parallel runBacktest calls in the batch and tripping
  // the rate limit. Every combination in a sweep shares the same
  // pairs, timeframe, and date range, so warming once per batch
  // covers every run that follows.
  try {
    const start = new Date(sweep.date_range_start)
    const end = new Date(sweep.date_range_end)
    for (const pair of sweep.pairs) {
      await ensureCandles(
        pair,
        sweep.timeframe as BacktestTimeframe,
        start,
        end,
      )
    }
  } catch (error) {
    // A warmup failure is not fatal: each individual combination
    // will retry the fetch on its own. Log via error_message and
    // proceed; the per-run error reporting will surface anything
    // that ultimately stays broken.
    const message = error instanceof Error ? error.message : String(error)
    await service
      .from('backtest_sweeps')
      .update({ error_message: `Cache warmup: ${message}` })
      .eq('id', sweepId)
  }

  const safeBatchSize = Math.max(1, Math.min(10, Math.floor(batchSize)))
  const { data: pendingRuns, error: pendingError } = await service
    .from('backtest_runs')
    .select('id')
    .eq('sweep_id', sweepId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'pending')
    .order('sweep_combination_index', { ascending: true })
    .limit(safeBatchSize)
  if (pendingError) {
    return { ok: false, message: pendingError.message }
  }

  if (!pendingRuns || pendingRuns.length === 0) {
    // No pending runs left. Roll the sweep up to completed if all
    // its children have reached a terminal state.
    const { count: stillPending } = await service
      .from('backtest_runs')
      .select('id', { count: 'exact', head: true })
      .eq('sweep_id', sweepId)
      .eq('status', 'pending')
    const { count: stillRunning } = await service
      .from('backtest_runs')
      .select('id', { count: 'exact', head: true })
      .eq('sweep_id', sweepId)
      .eq('status', 'running')
    if ((stillPending ?? 0) === 0 && (stillRunning ?? 0) === 0) {
      await service
        .from('backtest_sweeps')
        .update({
          status: 'completed',
          run_completed_at: new Date().toISOString(),
        })
        .eq('id', sweepId)
    }
    revalidatePath(`/backtest/sweeps/${sweepId}`)
    return { ok: true, id: sweepId }
  }

  const results = await Promise.all(
    pendingRuns.map((row) => processSingleRun(row.id, ctx.tenantId)),
  )
  const completedDelta = results.filter((r) => r.ok && !r.failed).length
  const failedDelta = results.filter((r) => r.failed).length

  // Re-read counters and increment atomically by writing the new
  // totals. supabase-js does not expose row-level increment, so a
  // read-modify-write is the simplest approach. Race risk between
  // concurrent batches is handled by the client driver only ever
  // having one batch in flight at a time.
  const { data: latest } = await service
    .from('backtest_sweeps')
    .select('combinations_completed, combinations_failed')
    .eq('id', sweepId)
    .single()
  const newCompleted = (latest?.combinations_completed ?? 0) + completedDelta
  const newFailed = (latest?.combinations_failed ?? 0) + failedDelta

  await service
    .from('backtest_sweeps')
    .update({
      combinations_completed: newCompleted,
      combinations_failed: newFailed,
    })
    .eq('id', sweepId)

  // Mark the sweep complete if this batch finished off the work.
  if (newCompleted + newFailed >= sweep.total_combinations) {
    await service
      .from('backtest_sweeps')
      .update({
        status: 'completed',
        run_completed_at: new Date().toISOString(),
      })
      .eq('id', sweepId)
  }

  revalidatePath(`/backtest/sweeps/${sweepId}`)
  return { ok: true, id: sweepId }
}

export async function cancelSweepAction(
  sweepId: string,
): Promise<SweepActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('backtest_sweeps')
    .update({
      status: 'cancelled',
      run_completed_at: new Date().toISOString(),
    })
    .eq('id', sweepId)
    .eq('tenant_id', ctx.tenantId)
  if (updateError) return { ok: false, message: updateError.message }

  await service
    .from('backtest_runs')
    .update({ status: 'cancelled' })
    .eq('sweep_id', sweepId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'pending')

  revalidatePath(`/backtest/sweeps/${sweepId}`)
  return { ok: true, id: sweepId }
}

export async function deleteSweepAction(
  sweepId: string,
): Promise<SweepActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { error } = await service
    .from('backtest_sweeps')
    .delete()
    .eq('id', sweepId)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/backtest')
  revalidatePath('/backtest/sweeps')
  return { ok: true, id: sweepId }
}
