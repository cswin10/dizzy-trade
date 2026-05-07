import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { computeBacktestAnalyticsAction } from '@/app/actions/backtest-analytics'
import { BacktestAnalyticsSections } from '@/components/shared/BacktestAnalyticsSections'
import { BacktestDiagnosticsPanel } from '@/components/shared/BacktestDiagnosticsPanel'
import {
  BacktestEquityCurveChart,
  type EquityCurvePoint,
} from '@/components/shared/BacktestEquityCurveChart'
import {
  BacktestPerformanceByPairTable,
  type PairPerformanceRow,
} from '@/components/shared/BacktestPerformanceByPairTable'
import { BacktestResultsCards } from '@/components/shared/BacktestResultsCards'
import {
  BacktestTradeDistributionChart,
  type DistributionBucket,
} from '@/components/shared/BacktestTradeDistributionChart'
import {
  BacktestTradesTable,
  type BacktestTradeRow,
} from '@/components/shared/BacktestTradesTable'
import { BacktestTrainTestPanel } from '@/components/shared/BacktestTrainTestPanel'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import type {
  BacktestDiagnostics,
  BacktestMetrics,
} from '@/lib/backtest/types'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Backtest result · Dizzy Trade',
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function buildEquityCurve(trades: BacktestTradeRow[]): {
  points: EquityCurvePoint[]
  splitIndex: number | null
} {
  const executed = trades
    .filter((t) => t.exit_reason !== 'rules_blocked')
    .sort((a, b) => {
      const aTime = a.exit_at ? new Date(a.exit_at).getTime() : 0
      const bTime = b.exit_at ? new Date(b.exit_at).getTime() : 0
      return aTime - bTime
    })
  let cumulative = 0
  const points: EquityCurvePoint[] = executed.map((trade, i) => {
    const pnlGbp = Number(
      (trade as unknown as { pnl_gbp: number | null }).pnl_gbp ?? 0,
    )
    cumulative += pnlGbp
    return {
      index: i + 1,
      cumulative_pnl_gbp: cumulative,
      in_train: Boolean(
        (trade as unknown as { in_train_period?: boolean | null })
          .in_train_period,
      ),
      entry_at_iso: trade.entry_at,
    }
  })
  return { points, splitIndex: null }
}

function buildDistribution(trades: BacktestTradeRow[]): DistributionBucket[] {
  const executed = trades.filter((t) => t.exit_reason !== 'rules_blocked')
  const buckets: { label: string; midpoint: number; count: number }[] = []
  for (let r = -3; r < 3; r += 0.5) {
    buckets.push({
      label: `${r.toFixed(1)}R`,
      midpoint: r + 0.25,
      count: 0,
    })
  }
  for (const trade of executed) {
    const r = trade.r_multiple ?? 0
    const clamped = Math.max(-3, Math.min(2.99, r))
    const bucketIndex = Math.floor((clamped + 3) / 0.5)
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex]!.count += 1
    }
  }
  return buckets
}

function buildPairBreakdown(trades: BacktestTradeRow[]): PairPerformanceRow[] {
  const map = new Map<string, PairPerformanceRow & { wins: number }>()
  for (const trade of trades) {
    if (trade.exit_reason === 'rules_blocked') continue
    const pnl = Number(
      (trade as unknown as { pnl_gbp: number | null }).pnl_gbp ?? 0,
    )
    const r = Number(trade.r_multiple ?? 0)
    const existing = map.get(trade.pair) ?? {
      pair: trade.pair,
      trades: 0,
      win_rate: 0,
      avg_r: 0,
      total_pnl_gbp: 0,
      wins: 0,
    }
    existing.trades += 1
    existing.total_pnl_gbp += pnl
    existing.avg_r += r
    if (trade.outcome === 'win') existing.wins += 1
    map.set(trade.pair, existing)
  }
  return Array.from(map.values()).map((row) => ({
    pair: row.pair,
    trades: row.trades,
    win_rate: row.trades > 0 ? row.wins / row.trades : 0,
    avg_r: row.trades > 0 ? row.avg_r / row.trades : 0,
    total_pnl_gbp: row.total_pnl_gbp,
  }))
}

export default async function BacktestResultPage({
  params,
}: {
  params: { run_id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Run all four queries in parallel. Previously this page waited
  // for run -> sweep -> trades -> analytics serially; on a slow
  // Supabase connection that is four full round-trips before the
  // operator sees anything. The sweep lookup can fan out before
  // we know whether sweep_id is set; we just discard the result
  // when it isn't, which is cheaper than the extra round-trip.
  const analyticsStart = Date.now()
  const [runRes, tradesRes, analyticsRes] = await Promise.all([
    supabase
      .from('backtest_runs')
      .select('*')
      .eq('id', params.run_id)
      .single(),
    supabase
      .from('backtest_trades')
      .select(
        'id, pair, direction, entry_at, entry_price, stop_price, target_price, exit_at, exit_price, exit_reason, r_multiple, outcome, conditions_at_signal, pnl_gbp, in_train_period',
      )
      .eq('backtest_run_id', params.run_id)
      .order('entry_at', { ascending: true }),
    computeBacktestAnalyticsAction(params.run_id),
  ])
  const analyticsMs = Date.now() - analyticsStart
  const { data: run, error } = runRes
  if (error || !run) notFound()

  // Resolve the sweep header pill (if any) after the parent run is
  // known. This is one extra round-trip in the rare sweep case but
  // keeps the common (non-sweep) path at three parallel queries.
  let parentSweep: { id: string; name: string } | null = null
  if (run.sweep_id) {
    const sweepRes = await supabase
      .from('backtest_sweeps')
      .select('id, name')
      .eq('id', run.sweep_id)
      .single()
    if (sweepRes.data) {
      parentSweep = { id: sweepRes.data.id, name: sweepRes.data.name }
    }
  }

  const trades: BacktestTradeRow[] = (tradesRes.data ?? []).map((row) => ({
    id: row.id,
    pair: row.pair,
    direction: row.direction,
    entry_at: row.entry_at,
    entry_price: Number(row.entry_price),
    stop_price: Number(row.stop_price),
    target_price: Number(row.target_price),
    exit_at: row.exit_at,
    exit_price: row.exit_price == null ? null : Number(row.exit_price),
    exit_reason: row.exit_reason,
    r_multiple: row.r_multiple == null ? null : Number(row.r_multiple),
    outcome: row.outcome,
    conditions_at_signal: row.conditions_at_signal,
    // Carry pnl_gbp and in_train_period through for chart computations.
    ...({
      pnl_gbp: row.pnl_gbp == null ? null : Number(row.pnl_gbp),
    } as object),
    ...({ in_train_period: row.in_train_period } as object),
  })) as BacktestTradeRow[]

  const trainMetrics = (run.train_metrics as BacktestMetrics | null) ?? null
  const testMetrics = (run.test_metrics as BacktestMetrics | null) ?? null

  const equity = buildEquityCurve(trades)
  if (run.enable_train_test_split) {
    const splitTimeMs =
      new Date(run.date_range_start).getTime() +
      ((new Date(run.date_range_end).getTime() -
        new Date(run.date_range_start).getTime()) *
        Number(run.train_split_pct)) /
        100
    const idx = equity.points.findIndex(
      (p) => new Date(p.entry_at_iso).getTime() >= splitTimeMs,
    )
    equity.splitIndex = idx >= 0 ? idx : null
  }
  const distribution = buildDistribution(trades)
  const analytics = analyticsRes.ok ? analyticsRes.data : null
  const pairBreakdown: PairPerformanceRow[] = analytics
    ? analytics.per_pair.map((p) => ({
        pair: p.pair,
        trades: p.trades,
        win_rate: p.win_rate,
        avg_r: p.avg_r,
        total_pnl_gbp: p.total_pnl_gbp,
        max_drawdown_gbp: p.max_drawdown_gbp,
        sharpe_ratio: p.sharpe_ratio,
        best_trade_gbp: p.best_trade_gbp,
        worst_trade_gbp: p.worst_trade_gbp,
        profit_factor: p.profit_factor,
      }))
    : buildPairBreakdown(trades)
  if (process.env.NODE_ENV !== 'production') {
    // Soft performance log so the operator can spot regressions on
    // dev without coupling to a tracing setup. Production swallows
    // it to keep noise out of server logs.
    console.log(
      `[backtest detail] analytics computed in ${analyticsMs}ms (${trades.length} trades)`,
    )
  }

  const backHref = parentSweep
    ? `/backtest/sweeps/${parentSweep.id}`
    : '/backtest'
  const backLabel = parentSweep ? 'Back to sweep' : 'Back'

  return (
    <PageContainer>
      <PageHeader
        title={run.name}
        subtitle={`${run.framework_id} · ${run.timeframe} · ${formatDate(run.date_range_start)} to ${formatDate(run.date_range_end)}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[run.status] ?? ''}`}
            >
              {run.status}
            </span>
            <Link href="/backtest/new" className="contents">
              <Button variant="ghost" className="w-auto">
                New backtest
              </Button>
            </Link>
            <Link href={backHref} className="contents">
              <Button variant="ghost" className="w-auto">
                {backLabel}
              </Button>
            </Link>
          </div>
        }
      />
      {parentSweep ? (
        <div className="mb-4 flex items-center gap-2 text-xs text-white/55">
          <span>From sweep:</span>
          <Link
            href={`/backtest/sweeps/${parentSweep.id}`}
            className="rounded-full border border-white/10 bg-surface px-3 py-1 font-medium text-white/80 transition-colors hover:border-white/20 hover:text-white"
          >
            {parentSweep.name}
          </Link>
        </div>
      ) : null}

      {run.status === 'running' || run.status === 'pending' ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-200">
          Backtest in progress, this may take 30 to 120 seconds. Refresh to
          check status.
        </div>
      ) : null}

      {run.status === 'failed' ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
          <div className="font-medium">Run failed</div>
          <div className="mt-1 font-mono text-xs">
            {run.error_message ?? 'Unknown error'}
          </div>
        </div>
      ) : null}

      {run.status === 'completed' ? (
        <div className="flex flex-col gap-6">
          {trades.filter((t) => t.exit_reason !== 'rules_blocked').length ===
          0 ? (
            run.diagnostics ? (
              <BacktestDiagnosticsPanel
                diagnostics={run.diagnostics as BacktestDiagnostics}
                zeroSignals
              />
            ) : (
              <div className="rounded-lg border border-white/[0.06] bg-surface p-8 text-center text-sm text-white/55">
                Backtest completed but no signals fired in this period. Try a
                longer date range or different parameters.
              </div>
            )
          ) : (
            <>
              <BacktestResultsCards
                totalTrades={run.total_trades}
                winRate={run.win_rate == null ? null : Number(run.win_rate)}
                avgR={run.avg_r == null ? null : Number(run.avg_r)}
                totalPnlGbp={
                  run.total_pnl_gbp == null ? null : Number(run.total_pnl_gbp)
                }
                maxDrawdownGbp={
                  run.max_drawdown_gbp == null
                    ? null
                    : Number(run.max_drawdown_gbp)
                }
                sharpeRatio={
                  run.sharpe_ratio == null ? null : Number(run.sharpe_ratio)
                }
              />

              {run.enable_train_test_split && trainMetrics && testMetrics ? (
                <BacktestTrainTestPanel
                  trainMetrics={trainMetrics}
                  testMetrics={testMetrics}
                  overfitWarning={run.overfit_warning_triggered}
                />
              ) : null}

              <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
                <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
                  Equity curve
                </h2>
                <BacktestEquityCurveChart
                  points={equity.points}
                  splitIndex={equity.splitIndex}
                />
              </section>

              <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
                <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
                  Trade distribution
                </h2>
                <BacktestTradeDistributionChart buckets={distribution} />
              </section>

              <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
                <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
                  Performance by pair
                </h2>
                <BacktestPerformanceByPairTable rows={pairBreakdown} />
              </section>

              <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
                <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
                  Trades
                </h2>
                <BacktestTradesTable trades={trades} />
              </section>

              {analytics ? (
                <BacktestAnalyticsSections analytics={analytics} />
              ) : null}

              {run.diagnostics ? (
                <BacktestDiagnosticsPanel
                  diagnostics={run.diagnostics as BacktestDiagnostics}
                  zeroSignals={false}
                />
              ) : null}

              <details className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
                <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-white/55">
                  Config used
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-white/65">
                  {JSON.stringify(
                    {
                      framework_id: run.framework_id,
                      framework_thresholds: run.framework_thresholds,
                      timeframe: run.timeframe,
                      pairs: run.pairs,
                      risk_amount_gbp: Number(run.risk_amount_gbp),
                      min_rr: Number(run.min_rr),
                      max_concurrent_positions: run.max_concurrent_positions,
                      max_daily_loss_gbp: run.max_daily_loss_gbp,
                      max_consecutive_losers: run.max_consecutive_losers,
                      slippage_pct: Number(run.slippage_pct),
                      maker_fee_pct: Number(run.maker_fee_pct),
                      taker_fee_pct: Number(run.taker_fee_pct),
                      assume_taker: run.assume_taker,
                      enable_train_test_split: run.enable_train_test_split,
                      train_split_pct: Number(run.train_split_pct),
                      gbp_usd_rate_used: run.gbp_usd_rate_used,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </div>
      ) : null}
    </PageContainer>
  )
}
