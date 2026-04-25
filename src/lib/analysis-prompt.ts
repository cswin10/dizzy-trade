import 'server-only'

import { LESSON_TAGS } from '@/lib/validations/analysis'

export type AnalysisCandle = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export type AnalysisTradeRecord = {
  asset_symbol: string
  direction: 'long' | 'short'
  entry_price: number
  exit_price: number | null
  entry_size: number
  exit_size: number | null
  leverage: number | null
  entry_at: string
  exit_at: string | null
  outcome: 'win' | 'loss' | 'breakeven' | 'open'
  pnl: number | null
  risk_amount_gbp: number | null
  narrative_tag: string | null
  setup_type: string | null
  thesis: string | null
  lesson: string | null
  source: 'manual' | 'hyperliquid' | 'coinbase' | 'onchain'
  btc_context_at_entry: 'up' | 'down' | 'ranging' | null
}

export type AnalysisAlertContext = {
  framework_id: string
  triggered_at: string
  suggested_direction: 'long' | 'short' | null
  suggested_entry: number | null
  suggested_stop: number | null
  suggested_target: number | null
  position_size_coin: number | null
  position_size_usd: number | null
  leverage_implied: number | null
  rules_status: 'passed' | 'blocked' | 'warning' | null
  rules_violations: unknown
}

export type AnalysisSimilarTrade = {
  asset_symbol: string
  direction: 'long' | 'short'
  outcome: 'win' | 'loss' | 'breakeven'
  pnl: number | null
  entry_at: string
  exit_at: string | null
  setup_type: string | null
  lesson: string | null
}

export type AnalysisContext = {
  trade: AnalysisTradeRecord
  alert: AnalysisAlertContext | null
  pairCandlesAtEntry: AnalysisCandle[]
  btcCandlesAtEntry: AnalysisCandle[]
  pairCandlesAtExit: AnalysisCandle[]
  similarPairTrades: AnalysisSimilarTrade[]
  similarFrameworkOutcomeTrades: AnalysisSimilarTrade[]
  topLessonTags: { tag: string; count: number }[]
}

export const ANALYSIS_SYSTEM_PROMPT = `You are a senior trading coach reviewing a single closed trade for a self-directed crypto trader.

The trader is running a mean-reversion framework on BTC, ETH and SOL on the 1h timeframe. They are currently validating positive expectancy over a 50-trade sample, so every individual trade is one data point in a larger experiment. Your job is to help them understand whether this trade was well-executed against their plan, regardless of outcome. Process is the metric, not pnl on a single trade.

Be direct and concise. Use British English. Do not use em dashes.

You will receive the trade itself, the alert that triggered it (if any), market context candles before entry and around exit, similar past trades, and the trader's most-used lesson tags.

You must reply with a single JSON object and no other text. The schema is:

{
  "analysis_text": "Markdown-formatted overall review. 3-6 short paragraphs. Reference specific numbers from the data.",
  "what_went_right": "1-3 short sentences naming what the trader did correctly.",
  "what_went_wrong": "1-3 short sentences naming what the trader could have done better. If the execution was clean, say so honestly.",
  "pattern_insight": "Optional. If the similar past trades reveal a recurring pattern, note it in 1-2 sentences. Otherwise return null.",
  "lesson_tag": "Exactly one snake_case value from the allowed list."
}

Allowed lesson_tag values:
${LESSON_TAGS.map((tag) => `  - ${tag}`).join('\n')}

Pick the single most informative tag. clean_execution_win and clean_execution_loss are the right choice when the trader followed the plan and the outcome was simply the result of variance. Do not invent new tags. Do not add commentary outside the JSON object.`

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return 'null'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatCandles(candles: AnalysisCandle[]): string {
  if (candles.length === 0) return '  (no candles available)'
  return candles
    .map((c) => {
      const ts = new Date(c.t).toISOString()
      return `  ${ts} O=${formatNumber(c.o)} H=${formatNumber(c.h)} L=${formatNumber(c.l)} C=${formatNumber(c.c)} V=${formatNumber(c.v, 0)}`
    })
    .join('\n')
}

function formatTrade(trade: AnalysisTradeRecord): string {
  const pnl = trade.pnl == null ? 'null' : formatNumber(trade.pnl)
  const risk =
    trade.risk_amount_gbp == null
      ? 'null'
      : `£${formatNumber(trade.risk_amount_gbp)}`
  const r =
    trade.pnl != null && trade.risk_amount_gbp && trade.risk_amount_gbp > 0
      ? formatNumber(trade.pnl / trade.risk_amount_gbp)
      : 'null'
  return [
    `  pair: ${trade.asset_symbol}`,
    `  direction: ${trade.direction}`,
    `  entry_price: ${formatNumber(trade.entry_price)}`,
    `  exit_price: ${trade.exit_price == null ? 'null' : formatNumber(trade.exit_price)}`,
    `  entry_size: ${formatNumber(trade.entry_size, 4)}`,
    `  exit_size: ${trade.exit_size == null ? 'null' : formatNumber(trade.exit_size, 4)}`,
    `  leverage: ${trade.leverage ?? 'null'}`,
    `  entry_at: ${trade.entry_at}`,
    `  exit_at: ${trade.exit_at ?? 'null'}`,
    `  outcome: ${trade.outcome}`,
    `  pnl_usd: ${pnl}`,
    `  risk_gbp: ${risk}`,
    `  r_multiple: ${r}`,
    `  narrative_tag: ${trade.narrative_tag ?? 'null'}`,
    `  setup_type: ${trade.setup_type ?? 'null'}`,
    `  thesis: ${trade.thesis ?? 'null'}`,
    `  lesson_at_close: ${trade.lesson ?? 'null'}`,
    `  source: ${trade.source}`,
    `  btc_context_at_entry: ${trade.btc_context_at_entry ?? 'unknown'}`,
  ].join('\n')
}

function formatAlert(alert: AnalysisAlertContext | null): string {
  if (!alert) {
    return '  (this trade was logged manually, with no alert attached)'
  }
  return [
    `  framework_id: ${alert.framework_id}`,
    `  triggered_at: ${alert.triggered_at}`,
    `  suggested_direction: ${alert.suggested_direction ?? 'null'}`,
    `  suggested_entry: ${alert.suggested_entry == null ? 'null' : formatNumber(alert.suggested_entry)}`,
    `  suggested_stop: ${alert.suggested_stop == null ? 'null' : formatNumber(alert.suggested_stop)}`,
    `  suggested_target: ${alert.suggested_target == null ? 'null' : formatNumber(alert.suggested_target)}`,
    `  position_size_coin: ${alert.position_size_coin == null ? 'null' : formatNumber(alert.position_size_coin, 4)}`,
    `  position_size_usd: ${alert.position_size_usd == null ? 'null' : formatNumber(alert.position_size_usd)}`,
    `  leverage_implied: ${alert.leverage_implied == null ? 'null' : formatNumber(alert.leverage_implied)}`,
    `  rules_status: ${alert.rules_status ?? 'null'}`,
    `  rules_violations: ${JSON.stringify(alert.rules_violations ?? null)}`,
  ].join('\n')
}

function formatSimilar(rows: AnalysisSimilarTrade[]): string {
  if (rows.length === 0) return '  (no comparable trades in history)'
  return rows
    .map((row, i) => {
      const pnl = row.pnl == null ? 'null' : formatNumber(row.pnl)
      return [
        `  ${i + 1}. ${row.asset_symbol} ${row.direction} ${row.outcome} pnl=${pnl}`,
        `     entry_at=${row.entry_at} exit_at=${row.exit_at ?? 'null'}`,
        `     setup_type=${row.setup_type ?? 'null'}`,
        `     lesson=${row.lesson ?? 'null'}`,
      ].join('\n')
    })
    .join('\n')
}

function formatLessonTags(rows: { tag: string; count: number }[]): string {
  if (rows.length === 0) return '  (no prior tags)'
  return rows.map((r) => `  ${r.tag} (${r.count})`).join('\n')
}

export function buildAnalysisUserPrompt(context: AnalysisContext): string {
  return [
    'TRADE',
    formatTrade(context.trade),
    '',
    'ALERT',
    formatAlert(context.alert),
    '',
    `PAIR CANDLES BEFORE ENTRY (${context.trade.asset_symbol}, 1h, last 20 ending at entry)`,
    formatCandles(context.pairCandlesAtEntry),
    '',
    'BTC CANDLES BEFORE ENTRY (1h, last 20 ending at entry)',
    formatCandles(context.btcCandlesAtEntry),
    '',
    `PAIR CANDLES AROUND EXIT (${context.trade.asset_symbol}, 1h, last 10 ending at exit)`,
    formatCandles(context.pairCandlesAtExit),
    '',
    'SIMILAR PAST TRADES · same pair and direction',
    formatSimilar(context.similarPairTrades),
    '',
    'SIMILAR PAST TRADES · same framework and outcome',
    formatSimilar(context.similarFrameworkOutcomeTrades),
    '',
    "TRADER'S MOST-USED LESSON TAGS",
    formatLessonTags(context.topLessonTags),
    '',
    'Respond with the JSON object now. No prose outside the object.',
  ].join('\n')
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

/**
 * Strip markdown code fences if Claude wrapped the JSON in one despite
 * the system prompt. Returns the inner string when a fence is present
 * and the original string otherwise.
 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const match = FENCE_RE.exec(trimmed)
  if (match && match[1]) return match[1].trim()
  return trimmed
}
