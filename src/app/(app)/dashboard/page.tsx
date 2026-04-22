import { redirect } from 'next/navigation'

import { ActivityTabs } from '@/components/shared/ActivityTabs'
import { LogTradeButton } from '@/components/shared/LogTradeButton'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { TradeListRealtime } from '@/components/shared/TradeListRealtime'
import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { createClient } from '@/lib/supabase/server'
import { formatPnl, type Trade } from '@/lib/trade-helpers'

import { twMerge } from 'tailwind-merge'

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

function LiveIndicator() {
  return (
    <span
      aria-hidden="true"
      className="relative ml-4 inline-flex h-2 w-2 items-center justify-center self-center"
    >
      <span className="animate-pulse-ring absolute inset-0 rounded-full bg-accent" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
    </span>
  )
}

function pnlValueClass(value: number): string {
  if (value > 0) {
    return 'text-positive [text-shadow:0_0_24px_rgba(74,222,128,0.4)]'
  }
  if (value < 0) {
    return 'text-negative [text-shadow:0_0_24px_rgba(248,113,113,0.4)]'
  }
  return 'text-[#4C8FFF] [text-shadow:0_0_24px_rgba(76,143,255,0.4)]'
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
  const tenantId = memberships?.[0]?.tenant_id ?? ''

  let tenantName = ''
  if (tenantId) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .limit(1)
    tenantName = tenants?.[0]?.name ?? ''
  }

  // Open positions: distinct venues used as the secondary stat.
  const { data: openTradeRows } = await supabase
    .from('trades')
    .select('id, venue')
    .eq('outcome', 'open')
  const openCount = openTradeRows?.length ?? 0
  const openVenueCount = new Set(
    (openTradeRows ?? []).map((t) => t.venue).filter(Boolean),
  ).size

  // 24h realised PnL: trades that closed in the last 24 hours, summing pnl.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: closed24h } = await supabase
    .from('trades')
    .select('pnl')
    .gte('exit_at', since24h)
    .in('outcome', ['win', 'loss', 'breakeven'])
  const pnl24h = (closed24h ?? []).reduce((acc, row) => acc + (row.pnl ?? 0), 0)

  // Recent trades (last 10) for the Activity panel Trades tab.
  const { data: recentTrades } = await supabase
    .from('trades')
    .select('*')
    .order('entry_at', { ascending: false })
    .limit(10)

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        subtitle={`Signed in as ${user.email ?? 'unknown'}`}
        rightSlot={
          <>
            <LogTradeButton />
            <span className="inline-flex items-center gap-2">
              <StatusDot tone="positive" />
              <span className="text-sm text-accent">Live</span>
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

      <div className="grid grid-cols-12 gap-4 md:grid-rows-2">
        <Panel
          title="24h PnL"
          variant="hero"
          className="col-span-12 md:col-span-6 md:row-span-2"
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center">
              <span
                className={twMerge(
                  'text-6xl font-medium leading-none tracking-tight',
                  pnlValueClass(pnl24h),
                )}
              >
                {formatPnl(pnl24h)}
              </span>
              <LiveIndicator />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/45">
              <span>Realised · {formatPnl(pnl24h)}</span>
              <span aria-hidden="true" className="h-3 w-px bg-white/10" />
              <span>Unrealised · 0.00</span>
              <span aria-hidden="true" className="h-3 w-px bg-white/10" />
              <span>Fees · 0.00</span>
            </div>
            <div className="relative h-10 w-full">
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
              <span className="absolute bottom-0 left-0 text-[10px] text-white/25">
                sparkline pending
              </span>
            </div>
          </div>
        </Panel>

        <Panel
          title="Open positions"
          variant="compact"
          className="col-span-6 md:col-span-3"
        >
          <div className="flex flex-col gap-1.5">
            <MetricLabel>Count</MetricLabel>
            <span className="text-3xl font-medium tracking-tight text-white/90">
              {openCount}
            </span>
            <span className="text-xs text-white/45">
              Across {openVenueCount} venue{openVenueCount === 1 ? '' : 's'}
            </span>
          </div>
        </Panel>

        <Panel
          title="Watchlist"
          variant="compact"
          className="col-span-6 md:col-span-3"
        >
          <div className="flex flex-col gap-1.5">
            <MetricLabel>Tracked</MetricLabel>
            <span className="text-3xl font-medium tracking-tight text-white/90">
              0
            </span>
            <span className="text-xs text-white/45">0 narratives</span>
          </div>
        </Panel>

        <Panel
          title="Rules"
          variant="compact"
          className="col-span-12 md:col-span-6"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-8">
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
            </div>
            <span className="text-xs text-white/55">All systems green</span>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Activity">
          <ActivityTabs
            trades={
              <TradeListRealtime
                initialTrades={(recentTrades ?? []) as Trade[]}
                tenantId={tenantId}
                variant="compact"
                limit={10}
              />
            }
          />
        </Panel>
      </div>
    </PageContainer>
  )
}
