import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  RulesStatusPanel,
  type RulesLiveState,
} from '@/components/shared/RulesStatusPanel'
import { Panel } from '@/components/ui/Panel'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Rules · Dizzy Trade',
}

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function loadInitialState(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<RulesLiveState> {
  const [openRes, pnlRes, lastLossRes, recentRes] = await Promise.all([
    supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('outcome', 'open'),
    supabase
      .from('trades')
      .select('pnl')
      .eq('tenant_id', tenantId)
      .in('outcome', ['win', 'loss', 'breakeven'])
      .gte('exit_at', startOfTodayUtcIso()),
    supabase
      .from('trades')
      .select('exit_at')
      .eq('tenant_id', tenantId)
      .eq('outcome', 'loss')
      .order('exit_at', { ascending: false })
      .limit(1),
    supabase
      .from('trades')
      .select('outcome, exit_at')
      .eq('tenant_id', tenantId)
      .in('outcome', ['win', 'loss', 'breakeven'])
      .order('exit_at', { ascending: false })
      .limit(20),
  ])

  let today_realised_pnl_gbp = 0
  for (const row of pnlRes.data ?? []) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      today_realised_pnl_gbp += pnl
    }
  }

  let consecutive_losers_count = 0
  for (const row of recentRes.data ?? []) {
    if (row.outcome === 'loss') consecutive_losers_count++
    else break
  }

  return {
    open_positions_count: openRes.count ?? 0,
    today_realised_pnl_gbp,
    consecutive_losers_count,
    last_loss_at: lastLossRes.data?.[0]?.exit_at ?? null,
  }
}

export default async function RulesPage() {
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

  const { data: strategies } = await supabase
    .from('strategies')
    .select(
      'name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers, is_active',
    )
    .eq('is_active', true)
    .limit(1)

  const strategy = strategies?.[0]
  const initialState: RulesLiveState = tenantId
    ? await loadInitialState(supabase, tenantId)
    : {
        open_positions_count: 0,
        today_realised_pnl_gbp: 0,
        consecutive_losers_count: 0,
        last_loss_at: null,
      }

  return (
    <PageContainer>
      <PageHeader title="Rules" subtitle="Your discipline guardrails" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title={strategy ? `Active rules (${strategy.name})` : 'Active rules'}
        >
          {strategy ? (
            <ul className="flex flex-col gap-2 text-sm text-white/80">
              <RuleLine
                label="Max concurrent positions"
                value={String(strategy.max_concurrent_positions)}
              />
              <RuleLine
                label="Max daily loss"
                value={
                  strategy.max_daily_loss_gbp != null
                    ? `£${Number(strategy.max_daily_loss_gbp).toFixed(0)}`
                    : 'Not set'
                }
              />
              <RuleLine
                label="Risk per trade"
                value={`£${Number(strategy.risk_amount_gbp).toFixed(0)}`}
              />
              <RuleLine
                label="Minimum RR"
                value={`${Number(strategy.min_rr).toFixed(1)}:1`}
              />
              <RuleLine
                label="Max consecutive losers"
                value={
                  strategy.max_consecutive_losers != null
                    ? `${strategy.max_consecutive_losers} (24h cool-down)`
                    : 'Not set'
                }
              />
            </ul>
          ) : (
            <p className="py-3 text-sm text-white/45">
              No active strategy. Activate one in Settings → Strategies to
              enable rule enforcement.
            </p>
          )}
          <p className="mt-4 text-xs text-white/35">
            Edit these in Settings → Strategies.
          </p>
        </Panel>

        {tenantId && strategy ? (
          <RulesStatusPanel
            tenantId={tenantId}
            initial={initialState}
            limits={{
              max_concurrent_positions: strategy.max_concurrent_positions,
              max_daily_loss_gbp:
                strategy.max_daily_loss_gbp == null
                  ? null
                  : Number(strategy.max_daily_loss_gbp),
              max_consecutive_losers: strategy.max_consecutive_losers,
            }}
          />
        ) : (
          <Panel title="Live status">
            <p className="py-3 text-sm text-white/45">
              Live status appears here once a strategy is active.
            </p>
          </Panel>
        )}
      </div>
    </PageContainer>
  )
}

function RuleLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2 last:border-0">
      <span className="text-white/55">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </li>
  )
}
