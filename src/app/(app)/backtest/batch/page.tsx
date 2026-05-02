import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  listBatchBacktestsAction,
  type BatchBacktestSummary,
} from '@/app/actions/batch-backtest'
import { BacktestTabs } from '@/components/shared/BacktestTabs'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Batch backtests · Dizzy Trade',
}

const statusClass: Record<BatchBacktestSummary['status'], string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
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

export default async function BatchBacktestListPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const result = await listBatchBacktestsAction()
  const rows = result.ok ? result.rows : []

  return (
    <PageContainer>
      <PageHeader
        title="Backtest"
        subtitle="Compare strategies head-to-head on the same config."
        rightSlot={
          <Link href="/backtest/batch/new" className="contents">
            <Button className="w-auto">New batch</Button>
          </Link>
        }
      />
      <BacktestTabs active="batches" />
      {!result.ok ? (
        <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {result.message}
        </div>
      ) : null}
      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-white/[0.06] bg-surface p-8 text-center">
            <p className="text-sm text-white/55">
              No batch backtests yet. Pick a few strategies from the library and
              run them head-to-head.
            </p>
            <Link
              href="/settings/strategies"
              className="mt-4 inline-block text-sm text-accent hover:underline"
            >
              Open the strategies library →
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors hover:border-white/10 hover:bg-surface-2"
              >
                <Link
                  href={`/backtest/batch/${row.id}`}
                  className="flex flex-1 flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {row.name ?? 'Untitled batch'}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusClass[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                    <span>{row.strategy_count} strategies</span>
                    <span>Created {formatDate(row.created_at)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  )
}
