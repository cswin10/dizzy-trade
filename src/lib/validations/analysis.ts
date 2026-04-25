import { z } from 'zod'

// The fixed vocabulary of lesson tags. Claude is asked to pick exactly
// one. Snake_case values keep them stable as filter URL params and
// avoid quoting in dropdowns. Keep this list short: more tags = more
// scattered filter buckets, less learning per bucket.
export const LESSON_TAGS = [
  'clean_execution_loss',
  'clean_execution_win',
  'stop_too_tight',
  'stop_too_wide',
  'exit_too_early',
  'exit_too_late',
  'bad_entry_timing',
  'wrong_direction',
  'chased_entry',
  'size_too_large',
  'size_too_small',
  'ignored_market_context',
  'discretionary_override_helped',
  'discretionary_override_hurt',
] as const

export type LessonTag = (typeof LESSON_TAGS)[number]

export const LESSON_TAG_LABELS: Record<LessonTag, string> = {
  clean_execution_loss: 'Clean execution · loss',
  clean_execution_win: 'Clean execution · win',
  stop_too_tight: 'Stop too tight',
  stop_too_wide: 'Stop too wide',
  exit_too_early: 'Exit too early',
  exit_too_late: 'Exit too late',
  bad_entry_timing: 'Bad entry timing',
  wrong_direction: 'Wrong direction',
  chased_entry: 'Chased entry',
  size_too_large: 'Size too large',
  size_too_small: 'Size too small',
  ignored_market_context: 'Ignored market context',
  discretionary_override_helped: 'Discretionary override helped',
  discretionary_override_hurt: 'Discretionary override hurt',
}

// The shape Claude is asked to produce. analysis_text is markdown and
// becomes the body of the disclosure; the structured fields populate
// the column chips and the optional pattern callout.
export const tradeAnalysisSchema = z.object({
  analysis_text: z.string().min(1).max(4000),
  what_went_right: z.string().min(1).max(800),
  what_went_wrong: z.string().min(1).max(800),
  pattern_insight: z.string().max(800).nullable().optional(),
  lesson_tag: z.enum(LESSON_TAGS),
})

export type TradeAnalysisPayload = z.infer<typeof tradeAnalysisSchema>

export const ANALYSIS_PROMPT_VERSION = 1
