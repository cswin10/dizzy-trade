// AUTO-GENERATED. Do not edit. Run `npm run bundle:scanner` to regenerate.
// Generated: 2026-04-25T11:54:42.374Z
//
// Source files (in dependency order):
//   supabase/functions/_shared/hyperliquid.ts
//   supabase/functions/_shared/rules.ts
//   supabase/functions/_shared/telegram.ts
//   supabase/functions/_shared/frameworks/types.ts
//   supabase/functions/_shared/frameworks/liquidation_hunt.ts
//   supabase/functions/_shared/technical.ts
//   supabase/functions/_shared/frameworks/narrative_breakout.ts
//   supabase/functions/_shared/frameworks/mean_reversion.ts
//   supabase/functions/_shared/frameworks/index.ts
//   supabase/functions/_shared/fx.ts
//   supabase/functions/_shared/hyperliquid_user.ts
//   supabase/functions/_shared/position_sizing.ts
//   supabase/functions/_shared/timeframes.ts
//   supabase/functions/scanner/index.ts
//
// Paste this entire file into the Supabase dashboard scanner Edge
// Function and click Deploy. The split files in supabase/functions/
// remain the source of truth; this is just the deploy artefact.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

// ---------------------------------------------------------------------
// supabase/functions/_shared/hyperliquid.ts
// ---------------------------------------------------------------------

// Deno runtime Hyperliquid client used by the scanner Edge Function.
// The public `info` endpoint handles all the data we need; no auth.

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const DEFAULT_TIMEOUT_MS = 10_000

type MarketData = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
}

type Candle = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

type AssetCtx = {
  funding: string
  openInterest: string
  prevDayPx: string
  dayNtlVlm: string
  markPx: string
  midPx?: string
  oraclePx?: string
}

type MetaAndAssetCtxsResponse = [
  { universe: Array<{ name: string; szDecimals: number }> },
  AssetCtx[],
]

type RawCandle = {
  t: number
  o: string | number
  h: string | number
  l: string | number
  c: string | number
  v: string | number
  s?: string
  i?: string
}

// POSTs JSON to the Hyperliquid info endpoint. Retries once on transport
// failure, fails hard on the second attempt. Throws with a message the
// scanner can log per-pair without crashing the whole scan.
async function postInfo<T>(
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Hyperliquid ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await once()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[hyperliquid] first attempt failed: ${message} (retrying)`)
    return await once()
  }
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

// Fetches every perpetual with its current market context in a single
// call. Result is keyed by symbol for O(1) lookups inside the scanner.
async function getAllMarketData(): Promise<Map<string, MarketData>> {
  const response = await postInfo<MetaAndAssetCtxsResponse>({
    type: 'metaAndAssetCtxs',
  })
  const [meta, ctxs] = response
  const out = new Map<string, MarketData>()
  for (let i = 0; i < meta.universe.length; i++) {
    const entry = meta.universe[i]
    const ctx = ctxs[i]
    if (!entry || !ctx) continue
    out.set(entry.name, {
      symbol: entry.name,
      markPrice: toNumber(ctx.markPx),
      funding: toNumber(ctx.funding),
      openInterest: toNumber(ctx.openInterest),
      dayNotionalVolume: toNumber(ctx.dayNtlVlm),
    })
  }
  return out
}

// Fetches up to `lookback` candles for a symbol ending now. Hyperliquid
// expects startTime/endTime in milliseconds, and returns newest-last.
type CandleInterval = '15m' | '1h' | '4h' | '1d'

const INTERVAL_MS: Record<CandleInterval, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

async function getCandles(
  symbol: string,
  interval: CandleInterval,
  lookback = 100,
): Promise<Candle[]> {
  const now = Date.now()
  const intervalMs = INTERVAL_MS[interval]
  const startTime = now - intervalMs * lookback
  const response = await postInfo<RawCandle[]>({
    type: 'candleSnapshot',
    req: {
      coin: symbol,
      interval,
      startTime,
      endTime: now,
    },
  })
  return response.map((c) => ({
    t: c.t,
    o: toNumber(c.o),
    h: toNumber(c.h),
    l: toNumber(c.l),
    c: toNumber(c.c),
    v: toNumber(c.v),
  }))
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/rules.ts
// ---------------------------------------------------------------------

// Rules evaluation library shared between the scanner Edge Function
// and the Next.js trade-submission server action.
//
// Kept in lockstep with src/lib/rules.ts: same types, same logic, same
// numeric thresholds. If you touch one, touch the other.
//
// The library is pure: no I/O, no environment globals. Callers are
// responsible for loading the strategy, the live state, and the
// proposed trade values, then handing them in as a self-contained
// RulesContext.

type RuleId =
  | 'max_concurrent'
  | 'max_daily_loss'
  | 'consecutive_losers_pause'
  | 'rr_below_min'
  | 'risk_amount_mismatch'

type RuleSeverity = 'block' | 'warn'

type RuleViolation = {
  rule: RuleId
  severity: RuleSeverity
  reason: string
  current_value: number | string
  limit_value: number | string
}

type RulesStatus = 'passed' | 'blocked' | 'warning'

type RulesResult = {
  status: RulesStatus
  violations: RuleViolation[]
}

type RulesContext = {
  strategy: {
    risk_amount_gbp: number
    min_rr: number
    max_concurrent_positions: number
    max_daily_loss_gbp: number | null
    max_consecutive_losers: number | null
  }
  proposedTrade: {
    // null when the caller could not compute the value (e.g. the
    // trade form does not collect a stop, so rr_ratio is unavailable
    // at submission time). Rules that depend on the missing value
    // are silently skipped.
    risk_amount_gbp: number | null
    rr_ratio: number | null
  }
  currentState: {
    open_positions_count: number
    today_realised_pnl_gbp: number // signed; -50 means down £50
    consecutive_losers_count: number
    last_loss_at: Date | null
  }
}

const MS_24H = 24 * 60 * 60 * 1000
const RISK_MISMATCH_TOLERANCE_GBP = 0.5

function fmtGbp(value: number): string {
  return `£${Math.abs(value).toFixed(0)}`
}

function fmtSignedGbp(value: number): string {
  return value >= 0
    ? `up £${value.toFixed(0)}`
    : `down £${Math.abs(value).toFixed(0)}`
}

/**
 * Evaluates the configured rules against a proposed trade. Returns a
 * RulesResult whose `status` is the worst severity encountered:
 * 'blocked' if any rule fired with severity 'block', 'warning' if
 * only warnings, 'passed' otherwise.
 */
function evaluateRules(ctx: RulesContext): RulesResult {
  const violations: RuleViolation[] = []
  const { strategy, proposedTrade, currentState } = ctx

  // 1. Max concurrent positions.
  if (currentState.open_positions_count >= strategy.max_concurrent_positions) {
    violations.push({
      rule: 'max_concurrent',
      severity: 'block',
      reason: `Max concurrent positions reached (${currentState.open_positions_count} of ${strategy.max_concurrent_positions} open)`,
      current_value: currentState.open_positions_count,
      limit_value: strategy.max_concurrent_positions,
    })
  }

  // 2. Daily loss cap. Skipped when no cap is set or when no trade
  // risk was supplied (the form gate may not have a meaningful risk
  // figure yet).
  if (
    strategy.max_daily_loss_gbp != null &&
    proposedTrade.risk_amount_gbp != null
  ) {
    const projectedDownsideGbp =
      proposedTrade.risk_amount_gbp - currentState.today_realised_pnl_gbp
    if (projectedDownsideGbp > strategy.max_daily_loss_gbp) {
      violations.push({
        rule: 'max_daily_loss',
        severity: 'block',
        reason: `Daily loss cap would be exceeded (currently ${fmtSignedGbp(currentState.today_realised_pnl_gbp)}, this trade risks ${fmtGbp(proposedTrade.risk_amount_gbp)}, cap is ${fmtGbp(strategy.max_daily_loss_gbp)})`,
        current_value: currentState.today_realised_pnl_gbp,
        limit_value: strategy.max_daily_loss_gbp,
      })
    }
  }

  // 3. Consecutive losers cool-down. Only fires when the most recent
  // loss is within the last 24h; if the trader has stepped away long
  // enough, the streak no longer pauses new entries.
  if (
    strategy.max_consecutive_losers != null &&
    currentState.consecutive_losers_count >= strategy.max_consecutive_losers &&
    currentState.last_loss_at !== null
  ) {
    const elapsedMs = Date.now() - currentState.last_loss_at.getTime()
    if (elapsedMs < MS_24H) {
      const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000))
      const remainingHours = Math.max(0, 24 - elapsedHours)
      violations.push({
        rule: 'consecutive_losers_pause',
        severity: 'block',
        reason: `Cooling off after ${currentState.consecutive_losers_count} consecutive losses (last loss ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago, ${remainingHours} hour${remainingHours === 1 ? '' : 's'} remaining)`,
        current_value: currentState.consecutive_losers_count,
        limit_value: strategy.max_consecutive_losers,
      })
    }
  }

  // 4. Risk-reward floor. Skipped when the caller could not compute
  // an RR (e.g. trade form without a stop value).
  if (proposedTrade.rr_ratio != null) {
    if (proposedTrade.rr_ratio < strategy.min_rr) {
      violations.push({
        rule: 'rr_below_min',
        severity: 'block',
        reason: `Risk-reward below minimum (${proposedTrade.rr_ratio.toFixed(1)}:1 vs required ${strategy.min_rr.toFixed(1)}:1)`,
        current_value: Number(proposedTrade.rr_ratio.toFixed(2)),
        limit_value: strategy.min_rr,
      })
    }
  }

  // 5. Risk amount drift. Warning only: the trader can override the
  // strategy's nominal risk if they have a reason, but we surface
  // the discrepancy.
  if (proposedTrade.risk_amount_gbp != null) {
    const diff = Math.abs(
      proposedTrade.risk_amount_gbp - strategy.risk_amount_gbp,
    )
    if (diff > RISK_MISMATCH_TOLERANCE_GBP) {
      violations.push({
        rule: 'risk_amount_mismatch',
        severity: 'warn',
        reason: `Trade risk differs from strategy (${fmtGbp(proposedTrade.risk_amount_gbp)} vs ${fmtGbp(strategy.risk_amount_gbp)})`,
        current_value: proposedTrade.risk_amount_gbp,
        limit_value: strategy.risk_amount_gbp,
      })
    }
  }

  const hasBlock = violations.some((v) => v.severity === 'block')
  const hasWarn = violations.some((v) => v.severity === 'warn')
  const status: RulesStatus = hasBlock
    ? 'blocked'
    : hasWarn
      ? 'warning'
      : 'passed'

  return { status, violations }
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/telegram.ts
// ---------------------------------------------------------------------

// Deno runtime Telegram notifier. Opt-in via env: if the token or chat
// id are unset we return false and skip the notification, so a
// partially-configured deployment still runs cleanly.


type TelegramAlertPayload = {
  framework_name: string
  symbol: string
  direction: 'long' | 'short'
  entry: number
  stop: number
  target: number
  funding: number
  oiDeltaPct: number
  appUrl: string
  positionSizeCoin?: number | null
  positionSizeUsd?: number | null
  leverageImplied?: number | null
  riskAmountGbp?: number | null
  validUntil?: Date | null
  timeframe?: '15m' | '1h' | '4h' | '1d' | null
  rulesStatus?: RulesStatus | null
  rulesViolations?: RuleViolation[] | null
}

function pct(x: number, digits = 2): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
}

function priceDiffPct(from: number, to: number): string {
  if (!Number.isFinite(from) || from === 0) return '-'
  return `${((Math.abs(to - from) / from) * 100).toFixed(2)}%`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1')
}

function rrLabel(entry: number, stop: number, target: number): string {
  const risk = Math.abs(entry - stop)
  if (risk <= 0) return ''
  const reward = Math.abs(target - entry)
  const ratio = reward / risk
  if (!Number.isFinite(ratio) || ratio <= 0) return ''
  return `1:${ratio.toFixed(1)} RR`
}

function formatCoin(value: number, symbol: string): string {
  const abs = Math.abs(value)
  let decimals: number
  if (abs >= 1000) decimals = 0
  else if (abs >= 1) decimals = 4
  else if (abs >= 0.01) decimals = 2
  else decimals = 0
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${symbol}`
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatValidUntil(validUntil: Date, timeframe: string | null): string {
  const hh = String(validUntil.getUTCHours()).padStart(2, '0')
  const mm = String(validUntil.getUTCMinutes()).padStart(2, '0')
  const tfLabel = timeframe ? ` (next ${timeframe} close)` : ''
  return `${hh}:${mm} UTC${tfLabel}`
}

function rulesHeaderPrefix(status: RulesStatus | null | undefined): {
  emoji: string
  suffix: string
} {
  if (status === 'blocked') return { emoji: '🛑', suffix: ' BLOCKED' }
  return { emoji: '🚨', suffix: '' }
}

function rulesSummaryLine(
  status: RulesStatus | null | undefined,
  violations: RuleViolation[] | null | undefined,
): string | null {
  if (!status || status === 'passed' || !violations || violations.length === 0)
    return null
  const reasons = violations.map((v) => v.reason).join('; ')
  if (status === 'blocked') {
    return `🛑 *Rules blocked*: ${escapeMarkdown(reasons)}`
  }
  return `⚠️ *Rules warning*: ${escapeMarkdown(reasons)}`
}

function formatAlertMessage(alert: TelegramAlertPayload): string {
  const dirLabel = alert.direction.toUpperCase()
  const fundingLabel = pct(alert.funding, 3)
  const oiLabel = `${alert.oiDeltaPct >= 0 ? '+' : ''}${alert.oiDeltaPct.toFixed(0)}% vs 24h avg`

  const stopLine = (() => {
    const distancePct = priceDiffPct(alert.entry, alert.stop)
    const riskTail =
      alert.riskAmountGbp != null && alert.riskAmountGbp > 0
        ? ` / £${alert.riskAmountGbp.toFixed(0)} risk`
        : ''
    return `Stop: ${alert.stop.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${distancePct}${riskTail})`
  })()

  const targetLine = (() => {
    const rr = rrLabel(alert.entry, alert.stop, alert.target)
    const tail = rr ? ` (${rr})` : ''
    return `Target: ${alert.target.toLocaleString(undefined, { maximumFractionDigits: 6 })}${tail}`
  })()

  const header = rulesHeaderPrefix(alert.rulesStatus)
  const lines: string[] = [
    `${header.emoji} *${escapeMarkdown(alert.framework_name)}${header.suffix}* — *${escapeMarkdown(alert.symbol)}*`,
    `Direction: *${dirLabel}*`,
    `Entry: ${alert.entry.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
    stopLine,
    targetLine,
    `Funding: ${fundingLabel} | OI: ${oiLabel}`,
  ]

  if (
    alert.positionSizeCoin != null &&
    alert.positionSizeUsd != null &&
    alert.positionSizeCoin > 0
  ) {
    lines.push('')
    lines.push(
      `Position: ${formatCoin(alert.positionSizeCoin, alert.symbol)} (${formatUsd(alert.positionSizeUsd)})`,
    )
    if (alert.leverageImplied != null && alert.leverageImplied > 0) {
      const lev = Math.round(alert.leverageImplied)
      const warn = lev > 100 ? ' ⚠️ HIGH LEVERAGE' : ''
      lines.push(`Leverage: ${lev}x${warn}`)
    }
  }

  const rulesLine = rulesSummaryLine(alert.rulesStatus, alert.rulesViolations)
  if (rulesLine) {
    lines.push('')
    lines.push(rulesLine)
  }

  if (alert.validUntil) {
    lines.push('')
    lines.push(
      `Valid until: ${formatValidUntil(alert.validUntil, alert.timeframe ?? null)}`,
    )
  }

  lines.push('')
  lines.push(`View in Dizzy Trade: ${alert.appUrl}`)

  return lines.join('\n')
}

type TelegramClosePayload = {
  symbol: string
  direction: 'long' | 'short'
  entry: number
  exit: number
  pnlGbp: number
  rMultiple: number | null
  outcome: 'win' | 'loss' | 'breakeven'
  appUrl: string
}

function formatCloseMessage(payload: TelegramClosePayload): string {
  const dirLabel = payload.direction.toUpperCase()
  const outcomeLabel =
    payload.outcome === 'win'
      ? 'WIN'
      : payload.outcome === 'loss'
        ? 'LOSS'
        : 'BREAKEVEN'
  const pnlSign = payload.pnlGbp >= 0 ? '+' : '-'
  const pnlAbs = Math.abs(payload.pnlGbp).toFixed(0)
  const rTail =
    payload.rMultiple != null && Number.isFinite(payload.rMultiple)
      ? ` (${payload.rMultiple >= 0 ? '+' : ''}${payload.rMultiple.toFixed(1)}R)`
      : ''
  return [
    `🏁 *Trade closed* — *${escapeMarkdown(payload.symbol)}*`,
    `Direction: ${dirLabel}`,
    `Entry: ${payload.entry.toLocaleString(undefined, { maximumFractionDigits: 6 })} → Exit: ${payload.exit.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
    `PnL: ${pnlSign}£${pnlAbs}${rTail}`,
    `Outcome: ${outcomeLabel}`,
    '',
    `View: ${payload.appUrl}`,
  ].join('\n')
}

async function sendTelegramClose(
  payload: TelegramClosePayload,
): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) {
    console.warn('[telegram] not configured, skipping close notification')
    return false
  }
  const text = formatCloseMessage(payload)
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      console.error(
        `[telegram] close send failed ${response.status}: ${body.slice(0, 200)}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error('[telegram] close send errored:', error)
    return false
  }
}

async function sendTelegramAlert(
  alert: TelegramAlertPayload,
): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) {
    console.warn('[telegram] not configured, skipping notification')
    return false
  }

  const text = formatAlertMessage(alert)
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      console.error(
        `[telegram] send failed ${response.status}: ${body.slice(0, 200)}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error('[telegram] send errored:', error)
    return false
  }
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/frameworks/types.ts
// ---------------------------------------------------------------------

type NarrativeHeat = 'hot' | 'warm' | 'cool' | 'cold'

// Frameworks are timeframe-agnostic. The scanner fetches candles for
// the active strategy's timeframe and passes them through `candles`;
// it is up to the framework to decide how many bars it needs and how
// to interpret them.
type MarketSnapshot = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
  candles?: Candle[]
  fundingHistory?: number[]
  oiHistory?: number[]
  narrativeHeat?: NarrativeHeat
  btcReturn24h?: number
}

type FrameworkResult = {
  triggered: boolean
  conditionValues: Record<string, number | string | boolean>
  suggestedDirection?: 'long' | 'short'
  suggestedEntry?: number
  suggestedStop?: number
  suggestedTarget?: number
}

type DataRequirements = {
  needsCandles?: boolean
  needsFundingHistory?: boolean
  needsOiHistory?: boolean
  needsNarrativeHeat?: boolean
  needsBtcReturn24h?: boolean
}

type Framework = {
  id: string
  name: string
  description: string
  dataRequirements: DataRequirements
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/frameworks/liquidation_hunt.ts
// ---------------------------------------------------------------------

// Framework 3: Liquidation Hunt
// -----------------------------
// Rationale: When funding is extreme and OI is elevated, crowded trades
// line up on one side. A sharp wick in the opposite direction, rejected
// back inside the previous range, is a common liquidation cascade
// signature: forced liquidations blow through stops, then price snaps
// back as the imbalance clears.
//
// All four conditions must hold for the alert to fire.
//
// Thresholds (loaded at runtime from framework_thresholds):
//   funding_threshold       absolute hourly funding floor
//   oi_elevation_multiplier OI must exceed this multiple of 24h avg
//   wick_to_body_ratio      rejection wick / body
//   stop_buffer             fractional buffer beyond wick extreme
//   target_rr_multiple      R multiple for target

const liquidationHuntFramework: Framework = {
  id: 'liquidation_hunt_v1',
  name: 'Liquidation hunt',
  description:
    'Extreme funding plus elevated open interest plus a rejected wick opposite to the funding bias.',
  dataRequirements: {
    needsCandles: true,
    needsFundingHistory: false,
    needsOiHistory: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const fundingThreshold = thresholds.funding_threshold!
    const oiMultiplier = thresholds.oi_elevation_multiplier!
    const wickBodyRatio = thresholds.wick_to_body_ratio!
    const stopBuffer = thresholds.stop_buffer!
    const targetRMultiple = thresholds.target_rr_multiple!

    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
      openInterest: snapshot.openInterest,
    }

    // Condition 1: absolute funding above threshold. Positive funding
    // means longs pay shorts, which usually means price has been pushed
    // up by crowded longs. Negative is the mirror.
    const absFunding = Math.abs(snapshot.funding)
    conditionValues.absFunding = absFunding
    conditionValues.fundingThreshold = fundingThreshold
    if (absFunding <= fundingThreshold) {
      return { triggered: false, conditionValues }
    }

    // Condition 2: OI elevated above the 24h rolling average. Empty
    // history means we haven't captured enough snapshots yet; fail
    // gracefully rather than firing a noisy first-minute alert.
    const oiHistory = snapshot.oiHistory ?? []
    if (oiHistory.length === 0) {
      conditionValues.oiHistoryLength = 0
      return { triggered: false, conditionValues }
    }
    const oiAvg = oiHistory.reduce((acc, x) => acc + x, 0) / oiHistory.length
    const oiRatio = oiAvg > 0 ? snapshot.openInterest / oiAvg : 0
    const oiDeltaPct = oiAvg > 0 ? (snapshot.openInterest / oiAvg - 1) * 100 : 0
    conditionValues.oiAvg24h = oiAvg
    conditionValues.oiRatio = oiRatio
    conditionValues.oiDeltaPct = oiDeltaPct
    if (oiRatio < oiMultiplier) {
      return { triggered: false, conditionValues }
    }

    // Condition 3 and 4: the most recent candle (whatever timeframe
    // the strategy chose) must have a wick opposite to the funding
    // bias and close back inside the range.
    const candles = snapshot.candles ?? []
    if (candles.length === 0) {
      conditionValues.candleAvailable = false
      return { triggered: false, conditionValues }
    }
    const candle = candles[candles.length - 1]!
    const body = Math.abs(candle.c - candle.o)
    const upperWick = candle.h - Math.max(candle.o, candle.c)
    const lowerWick = Math.min(candle.o, candle.c) - candle.l
    conditionValues.candleOpen = candle.o
    conditionValues.candleHigh = candle.h
    conditionValues.candleLow = candle.l
    conditionValues.candleClose = candle.c
    conditionValues.body = body
    conditionValues.upperWick = upperWick
    conditionValues.lowerWick = lowerWick

    // A zero-body candle (doji) would divide by zero; treat body as a
    // tiny epsilon so the ratio is stable without dropping valid
    // rejections.
    const effectiveBody = Math.max(body, Math.abs(candle.c) * 1e-6, 1e-9)

    let direction: 'long' | 'short'
    let stop: number
    let rejected: boolean

    if (snapshot.funding > 0) {
      // Positive funding: crowd is long, look for an upper wick that
      // rejected into the close. Suggested trade is a short.
      direction = 'short'
      const wickRatio = upperWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < wickBodyRatio) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c < candle.h
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.h * (1 + stopBuffer)
    } else {
      // Negative funding: crowd is short, look for a lower wick that
      // rejected back up. Suggested trade is a long.
      direction = 'long'
      const wickRatio = lowerWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < wickBodyRatio) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c > candle.l
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.l * (1 - stopBuffer)
    }

    const entry = snapshot.markPrice
    const risk = Math.abs(entry - stop)
    const target =
      direction === 'short'
        ? entry - risk * targetRMultiple
        : entry + risk * targetRMultiple

    return {
      triggered: true,
      conditionValues,
      suggestedDirection: direction,
      suggestedEntry: entry,
      suggestedStop: stop,
      suggestedTarget: target,
    }
  },
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/technical.ts
// ---------------------------------------------------------------------

// Shared technical analysis helpers for the Deno scanner runtime.
//
// Kept in lockstep with src/lib/technical.ts: same function names, same
// signatures, same numeric results. If you touch one, touch the other.


// Internal fractal window: a swing needs this many confirming candles
// on each side. Small enough to pick up meaningful local extremes on
// 4h candles without being overly restrictive.
const FRACTAL_WINDOW = 2

/**
 * Simple moving average of the last `period` values.
 *
 * @example
 *   sma([1, 2, 3, 4, 5], 3) // 4
 *   sma([1, 2], 5)          // NaN (not enough samples)
 */
function sma(values: number[], period: number): number {
  if (period <= 0 || values.length < period) return NaN
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!
  }
  return sum / period
}

/**
 * Wilder's RSI computed over the full closes array. Returns the RSI at
 * the last close. Needs at least `period + 1` samples; returns NaN
 * otherwise.
 *
 * @example
 *   rsi([44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.6, 45.3, 45.7,
 *        45.2, 45, 44.7, 44.5, 45], 14) // around 61
 */
function rsi(closes: number[], period: number): number {
  if (period <= 0 || closes.length <= period) return NaN
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Swing highs inside the most recent `lookback` candles. A swing high
 * is a candle whose high exceeds the FRACTAL_WINDOW candles either
 * side. Returned in chronological order (oldest first).
 *
 * @example
 *   findSwingHighs(candles, 50) // [{ index: 32, price: 1.82 }, ...]
 */
function findSwingHighs(
  candles: Candle[],
  lookback: number,
): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = []
  const n = candles.length
  const start = Math.max(FRACTAL_WINDOW, n - lookback)
  for (let i = start; i < n - FRACTAL_WINDOW; i++) {
    const high = candles[i]!.h
    let isSwing = true
    for (let j = i - FRACTAL_WINDOW; j <= i + FRACTAL_WINDOW; j++) {
      if (j === i) continue
      if (candles[j]!.h > high) {
        isSwing = false
        break
      }
    }
    if (isSwing) out.push({ index: i, price: high })
  }
  return out
}

/**
 * Swing lows inside the most recent `lookback` candles, mirror of
 * findSwingHighs.
 *
 * @example
 *   findSwingLows(candles, 50) // [{ index: 18, price: 1.41 }, ...]
 */
function findSwingLows(
  candles: Candle[],
  lookback: number,
): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = []
  const n = candles.length
  const start = Math.max(FRACTAL_WINDOW, n - lookback)
  for (let i = start; i < n - FRACTAL_WINDOW; i++) {
    const low = candles[i]!.l
    let isSwing = true
    for (let j = i - FRACTAL_WINDOW; j <= i + FRACTAL_WINDOW; j++) {
      if (j === i) continue
      if (candles[j]!.l < low) {
        isSwing = false
        break
      }
    }
    if (isSwing) out.push({ index: i, price: low })
  }
  return out
}

/**
 * Most recent swing high whose age (distance from the last candle) is
 * at least `minAge`. Null when no such swing exists.
 *
 * @example
 *   mostRecentSwingHigh(candles, 50, 10) // { index: 78, price: 2.14 }
 */
function mostRecentSwingHigh(
  candles: Candle[],
  lookback: number,
  minAge: number,
): { index: number; price: number } | null {
  const swings = findSwingHighs(candles, lookback)
  const lastIdx = candles.length - 1
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i]!
    if (lastIdx - s.index >= minAge) return s
  }
  return null
}

/**
 * Most recent swing low whose age is at least `minAge`. Null otherwise.
 *
 * @example
 *   mostRecentSwingLow(candles, 50, 10) // { index: 65, price: 1.52 }
 */
function mostRecentSwingLow(
  candles: Candle[],
  lookback: number,
  minAge: number,
): { index: number; price: number } | null {
  const swings = findSwingLows(candles, lookback)
  const lastIdx = candles.length - 1
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i]!
    if (lastIdx - s.index >= minAge) return s
  }
  return null
}

/**
 * Nearest round-number level for a price, with step sizes that scale
 * by magnitude.
 *
 *   price < $1          step $0.01
 *   $1 - $10            step $0.25
 *   $10 - $100          step $1
 *   $100 - $1000        step $10
 *   >= $1000            step $100
 *
 * @example
 *   roundNumberProximity(47.30)   // 47
 *   roundNumberProximity(3.12)    // 3
 *   roundNumberProximity(1275)    // 1300
 */
function roundNumberProximity(price: number): number {
  const abs = Math.abs(price)
  let step: number
  if (abs < 1) step = 0.01
  else if (abs < 10) step = 0.25
  else if (abs < 100) step = 1
  else if (abs < 1000) step = 10
  else step = 100
  return Math.round(price / step) * step
}

/**
 * Absolute body size of a candle.
 *
 * @example
 *   candleBody({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 2
 */
function candleBody(c: Candle): number {
  return Math.abs(c.c - c.o)
}

/**
 * Upper wick length (high minus the top of the body).
 *
 * @example
 *   candleUpperWick({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 1
 */
function candleUpperWick(c: Candle): number {
  return c.h - Math.max(c.o, c.c)
}

/**
 * Lower wick length (bottom of the body minus low).
 *
 * @example
 *   candleLowerWick({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 1
 */
function candleLowerWick(c: Candle): number {
  return Math.min(c.o, c.c) - c.l
}

/**
 * Position of the close within the candle range, 0 at the low and 1
 * at the high. Returns 0.5 for a zero-range candle so callers don't
 * divide by zero.
 *
 * @example
 *   candleClosePosition({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 0.75
 */
function candleClosePosition(c: Candle): number {
  const range = c.h - c.l
  if (range <= 0) return 0.5
  return (c.c - c.l) / range
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/frameworks/narrative_breakout.ts
// ---------------------------------------------------------------------

// Framework 1: Narrative Breakout
// -------------------------------
// Rationale: A symbol tagged as "hot" narrative that breaks out above a
// 20-candle 4h range on elevated volume, while outperforming BTC over
// the last 24h and with funding in a healthy band (positive but not
// overheated), is a high-conviction trend continuation setup. Heat
// numeric thresholds (heat_score_absolute, heat_delta_6h) stay dormant
// until a news module writes them; for now the categorical
// narrativeHeat === 'hot' stands in.
//
// Thresholds:
//   breakout_lookback_candles   number of prior 4h candles for level
//   volume_multiplier           volume / SMA20 floor
//   btc_outperformance_24h      asset return minus BTC return floor
//   funding_min_hourly          funding floor
//   funding_max_hourly          funding ceiling
//
// Stop and target are fixed: 0.5% below the breakout level and 2R.

const STOP_BUFFER = 0.005
const TARGET_R_MULTIPLE = 2

const narrativeBreakoutFramework: Framework = {
  id: 'narrative_breakout_v1',
  name: 'Narrative breakout',
  description:
    'Hot narrative symbol breaking a 20-candle 4h range on volume with BTC outperformance.',
  dataRequirements: {
    needsCandles: true,
    needsNarrativeHeat: true,
    needsBtcReturn24h: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const lookback = thresholds.breakout_lookback_candles!
    const volumeMultiplier = thresholds.volume_multiplier!
    const outperformanceFloor = thresholds.btc_outperformance_24h!
    const fundingMin = thresholds.funding_min_hourly!
    const fundingMax = thresholds.funding_max_hourly!

    const conditionValues: Record<string, number | string | boolean> = {
      heat: snapshot.narrativeHeat ?? 'unknown',
      funding: snapshot.funding,
    }

    // Condition 1: narrative tag must be hot. Heat numeric thresholds
    // (heat_score_absolute, heat_delta_6h) are dormant until the news
    // module ships.
    if (snapshot.narrativeHeat !== 'hot') {
      return { triggered: false, conditionValues }
    }

    // Condition 2a: breakout above the high of the previous `lookback`
    // candles. Needs lookback + 1 candles so we can separate "previous"
    // from the current closed candle.
    const candles = snapshot.candles ?? []
    if (candles.length < lookback + 1) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }
    const current = candles[candles.length - 1]!
    const priors = candles.slice(
      candles.length - 1 - lookback,
      candles.length - 1,
    )
    let breakoutLevel = priors[0]!.h
    for (const c of priors) {
      if (c.h > breakoutLevel) breakoutLevel = c.h
    }
    conditionValues.breakout_level = breakoutLevel
    conditionValues.current_close = current.c
    if (current.c <= breakoutLevel) {
      return { triggered: false, conditionValues }
    }

    // Condition 2b: volume above volume_multiplier * SMA20 of the
    // previous `lookback` candles' volumes.
    const priorVolumes = priors.map((c) => c.v)
    const volumeSma = sma(priorVolumes, lookback)
    const volumeRatio = volumeSma > 0 ? current.v / volumeSma : 0
    conditionValues.volume_ratio = volumeRatio
    if (!(volumeRatio > volumeMultiplier)) {
      return { triggered: false, conditionValues }
    }

    // Condition 3: asset 24h return minus BTC 24h return must clear
    // the outperformance floor. 24h on 4h candles is 6 bars back.
    if (snapshot.btcReturn24h === undefined) {
      conditionValues.btcReturnAvailable = false
      return { triggered: false, conditionValues }
    }
    if (candles.length < 7) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }
    const ref = candles[candles.length - 7]!
    const assetReturn24h = ref.c > 0 ? (current.c - ref.c) / ref.c : 0
    const outperformance = assetReturn24h - snapshot.btcReturn24h
    conditionValues.asset_return_24h = assetReturn24h
    conditionValues.btc_return_24h = snapshot.btcReturn24h
    conditionValues.outperformance = outperformance
    if (outperformance < outperformanceFloor) {
      return { triggered: false, conditionValues }
    }

    // Condition 4: funding in the healthy band (positive but not hot).
    if (!(snapshot.funding > fundingMin && snapshot.funding < fundingMax)) {
      return { triggered: false, conditionValues }
    }

    const entry = snapshot.markPrice
    const stop = breakoutLevel * (1 - STOP_BUFFER)
    const risk = entry - stop
    const target = entry + TARGET_R_MULTIPLE * risk

    return {
      triggered: true,
      conditionValues,
      suggestedDirection: 'long',
      suggestedEntry: entry,
      suggestedStop: stop,
      suggestedTarget: target,
    }
  },
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/frameworks/mean_reversion.ts
// ---------------------------------------------------------------------

// Framework 2: Mean Reversion
// ---------------------------
// Rationale: A stretched move into a prior swing level (or a round
// number) that prints an RSI divergence on the 4h and a rejection
// candle, with funding stretched in the same direction, is a classic
// mean-reversion setup. The rejection wick marks the stop; the entry
// is the mark price; the target is 2R.
//
// Long setup requires a bullish rejection at support; short setup is
// the mirror at resistance. Long is evaluated first; if it does not
// qualify we fall through to the short checks.
//
// Thresholds:
//   swing_lookback_candles             lookback for swing detection
//   swing_min_age_candles              min age of the swing level
//   level_proximity_pct                how close price must be to level
//   rsi_period                         RSI period
//   rsi_lookback_candles               RSI divergence / breakout lookback
//   rsi_overbought / rsi_oversold      RSI gates
//   rejection_wick_body_ratio          wick / body for rejection candle
//   rejection_close_position_threshold close position in range
//   funding_stretch_long_setup         funding <= for long
//   funding_stretch_short_setup        funding >= for short

const STOP_BUFFER__mean_reversion = 0.002
const TARGET_R_MULTIPLE__mean_reversion = 2

function stepForPrice(p: number): number {
  const a = Math.abs(p)
  if (a < 1) return 0.01
  if (a < 10) return 0.25
  if (a < 100) return 1
  if (a < 1000) return 10
  return 100
}

function roundBelow(p: number): number {
  const step = stepForPrice(p)
  return Math.floor(p / step) * step
}

function roundAbove(p: number): number {
  const step = stepForPrice(p)
  return Math.ceil(p / step) * step
}

const meanReversionFramework: Framework = {
  id: 'mean_reversion_v1',
  name: 'Mean reversion',
  description:
    'Rejection at a prior 4h swing level or round number with RSI divergence and stretched funding.',
  dataRequirements: {
    needsCandles: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const swingLookback = thresholds.swing_lookback_candles!
    const swingMinAge = thresholds.swing_min_age_candles!
    const levelProximity = thresholds.level_proximity_pct!
    const rsiPeriod = thresholds.rsi_period!
    const rsiLookback = thresholds.rsi_lookback_candles!
    const rsiOverbought = thresholds.rsi_overbought!
    const rsiOversold = thresholds.rsi_oversold!
    const rejectionWickRatio = thresholds.rejection_wick_body_ratio!
    const rejectionClosePos = thresholds.rejection_close_position_threshold!
    const fundingStretchLong = thresholds.funding_stretch_long_setup!
    const fundingStretchShort = thresholds.funding_stretch_short_setup!

    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
    }

    const candles = snapshot.candles ?? []
    const minNeeded = Math.max(
      rsiPeriod + 2,
      rsiLookback + 1,
      swingLookback + 1,
    )
    if (candles.length < minNeeded) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }

    const current = candles[candles.length - 1]!
    const closes = candles.map((c) => c.c)
    const currentRsi = rsi(closes, rsiPeriod)
    conditionValues.rsi = currentRsi
    conditionValues.markPrice = snapshot.markPrice

    // ============================== LONG ==============================
    const longSwing = mostRecentSwingLow(candles, swingLookback, swingMinAge)
    const rBelow = roundBelow(snapshot.markPrice)
    const nearSwingLong =
      longSwing !== null &&
      Math.abs(snapshot.markPrice - longSwing.price) / snapshot.markPrice <=
        levelProximity
    const nearRoundLong =
      rBelow > 0 &&
      Math.abs(snapshot.markPrice - rBelow) / snapshot.markPrice <=
        levelProximity
    conditionValues.longSwingLevel = longSwing ? longSwing.price : 0
    conditionValues.longRoundBelow = rBelow
    conditionValues.longNearLevel = nearSwingLong || nearRoundLong

    if (nearSwingLong || nearRoundLong) {
      // Current candle must print a new 20-candle price low.
      let lowestPrior = Infinity
      for (
        let i = Math.max(0, candles.length - rsiLookback);
        i < candles.length - 1;
        i++
      ) {
        const lo = candles[i]!.l
        if (lo < lowestPrior) lowestPrior = lo
      }
      const makesNewLow = current.l <= lowestPrior
      conditionValues.longMakesNewLow = makesNewLow

      // RSI divergence: RSI at the most recent prior swing low inside
      // the divergence lookback must be below currentRsi.
      const divSwing = mostRecentSwingLow(candles, rsiLookback, 1)
      let bullishDivergence = false
      if (divSwing !== null) {
        const closesAtSwing = closes.slice(0, divSwing.index + 1)
        const swingRsi = rsi(closesAtSwing, rsiPeriod)
        conditionValues.longSwingRsi = swingRsi
        if (Number.isFinite(swingRsi) && Number.isFinite(currentRsi)) {
          bullishDivergence = currentRsi > swingRsi
        }
      }
      conditionValues.longBullishDivergence = bullishDivergence

      const rsiOk = Number.isFinite(currentRsi) && currentRsi < rsiOversold

      // Rejection candle: lower wick dominates, bullish close, close
      // in the upper portion of the range.
      const body = candleBody(current)
      const lowerWick = candleLowerWick(current)
      const closePos = candleClosePosition(current)
      const effectiveBody = Math.max(body, Math.abs(current.c) * 1e-6, 1e-9)
      const wickRatio = lowerWick / effectiveBody
      const bullishCandle = current.c > current.o
      const closePosOk = closePos >= rejectionClosePos
      const rejection =
        wickRatio > rejectionWickRatio && bullishCandle && closePosOk
      conditionValues.longWickRatio = wickRatio
      conditionValues.longClosePosition = closePos
      conditionValues.longRejection = rejection

      const fundingOk = snapshot.funding <= fundingStretchLong
      conditionValues.longFundingOk = fundingOk

      if (makesNewLow && bullishDivergence && rsiOk && rejection && fundingOk) {
        const entry = snapshot.markPrice
        const stop = current.l * (1 - STOP_BUFFER__mean_reversion)
        const risk = entry - stop
        const target = entry + TARGET_R_MULTIPLE__mean_reversion * risk
        return {
          triggered: true,
          conditionValues,
          suggestedDirection: 'long',
          suggestedEntry: entry,
          suggestedStop: stop,
          suggestedTarget: target,
        }
      }
    }

    // ============================== SHORT =============================
    const shortSwing = mostRecentSwingHigh(candles, swingLookback, swingMinAge)
    const rAbove = roundAbove(snapshot.markPrice)
    const nearSwingShort =
      shortSwing !== null &&
      Math.abs(snapshot.markPrice - shortSwing.price) / snapshot.markPrice <=
        levelProximity
    const nearRoundShort =
      rAbove > 0 &&
      Math.abs(snapshot.markPrice - rAbove) / snapshot.markPrice <=
        levelProximity
    conditionValues.shortSwingLevel = shortSwing ? shortSwing.price : 0
    conditionValues.shortRoundAbove = rAbove
    conditionValues.shortNearLevel = nearSwingShort || nearRoundShort

    if (nearSwingShort || nearRoundShort) {
      let highestPrior = -Infinity
      for (
        let i = Math.max(0, candles.length - rsiLookback);
        i < candles.length - 1;
        i++
      ) {
        const hi = candles[i]!.h
        if (hi > highestPrior) highestPrior = hi
      }
      const makesNewHigh = current.h >= highestPrior
      conditionValues.shortMakesNewHigh = makesNewHigh

      const divSwing = mostRecentSwingHigh(candles, rsiLookback, 1)
      let bearishDivergence = false
      if (divSwing !== null) {
        const closesAtSwing = closes.slice(0, divSwing.index + 1)
        const swingRsi = rsi(closesAtSwing, rsiPeriod)
        conditionValues.shortSwingRsi = swingRsi
        if (Number.isFinite(swingRsi) && Number.isFinite(currentRsi)) {
          bearishDivergence = currentRsi < swingRsi
        }
      }
      conditionValues.shortBearishDivergence = bearishDivergence

      const rsiOk = Number.isFinite(currentRsi) && currentRsi > rsiOverbought

      const body = candleBody(current)
      const upperWick = candleUpperWick(current)
      const closePos = candleClosePosition(current)
      const effectiveBody = Math.max(body, Math.abs(current.c) * 1e-6, 1e-9)
      const wickRatio = upperWick / effectiveBody
      const bearishCandle = current.c < current.o
      const closePosOk = closePos <= 1 - rejectionClosePos
      const rejection =
        wickRatio > rejectionWickRatio && bearishCandle && closePosOk
      conditionValues.shortWickRatio = wickRatio
      conditionValues.shortClosePosition = closePos
      conditionValues.shortRejection = rejection

      const fundingOk = snapshot.funding >= fundingStretchShort
      conditionValues.shortFundingOk = fundingOk

      if (
        makesNewHigh &&
        bearishDivergence &&
        rsiOk &&
        rejection &&
        fundingOk
      ) {
        const entry = snapshot.markPrice
        const stop = current.h * (1 + STOP_BUFFER__mean_reversion)
        const risk = stop - entry
        const target = entry - TARGET_R_MULTIPLE__mean_reversion * risk
        return {
          triggered: true,
          conditionValues,
          suggestedDirection: 'short',
          suggestedEntry: entry,
          suggestedStop: stop,
          suggestedTarget: target,
        }
      }
    }

    return { triggered: false, conditionValues }
  },
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/frameworks/index.ts
// ---------------------------------------------------------------------

// Registered frameworks keyed by id. Adding a new framework is:
//  1. implement it in a new file exporting a Framework object
//  2. import it here and add it to this Map
// The scanner iterates the Map on every tick.
const FRAMEWORKS: Map<string, Framework> = new Map([
  [narrativeBreakoutFramework.id, narrativeBreakoutFramework],
  [meanReversionFramework.id, meanReversionFramework],
  [liquidationHuntFramework.id, liquidationHuntFramework],
])

// ---------------------------------------------------------------------
// supabase/functions/_shared/fx.ts
// ---------------------------------------------------------------------

// GBP/USD rate fetcher with a 1-hour in-memory cache.
//
// Uses Frankfurter (https://api.frankfurter.app), which is free, has
// no auth, and serves ECB reference rates. The Edge Function instance
// is reused across cron ticks so the module-level cache survives long
// enough to keep API hits trivial.
//
// If the API fails, we fall back to a hardcoded 1.27 (close enough
// for v1 sizing) and log a warning so the operator can see something
// went wrong without breaking the scan.

const FALLBACK_RATE = 1.27
const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = { rate: number; expiresAt: number }
let cache: CacheEntry | null = null

type FrankfurterResponse = {
  amount?: number
  base?: string
  date?: string
  rates?: Record<string, number>
}

/**
 * Returns the current GBP→USD rate. Cached for one hour per Edge
 * Function instance.
 *
 * @example
 *   const rate = await getGbpUsdRate() // 1.27
 *   const usd = pounds * rate
 */
async function getGbpUsdRate(): Promise<number> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.rate

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    let response: Response
    try {
      response = await fetch(
        'https://api.frankfurter.app/latest?from=GBP&to=USD',
        { signal: controller.signal },
      )
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new Error(`frankfurter ${response.status}`)
    }
    const body = (await response.json()) as FrankfurterResponse
    const rate = body.rates?.USD
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('frankfurter response missing USD rate')
    }
    cache = { rate, expiresAt: now + CACHE_TTL_MS }
    return rate
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[fx] GBP/USD fetch failed (${message}), using fallback ${FALLBACK_RATE}`,
    )
    return FALLBACK_RATE
  }
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/hyperliquid_user.ts
// ---------------------------------------------------------------------

// Hyperliquid per-account read API.
//
// Hyperliquid exposes positions and fills publicly given an account
// address: no auth, no signing. v1 of the position tracker is
// therefore read-only, and the only piece of user-supplied state we
// need is the main account address.
//
// When v1.1 introduces trade execution, an API wallet (a separate
// authorised key) is layered on top of this client; for now both
// functions hit the public `info` endpoint.
//
// Kept in lockstep with src/lib/hyperliquid_user.ts: same shapes,
// same retry semantics, same timeouts. If you touch one, touch the
// other.

const INFO_URL__hyperliquid_user = 'https://api.hyperliquid.xyz/info'
const REQUEST_TIMEOUT_MS = 10_000

type HyperliquidPosition = {
  coin: string
  szi: number
  entryPx: number | null
  positionValue: number | null
  unrealizedPnl: number | null
  liquidationPx: number | null
}

type HyperliquidUserState = {
  positions: HyperliquidPosition[]
}

type HyperliquidFillDir =
  | 'Open Long'
  | 'Close Long'
  | 'Open Short'
  | 'Close Short'

type HyperliquidFill = {
  coin: string
  px: number
  sz: number
  side: 'A' | 'B'
  time: number
  dir: HyperliquidFillDir | string
  closedPnl: number | null
}

type RawAssetPosition = {
  position?: {
    coin?: string
    szi?: string | number
    entryPx?: string | number
    positionValue?: string | number
    unrealizedPnl?: string | number
    liquidationPx?: string | number | null
  }
}

type RawUserState = {
  assetPositions?: RawAssetPosition[]
}

type RawFill = {
  coin?: string
  px?: string | number
  sz?: string | number
  side?: string
  time?: number
  dir?: string
  closedPnl?: string | number | null
}

function toNumber__hyperliquid_user(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function requireNumber(value: string | number | null | undefined): number {
  return toNumber__hyperliquid_user(value) ?? 0
}

async function postInfo__hyperliquid_user<T>(body: Record<string, unknown>): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(INFO_URL__hyperliquid_user, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Hyperliquid ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await once()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[hyperliquid_user] first attempt failed: ${message}`)
    return await once()
  }
}

/**
 * Returns the open positions and account summary for a Hyperliquid
 * main address. Throws after two failed attempts.
 */
async function getUserState(
  mainAddress: string,
): Promise<HyperliquidUserState> {
  const raw = await postInfo__hyperliquid_user<RawUserState>({
    type: 'clearinghouseState',
    user: mainAddress,
  })
  const positions: HyperliquidPosition[] = []
  for (const entry of raw.assetPositions ?? []) {
    const p = entry.position
    if (!p || !p.coin) continue
    const szi = toNumber__hyperliquid_user(p.szi) ?? 0
    if (szi === 0) continue
    positions.push({
      coin: String(p.coin),
      szi,
      entryPx: toNumber__hyperliquid_user(p.entryPx),
      positionValue: toNumber__hyperliquid_user(p.positionValue),
      unrealizedPnl: toNumber__hyperliquid_user(p.unrealizedPnl),
      liquidationPx: toNumber__hyperliquid_user(p.liquidationPx ?? null),
    })
  }
  return { positions }
}

/**
 * Returns completed fills for a Hyperliquid main address. Optionally
 * filtered to fills at or after `startTime` (Unix milliseconds).
 */
async function getUserFills(
  mainAddress: string,
  startTime?: number,
): Promise<HyperliquidFill[]> {
  const body: Record<string, unknown> = startTime
    ? {
        type: 'userFillsByTime',
        user: mainAddress,
        startTime,
      }
    : {
        type: 'userFills',
        user: mainAddress,
      }
  const raw = await postInfo__hyperliquid_user<RawFill[]>(body)
  return (raw ?? []).map((row) => ({
    coin: String(row.coin ?? ''),
    px: requireNumber(row.px),
    sz: requireNumber(row.sz),
    side: row.side === 'A' || row.side === 'B' ? row.side : 'A',
    time: typeof row.time === 'number' ? row.time : 0,
    dir: String(row.dir ?? ''),
    closedPnl: toNumber__hyperliquid_user(row.closedPnl ?? null),
  }))
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/position_sizing.ts
// ---------------------------------------------------------------------

// Risk-based position sizing for strategy alerts.
//
// Given the strategy's GBP risk per trade, the entry, and the stop,
// we work back to a position size in the base asset and the implied
// notional and leverage. Coin amounts are rounded by price tier so
// the user gets a copy-pasteable size rather than a 12-decimal float.

type SizingInput = {
  entry: number
  stop: number
  riskGbp: number
  gbpUsdRate: number
}

type SizingResult = {
  positionSizeCoin: number
  positionSizeUsd: number
  leverageImplied: number
  riskUsd: number
}

// Decimals for the base-asset position. BTC/ETH end up with 4dp,
// mid-cap coins with 2dp, sub-dollar memecoins with whole units.
function decimalsForPrice(price: number): number {
  const abs = Math.abs(price)
  if (abs >= 1000) return 4
  if (abs >= 10) return 2
  if (abs >= 1) return 1
  return 0
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Compute position size, notional, and implied leverage from a
 * GBP risk amount and an entry/stop pair.
 *
 * @example
 *   computeSizing({ entry: 67245, stop: 66920, riskGbp: 30, gbpUsdRate: 1.27 })
 *   // -> { positionSizeCoin: 0.1172, positionSizeUsd: 7881.12,
 *   //      leverageImplied: 207.0, riskUsd: 38.1 }
 */
function computeSizing(input: SizingInput): SizingResult {
  const riskUsd = input.riskGbp * input.gbpUsdRate
  const stopDistanceUsd = Math.abs(input.entry - input.stop)
  if (stopDistanceUsd <= 0 || riskUsd <= 0 || input.entry <= 0) {
    return {
      positionSizeCoin: 0,
      positionSizeUsd: 0,
      leverageImplied: 0,
      riskUsd,
    }
  }
  const rawCoin = riskUsd / stopDistanceUsd
  const positionSizeCoin = roundTo(rawCoin, decimalsForPrice(input.entry))
  const positionSizeUsd = positionSizeCoin * input.entry
  const leverageImplied = riskUsd > 0 ? positionSizeUsd / riskUsd : 0
  return {
    positionSizeCoin,
    positionSizeUsd,
    leverageImplied,
    riskUsd,
  }
}

// ---------------------------------------------------------------------
// supabase/functions/_shared/timeframes.ts
// ---------------------------------------------------------------------

// Timeframe helpers for strategy candle alignment.
//
// All Hyperliquid candles align to UTC boundaries on intervals that
// divide the day evenly, so a Unix timestamp rounded up to the next
// multiple of the interval gives the next candle close.
//
// If `now` lands exactly on a boundary, the candle that opened at
// that boundary closes one full interval later.

type Timeframe = '15m' | '1h' | '4h' | '1d'

const INTERVAL_MS__timeframes: Record<Timeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

/**
 * Returns the close time of the candle currently open at `now`.
 *
 * @example
 *   nextCandleClose('1h', new Date('2026-04-25T13:42:11Z'))
 *   // -> Date('2026-04-25T14:00:00Z')
 *   nextCandleClose('1h', new Date('2026-04-25T13:00:00Z'))
 *   // -> Date('2026-04-25T14:00:00Z')
 */
function nextCandleClose(
  timeframe: Timeframe,
  now: Date = new Date(),
): Date {
  const ms = now.getTime()
  const interval = INTERVAL_MS__timeframes[timeframe]
  const ceiling = Math.ceil(ms / interval) * interval
  const next = ceiling > ms ? ceiling : ceiling + interval
  return new Date(next)
}

// ---------------------------------------------------------------------
// supabase/functions/scanner/index.ts
// ---------------------------------------------------------------------

// Scanner Edge Function.
//
// Runs every minute via pg_cron. On each tick:
//   1. load the active universe and bulk-fetch market data
//   2. write one market_snapshots row per universe pair (rolling
//      history for OI and funding, used by frameworks that ask for it)
//   3. load active strategies plus the global config (thresholds,
//      narrative tags, BTC reference return)
//   4. for each strategy, evaluate its framework against each of its
//      configured pair_symbols on the strategy's chosen timeframe
//   5. insert alerts (tagged with strategy_id) and fire Telegram
//      notifications for watchlist symbols
//
// Errors on a single pair are logged and swallowed so the rest of the
// scan still runs. A soft 45s and hard 55s time budget caps the
// per-tick work so cron doesn't pile up if Hyperliquid is slow.
//
// market_snapshots writes cover the full universe even though only
// strategy pairs are evaluated. Future strategies that change their
// pair list need historical OI/funding to be useful from day one.



const CONCURRENCY = 5
const HISTORY_WINDOW_MINUTES = 60 * 24 // 24 hours
const SOFT_BUDGET_MS = 45_000
const HARD_BUDGET_MS = 55_000
const CANDLE_LOOKBACK = 60
const APP_URL =
  Deno.env.get('DIZZY_TRADE_APP_URL') ?? 'https://dizzy-trade.vercel.app'

type Timeframe__index = '15m' | '1h' | '4h' | '1d'

type UniverseRow = {
  symbol: string
  coingecko_id: string | null
  is_watchlist: boolean
}

type HyperliquidConfigRow = {
  tenant_id: string
  main_address: string
}

type LiveTradeRow = {
  id: string
  tenant_id: string
  asset_symbol: string
  direction: 'long' | 'short'
  entry_price: number
  linked_at: string | null
}

type StrategyRow = {
  id: string
  name: string
  framework_id: string
  timeframe: Timeframe__index
  pair_symbols: string[]
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  is_active: boolean
}

type RulesState = {
  open_positions_count: number
  today_realised_pnl_gbp: number
  consecutive_losers_count: number
  last_loss_at: Date | null
}

// Simple concurrency pool: run `fn` over every item, but never more than
// `limit` in flight at once. Preserves result ordering by index.
async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        results[idx] = await fn(items[idx]!, idx)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[scanner] task ${idx} failed: ${message}`)
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return results
}

function supabase() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loadUniverse(): Promise<UniverseRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('universe')
    .select('symbol, coingecko_id, is_watchlist')
    .eq('is_active', true)
  if (error) throw new Error(`universe load failed: ${error.message}`)
  return (data ?? []) as UniverseRow[]
}

async function loadActiveStrategies(): Promise<StrategyRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('strategies')
    .select(
      'id, name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers, is_active',
    )
    .eq('is_active', true)
  if (error) {
    throw new Error(`strategies load failed: ${error.message}`)
  }
  return (data ?? []) as StrategyRow[]
}

// At scan time the scanner has no per-tenant context; for v1 with a
// single trader we aggregate across all trades. When we go multi-user
// this needs to scope by tenant.
async function loadRulesState(): Promise<RulesState> {
  const client = supabase()
  const todayUtcStart = new Date()
  todayUtcStart.setUTCHours(0, 0, 0, 0)

  const [openRes, pnlRes, lastLossRes, recentLossesRes] = await Promise.all([
    client
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('outcome', 'open'),
    client
      .from('trades')
      .select('pnl')
      .in('outcome', ['win', 'loss', 'breakeven'])
      .gte('exit_at', todayUtcStart.toISOString()),
    client
      .from('trades')
      .select('exit_at')
      .eq('outcome', 'loss')
      .order('exit_at', { ascending: false })
      .limit(1),
    client
      .from('trades')
      .select('outcome, exit_at')
      .in('outcome', ['win', 'loss', 'breakeven'])
      .order('exit_at', { ascending: false })
      .limit(20),
  ])

  const open_positions_count = openRes.count ?? 0

  let today_realised_pnl_gbp = 0
  for (const row of pnlRes.data ?? []) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      today_realised_pnl_gbp += pnl
    }
  }

  let consecutive_losers_count = 0
  for (const row of recentLossesRes.data ?? []) {
    if (row.outcome === 'loss') consecutive_losers_count++
    else break
  }

  let last_loss_at: Date | null = null
  const lastLoss = lastLossRes.data?.[0]?.exit_at
  if (typeof lastLoss === 'string') last_loss_at = new Date(lastLoss)

  return {
    open_positions_count,
    today_realised_pnl_gbp,
    consecutive_losers_count,
    last_loss_at,
  }
}

function computeRrRatio(
  direction: 'long' | 'short' | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (entry == null || stop == null || target == null) return null
  if (!direction) return null
  const risk = direction === 'long' ? entry - stop : stop - entry
  const reward = direction === 'long' ? target - entry : entry - target
  if (risk <= 0 || reward <= 0) return null
  return reward / risk
}

// Nested map: framework_id -> key -> value. Frameworks that have no
// row in the table get an empty inner map and will error on missing
// keys, which surfaces quickly in logs without silently misfiring.
async function loadThresholds(): Promise<Map<string, Record<string, number>>> {
  const client = supabase()
  const { data, error } = await client
    .from('framework_thresholds')
    .select('framework_id, key, value')
  if (error) {
    throw new Error(`threshold load failed: ${error.message}`)
  }
  const out = new Map<string, Record<string, number>>()
  for (const row of data ?? []) {
    const frameworkId = String(row.framework_id)
    const bucket = out.get(frameworkId) ?? {}
    bucket[String(row.key)] = Number(row.value)
    out.set(frameworkId, bucket)
  }
  return out
}

async function loadNarrativeHeat(): Promise<Map<string, NarrativeHeat>> {
  const client = supabase()
  const { data, error } = await client
    .from('narrative_tags')
    .select('symbol, heat_level')
  if (error) {
    console.warn(`[scanner] narrative load failed: ${error.message}`)
    return new Map()
  }
  const out = new Map<string, NarrativeHeat>()
  for (const row of data ?? []) {
    out.set(String(row.symbol), row.heat_level as NarrativeHeat)
  }
  return out
}

// 24h BTC return computed from 1h candles (24 bars back). Frameworks
// that need a BTC outperformance baseline read this off the snapshot.
// Returns 0 when the data isn't available so downstream conditions
// degrade gracefully rather than crashing the scan.
async function loadBtcReturn24h(): Promise<number> {
  try {
    const candles = await getCandles('BTC', '1h', 30)
    if (candles.length < 25) return 0
    const latest = candles[candles.length - 1]!.c
    const ref = candles[candles.length - 25]!.c
    if (ref <= 0) return 0
    return (latest - ref) / ref
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scanner] BTC baseline failed: ${message}`)
    return 0
  }
}

type SnapshotInsert = {
  symbol: string
  mark_price: number | null
  funding: number | null
  open_interest: number | null
  day_notional_volume: number | null
}

async function writeSnapshots(rows: SnapshotInsert[]): Promise<void> {
  if (rows.length === 0) return
  const client = supabase()
  const { error } = await client.from('market_snapshots').insert(rows)
  if (error) {
    console.error(`[scanner] snapshot insert failed: ${error.message}`)
  }
}

async function loadHistory(
  symbols: string[],
): Promise<Map<string, { funding: number[]; oi: number[] }>> {
  const result = new Map<string, { funding: number[]; oi: number[] }>()
  if (symbols.length === 0) return result
  const client = supabase()
  const since = new Date(
    Date.now() - HISTORY_WINDOW_MINUTES * 60 * 1000,
  ).toISOString()
  const { data, error } = await client
    .from('market_snapshots')
    .select('symbol, funding, open_interest, captured_at')
    .in('symbol', symbols)
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
  if (error) {
    console.error(`[scanner] history load failed: ${error.message}`)
    return result
  }
  for (const row of data ?? []) {
    const bucket = result.get(row.symbol) ?? { funding: [], oi: [] }
    if (row.funding !== null) bucket.funding.push(Number(row.funding))
    if (row.open_interest !== null) {
      bucket.oi.push(Number(row.open_interest))
    }
    result.set(row.symbol, bucket)
  }
  return result
}

type AlertInsert = {
  strategy_id: string
  framework_id: string
  symbol: string
  coingecko_id: string | null
  condition_values: Record<string, unknown>
  suggested_direction: 'long' | 'short' | null
  suggested_entry: number | null
  suggested_stop: number | null
  suggested_target: number | null
  is_watchlist: boolean
  notified_telegram: boolean
  position_size_coin: number | null
  position_size_usd: number | null
  leverage_implied: number | null
  valid_until: string | null
  risk_amount_gbp: number | null
  gbp_usd_rate: number | null
  rules_status: RulesStatus | null
  rules_violations: RuleViolation[] | null
}

async function insertAlert(alert: AlertInsert): Promise<string | null> {
  const client = supabase()
  const { data, error } = await client
    .from('alerts')
    .insert(alert)
    .select('id')
    .single()
  if (error) {
    console.error(`[scanner] alert insert failed: ${error.message}`)
    return null
  }
  return (data?.id as string) ?? null
}

async function markNotified(alertId: string): Promise<void> {
  const client = supabase()
  await client
    .from('alerts')
    .update({ notified_telegram: true })
    .eq('id', alertId)
}

type StrategySummary = {
  name: string
  scanned: number
  triggered: number
}

async function evaluateStrategy(args: {
  strategy: StrategyRow
  markets: Map<string, MarketData>
  universeBySymbol: Map<string, UniverseRow>
  thresholds: Map<string, Record<string, number>>
  history: Map<string, { funding: number[]; oi: number[] }>
  narrativeHeat: Map<string, NarrativeHeat>
  btcReturn24h: number
  gbpUsdRate: number
  rulesState: RulesState
  scanStartedAt: number
  budgetState: { softLogged: boolean; truncated: boolean }
}): Promise<StrategySummary> {
  const {
    strategy,
    markets,
    universeBySymbol,
    thresholds,
    history,
    narrativeHeat,
    btcReturn24h,
    gbpUsdRate,
    rulesState,
    scanStartedAt,
    budgetState,
  } = args

  const summary: StrategySummary = {
    name: strategy.name,
    scanned: 0,
    triggered: 0,
  }

  const framework = FRAMEWORKS.get(strategy.framework_id)
  if (!framework) {
    console.warn(
      `[scanner] strategy=${strategy.name} references unknown framework_id=${strategy.framework_id}, skipping`,
    )
    return summary
  }

  const frameworkThresholds = thresholds.get(strategy.framework_id) ?? {}

  await pMap(strategy.pair_symbols, CONCURRENCY, async (symbol) => {
    const elapsed = Date.now() - scanStartedAt
    if (elapsed > HARD_BUDGET_MS) {
      budgetState.truncated = true
      return
    }
    if (elapsed > SOFT_BUDGET_MS && !budgetState.softLogged) {
      console.warn(
        `[scanner] soft time budget exceeded at ${elapsed}ms, continuing`,
      )
      budgetState.softLogged = true
    }

    const meta = markets.get(symbol)
    if (!meta) return
    summary.scanned++

    let candles: Candle[] = []
    try {
      candles = await getCandles(symbol, strategy.timeframe, CANDLE_LOOKBACK)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[scanner] ${symbol} candle fetch failed: ${message}`)
      return
    }

    const bucket = history.get(symbol)
    const universeRow = universeBySymbol.get(symbol)
    const snapshot: MarketSnapshot = {
      symbol,
      markPrice: meta.markPrice,
      funding: meta.funding,
      openInterest: meta.openInterest,
      dayNotionalVolume: meta.dayNotionalVolume,
      candles,
      fundingHistory: bucket?.funding ?? [],
      oiHistory: bucket?.oi ?? [],
      narrativeHeat: narrativeHeat.get(symbol) ?? 'cool',
      btcReturn24h,
    }

    let result
    try {
      result = framework.evaluate(snapshot, frameworkThresholds)
    } catch (error) {
      console.error(
        `[scanner] strategy=${strategy.name} framework=${framework.id} threw for ${symbol}:`,
        error,
      )
      return
    }
    if (!result.triggered) return

    summary.triggered++
    const isWatchlist = universeRow?.is_watchlist ?? true

    // Position sizing is only meaningful when we have entry and stop;
    // narrative-only alerts without a stop fall back to nulls so the
    // schema stays uniform.
    let sizing: ReturnType<typeof computeSizing> | null = null
    if (
      result.suggestedEntry != null &&
      result.suggestedStop != null &&
      strategy.risk_amount_gbp > 0
    ) {
      sizing = computeSizing({
        entry: result.suggestedEntry,
        stop: result.suggestedStop,
        riskGbp: strategy.risk_amount_gbp,
        gbpUsdRate,
      })
    }
    const validUntil = nextCandleClose(strategy.timeframe)

    const rrRatio = computeRrRatio(
      result.suggestedDirection,
      result.suggestedEntry,
      result.suggestedStop,
      result.suggestedTarget,
    )
    const rulesContext: RulesContext = {
      strategy: {
        risk_amount_gbp: strategy.risk_amount_gbp,
        min_rr: strategy.min_rr,
        max_concurrent_positions: strategy.max_concurrent_positions,
        max_daily_loss_gbp: strategy.max_daily_loss_gbp,
        max_consecutive_losers: strategy.max_consecutive_losers,
      },
      proposedTrade: {
        risk_amount_gbp: strategy.risk_amount_gbp,
        rr_ratio: rrRatio,
      },
      currentState: rulesState,
    }
    const rulesResult = evaluateRules(rulesContext)

    const alertId = await insertAlert({
      strategy_id: strategy.id,
      framework_id: framework.id,
      symbol,
      coingecko_id: universeRow?.coingecko_id ?? null,
      condition_values: result.conditionValues,
      suggested_direction: result.suggestedDirection ?? null,
      suggested_entry: result.suggestedEntry ?? null,
      suggested_stop: result.suggestedStop ?? null,
      suggested_target: result.suggestedTarget ?? null,
      is_watchlist: isWatchlist,
      notified_telegram: false,
      position_size_coin: sizing?.positionSizeCoin ?? null,
      position_size_usd: sizing?.positionSizeUsd ?? null,
      leverage_implied: sizing?.leverageImplied ?? null,
      valid_until: validUntil.toISOString(),
      risk_amount_gbp: strategy.risk_amount_gbp,
      gbp_usd_rate: gbpUsdRate,
      rules_status: rulesResult.status,
      rules_violations: rulesResult.violations,
    })
    if (!alertId) return

    if (
      isWatchlist &&
      result.suggestedDirection &&
      result.suggestedEntry != null &&
      result.suggestedStop != null &&
      result.suggestedTarget != null
    ) {
      const oiDeltaPct = Number(
        (result.conditionValues.oiDeltaPct as number | undefined) ?? 0,
      )
      const ok = await sendTelegramAlert({
        framework_name: framework.name,
        symbol,
        direction: result.suggestedDirection,
        entry: result.suggestedEntry,
        stop: result.suggestedStop,
        target: result.suggestedTarget,
        funding: meta.funding,
        oiDeltaPct,
        appUrl: `${APP_URL}/alerts`,
        positionSizeCoin: sizing?.positionSizeCoin ?? null,
        positionSizeUsd: sizing?.positionSizeUsd ?? null,
        leverageImplied: sizing?.leverageImplied ?? null,
        riskAmountGbp: strategy.risk_amount_gbp,
        validUntil,
        timeframe: strategy.timeframe,
        rulesStatus: rulesResult.status,
        rulesViolations: rulesResult.violations,
      })
      if (ok) await markNotified(alertId)
    }
  })

  return summary
}

async function runScan(): Promise<{
  scanned: number
  triggered: number
  durationMs: number
  truncated: boolean
  strategies: StrategySummary[]
  positionsTracked: number
  positionsClosed: number
}> {
  const started = Date.now()

  const universe = await loadUniverse()
  const universeBySymbol = new Map(universe.map((u) => [u.symbol, u]))

  // Bulk market data: single request covers every Hyperliquid perp.
  const markets: Map<string, MarketData> = await getAllMarketData()

  // market_snapshots covers the full universe so future strategies
  // have rolling OI/funding history available from day one.
  const snapshots: SnapshotInsert[] = []
  for (const row of universe) {
    const m = markets.get(row.symbol)
    if (!m) continue
    snapshots.push({
      symbol: row.symbol,
      mark_price: m.markPrice,
      funding: m.funding,
      open_interest: m.openInterest,
      day_notional_volume: m.dayNotionalVolume,
    })
  }
  await writeSnapshots(snapshots)

  const strategies = await loadActiveStrategies()
  if (strategies.length === 0) {
    console.warn('[scanner] no active strategies, nothing to evaluate')
    return {
      scanned: 0,
      triggered: 0,
      durationMs: Date.now() - started,
      truncated: false,
      strategies: [],
      positionsTracked: 0,
      positionsClosed: 0,
    }
  }

  // Union of pair symbols across all active strategies. History and
  // narrative heat get loaded once for this set rather than per
  // strategy.
  const strategyPairs = new Set<string>()
  for (const s of strategies) {
    for (const sym of s.pair_symbols) strategyPairs.add(sym)
  }

  const [
    thresholds,
    narrativeHeat,
    btcReturn24h,
    history,
    gbpUsdRate,
    rulesState,
  ] = await Promise.all([
    loadThresholds(),
    loadNarrativeHeat(),
    loadBtcReturn24h(),
    loadHistory([...strategyPairs]),
    getGbpUsdRate(),
    loadRulesState(),
  ])

  const budgetState = { softLogged: false, truncated: false }
  const summaries: StrategySummary[] = []
  let totalScanned = 0
  let totalTriggered = 0

  for (const strategy of strategies) {
    const summary = await evaluateStrategy({
      strategy,
      markets,
      universeBySymbol,
      thresholds,
      history,
      narrativeHeat,
      btcReturn24h,
      gbpUsdRate,
      rulesState,
      scanStartedAt: started,
      budgetState,
    })
    summaries.push(summary)
    totalScanned += summary.scanned
    totalTriggered += summary.triggered
    console.log(
      `[scanner] strategy=${summary.name} scanned=${summary.scanned} triggered=${summary.triggered}`,
    )
    if (budgetState.truncated) break
  }

  // Position sync: poll the Hyperliquid main accounts that have linked
  // open trades, write a snapshot for each still-open position, and
  // detect closes by comparing the live trade list against the live
  // position list.
  let positionsTracked = 0
  let positionsClosed = 0
  if (Date.now() - started < 50_000) {
    const syncSummary = await syncHyperliquidPositions({
      scanStartedAt: started,
      gbpUsdRate,
    })
    positionsTracked = syncSummary.tracked
    positionsClosed = syncSummary.closed
    if (syncSummary.tracked > 0 || syncSummary.closed > 0) {
      console.log(
        `[scanner] hyperliquid sync tracked=${syncSummary.tracked} closed=${syncSummary.closed}`,
      )
    }
  } else {
    console.warn(
      '[scanner] skipping Hyperliquid sync, scan budget exhausted',
    )
  }

  return {
    scanned: totalScanned,
    triggered: totalTriggered,
    durationMs: Date.now() - started,
    truncated: budgetState.truncated,
    strategies: summaries,
    positionsTracked,
    positionsClosed,
  }
}

type SyncSummary = { tracked: number; closed: number }

async function loadHyperliquidConfigs(): Promise<HyperliquidConfigRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('user_hyperliquid_config')
    .select('tenant_id, main_address')
  if (error) {
    console.warn(`[scanner] hyperliquid config load failed: ${error.message}`)
    return []
  }
  return (data ?? []) as HyperliquidConfigRow[]
}

async function loadLiveTrades(tenantId: string): Promise<LiveTradeRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('trades')
    .select('id, tenant_id, asset_symbol, direction, entry_price, linked_at')
    .eq('tenant_id', tenantId)
    .eq('live_status', 'live')
  if (error) {
    console.warn(
      `[scanner] live trades load failed (tenant=${tenantId}): ${error.message}`,
    )
    return []
  }
  return (data ?? []) as LiveTradeRow[]
}

function findPositionForTrade(
  positions: HyperliquidPosition[],
  trade: LiveTradeRow,
): HyperliquidPosition | undefined {
  const wantedSign = trade.direction === 'long' ? 1 : -1
  return positions.find((p) => {
    if (p.coin !== trade.asset_symbol) return false
    const sign = p.szi >= 0 ? 1 : -1
    return sign === wantedSign
  })
}

async function recordPositionSnapshot(
  trade: LiveTradeRow,
  position: HyperliquidPosition,
): Promise<void> {
  const client = supabase()
  const nowIso = new Date().toISOString()
  const [{ error: snapshotError }, { error: tradeError }] = await Promise.all([
    client.from('hyperliquid_position_snapshots').insert({
      tenant_id: trade.tenant_id,
      trade_id: trade.id,
      coin: position.coin,
      size: position.szi,
      entry_px: position.entryPx,
      position_value: position.positionValue,
      unrealized_pnl: position.unrealizedPnl,
      liquidation_px: position.liquidationPx,
    }),
    client
      .from('trades')
      .update({ last_synced_at: nowIso })
      .eq('id', trade.id)
      .eq('tenant_id', trade.tenant_id),
  ])
  if (snapshotError) {
    console.warn(
      `[scanner] snapshot insert failed for trade ${trade.id}: ${snapshotError.message}`,
    )
  }
  if (tradeError) {
    console.warn(
      `[scanner] last_synced_at update failed for trade ${trade.id}: ${tradeError.message}`,
    )
  }
}

async function detectAndApplyClose(
  mainAddress: string,
  trade: LiveTradeRow,
  gbpUsdRate: number,
): Promise<boolean> {
  const closeDir = trade.direction === 'long' ? 'Close Long' : 'Close Short'
  const linkedAt = trade.linked_at
    ? Date.parse(trade.linked_at)
    : Date.now() - 7 * 24 * 60 * 60 * 1000
  let fills
  try {
    fills = await getUserFills(mainAddress, linkedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[scanner] fills load failed for ${trade.id}: ${message}`,
    )
    return false
  }
  const matching = fills
    .filter((f) => f.coin === trade.asset_symbol && f.dir === closeDir)
    .sort((a, b) => b.time - a.time)
  const close = matching[0]
  if (!close) return false

  const sign = trade.direction === 'long' ? 1 : -1
  const pnlUsd = (close.px - trade.entry_price) * close.sz * sign
  const outcome = pnlUsd > 0 ? 'win' : pnlUsd < 0 ? 'loss' : 'breakeven'

  const client = supabase()
  // The conditional eq on live_status='live' is the safety net
  // against racing a manual close: if the user updated the trade
  // first, live_status will already be 'closed_manual' and this
  // update is a no-op.
  const { data, error } = await client
    .from('trades')
    .update({
      exit_price: close.px,
      exit_size: close.sz,
      exit_at: new Date(close.time).toISOString(),
      pnl: pnlUsd,
      outcome,
      live_status: 'closed_auto',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', trade.id)
    .eq('tenant_id', trade.tenant_id)
    .eq('live_status', 'live')
    .select('id')
  if (error) {
    console.warn(
      `[scanner] close update failed for ${trade.id}: ${error.message}`,
    )
    return false
  }
  const updated = (data ?? []).length > 0
  if (!updated) return false

  const pnlGbp = gbpUsdRate > 0 ? pnlUsd / gbpUsdRate : pnlUsd
  const ok = await sendTelegramClose({
    symbol: trade.asset_symbol,
    direction: trade.direction,
    entry: trade.entry_price,
    exit: close.px,
    pnlGbp,
    rMultiple: null,
    outcome,
    appUrl: `${APP_URL}/journal`,
  })
  if (!ok) {
    console.warn(`[scanner] close notification skipped for ${trade.id}`)
  }
  return true
}

async function syncHyperliquidPositions(args: {
  scanStartedAt: number
  gbpUsdRate: number
}): Promise<SyncSummary> {
  const summary: SyncSummary = { tracked: 0, closed: 0 }
  const configs = await loadHyperliquidConfigs()
  if (configs.length === 0) return summary

  for (const config of configs) {
    if (Date.now() - args.scanStartedAt > 50_000) {
      console.warn(
        '[scanner] Hyperliquid sync truncated, resuming next tick',
      )
      break
    }
    let state
    try {
      state = await getUserState(config.main_address)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[scanner] userState failed for ${config.main_address}: ${message}`,
      )
      continue
    }
    const trades = await loadLiveTrades(config.tenant_id)
    for (const trade of trades) {
      const position = findPositionForTrade(state.positions, trade)
      if (position) {
        await recordPositionSnapshot(trade, position)
        summary.tracked++
        continue
      }
      const closed = await detectAndApplyClose(
        config.main_address,
        trade,
        args.gbpUsdRate,
      )
      if (closed) summary.closed++
    }
  }

  return summary
}

Deno.serve(async () => {
  try {
    const summary = await runScan()
    console.log(
      `[scanner] total scanned=${summary.scanned} triggered=${summary.triggered} durationMs=${summary.durationMs}${summary.truncated ? ' truncated=1' : ''}`,
    )
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[scanner] fatal: ${message}`)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

