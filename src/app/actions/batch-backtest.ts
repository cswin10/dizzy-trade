'use server'

// Side-effect import: populates the strategy condition and exit-
// rule registries before any executeBacktestRunAction call hits
// the engine. Same reason as src/app/actions/strategy-definitions.ts.
import '@/lib/strategies/register'

import { revalidatePath } from 'next/cache'

import {
  createBacktestRunAction,
  executeBacktestRunAction,
} from '@/app/actions/backtest'
import type { BacktestConfigInput } from '@/lib/validations/backtest'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type BatchBacktestActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

type SharedConfig = {
  pairs: string[]
  timeframe: string
  date_range_start: string
  date_range_end: string
  starting_capital_gbp: number
  slippage_pct: number
  maker_fee_pct: number
  taker_fee_pct: number
  assume_taker: boolean
  use_strategy_native_pairs: boolean
}

export type CreateBatchBacktestInput = {
  name: string | null
  shared: SharedConfig
  strategy_definition_ids: string[]
  legacy_strategy_ids: string[]
}

const MAX_STRATEGIES_PER_BATCH = 20
const MIN_STRATEGIES_PER_BATCH = 2

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

// Materialises a batch row, then sequentially kicks off a child
// backtest_runs row per selected strategy. The kicker reuses the
// existing single-backtest action so the engine is exercised the
// same way it always is; the orchestrator just collates results
// under a shared batch_run_id. Sequential execution is intentional:
// engine memory stays bounded and the overall wall time is still
// trivial for the batch sizes we cap at.
//
// Errors on a single strategy do not poison the batch: that
// strategy's backtest_runs row ends in 'failed' (handled inside
// executeBacktestRunAction) and the orchestrator continues with the
// remaining strategies. The batch ends in 'completed' with mixed
// child statuses surfaced in the leaderboard UI.
export async function createBatchBacktestAction(
  input: CreateBatchBacktestInput,
): Promise<BatchBacktestActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const totalStrategies =
    input.strategy_definition_ids.length + input.legacy_strategy_ids.length
  if (totalStrategies < MIN_STRATEGIES_PER_BATCH) {
    return {
      ok: false,
      message: `Pick at least ${MIN_STRATEGIES_PER_BATCH} strategies for a batch.`,
    }
  }
  if (totalStrategies > MAX_STRATEGIES_PER_BATCH) {
    return {
      ok: false,
      message: `Maximum ${MAX_STRATEGIES_PER_BATCH} strategies per batch.`,
    }
  }
  if (
    new Date(input.shared.date_range_end) <=
    new Date(input.shared.date_range_start)
  ) {
    return { ok: false, message: 'End date must be after start date.' }
  }

  const service = createServiceClient()

  // Hydrate strategies in one shot so we can both validate
  // ownership and fold their native pairs/timeframes into each
  // child run when use_strategy_native_pairs is on.
  const [composableRes, legacyRes] = await Promise.all([
    input.strategy_definition_ids.length > 0
      ? service
          .from('strategy_definitions')
          .select('id, name, pairs, timeframe')
          .eq('tenant_id', ctx.tenantId)
          .in('id', input.strategy_definition_ids)
      : { data: [], error: null },
    input.legacy_strategy_ids.length > 0
      ? service
          .from('strategies')
          .select(
            'id, name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
          )
          .in('id', input.legacy_strategy_ids)
      : { data: [], error: null },
  ])
  if (composableRes.error) {
    return { ok: false, message: composableRes.error.message }
  }
  if (legacyRes.error) {
    return { ok: false, message: legacyRes.error.message }
  }
  const composable = composableRes.data ?? []
  const legacy = legacyRes.data ?? []
  if (composable.length !== input.strategy_definition_ids.length) {
    return {
      ok: false,
      message: 'One or more composable strategies could not be found.',
    }
  }
  if (legacy.length !== input.legacy_strategy_ids.length) {
    return {
      ok: false,
      message: 'One or more legacy strategies could not be found.',
    }
  }

  // Per-tenant batch row inserted up front so the user can navigate
  // to its detail page while the children are still running.
  const batchName =
    input.name?.trim() ||
    `Batch ${new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })}`
  const { data: batch, error: insertError } = await service
    .from('batch_backtest_runs')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.user.id,
      name: batchName,
      status: 'running',
      config: { ...input.shared, name: batchName },
      strategy_definition_ids: input.strategy_definition_ids,
      legacy_strategy_ids: input.legacy_strategy_ids,
    })
    .select('id')
    .single()
  if (insertError || !batch) {
    return { ok: false, message: insertError?.message ?? 'Insert failed' }
  }

  const childRunIds: string[] = []
  const failedStrategies: Array<{ name: string; reason: string }> = []

  for (const def of composable) {
    const pairs = input.shared.use_strategy_native_pairs
      ? (def.pairs ?? [])
      : input.shared.pairs
    const timeframe = input.shared.use_strategy_native_pairs
      ? def.timeframe
      : input.shared.timeframe
    if (pairs.length === 0) {
      failedStrategies.push({
        name: def.name,
        reason: 'No pairs configured',
      })
      continue
    }
    const config: BacktestConfigInput = {
      name: `${batchName} · ${def.name}`,
      strategy_definition_id: def.id,
      timeframe: timeframe as BacktestConfigInput['timeframe'],
      pairs,
      risk_amount_gbp: input.shared.starting_capital_gbp,
      min_rr: 1,
      max_concurrent_positions: 5,
      max_daily_loss_gbp: null,
      max_consecutive_losers: null,
      date_range_start: new Date(input.shared.date_range_start),
      date_range_end: new Date(input.shared.date_range_end),
      slippage_pct: input.shared.slippage_pct,
      maker_fee_pct: input.shared.maker_fee_pct,
      taker_fee_pct: input.shared.taker_fee_pct,
      assume_taker: input.shared.assume_taker,
      enable_train_test_split: false,
      train_split_pct: 70,
    }
    const created = await createBacktestRunAction(config)
    if (!created.ok || !created.id) {
      failedStrategies.push({
        name: def.name,
        reason: created.message ?? 'Create failed',
      })
      continue
    }
    childRunIds.push(created.id)
    // Tag the child row with the parent batch id immediately so
    // the leaderboard query finds it even if execute fails later.
    await service
      .from('backtest_runs')
      .update({ batch_run_id: batch.id })
      .eq('id', created.id)
  }

  for (const leg of legacy) {
    const pairs = input.shared.use_strategy_native_pairs
      ? (leg.pair_symbols ?? [])
      : input.shared.pairs
    const timeframe = input.shared.use_strategy_native_pairs
      ? leg.timeframe
      : input.shared.timeframe
    if (pairs.length === 0) {
      failedStrategies.push({
        name: leg.name,
        reason: 'No pairs configured',
      })
      continue
    }
    const config: BacktestConfigInput = {
      name: `${batchName} · ${leg.name}`,
      framework_id: leg.framework_id,
      framework_thresholds: {},
      timeframe: timeframe as BacktestConfigInput['timeframe'],
      pairs,
      risk_amount_gbp:
        leg.risk_amount_gbp != null
          ? Number(leg.risk_amount_gbp)
          : input.shared.starting_capital_gbp,
      min_rr: leg.min_rr != null ? Number(leg.min_rr) : 1,
      max_concurrent_positions: leg.max_concurrent_positions ?? 5,
      max_daily_loss_gbp:
        leg.max_daily_loss_gbp == null ? null : Number(leg.max_daily_loss_gbp),
      max_consecutive_losers: leg.max_consecutive_losers,
      date_range_start: new Date(input.shared.date_range_start),
      date_range_end: new Date(input.shared.date_range_end),
      slippage_pct: input.shared.slippage_pct,
      maker_fee_pct: input.shared.maker_fee_pct,
      taker_fee_pct: input.shared.taker_fee_pct,
      assume_taker: input.shared.assume_taker,
      enable_train_test_split: false,
      train_split_pct: 70,
    }
    const created = await createBacktestRunAction(config)
    if (!created.ok || !created.id) {
      failedStrategies.push({
        name: leg.name,
        reason: created.message ?? 'Create failed',
      })
      continue
    }
    childRunIds.push(created.id)
    await service
      .from('backtest_runs')
      .update({ batch_run_id: batch.id })
      .eq('id', created.id)
  }

  // Sequential execution of every child run. Each call is awaited
  // so memory and Hyperliquid candle-fetch concurrency stays at
  // single-backtest levels. The engine's per-pair candle cache
  // makes subsequent runs in the batch fast: every child after the
  // first reads from cache.
  for (const runId of childRunIds) {
    try {
      await executeBacktestRunAction(runId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failedStrategies.push({ name: runId, reason: message })
    }
  }

  await service
    .from('batch_backtest_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message:
        failedStrategies.length > 0
          ? failedStrategies.map((f) => `${f.name}: ${f.reason}`).join('; ')
          : null,
    })
    .eq('id', batch.id)

  revalidatePath('/backtest')
  revalidatePath('/backtest/batch')
  revalidatePath(`/backtest/batch/${batch.id}`)
  return { ok: true, id: batch.id }
}

export type BatchBacktestSummary = {
  id: string
  name: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  config: Record<string, unknown>
  strategy_count: number
  created_at: string
  completed_at: string | null
}

export async function listBatchBacktestsAction(): Promise<{
  ok: boolean
  rows: BatchBacktestSummary[]
  message?: string
}> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, rows: [], message: ctx.error }
  const service = createServiceClient()
  const { data, error } = await service
    .from('batch_backtest_runs')
    .select(
      'id, name, status, config, strategy_definition_ids, legacy_strategy_ids, created_at, completed_at',
    )
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return { ok: false, rows: [], message: error.message }
  const rows: BatchBacktestSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    config: row.config,
    strategy_count:
      (row.strategy_definition_ids?.length ?? 0) +
      (row.legacy_strategy_ids?.length ?? 0),
    created_at: row.created_at,
    completed_at: row.completed_at,
  }))
  return { ok: true, rows }
}

export type BatchBacktestDetail = {
  batch: {
    id: string
    name: string | null
    status: 'pending' | 'running' | 'completed' | 'failed'
    config: Record<string, unknown>
    strategy_definition_ids: string[]
    legacy_strategy_ids: string[]
    created_at: string
    completed_at: string | null
    error_message: string | null
  }
  runs: Array<{
    id: string
    name: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    framework_id: string | null
    strategy_definition_id: string | null
    total_trades: number | null
    wins: number | null
    losses: number | null
    win_rate: number | null
    avg_r: number | null
    total_pnl_gbp: number | null
    max_drawdown_gbp: number | null
    sharpe_ratio: number | null
    longest_losing_streak: number | null
    expectancy_per_trade_gbp: number | null
    // Headline-only summary for the leaderboard's zero-signal
    // indicator. Full diagnostics live on the detail page.
    diagnostics_summary: {
      evaluations_total: number
      warmup_candles_used: number
      warmup_param_max: number
      top_failure_type: string | null
      top_failure_count: number
      top_failure_insufficient_data: boolean
    } | null
  }>
}

export async function getBatchBacktestAction(
  id: string,
): Promise<
  { ok: true; data: BatchBacktestDetail } | { ok: false; message: string }
> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const [batchRes, runsRes] = await Promise.all([
    service
      .from('batch_backtest_runs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .single(),
    service
      .from('backtest_runs')
      .select(
        'id, name, status, framework_id, strategy_definition_id, total_trades, wins, losses, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio, longest_losing_streak, expectancy_per_trade_gbp, diagnostics',
      )
      .eq('batch_run_id', id)
      .order('total_pnl_gbp', { ascending: false, nullsFirst: false }),
  ])
  if (batchRes.error || !batchRes.data) {
    return { ok: false, message: batchRes.error?.message ?? 'Batch not found' }
  }
  if (runsRes.error) {
    return { ok: false, message: runsRes.error.message }
  }
  const batch = batchRes.data
  return {
    ok: true,
    data: {
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        config: batch.config,
        strategy_definition_ids: batch.strategy_definition_ids ?? [],
        legacy_strategy_ids: batch.legacy_strategy_ids ?? [],
        created_at: batch.created_at,
        completed_at: batch.completed_at,
        error_message: batch.error_message,
      },
      runs: (runsRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        framework_id: row.framework_id,
        strategy_definition_id: row.strategy_definition_id,
        total_trades: row.total_trades,
        wins: row.wins,
        losses: row.losses,
        win_rate: row.win_rate == null ? null : Number(row.win_rate),
        avg_r: row.avg_r == null ? null : Number(row.avg_r),
        total_pnl_gbp:
          row.total_pnl_gbp == null ? null : Number(row.total_pnl_gbp),
        max_drawdown_gbp:
          row.max_drawdown_gbp == null ? null : Number(row.max_drawdown_gbp),
        sharpe_ratio:
          row.sharpe_ratio == null ? null : Number(row.sharpe_ratio),
        longest_losing_streak: row.longest_losing_streak,
        expectancy_per_trade_gbp:
          row.expectancy_per_trade_gbp == null
            ? null
            : Number(row.expectancy_per_trade_gbp),
        diagnostics_summary: summariseDiagnostics(row.diagnostics),
      })),
    },
  }
}

// Reduces the full BacktestDiagnostics payload to the headline
// fields the leaderboard actually renders. Keeps the leaderboard
// query response small while still letting the UI explain why a
// run produced zero signals without a second round trip.
function summariseDiagnostics(
  raw: unknown,
): BatchBacktestDetail['runs'][number]['diagnostics_summary'] {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as {
    evaluations_total?: unknown
    warmup_candles_used?: unknown
    warmup_param_max?: unknown
    condition_failure_breakdown?: unknown
    condition_insufficient_data?: unknown
  }
  const breakdown =
    d.condition_failure_breakdown && typeof d.condition_failure_breakdown === 'object'
      ? (d.condition_failure_breakdown as Record<string, number>)
      : {}
  const insufficient =
    d.condition_insufficient_data && typeof d.condition_insufficient_data === 'object'
      ? (d.condition_insufficient_data as Record<string, number>)
      : {}
  let topType: string | null = null
  let topCount = 0
  for (const [type, count] of Object.entries(breakdown)) {
    if (typeof count === 'number' && count > topCount) {
      topType = type
      topCount = count
    }
  }
  return {
    evaluations_total:
      typeof d.evaluations_total === 'number' ? d.evaluations_total : 0,
    warmup_candles_used:
      typeof d.warmup_candles_used === 'number' ? d.warmup_candles_used : 0,
    warmup_param_max:
      typeof d.warmup_param_max === 'number' ? d.warmup_param_max : 0,
    top_failure_type: topType,
    top_failure_count: topCount,
    top_failure_insufficient_data:
      topType !== null &&
      (insufficient[topType] ?? 0) > topCount / 2,
  }
}

// Equity curve overlay loader. Fetches every trade for every run
// in the batch, computes cumulative PnL at each exit timestamp,
// and returns one series per run keyed by run id. The chart
// component on the detail page walks these in render-time.
export async function getBatchEquityCurvesAction(id: string): Promise<{
  ok: boolean
  series: Array<{
    run_id: string
    name: string
    points: Array<{ t: number; pnl: number }>
  }>
  message?: string
}> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, series: [], message: ctx.error }
  const service = createServiceClient()
  const { data: runs, error: runsError } = await service
    .from('backtest_runs')
    .select('id, name')
    .eq('batch_run_id', id)
    .eq('tenant_id', ctx.tenantId)
  if (runsError) return { ok: false, series: [], message: runsError.message }

  const out: Array<{
    run_id: string
    name: string
    points: Array<{ t: number; pnl: number }>
  }> = []
  for (const run of runs ?? []) {
    const { data: trades } = await service
      .from('backtest_trades')
      .select('exit_at, pnl_gbp')
      .eq('backtest_run_id', run.id)
      .not('exit_at', 'is', null)
      .order('exit_at', { ascending: true })
    let cumulative = 0
    const points: Array<{ t: number; pnl: number }> = []
    for (const trade of trades ?? []) {
      if (!trade.exit_at) continue
      cumulative += Number(trade.pnl_gbp ?? 0)
      points.push({ t: Date.parse(trade.exit_at), pnl: cumulative })
    }
    out.push({ run_id: run.id, name: run.name, points })
  }
  return { ok: true, series: out }
}

export async function deleteBatchBacktestAction(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const { error } = await service
    .from('batch_backtest_runs')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, message: error.message }
  revalidatePath('/backtest/batch')
  return { ok: true }
}
