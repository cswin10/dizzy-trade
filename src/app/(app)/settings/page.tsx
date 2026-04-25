import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  NarrativeTagsEditor,
  type NarrativeTagRow,
} from '@/components/shared/NarrativeTagsEditor'
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

export const metadata = {
  title: 'Settings · Dizzy Trade',
}

export default async function SettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [
    { data: thresholds },
    { data: tags },
    { data: universe },
    { data: strategies },
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
              <StrategiesEditor
                initialStrategies={strategyRows}
                universeSymbols={universeSymbols}
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
