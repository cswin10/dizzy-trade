'use server'

// Server-side glue for the analytics module. Loads the run row and
// its trades from Supabase, re-shapes them into AnalyticsTrade
// records, and hands them to the pure analytics functions in
// src/lib/backtest/analytics.ts. Both actions are tenant-scoped via
// the same resolveTenant helper the rest of the backtest actions
// use, so RLS still applies.

import {
  computeBacktestAnalytics,
  computeBatchAnalytics,
  type AnalyticsTrade,
  type BacktestAnalytics,
  type BatchAnalytics,
  type RunWithTrades,
} from '@/lib/backtest/analytics'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

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
  return { ok: true as const, tenantId }
}

type TradeRow = {
  pair: string
  direction: string | null
  entry_at: string
  exit_at: string | null
  exit_reason: string | null
  pnl_gbp: number | string | null
  r_multiple: number | string | null
  outcome: string | null
}

function rowToAnalyticsTrade(row: TradeRow): AnalyticsTrade {
  return {
    pair: row.pair,
    direction: (row.direction as 'long' | 'short' | null) ?? 'long',
    entry_at: new Date(row.entry_at),
    exit_at: row.exit_at ? new Date(row.exit_at) : null,
    exit_reason:
      (row.exit_reason as AnalyticsTrade['exit_reason']) ?? 'rules_blocked',
    pnl_gbp: row.pnl_gbp == null ? null : Number(row.pnl_gbp),
    r_multiple: row.r_multiple == null ? null : Number(row.r_multiple),
    outcome: (row.outcome as AnalyticsTrade['outcome']) ?? null,
  }
}

export type BacktestAnalyticsResult =
  | { ok: true; data: BacktestAnalytics }
  | { ok: false; message: string }

export async function computeBacktestAnalyticsAction(
  runId: string,
): Promise<BacktestAnalyticsResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const [runRes, tradesRes] = await Promise.all([
    service
      .from('backtest_runs')
      .select('id, timeframe, tenant_id')
      .eq('id', runId)
      .eq('tenant_id', ctx.tenantId)
      .single(),
    service
      .from('backtest_trades')
      .select(
        'pair, direction, entry_at, exit_at, exit_reason, pnl_gbp, r_multiple, outcome',
      )
      .eq('backtest_run_id', runId),
  ])
  if (runRes.error || !runRes.data) {
    return { ok: false, message: runRes.error?.message ?? 'Run not found' }
  }
  if (tradesRes.error) {
    return { ok: false, message: tradesRes.error.message }
  }
  const trades = (tradesRes.data ?? []).map(rowToAnalyticsTrade)
  const analytics = computeBacktestAnalytics(trades, runRes.data.timeframe)
  return { ok: true, data: analytics }
}

export type BatchAnalyticsResult =
  | { ok: true; data: BatchAnalytics }
  | { ok: false; message: string }

export async function computeBatchAnalyticsAction(
  batchId: string,
): Promise<BatchAnalyticsResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const batchRes = await service
    .from('batch_backtest_runs')
    .select('id, tenant_id')
    .eq('id', batchId)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (batchRes.error || !batchRes.data) {
    return { ok: false, message: batchRes.error?.message ?? 'Batch not found' }
  }
  const runsRes = await service
    .from('backtest_runs')
    .select('id, name, timeframe, total_pnl_gbp')
    .eq('batch_run_id', batchId)
  if (runsRes.error) {
    return { ok: false, message: runsRes.error.message }
  }
  const runs = runsRes.data ?? []
  if (runs.length < 2) {
    return {
      ok: true,
      data: { correlation: null, combined: null },
    }
  }
  // Fetch trades for every child in parallel. Each batch we have
  // ever seen is ≤ 20 strategies × ≤ 200 trades, so a single
  // round-trip per run is fine; alternative would be one big
  // .in() query but that returns a flat list we'd have to bucket
  // back out anyway.
  const tradeFetches = await Promise.all(
    runs.map((run) =>
      service
        .from('backtest_trades')
        .select(
          'pair, direction, entry_at, exit_at, exit_reason, pnl_gbp, r_multiple, outcome',
        )
        .eq('backtest_run_id', run.id),
    ),
  )
  const runsWithTrades: RunWithTrades[] = runs.map((run, i) => {
    const fetched = tradeFetches[i]
    const rows = fetched && !fetched.error ? (fetched.data ?? []) : []
    return {
      run_id: run.id,
      name: run.name,
      total_pnl_gbp:
        run.total_pnl_gbp == null ? 0 : Number(run.total_pnl_gbp),
      trades: rows.map(rowToAnalyticsTrade),
    }
  })
  // Use the most common timeframe across child runs for Sharpe
  // annualisation. Children in the same batch always share the
  // shared timeframe except when use_strategy_native_pairs is on,
  // in which case picking the mode is the most defensible choice.
  const tfCounts = new Map<string, number>()
  for (const r of runs) {
    tfCounts.set(r.timeframe, (tfCounts.get(r.timeframe) ?? 0) + 1)
  }
  let timeframe = '1h'
  let bestCount = -1
  tfCounts.forEach((count, tf) => {
    if (count > bestCount) {
      bestCount = count
      timeframe = tf
    }
  })
  const analytics = computeBatchAnalytics(runsWithTrades, timeframe)
  return { ok: true, data: analytics }
}
