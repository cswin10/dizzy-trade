import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  SweepResultsHeatmap,
  type HeatmapCell,
} from '@/components/shared/SweepResultsHeatmap'
import {
  SweepResultsLineChart,
  type LineChartPoint,
} from '@/components/shared/SweepResultsLineChart'
import {
  SweepResultsTable,
  type SweepResultRow,
} from '@/components/shared/SweepResultsTable'
import { SweepRunner } from '@/components/shared/SweepRunner'
import { Button } from '@/components/ui/Button'
import type { SweepDimension } from '@/lib/backtest/sweep'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Sweep result · Dizzy Trade',
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-white/10 text-white/45',
}

function formatGbp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function describeCombo(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([k, v]) => {
      if (typeof v === 'number') {
        return `${k}=${Number.isInteger(v) ? v : v.toFixed(4).replace(/\.?0+$/, '')}`
      }
      return `${k}=${String(v)}`
    })
    .join(', ')
}

export default async function SweepResultPage({
  params,
}: {
  params: { sweep_id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: sweep, error } = await supabase
    .from('backtest_sweeps')
    .select('*')
    .eq('id', params.sweep_id)
    .single()
  if (error || !sweep) notFound()

  const { data: runs } = await supabase
    .from('backtest_runs')
    .select(
      'id, status, sweep_combination_index, sweep_combination_values, total_trades, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio, overfit_warning_triggered, error_message',
    )
    .eq('sweep_id', params.sweep_id)
    .order('sweep_combination_index', { ascending: true })

  const rows: SweepResultRow[] = (runs ?? []).map((row) => ({
    run_id: row.id,
    combination_index: row.sweep_combination_index ?? 0,
    combination_values:
      (row.sweep_combination_values as Record<
        string,
        number | string | boolean
      > | null) ?? {},
    status: row.status,
    total_trades: row.total_trades,
    win_rate: row.win_rate == null ? null : Number(row.win_rate),
    avg_r: row.avg_r == null ? null : Number(row.avg_r),
    total_pnl_gbp: row.total_pnl_gbp == null ? null : Number(row.total_pnl_gbp),
    max_drawdown_gbp:
      row.max_drawdown_gbp == null ? null : Number(row.max_drawdown_gbp),
    sharpe_ratio: row.sharpe_ratio == null ? null : Number(row.sharpe_ratio),
    overfit_warning_triggered: row.overfit_warning_triggered,
    error_message: row.error_message,
  }))

  const completed = rows.filter((r) => r.status === 'completed')
  const bestByPnl =
    completed.length > 0
      ? completed.reduce((best, current) =>
          (current.total_pnl_gbp ?? -Infinity) >
          (best.total_pnl_gbp ?? -Infinity)
            ? current
            : best,
        )
      : null
  const bestBySharpe =
    completed.length > 0
      ? completed.reduce((best, current) =>
          (current.sharpe_ratio ?? -Infinity) > (best.sharpe_ratio ?? -Infinity)
            ? current
            : best,
        )
      : null

  const dimensions = (sweep.sweep_dimensions ?? []) as SweepDimension[]

  let heatmapCells: HeatmapCell[] = []
  let heatmapKeys: { x: string; y: string } | null = null
  let lineChartPoints: LineChartPoint[] = []
  let lineChartKey: string | null = null

  if (dimensions.length === 2) {
    const xKey = dimensions[0]!.key
    const yKey = dimensions[1]!.key
    heatmapKeys = { x: xKey, y: yKey }
    heatmapCells = completed.map((r) => ({
      xValue: r.combination_values[xKey] as number | string | boolean,
      yValue: r.combination_values[yKey] as number | string | boolean,
      pnlGbp: r.total_pnl_gbp,
      totalTrades: r.total_trades,
      winRate: r.win_rate,
      avgR: r.avg_r,
      sharpe: r.sharpe_ratio,
      runId: r.run_id,
    }))
  } else if (dimensions.length === 1) {
    const xKey = dimensions[0]!.key
    lineChartKey = xKey
    lineChartPoints = completed
      .slice()
      .sort((a, b) => {
        const av = a.combination_values[xKey]
        const bv = b.combination_values[xKey]
        if (typeof av === 'number' && typeof bv === 'number') return av - bv
        return String(av).localeCompare(String(bv))
      })
      .map((r) => ({
        x: r.combination_values[xKey] as number | string,
        total_pnl_gbp: r.total_pnl_gbp,
      }))
  }

  return (
    <PageContainer>
      <PageHeader
        title={sweep.name}
        subtitle={`${sweep.framework_id} · ${sweep.timeframe} · ${sweep.total_combinations} combinations`}
        rightSlot={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[sweep.status] ?? ''}`}
            >
              {sweep.status}
            </span>
            <Link href="/backtest/sweeps" className="contents">
              <Button variant="ghost" className="w-auto">
                Back to sweeps
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-6">
        <SweepRunner
          sweepId={sweep.id}
          status={sweep.status}
          combinationsCompleted={sweep.combinations_completed}
          combinationsFailed={sweep.combinations_failed}
          totalCombinations={sweep.total_combinations}
          runStartedAt={sweep.run_started_at}
        />

        {sweep.status === 'failed' && sweep.error_message ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {sweep.error_message}
          </div>
        ) : null}

        {completed.length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-3">
            <Card
              label="Combinations completed"
              value={completed.length.toString()}
            />
            <Card
              label="Best by PnL"
              value={bestByPnl ? `${formatGbp(bestByPnl.total_pnl_gbp)}` : '-'}
              detail={
                bestByPnl
                  ? describeCombo(bestByPnl.combination_values)
                  : undefined
              }
            />
            <Card
              label="Best by Sharpe"
              value={
                bestBySharpe && bestBySharpe.sharpe_ratio != null
                  ? bestBySharpe.sharpe_ratio.toFixed(2)
                  : '-'
              }
              detail={
                bestBySharpe
                  ? describeCombo(bestBySharpe.combination_values)
                  : undefined
              }
            />
          </section>
        ) : null}

        <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
          <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
            Results
          </h2>
          <SweepResultsTable rows={rows} sweepId={sweep.id} />
        </section>

        {heatmapKeys && heatmapCells.length > 0 ? (
          <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
            <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
              Heatmap
            </h2>
            <SweepResultsHeatmap
              xKey={heatmapKeys.x}
              yKey={heatmapKeys.y}
              cells={heatmapCells}
            />
          </section>
        ) : null}

        {lineChartKey && lineChartPoints.length > 0 ? (
          <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
            <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
              Sensitivity curve
            </h2>
            <SweepResultsLineChart
              xKey={lineChartKey}
              points={lineChartPoints}
            />
          </section>
        ) : null}

        <details className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
          <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-white/55">
            Sweep config
          </summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-white/65">
            {JSON.stringify(
              {
                framework_id: sweep.framework_id,
                timeframe: sweep.timeframe,
                pairs: sweep.pairs,
                date_range_start: sweep.date_range_start,
                date_range_end: sweep.date_range_end,
                dimensions,
                base: {
                  max_concurrent_positions: sweep.max_concurrent_positions,
                  max_daily_loss_gbp: sweep.max_daily_loss_gbp,
                  max_consecutive_losers: sweep.max_consecutive_losers,
                  slippage_pct: Number(sweep.slippage_pct),
                  maker_fee_pct: Number(sweep.maker_fee_pct),
                  taker_fee_pct: Number(sweep.taker_fee_pct),
                  assume_taker: sweep.assume_taker,
                  enable_train_test_split: sweep.enable_train_test_split,
                  train_split_pct: Number(sweep.train_split_pct),
                },
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    </PageContainer>
  )
}

function Card({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="mt-2 font-mono text-lg text-white">{value}</div>
      {detail ? (
        <div className="mt-1 truncate font-mono text-[11px] text-white/55">
          {detail}
        </div>
      ) : null}
    </div>
  )
}
