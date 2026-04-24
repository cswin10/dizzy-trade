import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  NarrativeTagsEditor,
  type NarrativeTagRow,
} from '@/components/shared/NarrativeTagsEditor'
import {
  ThresholdsEditor,
  type ThresholdRow,
} from '@/components/shared/ThresholdsEditor'
import { Tabs } from '@/components/ui/Tabs'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Settings · Dizzy Trade',
}

export default async function SettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: thresholds }, { data: tags }, { data: universe }] =
    await Promise.all([
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
