'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { twMerge } from 'tailwind-merge'

import { generateTradeAnalysisAction } from '@/app/actions/analysis'
import { LESSON_TAG_LABELS, type LessonTag } from '@/lib/validations/analysis'

export type TradeAnalysisProps = {
  tradeId: string
  outcome: 'win' | 'loss' | 'breakeven' | 'open'
  analysis: {
    text: string | null
    lesson_tag: string | null
    what_went_right: string | null
    what_went_wrong: string | null
    pattern_insight: string | null
    generated_at: string | null
  }
}

type Phase = 'idle' | 'pending' | 'error'

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function knownTag(tag: string | null): tag is LessonTag {
  return Boolean(tag && tag in LESSON_TAG_LABELS)
}

function tagLabel(tag: string | null): string {
  if (knownTag(tag)) return LESSON_TAG_LABELS[tag]
  return tag ?? 'Unknown'
}

function tagTone(tag: string | null): string {
  if (!tag) return 'border-white/10 text-white/55'
  if (tag.includes('clean_execution_win')) {
    return 'border-positive/40 bg-positive/10 text-positive'
  }
  if (tag.includes('clean_execution_loss')) {
    return 'border-white/15 bg-white/[0.04] text-white/75'
  }
  if (tag.includes('helped')) {
    return 'border-positive/40 bg-positive/10 text-positive'
  }
  return 'border-warning/40 bg-warning/10 text-warning'
}

// Lightweight markdown rendering: paragraphs, bold, italic, simple
// bullet lists. Avoids the weight of a full markdown lib for what is
// essentially short structured prose.
function renderMarkdown(input: string): ReactNode {
  const blocks = input.split(/\n{2,}/)
  return blocks.map((block, blockIdx) => {
    const lines = block.split('\n')
    const isList = lines.every((line) => /^\s*[-*]\s+/.test(line))
    if (isList) {
      return (
        <ul
          key={blockIdx}
          className="ml-4 list-disc space-y-1 text-sm text-white/75"
        >
          {lines.map((line, lineIdx) => (
            <li key={lineIdx}>
              {renderInline(line.replace(/^\s*[-*]\s+/, ''))}
            </li>
          ))}
        </ul>
      )
    }
    return (
      <p key={blockIdx} className="text-sm leading-relaxed text-white/75">
        {lines.map((line, lineIdx) => (
          <span key={lineIdx}>
            {renderInline(line)}
            {lineIdx < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    )
  })
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="text-white">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('*')) {
      parts.push(
        <em key={key++} className="text-white/85">
          {token.slice(1, -1)}
        </em>,
      )
    } else {
      parts.push(
        <code
          key={key++}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-white/80"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function LessonTagChip({ tag }: { tag: string | null }) {
  if (!tag) return null
  return (
    <span
      className={twMerge(
        'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest',
        tagTone(tag),
      )}
    >
      {tagLabel(tag)}
    </span>
  )
}

export function TradeAnalysis({
  tradeId,
  outcome,
  analysis,
}: TradeAnalysisProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hasAnalysis, setHasAnalysis] = useState<boolean>(
    Boolean(analysis.text),
  )
  const lastTriggered = useRef<{
    tradeId: string
    force: boolean
  } | null>(null)

  // Sync external prop updates after server revalidation overwrites
  // initialTrades. Outcome 'open' renders nothing.
  useEffect(() => {
    setHasAnalysis(Boolean(analysis.text))
  }, [analysis.text])

  const generate = useCallback(
    async (force: boolean) => {
      if (phase === 'pending') return
      lastTriggered.current = { tradeId, force }
      setPhase('pending')
      setError(null)
      try {
        const result = await generateTradeAnalysisAction(tradeId, force)
        if (result.status === 'error') {
          setPhase('error')
          setError(result.message)
          return
        }
        if (result.status === 'skipped') {
          setPhase('idle')
          setError(result.reason)
          return
        }
        setPhase('idle')
        setHasAnalysis(true)
      } catch (err) {
        setPhase('error')
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [phase, tradeId],
  )

  const generatedLabel = useMemo(() => {
    if (!analysis.generated_at) return null
    const d = new Date(analysis.generated_at)
    if (Number.isNaN(d.getTime())) return null
    return dateFormatter.format(d)
  }, [analysis.generated_at])

  if (outcome === 'open') return null

  if (!hasAnalysis) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/45">
        {phase === 'pending' ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
            />
            <span className="font-mono uppercase tracking-widest text-accent/85">
              Claude is reviewing this trade
            </span>
          </span>
        ) : (
          <>
            <span>No analysis yet.</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void generate(false)
              }}
              className="font-mono text-[10px] uppercase tracking-widest text-accent transition-colors duration-150 hover:text-white"
            >
              Generate
            </button>
            {error ? <span className="text-warning">· {error}</span> : null}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-white/[0.08] bg-surface-2/40">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-white/45">
            {open ? '▾' : '▸'}
          </span>
          <span className="font-mono uppercase tracking-widest text-white/55">
            Analysis
          </span>
          <LessonTagChip tag={analysis.lesson_tag} />
          {phase === 'pending' ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
              />
              Re-analysing
            </span>
          ) : null}
        </span>
        {generatedLabel ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-white/35">
            {generatedLabel}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="space-y-3 border-t border-white/[0.06] px-3 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          {analysis.text ? renderMarkdown(analysis.text) : null}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {analysis.what_went_right ? (
              <div className="rounded border border-positive/20 bg-positive/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-positive">
                  What went right
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/75">
                  {analysis.what_went_right}
                </p>
              </div>
            ) : null}
            {analysis.what_went_wrong ? (
              <div className="rounded border border-negative/20 bg-negative/5 p-2.5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-negative">
                  What went wrong
                </p>
                <p className="mt-1 text-xs leading-relaxed text-white/75">
                  {analysis.what_went_wrong}
                </p>
              </div>
            ) : null}
          </div>
          {analysis.pattern_insight ? (
            <div className="rounded border border-accent/20 bg-accent/5 p-2.5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
                Pattern insight
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/75">
                {analysis.pattern_insight}
              </p>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-white/[0.04] pt-2 text-[11px] text-white/45">
            <span>
              {error ? <span className="text-warning">{error}</span> : null}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void generate(true)
              }}
              disabled={phase === 'pending'}
              className="font-mono text-[10px] uppercase tracking-widest text-white/55 transition-colors duration-150 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'pending' ? 'Working...' : 'Re-analyse'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
