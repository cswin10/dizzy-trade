import { redirect } from 'next/navigation'

import { AlertFilters } from '@/components/shared/AlertFilters'
import { AlertsListRealtime } from '@/components/shared/AlertsListRealtime'
import type { AlertRow } from '@/components/shared/AlertsList'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusDot } from '@/components/ui/StatusDot'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Alerts · Dizzy Trade',
}

const FRAMEWORK_FILTERS = [
  { id: 'liquidation_hunt_v1', label: 'Liquidation hunt' },
]

const ALERT_PAGE_LIMIT = 100

function lastScanRelative(capturedAt: string | null | undefined): string {
  if (!capturedAt) return 'Last scan: never'
  const diffSec = Math.round((Date.now() - Date.parse(capturedAt)) / 1000)
  if (!Number.isFinite(diffSec) || diffSec < 0) return 'Last scan: now'
  if (diffSec < 60) return `Last scan: ${diffSec}s ago`
  const minutes = Math.round(diffSec / 60)
  return `Last scan: ${minutes}m ago`
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const framework = (() => {
    const v = searchParams.framework
    const s = Array.isArray(v) ? v[0] : v
    if (!s || s === 'all') return null
    return FRAMEWORK_FILTERS.some((f) => f.id === s) ? s : null
  })()
  const watchlistOnly = searchParams.watchlist === '1'
  const showDismissed = searchParams.dismissed === '1'

  let query = supabase
    .from('alerts')
    .select('*')
    .order('triggered_at', { ascending: false })
    .limit(ALERT_PAGE_LIMIT)
  if (framework) query = query.eq('framework_id', framework)
  if (watchlistOnly) query = query.eq('is_watchlist', true)
  if (!showDismissed) query = query.eq('dismissed', false)

  const { data: alerts } = await query

  const { data: lastSnapshot } = await supabase
    .from('market_snapshots')
    .select('captured_at')
    .order('captured_at', { ascending: false })
    .limit(1)
  const lastCapturedAt = lastSnapshot?.[0]?.captured_at ?? null

  return (
    <PageContainer>
      <PageHeader
        title="Alerts"
        subtitle="Real-time trading signals"
        rightSlot={
          <>
            <span className="inline-flex items-center gap-2">
              <StatusDot tone="positive" pulse />
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/55">
                Scanner active
              </span>
            </span>
            <span className="text-xs text-white/45">
              {lastScanRelative(lastCapturedAt)}
            </span>
          </>
        }
      />
      <div className="mb-6">
        <AlertFilters frameworks={FRAMEWORK_FILTERS} />
      </div>
      <AlertsListRealtime
        initialAlerts={(alerts ?? []) as AlertRow[]}
        showDismissed={showDismissed}
      />
    </PageContainer>
  )
}
