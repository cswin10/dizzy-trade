import Link from 'next/link'
import { redirect } from 'next/navigation'

import { LiveDashboard } from '@/components/shared/LiveDashboard'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StrategyWorkspaceTabs } from '@/components/shared/StrategyWorkspaceTabs'
import { Button } from '@/components/ui/Button'
import { getMockClientIfActive } from '@/lib/exchange/factory'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const metadata = { title: 'Live · Dizzy Trade' }

// Pulls everything the dashboard needs in one server-render so
// the page is interactive on first paint. Mutations route back
// through the server actions in src/app/actions/live-*.ts.
export default async function LivePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const service = createServiceClient()
  const { data: deployments } = await service
    .from('strategy_deployments')
    .select('*')
    .order('deployed_at', { ascending: false })
  const { data: signals } = await service
    .from('live_signals')
    .select('*')
    .order('signal_at', { ascending: false })
    .limit(100)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todaysSignals = (signals ?? []).filter(
    (s) => new Date(s.signal_at).getTime() >= today.getTime(),
  )
  const todaysClosed = todaysSignals.filter(
    (s) => s.status === 'closed_at_stop' || s.status === 'closed_at_target',
  )
  const todaysPnl = todaysClosed.reduce(
    (a, s) => a + Number(s.realised_pnl_gbp ?? 0),
    0,
  )

  const stats = {
    active_deployments: (deployments ?? []).filter((d) => d.status === 'live')
      .length,
    pending_signals: (signals ?? []).filter(
      (s) => s.status === 'pending_confirmation',
    ).length,
    open_positions: (signals ?? []).filter(
      (s) => s.status === 'order_placed' || s.status === 'filled',
    ).length,
    todays_pnl_gbp: todaysPnl,
    todays_signals: todaysSignals.length,
    todays_confirmations: todaysSignals.filter(
      (s) => s.confirmed_at !== null,
    ).length,
    todays_fills: todaysSignals.filter((s) => s.filled_at !== null).length,
  }

  // Mock-only debug surface: drain the audit log so the operator
  // can see the calls the pipeline made on this render. Pulled
  // here rather than in the client component because the singleton
  // is server-side. Returns null when a real Hyperliquid client
  // is active for this tenant (i.e. credentials are configured),
  // in which case the debug pane hides itself.
  const tenantId = (
    await service.from('tenant_members').select('tenant_id').eq('user_id', user.id).limit(1).single()
  ).data?.tenant_id as string | undefined
  const mockClient = tenantId ? await getMockClientIfActive(tenantId) : null
  const auditEvents = mockClient ? mockClient.drainAuditLog() : []

  return (
    <PageContainer>
      <PageHeader
        title="Live deployments"
        subtitle="Strategies running against the exchange. Phase 1 uses a mock client; no real orders are placed."
        rightSlot={
          <Link href="/settings/strategies" className="contents">
            <Button variant="ghost" className="w-auto">
              Strategies
            </Button>
          </Link>
        }
      />
      <StrategyWorkspaceTabs active="live" />
      <LiveDashboard
        stats={stats}
        deployments={(deployments ?? []) as any}
        signals={(signals ?? []) as any}
        auditEvents={auditEvents.map((e) => ({
          ...e,
          at: e.at.toISOString(),
        }))}
        mockActive={mockClient !== null}
      />
    </PageContainer>
  )
}
