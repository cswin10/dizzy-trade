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
  return name.length > 12 ? `${name.slice(0, 12)}…` : name
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
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-light/60">
              <StatusDot />
              <span className="text-teal">Live</span>
            </span>
            <span className="h-4 w-px bg-light/15" aria-hidden="true" />
            <span className="text-[11px] uppercase tracking-widest text-light/60">
              Tenant ·{' '}
              <span className="text-light">
                {tenantName ? shortenTenant(tenantName) : '-'}
              </span>
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Open positions">
          <p className="py-6 text-center text-xs text-light/40">
            No open positions
          </p>
        </Panel>

        <Panel title="Today PnL">
          <div className="flex flex-col gap-2 py-4">
            <span className="text-2xl font-medium text-accent">0.0000</span>
            <span className="text-[11px] uppercase tracking-widest text-light/40">
              24h · 0.0000
            </span>
          </div>
        </Panel>

        <Panel title="Rules">
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-light/60">
              <StatusDot tone="active" />
              <span>0 active</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-light/40">
              <StatusDot tone="muted" />
              <span>0 violations</span>
            </div>
          </div>
        </Panel>

        <Panel title="Watchlist">
          <p className="py-6 text-center text-xs text-light/40">Empty</p>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Recent trades">
          <p className="py-10 text-center text-xs text-light/40">
            No trades logged
          </p>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Narrative heat">
          <p className="py-10 text-center text-xs text-light/40">
            Not yet wired
          </p>
        </Panel>
        <Panel title="Claude digest">
          <p className="py-10 text-center text-xs text-light/40">
            Not yet wired
          </p>
        </Panel>
      </div>
    </PageContainer>
  )
}
