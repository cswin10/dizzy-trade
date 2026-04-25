import { redirect } from 'next/navigation'

import { JournalAutoAnalyse } from '@/components/shared/JournalAutoAnalyse'
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
import { LESSON_TAGS, type LessonTag } from '@/lib/validations/analysis'

export const metadata = {
  title: 'Journal · Dizzy Trade',
}

const NARRATIVE_SET = new Set<string>(NARRATIVE_TAGS)
const OUTCOME_SET = new Set<string>(OUTCOMES)
const TIME_SET = new Set<string>(TIME_FILTERS)
const LESSON_SET = new Set<string>(LESSON_TAGS)
// The lesson filter only appears once the journal carries enough
// tagged trades for the filter to be useful. Below the threshold the
// dropdown is hidden so the toolbar doesn't feel cluttered.
const LESSON_FILTER_THRESHOLD = 5

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
  const lesson = (() => {
    const v = searchParams.lesson
    const s = Array.isArray(v) ? v[0] : v
    return s && LESSON_SET.has(s) ? (s as LessonTag) : null
  })()
  return { narrative, outcome, time, lesson }
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
  if (filters.lesson) query = query.eq('analysis_lesson_tag', filters.lesson)
  const cutoff = timeFilterCutoff(filters.time)
  if (cutoff) query = query.gte('entry_at', cutoff.toISOString())

  const { data: trades } = await query
  const tradeRows = (trades ?? []) as Trade[]

  // Build the set of lesson tags that this tenant has actually used.
  // The dropdown is hidden until a meaningful sample exists.
  const tagCounts = new Map<LessonTag, number>()
  for (const t of tradeRows) {
    const tag = t.analysis_lesson_tag
    if (typeof tag === 'string' && LESSON_SET.has(tag)) {
      tagCounts.set(
        tag as LessonTag,
        (tagCounts.get(tag as LessonTag) ?? 0) + 1,
      )
    }
  }
  const totalTagged = [...tagCounts.values()].reduce((a, b) => a + b, 0)
  const availableLessonTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

  // Closed trades that were never analysed. The auto-trigger kicks
  // these off one per second so the journal heals itself in the
  // background.
  const pendingAnalysisIds = tradeRows
    .filter(
      (t) =>
        t.outcome !== 'open' &&
        (!t.analysis_text || t.analysis_text.length === 0),
    )
    .map((t) => t.id)

  return (
    <PageContainer>
      <PageHeader
        title="Journal"
        subtitle="Your trade history"
        rightSlot={<LogTradeButton />}
      />
      <div className="mb-6">
        <JournalFilters
          availableLessonTags={availableLessonTags}
          showLessonFilter={totalTagged >= LESSON_FILTER_THRESHOLD}
        />
      </div>
      <Panel>
        <TradeListRealtime
          initialTrades={tradeRows}
          tenantId={tenantId}
          variant="full"
        />
      </Panel>
      <JournalAutoAnalyse tradeIds={pendingAnalysisIds} />
    </PageContainer>
  )
}
