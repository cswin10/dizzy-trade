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

function ReadoutLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-widest text-light/40">
      {children}
    </span>
  )
}

function EmptyReadout({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-center text-[11px] uppercase tracking-widest text-light/40">
      - {children} -
    </p>
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Open positions">
          <div className="flex flex-col gap-2">
            <ReadoutLabel>Count</ReadoutLabel>
            <span className="text-2xl font-medium text-light">0</span>
            <EmptyReadout>No positions</EmptyReadout>
          </div>
        </Panel>

        <Panel title="Today PnL">
          <div className="flex flex-col gap-2">
            <ReadoutLabel>PnL · 24h</ReadoutLabel>
            <span className="text-2xl font-medium text-accent">0.0000</span>
            <span className="text-[11px] uppercase tracking-widest text-light/40">
              Realised · 0.0000
            </span>
          </div>
        </Panel>

        <Panel title="Rules">
          <div className="flex flex-col gap-2">
            <ReadoutLabel>Status</ReadoutLabel>
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
          <div className="flex flex-col gap-2">
            <ReadoutLabel>Tracked</ReadoutLabel>
            <span className="text-2xl font-medium text-light">0</span>
            <EmptyReadout>Empty</EmptyReadout>
          </div>
        </Panel>
      </div>

      <div className="mt-3">
        <Panel title="Recent trades">
          <div className="flex min-h-[120px] items-center justify-center">
            <EmptyReadout>Trade log empty</EmptyReadout>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Narrative heat">
          <div className="flex min-h-[120px] items-center justify-center">
            <EmptyReadout>Awaiting data</EmptyReadout>
          </div>
        </Panel>
        <Panel title="Claude digest">
          <div className="flex min-h-[120px] items-center justify-center">
            <EmptyReadout>Awaiting data</EmptyReadout>
          </div>
        </Panel>
      </div>
    </PageContainer>
  )
}
