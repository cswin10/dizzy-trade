import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const metadata = { title: 'Deployment · Dizzy Trade' }

function formatGbp(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })}`
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-'
  return value.toFixed(digits)
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_LABELS: Record<string, string> = {
  pending_confirmation: 'Pending',
  confirmed: 'Confirmed',
  order_placed: 'Order placed',
  filled: 'Filled',
  expired_unfilled: 'Expired',
  cancelled: 'Cancelled',
  closed_at_stop: 'Stop hit',
  closed_at_target: 'Target hit',
  skipped_by_user: 'Skipped',
  skipped_max_positions: 'Skip · max positions',
  skipped_daily_loss: 'Skip · daily loss cap',
  skipped_consecutive_losers: 'Skip · loser streak',
  failed: 'Failed',
}

export default async function DeploymentDetailPage({
  params,
}: {
  params: { deployment_id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const service = createServiceClient()
  const [deploymentRes, signalsRes] = await Promise.all([
    service
      .from('strategy_deployments')
      .select('*')
      .eq('id', params.deployment_id)
      .single(),
    service
      .from('live_signals')
      .select('*')
      .eq('deployment_id', params.deployment_id)
      .order('signal_at', { ascending: false }),
  ])
  const { data: deployment } = deploymentRes
  if (!deployment) notFound()
  const allSignals = signalsRes.data ?? []
  const fired = allSignals.length
  const confirmed = allSignals.filter((s) => s.confirmed_at != null).length
  const filled = allSignals.filter((s) => s.filled_at != null).length
  const closed = allSignals.filter(
    (s) => s.status === 'closed_at_stop' || s.status === 'closed_at_target',
  )
  const totalPnl = closed.reduce(
    (a, s) => a + Number(s.realised_pnl_gbp ?? 0),
    0,
  )
  const captureRate = fired > 0 ? confirmed / fired : 0
  const fillRate = confirmed > 0 ? filled / confirmed : 0

  // Compare live avg R against the snapshot taken at deploy time.
  // Surfacing the gap directly makes "edge realised" trivially
  // visible; Phase 2 will plot the equity curves alongside.
  const liveAvgR =
    closed.length > 0
      ? closed.reduce(
          (a, s) => a + Number(s.realised_r_multiple ?? 0),
          0,
        ) / closed.length
      : 0
  const summary = (deployment.source_backtest_summary ?? {}) as {
    name?: string
    avg_r?: number
    win_rate?: number
    total_pnl_gbp?: number
  }
  const backtestAvgR = Number(summary.avg_r ?? 0)
  const edgeCaptured =
    backtestAvgR > 0 && Number.isFinite(liveAvgR) ? liveAvgR / backtestAvgR : null

  return (
    <PageContainer>
      <PageHeader
        title={`Deployment ${deployment.id.slice(0, 8)}`}
        subtitle={`${deployment.live_pairs.join(', ')} · risk £${Number(deployment.live_risk_gbp)} per trade · status ${deployment.status}`}
        rightSlot={
          <Link href="/live" className="contents">
            <Button variant="ghost" className="w-auto">
              Back to live
            </Button>
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Signals fired" value={String(fired)} />
        <Stat
          label="Capture rate"
          value={fired > 0 ? `${(captureRate * 100).toFixed(0)}%` : '-'}
        />
        <Stat
          label="Fill rate"
          value={confirmed > 0 ? `${(fillRate * 100).toFixed(0)}%` : '-'}
        />
        <Stat label="Closes" value={String(closed.length)} />
        <Stat
          label="Total PnL"
          value={formatGbp(totalPnl)}
          tone={totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : undefined}
        />
        <Stat
          label="Live avg R"
          value={closed.length > 0 ? formatNumber(liveAvgR) : '-'}
        />
      </section>

      {summary && Object.keys(summary).length > 0 ? (
        <section className="mt-6 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
            Backtest comparison
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Backtest source" value={summary.name ?? '-'} />
            <Stat
              label="Backtest avg R"
              value={
                summary.avg_r != null ? formatNumber(Number(summary.avg_r)) : '-'
              }
            />
            <Stat
              label="Backtest win rate"
              value={
                summary.win_rate != null
                  ? `${(Number(summary.win_rate) * 100).toFixed(1)}%`
                  : '-'
              }
            />
            <Stat
              label="Edge captured"
              value={
                edgeCaptured == null
                  ? '-'
                  : `${(edgeCaptured * 100).toFixed(0)}%`
              }
              tone={
                edgeCaptured != null && edgeCaptured >= 0.5
                  ? 'positive'
                  : edgeCaptured != null && edgeCaptured < 0
                    ? 'negative'
                    : undefined
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-white/45">
            Live avg R as a fraction of backtest avg R. Manual confirmation +
            limit orders typically capture 50-80% of backtest edge depending
            on strategy type.
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Signals ({allSignals.length})
        </h2>
        {allSignals.length === 0 ? (
          <p className="text-xs text-white/55">
            No signals yet. Fire one from the /live page mock debug panel.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 text-left">Signal at</th>
                  <th className="px-3 py-2 text-left">Pair</th>
                  <th className="px-3 py-2 text-left">Dir</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Entry</th>
                  <th className="px-3 py-2 text-right">Exit</th>
                  <th className="px-3 py-2 text-right">Risk £</th>
                  <th className="px-3 py-2 text-right">PnL £</th>
                  <th className="px-3 py-2 text-right">R</th>
                </tr>
              </thead>
              <tbody>
                {allSignals.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-white/[0.04] text-white/85"
                  >
                    <td className="px-3 py-2 font-mono text-white/55">
                      {formatTime(s.signal_at)}
                    </td>
                    <td className="px-3 py-2 font-mono">{s.pair}</td>
                    <td className="px-3 py-2 font-mono">
                      {s.direction.toUpperCase()}
                    </td>
                    <td className="px-3 py-2">
                      {STATUS_LABELS[s.status] ?? s.status}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {s.fill_price != null
                        ? formatNumber(Number(s.fill_price))
                        : formatNumber(Number(s.intended_entry_price))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {s.exit_price != null
                        ? formatNumber(Number(s.exit_price))
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatGbp(Number(s.intended_risk_gbp))}
                    </td>
                    <td
                      className={
                        Number(s.realised_pnl_gbp ?? 0) > 0
                          ? 'px-3 py-2 text-right font-mono text-emerald-300'
                          : Number(s.realised_pnl_gbp ?? 0) < 0
                            ? 'px-3 py-2 text-right font-mono text-red-300'
                            : 'px-3 py-2 text-right font-mono'
                      }
                    >
                      {s.realised_pnl_gbp != null
                        ? formatGbp(Number(s.realised_pnl_gbp))
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {s.realised_r_multiple != null
                        ? formatNumber(Number(s.realised_r_multiple))
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  const colour =
    tone === 'positive'
      ? 'text-emerald-300'
      : tone === 'negative'
        ? 'text-red-300'
        : 'text-white/90'
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className={`mt-1 font-mono text-sm ${colour}`}>{value}</div>
    </div>
  )
}
