'use client'

import Link from 'next/link'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { WalkForwardSummary } from '@/app/actions/walk-forward'

type ParentRow = {
  id: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  parent_config: Record<string, unknown>
  window_size_days: number
  step_size_days: number
  child_run_ids: string[]
  summary: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

type ChildRow = {
  id: string
  name: string
  status: string | null
  total_trades: number | null
  win_rate: number | null
  avg_r: number | null
  total_pnl_gbp: number | null
  max_drawdown_gbp: number | null
  sharpe_ratio: number | null
  date_range_start: string
  date_range_end: string
}

export type WalkForwardDetailProps = {
  parent: ParentRow
  childRows: ChildRow[]
}

function fmtGbp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

function fmtNumber(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return value.toFixed(digits)
}

function fmtRange(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
  const e = new Date(end).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
  return `${s} → ${e}`
}

export function WalkForwardDetail({
  parent,
  childRows: rows,
}: WalkForwardDetailProps) {
  const summary = (parent.summary ?? null) as
    | (Partial<WalkForwardSummary> & Record<string, unknown>)
    | null
  const config = parent.parent_config as {
    pairs?: string[]
    timeframe?: string
    risk_amount_gbp?: number
    total_start?: string
    total_end?: string
  }

  const pnlChartData = rows.map((r, i) => ({
    label: `${i + 1}`,
    pnl: r.total_pnl_gbp == null ? 0 : Number(r.total_pnl_gbp),
    win_rate: r.win_rate == null ? 0 : r.win_rate * 100,
  }))

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Status" value={parent.status} />
        <Stat label="Windows" value={String(rows.length)} />
        <Stat
          label="Profitable"
          value={
            summary?.profitable_windows != null
              ? `${summary.profitable_windows} / ${summary.total_windows ?? rows.length}`
              : '-'
          }
        />
        <Stat
          label="Significant +"
          value={String(summary?.significant_windows ?? 0)}
          detail="Profitable AND ≥5 trades"
        />
        <Stat
          label="Consistency"
          value={fmtPct(
            summary?.consistency_score == null
              ? null
              : Number(summary.consistency_score),
          )}
          detail="Profitable / total"
        />
        <Stat
          label="Avg window PnL"
          value={fmtGbp(
            summary?.avg_window_pnl_gbp == null
              ? null
              : Number(summary.avg_window_pnl_gbp),
          )}
        />
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Configuration
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <KV label="Pairs" value={(config.pairs ?? []).join(', ') || '-'} />
          <KV label="Timeframe" value={config.timeframe ?? '-'} />
          <KV
            label="Total range"
            value={
              config.total_start && config.total_end
                ? fmtRange(config.total_start, config.total_end)
                : '-'
            }
          />
          <KV
            label="Risk per trade"
            value={
              config.risk_amount_gbp == null
                ? '-'
                : `£${Number(config.risk_amount_gbp).toFixed(0)}`
            }
          />
          <KV label="Window size" value={`${parent.window_size_days} days`} />
          <KV label="Step size" value={`${parent.step_size_days} days`} />
          <KV
            label="Best window"
            value={fmtGbp(
              summary?.best_window_pnl_gbp == null
                ? null
                : Number(summary.best_window_pnl_gbp),
            )}
          />
          <KV
            label="Worst window"
            value={fmtGbp(
              summary?.worst_window_pnl_gbp == null
                ? null
                : Number(summary.worst_window_pnl_gbp),
            )}
          />
        </dl>
      </section>

      {parent.error_message ? (
        <section className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-4 text-sm text-red-200">
          <div className="font-semibold">Run failed</div>
          <div className="mt-1 text-xs">{parent.error_message}</div>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
              Per-window PnL
            </h2>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlChartData}>
                  <CartesianGrid stroke="#1F2937" strokeOpacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                    tickFormatter={(v) => fmtGbp(v)}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                  <Tooltip
                    contentStyle={{
                      background: '#0F172A',
                      border: '1px solid #1F2937',
                      fontSize: 11,
                    }}
                    formatter={(value: number) => [fmtGbp(value), 'PnL']}
                  />
                  <Bar dataKey="pnl" isAnimationActive={false}>
                    {pnlChartData.map((p, i) => (
                      <Cell
                        key={i}
                        fill={p.pnl >= 0 ? '#4ADE80' : '#F87171'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
              Win rate by window
            </h2>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pnlChartData}>
                  <CartesianGrid stroke="#1F2937" strokeOpacity={0.5} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <ReferenceLine y={50} stroke="rgba(255,255,255,0.2)" />
                  <Tooltip
                    contentStyle={{
                      background: '#0F172A',
                      border: '1px solid #1F2937',
                      fontSize: 11,
                    }}
                    formatter={(value: number) => [
                      `${value.toFixed(1)}%`,
                      'Win rate',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="win_rate"
                    stroke="#3B82FF"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      ) : null}

      <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Window-by-window
        </h2>
        {rows.length === 0 ? (
          <p className="text-xs text-white/55">No child runs to show yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Range</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win rate</th>
                  <th className="px-3 py-2 text-right">Avg R</th>
                  <th className="px-3 py-2 text-right">PnL</th>
                  <th className="px-3 py-2 text-right">Max DD</th>
                  <th className="px-3 py-2 text-right">Sharpe</th>
                  <th className="px-3 py-2 text-right">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className="border-t border-white/[0.04] text-white/85"
                  >
                    <td className="px-3 py-2 font-mono">{i + 1}</td>
                    <td className="px-3 py-2 text-white/70">
                      {fmtRange(r.date_range_start, r.date_range_end)}
                    </td>
                    <td className="px-3 py-2">{r.status ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.total_trades ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtPct(r.win_rate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNumber(r.avg_r)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        r.total_pnl_gbp == null
                          ? ''
                          : r.total_pnl_gbp >= 0
                            ? 'text-emerald-300'
                            : 'text-red-300'
                      }`}
                    >
                      {fmtGbp(r.total_pnl_gbp)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-200/85">
                      {r.max_drawdown_gbp == null
                        ? '-'
                        : fmtGbp(-Math.abs(r.max_drawdown_gbp))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtNumber(r.sharpe_ratio)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/backtest/${r.id}`}
                        className="text-accent hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-white/90">{value}</div>
      {detail ? (
        <div className="mt-1 text-[10px] text-white/45">{detail}</div>
      ) : null}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-white/85">{value}</dd>
    </div>
  )
}
