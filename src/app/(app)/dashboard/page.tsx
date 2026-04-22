import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Dashboard · Dizzy Trade',
}

function shortenTenant(name: string): string {
  return name.length > 20 ? `${name.slice(0, 20)}…` : name
}

function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
      {children}
    </span>
  )
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: memberships } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  const tenantId = memberships?.[0]?.tenant_id

  let tenantName = ''
  if (tenantId) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .limit(1)
    tenantName = tenants?.[0]?.name ?? ''
  }

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        subtitle={`Signed in as ${user.email ?? 'unknown'}`}
        rightSlot={
          <>
            <span className="inline-flex items-center gap-2">
              <StatusDot tone="positive" />
              <span className="text-sm text-white/55">Live</span>
            </span>
            <span
              className="rounded-md border border-white/[0.06] bg-surface px-2.5 py-1 text-xs text-white/70"
              title={tenantName || undefined}
            >
              {tenantName ? shortenTenant(tenantName) : 'No tenant'}
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Open positions">
          <div className="flex flex-col gap-2 py-2">
            <MetricLabel>Count</MetricLabel>
            <span className="text-4xl font-medium tracking-tight text-white/90">
              0
            </span>
            <span className="text-sm text-white/45">Across 0 venues</span>
          </div>
        </Panel>

        <Panel title="Today PnL">
          <div className="flex flex-col gap-2 py-2">
            <MetricLabel>24h PnL</MetricLabel>
            <span className="text-4xl font-medium tracking-tight text-white/70">
              0.00
            </span>
            <div className="flex flex-col gap-0.5 text-sm text-white/45">
              <span>Realised · 0.00</span>
              <span>Unrealised · 0.00</span>
            </div>
          </div>
        </Panel>

        <Panel title="Rules">
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1">
              <MetricLabel>Active</MetricLabel>
              <span className="text-2xl font-medium tracking-tight text-white/90">
                0
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <MetricLabel>Violations</MetricLabel>
              <span className="text-2xl font-medium tracking-tight text-white/70">
                0
              </span>
            </div>
            <span className="text-sm text-white/55">All systems green</span>
          </div>
        </Panel>

        <Panel title="Watchlist">
          <div className="flex flex-col gap-2 py-2">
            <MetricLabel>Tracked</MetricLabel>
            <span className="text-4xl font-medium tracking-tight text-white/90">
              0
            </span>
            <span className="text-sm text-white/45">0 narratives</span>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Recent trades">
          <div className="flex min-h-[120px] items-center justify-center">
            <p className="text-sm text-white/35">Nothing logged yet</p>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Narrative heat">
          <div className="flex min-h-[120px] items-center justify-center">
            <p className="text-sm text-white/35">Signals will appear here</p>
          </div>
        </Panel>
        <Panel title="Claude digest">
          <div className="flex min-h-[120px] items-center justify-center">
            <p className="text-sm text-white/35">
              First digest generates tomorrow
            </p>
          </div>
        </Panel>
      </div>
    </PageContainer>
  )
}
