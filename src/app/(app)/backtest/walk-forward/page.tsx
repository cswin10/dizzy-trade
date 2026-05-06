import Link from 'next/link'
import { redirect } from 'next/navigation'

import { BacktestTabs } from '@/components/shared/BacktestTabs'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Walk-forward backtests · Dizzy Trade',
}

const statusClass: Record<string, string> = {
  queued: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  complete: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function WalkForwardListPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data, error } = await supabase
    .from('walk_forward_runs')
    .select(
      'id, status, parent_config, window_size_days, step_size_days, child_run_ids, summary, created_at, completed_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = error || !data ? [] : data

  return (
    <PageContainer>
      <PageHeader
        title="Backtest"
        subtitle="Roll the same strategy through multiple windows and check whether edge persists."
        rightSlot={
          <Link href="/backtest/walk-forward/new" className="contents">
            <Button className="w-auto">New walk-forward</Button>
          </Link>
        }
      />
      <BacktestTabs active="walk_forward" />
      {error ? (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error.message}
        </div>
      ) : null}
      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-white/[0.06] bg-surface p-8 text-center">
            <p className="text-sm text-white/55">
              No walk-forward runs yet. Pick a strategy and roll it across
              your full history to see whether edge persists across windows.
            </p>
            <Link
              href="/backtest/walk-forward/new"
              className="mt-4 inline-block text-sm text-accent hover:underline"
            >
              Start a walk-forward run →
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const config =
                (row.parent_config ?? {}) as Record<string, unknown>
              const summary =
                (row.summary ?? null) as Record<string, unknown> | null
              const pairs = (config.pairs as string[] | undefined) ?? []
              const timeframe = (config.timeframe as string | undefined) ?? '-'
              const childCount = (row.child_run_ids ?? []).length
              const consistency =
                summary?.consistency_score == null
                  ? null
                  : Number(summary.consistency_score)
              const profitable =
                summary?.profitable_windows == null
                  ? null
                  : Number(summary.profitable_windows)
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors hover:border-white/10 hover:bg-surface-2"
                >
                  <Link
                    href={`/backtest/walk-forward/${row.id}`}
                    className="flex flex-1 flex-col gap-1"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {timeframe} · {pairs.join(', ') || '-'} ·{' '}
                        {row.window_size_days}d / {row.step_size_days}d
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass[row.status] ?? 'bg-white/10 text-white/55'}`}
                      >
                        {row.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                      <span>{childCount} windows</span>
                      {profitable != null ? (
                        <span>{profitable} profitable</span>
                      ) : null}
                      {consistency != null ? (
                        <span>
                          consistency {(consistency * 100).toFixed(0)}%
                        </span>
                      ) : null}
                      <span>Created {formatDate(row.created_at)}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </PageContainer>
  )
}
