'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

import { Select } from '@/components/ui/Select'
import {
  NARRATIVE_TAGS,
  OUTCOMES,
  TIME_FILTERS,
  type OutcomeFilter,
  type TimeFilter,
} from '@/lib/constants/trade'
import { LESSON_TAG_LABELS, type LessonTag } from '@/lib/validations/analysis'

const TIME_LABELS: Record<TimeFilter, string> = {
  all: 'All time',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  ytd: 'Year to date',
}

const OUTCOME_LABELS: Record<OutcomeFilter, string> = {
  all: 'All outcomes',
  win: 'Win',
  loss: 'Loss',
  breakeven: 'Breakeven',
  open: 'Open',
}

export type JournalFiltersProps = {
  // The set of lesson tags that appear on at least one of this
  // tenant's trades. The dropdown is hidden until at least 5 trades
  // have any tag, so the filter only surfaces once it would be useful.
  availableLessonTags?: LessonTag[]
  showLessonFilter?: boolean
}

export function JournalFilters({
  availableLessonTags = [],
  showLessonFilter = false,
}: JournalFiltersProps = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname)
      })
    },
    [params, pathname, router],
  )

  return (
    <div
      className={`flex flex-wrap items-end gap-3 ${pending ? 'opacity-70' : ''}`}
    >
      <div className="w-44">
        <Select
          label="Narrative"
          name="narrative"
          value={params.get('narrative') ?? 'all'}
          onChange={(e) => update('narrative', e.target.value)}
        >
          <option value="all">All narratives</option>
          {NARRATIVE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <Select
          label="Outcome"
          name="outcome"
          value={(params.get('outcome') as OutcomeFilter) ?? 'all'}
          onChange={(e) => update('outcome', e.target.value)}
        >
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-44">
        <Select
          label="Time"
          name="time"
          value={(params.get('time') as TimeFilter) ?? 'all'}
          onChange={(e) => update('time', e.target.value)}
        >
          {TIME_FILTERS.map((t) => (
            <option key={t} value={t}>
              {TIME_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {showLessonFilter ? (
        <div className="w-52">
          <Select
            label="Lesson"
            name="lesson"
            value={params.get('lesson') ?? 'all'}
            onChange={(e) => update('lesson', e.target.value)}
          >
            <option value="all">All lessons</option>
            {availableLessonTags.map((tag) => (
              <option key={tag} value={tag}>
                {LESSON_TAG_LABELS[tag]}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>
  )
}
