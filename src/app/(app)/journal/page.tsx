import { redirect } from 'next/navigation'

import { JournalFilters } from '@/components/shared/JournalFilters'
import { LogTradeButton } from '@/components/shared/LogTradeButton'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { TradeListRealtime } from '@/components/shared/TradeListRealtime'
import { Panel } from '@/components/ui/Panel'
import {
  NARRATIVE_TAGS,
  OUTCOMES,
  TIME_FILTERS,
  type NarrativeTag,
  type OutcomeFilter,
  type TimeFilter,
} from '@/lib/constants/trade'
import { createClient } from '@/lib/supabase/server'
import type { Trade } from '@/lib/trade-helpers'

export const metadata = {
  title: 'Journal · Dizzy Trade',
}

const NARRATIVE_SET = new Set<string>(NARRATIVE_TAGS)
const OUTCOME_SET = new Set<string>(OUTCOMES)
const TIME_SET = new Set<string>(TIME_FILTERS)

function parseFilters(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const narrative = (() => {
    const v = searchParams.narrative
    const s = Array.isArray(v) ? v[0] : v
    return s && NARRATIVE_SET.has(s) ? (s as NarrativeTag) : null
  })()
  const outcome = (() => {
    const v = searchParams.outcome
    const s = Array.isArray(v) ? v[0] : v
    return s && OUTCOME_SET.has(s) ? (s as OutcomeFilter) : 'all'
  })()
  const time = (() => {
    const v = searchParams.time
    const s = Array.isArray(v) ? v[0] : v
    return s && TIME_SET.has(s) ? (s as TimeFilter) : 'all'
  })()
  return { narrative, outcome, time }
}

function timeFilterCutoff(filter: TimeFilter): Date | null {
  const now = new Date()
  if (filter === '30d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 30)
    return d
  }
  if (filter === '90d') {
    const d = new Date(now)
    d.setDate(d.getDate() - 90)
    return d
  }
  if (filter === 'ytd') {
    return new Date(now.getFullYear(), 0, 1)
  }
  return null
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const filters = parseFilters(searchParams)

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

  let query = supabase
    .from('trades')
    .select('*')
    .order('entry_at', { ascending: false })

  if (filters.narrative) query = query.eq('narrative_tag', filters.narrative)
  if (filters.outcome !== 'all') query = query.eq('outcome', filters.outcome)
  const cutoff = timeFilterCutoff(filters.time)
  if (cutoff) query = query.gte('entry_at', cutoff.toISOString())

  const { data: trades } = await query

  return (
    <PageContainer>
      <PageHeader
        title="Journal"
        subtitle="Your trade history"
        rightSlot={<LogTradeButton />}
      />
      <div className="mb-6">
        <JournalFilters />
      </div>
      <Panel>
        <TradeListRealtime
          initialTrades={(trades ?? []) as Trade[]}
          tenantId={tenantId}
          variant="full"
        />
      </Panel>
    </PageContainer>
  )
}
