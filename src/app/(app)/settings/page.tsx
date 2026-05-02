import { redirect } from 'next/navigation'

import { HyperliquidSettings } from '@/components/shared/HyperliquidSettings'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  NarrativeTagsEditor,
  type NarrativeTagRow,
} from '@/components/shared/NarrativeTagsEditor'
import { RulesSettingsTab } from '@/components/shared/RulesSettingsTab'
import type { RulesLiveState } from '@/components/shared/RulesStatusPanel'
import {
  StrategiesEditor,
  type StrategyRow,
} from '@/components/shared/StrategiesEditor'
import {
  ThresholdsEditor,
  type ThresholdRow,
} from '@/components/shared/ThresholdsEditor'
import { Tabs } from '@/components/ui/Tabs'
import { createClient } from '@/lib/supabase/server'
import type { Timeframe } from '@/lib/validations/strategy'

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function loadRulesLiveState(
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

export const metadata = {
  title: 'Settings · Dizzy Trade',
}

export default async function SettingsPage() {
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
  const tenantId = memberships?.[0]?.tenant_id ?? null

  const [
    { data: thresholds },
    { data: tags },
    { data: universe },
    { data: strategies },
    { data: hyperliquidConfig },
    { data: lastSyncRow },
  ] = await Promise.all([
    supabase
      .from('framework_thresholds')
      .select('id, framework_id, key, value, description, updated_at')
      .order('framework_id', { ascending: true })
      .order('key', { ascending: true }),
    supabase
      .from('narrative_tags')
      .select('symbol, heat_level, note, updated_at'),
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    supabase
      .from('strategies')
      .select(
        'id, name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers, is_active',
      )
      .order('created_at', { ascending: true }),
    supabase.from('user_hyperliquid_config').select('main_address').limit(1),
    supabase
      .from('trades')
      .select('last_synced_at')
      .not('last_synced_at', 'is', null)
      .order('last_synced_at', { ascending: false })
      .limit(1),
  ])

  const thresholdRows: ThresholdRow[] = (thresholds ?? []).map((row) => ({
    id: String(row.id),
    framework_id: String(row.framework_id),
    key: String(row.key),
    value: Number(row.value),
    description: row.description ?? null,
    updated_at: row.updated_at ?? null,
  }))

  const tagRows: NarrativeTagRow[] = (tags ?? []).map((row) => ({
    symbol: String(row.symbol),
    heat_level: row.heat_level,
    note: row.note ?? null,
    updated_at: row.updated_at ?? null,
    persisted: true,
  }))

  const universeSymbols = (universe ?? []).map((row) => String(row.symbol))

  const strategyRows: StrategyRow[] = (strategies ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    framework_id: String(row.framework_id),
    timeframe: row.timeframe as Timeframe,
    pair_symbols: (row.pair_symbols ?? []).map(String),
    risk_amount_gbp: Number(row.risk_amount_gbp),
    min_rr: Number(row.min_rr),
    max_concurrent_positions: Number(row.max_concurrent_positions),
    max_daily_loss_gbp:
      row.max_daily_loss_gbp == null ? null : Number(row.max_daily_loss_gbp),
    max_consecutive_losers:
      row.max_consecutive_losers == null
        ? null
        : Number(row.max_consecutive_losers),
    is_active: Boolean(row.is_active),
  }))

  const hyperliquidAddress =
    (hyperliquidConfig?.[0]?.main_address as string | undefined) ?? null
  const hyperliquidLastSynced =
    (lastSyncRow?.[0]?.last_synced_at as string | undefined) ?? null

  const activeStrategy = strategyRows.find((row) => row.is_active) ?? null
  const rulesLiveState: RulesLiveState = tenantId
    ? await loadRulesLiveState(supabase, tenantId)
    : {
        open_positions_count: 0,
        today_realised_pnl_gbp: 0,
        consecutive_losers_count: 0,
        last_loss_at: null,
      }

  return (
    <PageContainer>
      <PageHeader title="Settings" subtitle="Configure your trading system" />
      <Tabs
        defaultTabId="frameworks"
        tabs={[
          {
            id: 'frameworks',
            label: 'Frameworks',
            content: <ThresholdsEditor initialThresholds={thresholdRows} />,
          },
          {
            id: 'strategies',
            label: 'Strategies',
            content: (
              <div className="flex flex-col gap-5">
                <div className="rounded-lg border border-accent/20 bg-accent/[0.06] p-4 text-sm text-white/80">
                  <p className="font-medium text-white">
                    Composable strategies have moved.
                  </p>
                  <p className="mt-1 text-white/65">
                    The new visual builder lives on a dedicated page. The legacy
                    framework editor below is kept for any existing framework
                    strategies.
                  </p>
                  <a
                    href="/settings/strategies"
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
                  >
                    Open the strategies library →
                  </a>
                </div>
                <StrategiesEditor
                  initialStrategies={strategyRows}
                  universeSymbols={universeSymbols}
                />
              </div>
            ),
          },
          {
            id: 'rules',
            label: 'Rules',
            content: (
              <RulesSettingsTab
                tenantId={tenantId}
                strategy={
                  activeStrategy
                    ? {
                        name: activeStrategy.name,
                        max_concurrent_positions:
                          activeStrategy.max_concurrent_positions,
                        max_daily_loss_gbp: activeStrategy.max_daily_loss_gbp,
                        risk_amount_gbp: activeStrategy.risk_amount_gbp,
                        min_rr: activeStrategy.min_rr,
                        max_consecutive_losers:
                          activeStrategy.max_consecutive_losers,
                      }
                    : null
                }
                initialState={rulesLiveState}
              />
            ),
          },
          {
            id: 'hyperliquid',
            label: 'Hyperliquid',
            content: (
              <HyperliquidSettings
                initialAddress={hyperliquidAddress}
                lastSyncedAt={hyperliquidLastSynced}
              />
            ),
          },
          {
            id: 'narratives',
            label: 'Narratives',
            content: (
              <NarrativeTagsEditor
                universeSymbols={universeSymbols}
                initialTags={tagRows}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  )
}
