'use server'

// Walk-forward backtesting orchestrator. Runs the existing
// backtest engine over a sequence of rolling windows for the same
// strategy, then aggregates per-window metrics into a parent
// summary the operator can use to judge whether edge persists
// across the date range or only printed money in one outlier
// window. Each child window is a normal public.backtest_runs row
// linked back via walk_forward_runs.child_run_ids.
//
// The engine itself is unchanged: this action is glue.

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  backtestConfigInputSchema,
  type BacktestConfigInput,
} from '@/lib/validations/backtest'

import {
  createBacktestRunAction,
  executeBacktestRunAction,
} from './backtest'

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

export type WalkForwardActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

export type ExecuteWalkForwardInput = {
  strategy_id: string
  total_start: string
  total_end: string
  window_size_days: number
  step_size_days: number
  // The remaining fields mirror BacktestConfigInput so each child
  // run inherits the same config.
  pairs: string[]
  timeframe: BacktestConfigInput['timeframe']
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  slippage_pct: number
  maker_fee_pct: number
  taker_fee_pct: number
  assume_taker: boolean
  enable_train_test_split?: boolean
  train_split_pct?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Walks the [total_start, total_end] range producing
// [window_start, window_end] segments stepped by step_size_days.
// First window starts at total_start; subsequent windows step
// forward by step_size; the last window's end is clamped to
// total_end.
function computeWalkForwardWindows(
  totalStart: Date,
  totalEnd: Date,
  windowSizeDays: number,
  stepSizeDays: number,
): Array<{ start: Date; end: Date }> {
  if (windowSizeDays <= 0 || stepSizeDays <= 0) return []
  const totalEndMs = totalEnd.getTime()
  const windows: Array<{ start: Date; end: Date }> = []
  const winMs = windowSizeDays * MS_PER_DAY
  const stepMs = stepSizeDays * MS_PER_DAY
  let cursor = totalStart.getTime()
  while (cursor + winMs <= totalEndMs) {
    windows.push({
      start: new Date(cursor),
      end: new Date(cursor + winMs),
    })
    cursor += stepMs
  }
  return windows
}

export async function executeWalkForwardRunAction(
  input: ExecuteWalkForwardInput,
): Promise<WalkForwardActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  if (input.window_size_days <= 0) {
    return { ok: false, message: 'window_size_days must be > 0' }
  }
  if (input.step_size_days <= 0) {
    return { ok: false, message: 'step_size_days must be > 0' }
  }
  const totalStart = new Date(input.total_start)
  const totalEnd = new Date(input.total_end)
  if (
    !Number.isFinite(totalStart.getTime()) ||
    !Number.isFinite(totalEnd.getTime())
  ) {
    return { ok: false, message: 'Invalid total_start / total_end dates' }
  }
  if (totalEnd.getTime() <= totalStart.getTime()) {
    return { ok: false, message: 'total_end must be after total_start' }
  }
  const windows = computeWalkForwardWindows(
    totalStart,
    totalEnd,
    input.window_size_days,
    input.step_size_days,
  )
  if (windows.length === 0) {
    return {
      ok: false,
      message: `No windows fit (${input.window_size_days}d window with ${input.step_size_days}d step over the chosen range)`,
    }
  }

  const service = createServiceClient()
  const parentConfig: Record<string, unknown> = {
    strategy_id: input.strategy_id,
    total_start: input.total_start,
    total_end: input.total_end,
    window_size_days: input.window_size_days,
    step_size_days: input.step_size_days,
    pairs: input.pairs,
    timeframe: input.timeframe,
    risk_amount_gbp: input.risk_amount_gbp,
    min_rr: input.min_rr,
    max_concurrent_positions: input.max_concurrent_positions,
    max_daily_loss_gbp: input.max_daily_loss_gbp,
    max_consecutive_losers: input.max_consecutive_losers,
    slippage_pct: input.slippage_pct,
    maker_fee_pct: input.maker_fee_pct,
    taker_fee_pct: input.taker_fee_pct,
    assume_taker: input.assume_taker,
  }

  const { data: parent, error: parentError } = await service
    .from('walk_forward_runs')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.user.id,
      strategy_id: input.strategy_id,
      parent_config: parentConfig,
      window_size_days: input.window_size_days,
      step_size_days: input.step_size_days,
      status: 'running',
    })
    .select('id')
    .single()
  if (parentError || !parent) {
    return {
      ok: false,
      message: parentError?.message ?? 'Walk-forward parent insert failed',
    }
  }
  const parentId = parent.id

  const childRunIds: string[] = []
  try {
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!
      const childConfig: BacktestConfigInput = {
        name: `Walk-forward ${i + 1}/${windows.length} (${w.start
          .toISOString()
          .slice(0, 10)} → ${w.end.toISOString().slice(0, 10)})`,
        strategy_definition_id: input.strategy_id,
        timeframe: input.timeframe,
        pairs: input.pairs,
        risk_amount_gbp: input.risk_amount_gbp,
        min_rr: input.min_rr,
        max_concurrent_positions: input.max_concurrent_positions,
        max_daily_loss_gbp: input.max_daily_loss_gbp,
        max_consecutive_losers: input.max_consecutive_losers,
        date_range_start: w.start,
        date_range_end: w.end,
        slippage_pct: input.slippage_pct,
        maker_fee_pct: input.maker_fee_pct,
        taker_fee_pct: input.taker_fee_pct,
        assume_taker: input.assume_taker,
        // Walk-forward windows are short by definition; train/test
        // split inside a single window is meaningless. Disable.
        enable_train_test_split: false,
        train_split_pct: 70,
      }
      // Validate the child config the same way the standard
      // backtest path does so any mistake surfaces with a clear
      // message rather than mid-engine.
      const parsed = backtestConfigInputSchema.safeParse(childConfig)
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? 'Child config invalid',
        )
      }
      const created = await createBacktestRunAction(parsed.data)
      if (!created.ok || !created.id) {
        throw new Error(
          created.message ?? 'Child createBacktestRunAction failed',
        )
      }
      childRunIds.push(created.id)
      await service
        .from('walk_forward_runs')
        .update({ child_run_ids: childRunIds })
        .eq('id', parentId)
        .eq('tenant_id', ctx.tenantId)

      const executed = await executeBacktestRunAction(created.id)
      if (!executed.ok) {
        // Continue to the next window - one bad window should not
        // poison the parent. The summary will surface the gap.
        console.warn(
          `[walk-forward ${parentId}] child ${created.id} failed:`,
          executed.message,
        )
      }
    }

    // Aggregate. Pull each child's summary columns and compute the
    // parent stats in one pass.
    const { data: childRows } = await service
      .from('backtest_runs')
      .select(
        'id, status, total_trades, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio, date_range_start, date_range_end',
      )
      .in('id', childRunIds)
    const summary = aggregateWalkForward(childRows ?? [])

    await service
      .from('walk_forward_runs')
      .update({
        status: 'complete',
        summary,
        completed_at: new Date().toISOString(),
      })
      .eq('id', parentId)
      .eq('tenant_id', ctx.tenantId)

    revalidatePath('/backtest')
    revalidatePath(`/backtest/walk-forward/${parentId}`)
    return { ok: true, id: parentId }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Walk-forward run failed'
    await service
      .from('walk_forward_runs')
      .update({
        status: 'failed',
        error_message: message,
        child_run_ids: childRunIds,
        completed_at: new Date().toISOString(),
      })
      .eq('id', parentId)
      .eq('tenant_id', ctx.tenantId)
    return { ok: false, message }
  }
}

// Pure aggregation helper. Exported for the detail page to render
// per-window rows alongside the headline summary.
export type WalkForwardSummary = {
  total_windows: number
  profitable_windows: number
  significant_windows: number
  consistency_score: number
  avg_window_pnl_gbp: number
  best_window_pnl_gbp: number
  best_window_id: string | null
  worst_window_pnl_gbp: number
  worst_window_id: string | null
  avg_window_win_rate: number
  avg_window_avg_r: number
  worst_window_drawdown_gbp: number
}

const SIGNIFICANT_WINDOW_TRADES = 5

function aggregateWalkForward(
  rows: Array<{
    id: string
    status: string | null
    total_trades: number | null
    win_rate: number | string | null
    avg_r: number | string | null
    total_pnl_gbp: number | string | null
    max_drawdown_gbp: number | string | null
    sharpe_ratio: number | string | null
    date_range_start: string
    date_range_end: string
  }>,
): WalkForwardSummary {
  const completed = rows.filter((r) => r.status === 'completed')
  const total = completed.length
  if (total === 0) {
    return {
      total_windows: rows.length,
      profitable_windows: 0,
      significant_windows: 0,
      consistency_score: 0,
      avg_window_pnl_gbp: 0,
      best_window_pnl_gbp: 0,
      best_window_id: null,
      worst_window_pnl_gbp: 0,
      worst_window_id: null,
      avg_window_win_rate: 0,
      avg_window_avg_r: 0,
      worst_window_drawdown_gbp: 0,
    }
  }
  let profitable = 0
  let significantProfitable = 0
  let pnlSum = 0
  let winRateSum = 0
  let avgRSum = 0
  let bestPnl = -Infinity
  let bestId: string | null = null
  let worstPnl = Infinity
  let worstId: string | null = null
  let worstDd = 0
  for (const r of completed) {
    const pnl = r.total_pnl_gbp == null ? 0 : Number(r.total_pnl_gbp)
    pnlSum += pnl
    if (r.win_rate != null) winRateSum += Number(r.win_rate)
    if (r.avg_r != null) avgRSum += Number(r.avg_r)
    if (pnl > 0) profitable += 1
    if (pnl > 0 && (r.total_trades ?? 0) >= SIGNIFICANT_WINDOW_TRADES) {
      significantProfitable += 1
    }
    if (pnl > bestPnl) {
      bestPnl = pnl
      bestId = r.id
    }
    if (pnl < worstPnl) {
      worstPnl = pnl
      worstId = r.id
    }
    const dd = r.max_drawdown_gbp == null ? 0 : Number(r.max_drawdown_gbp)
    if (dd > worstDd) worstDd = dd
  }
  return {
    total_windows: rows.length,
    profitable_windows: profitable,
    significant_windows: significantProfitable,
    consistency_score: total > 0 ? profitable / total : 0,
    avg_window_pnl_gbp: pnlSum / total,
    best_window_pnl_gbp: Number.isFinite(bestPnl) ? bestPnl : 0,
    best_window_id: bestId,
    worst_window_pnl_gbp: Number.isFinite(worstPnl) ? worstPnl : 0,
    worst_window_id: worstId,
    avg_window_win_rate: winRateSum / total,
    avg_window_avg_r: avgRSum / total,
    worst_window_drawdown_gbp: worstDd,
  }
}
