// Backtest simulation engine.
//
// Walks every candle across the requested pairs in chronological
// order. At each closing candle it asks the configured framework
// whether a signal fires, applies the same risk rules the live
// scanner uses, and either opens a simulated position or records the
// signal as rules-blocked. Open positions are checked for stop or
// target hits against later candles, with timeout and end-of-period
// fallbacks so nothing stays open forever.
//
// The engine is deliberately lookahead-free: it evaluates at the
// close of candle N and assumes any resulting trade enters at the
// open of candle N+1. Same-bar exit logic is pessimistic: when both
// stop and target sit inside a bar, we assume the stop hit first.
// This trades optimistic fills for a more honest expectancy estimate.

import 'server-only'

import { FRAMEWORKS, type MarketSnapshot } from '@/lib/frameworks'
import type { Candle } from '@/lib/hyperliquid'

import { ensureCandles } from './candles'
import {
  FRAMEWORK_WARMUP_CANDLES,
  TIMEOUT_CANDLES,
  type BacktestCandle,
  type BacktestConfig,
  type RunBacktestResult,
  type SimulatedTrade,
  type SimulatedTradeOutcome,
} from './types'

const FRANKFURTER_URL = 'https://api.frankfurter.app'
const GBP_USD_FALLBACK = 1.27

type OpenPosition = {
  pair: string
  direction: 'long' | 'short'
  entry_at: Date
  entry_candle_open_at: Date
  entry_price: number
  stop_price: number
  target_price: number
  size_coin: number
  size_usd: number
  conditions_at_signal: Record<string, unknown>
  candles_open: number
}

type SimState = {
  open_positions: Map<string, OpenPosition>
  closed_trades: SimulatedTrade[]
  blocked_signals: SimulatedTrade[]
  daily_pnl_gbp: Map<string, number>
  consecutive_losers: number
  last_loss_at: Date | null
  signals_total: number
  signals_blocked: number
}

// Rough proxy for the GBP/USD rate at the end of the backtest
// period. v1 uses a constant rate per run for simplicity; storing
// the rate that was used keeps results reproducible.
async function fetchGbpUsdRate(referenceDate: Date): Promise<number> {
  const today = new Date()
  const isFuture = referenceDate.getTime() > today.getTime()
  const dateParam = isFuture
    ? 'latest'
    : referenceDate.toISOString().slice(0, 10)
  try {
    const res = await fetch(`${FRANKFURTER_URL}/${dateParam}?from=GBP&to=USD`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return GBP_USD_FALLBACK
    const data = (await res.json()) as { rates?: { USD?: number } }
    const rate = data.rates?.USD
    return rate && Number.isFinite(rate) && rate > 0 ? rate : GBP_USD_FALLBACK
  } catch {
    return GBP_USD_FALLBACK
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Hyperliquid Candle shape (`{ t, o, h, l, c, v }`) is what the
// frameworks expect on snapshot.candles. Convert from BacktestCandle
// once at the boundary.
function toHyperliquidCandle(c: BacktestCandle): Candle {
  return {
    t: c.candle_open_at.getTime(),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }
}

function applySlippage(
  price: number,
  slippagePct: number,
  worsenForDirection: 'long-entry' | 'short-entry' | 'long-exit' | 'short-exit',
): number {
  const factor = slippagePct / 100
  switch (worsenForDirection) {
    case 'long-entry':
      return price * (1 + factor)
    case 'short-entry':
      return price * (1 - factor)
    case 'long-exit':
      return price * (1 - factor)
    case 'short-exit':
      return price * (1 + factor)
  }
}

function computePnlUsd(
  position: OpenPosition,
  exitPrice: number,
  feePct: number,
): number {
  const grossUsd =
    position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.size_coin
      : (position.entry_price - exitPrice) * position.size_coin
  // Fees apply to both entry and exit notional. Same fee tier on
  // both sides because v1 assumes taker fills throughout.
  const entryNotional = position.entry_price * position.size_coin
  const exitNotional = exitPrice * position.size_coin
  const feeUsd = ((entryNotional + exitNotional) * feePct) / 100
  return grossUsd - feeUsd
}

function classifyOutcome(pnlGbp: number): SimulatedTradeOutcome {
  if (pnlGbp > 0.01) return 'win'
  if (pnlGbp < -0.01) return 'loss'
  return 'breakeven'
}

// Builds a unified, chronologically sorted timeline across all pairs.
// Each entry includes the index of that candle within its pair's
// own array so the engine can grab a trailing window for framework
// evaluation without re-scanning.
type TimelineEntry = {
  pair: string
  index: number
  candle: BacktestCandle
}

function buildTimeline(
  perPairCandles: Map<string, BacktestCandle[]>,
): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  perPairCandles.forEach((candles, pair) => {
    candles.forEach((candle, index) => {
      timeline.push({ pair, index, candle })
    })
  })
  timeline.sort(
    (a, b) =>
      a.candle.candle_open_at.getTime() - b.candle.candle_open_at.getTime(),
  )
  return timeline
}

function checkExits(
  state: SimState,
  entry: TimelineEntry,
  feePct: number,
  slippagePct: number,
  gbpUsdRate: number,
  riskAmountGbp: number,
): void {
  const open = state.open_positions.get(entry.pair)
  if (!open) return
  // Skip the candle on which the position was actually opened so
  // we never use the same bar's range as both fill and exit.
  if (
    entry.candle.candle_open_at.getTime() <= open.entry_candle_open_at.getTime()
  ) {
    return
  }

  const candle = entry.candle
  const high = candle.high
  const low = candle.low

  let exitPrice: number | null = null
  let exitReason: 'target_hit' | 'stop_hit' | 'timeout' | null = null

  if (open.direction === 'long') {
    const stopHit = low <= open.stop_price
    const targetHit = high >= open.target_price
    if (stopHit && targetHit) {
      // Pessimistic: assume stop hit first inside the bar.
      exitPrice = applySlippage(open.stop_price, slippagePct, 'long-exit')
      exitReason = 'stop_hit'
    } else if (stopHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'long-exit')
      exitReason = 'stop_hit'
    } else if (targetHit) {
      exitPrice = applySlippage(open.target_price, slippagePct, 'long-exit')
      exitReason = 'target_hit'
    }
  } else {
    const stopHit = high >= open.stop_price
    const targetHit = low <= open.target_price
    if (stopHit && targetHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'short-exit')
      exitReason = 'stop_hit'
    } else if (stopHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'short-exit')
      exitReason = 'stop_hit'
    } else if (targetHit) {
      exitPrice = applySlippage(open.target_price, slippagePct, 'short-exit')
      exitReason = 'target_hit'
    }
  }

  if (exitPrice !== null && exitReason !== null) {
    closePosition(
      state,
      open,
      exitPrice,
      candle.candle_open_at,
      exitReason,
      feePct,
      gbpUsdRate,
      riskAmountGbp,
    )
    return
  }

  open.candles_open += 1
}

function maybeTimeout(
  state: SimState,
  entry: TimelineEntry,
  timeoutCandles: number,
  feePct: number,
  gbpUsdRate: number,
  riskAmountGbp: number,
): void {
  const open = state.open_positions.get(entry.pair)
  if (!open) return
  if (open.candles_open < timeoutCandles) return

  closePosition(
    state,
    open,
    entry.candle.close,
    entry.candle.candle_open_at,
    'timeout',
    feePct,
    gbpUsdRate,
    riskAmountGbp,
  )
}

function closePosition(
  state: SimState,
  position: OpenPosition,
  exitPrice: number,
  exitAt: Date,
  exitReason: 'target_hit' | 'stop_hit' | 'timeout' | 'open_at_period_end',
  feePct: number,
  gbpUsdRate: number,
  riskAmountGbp: number,
): void {
  const pnlUsd = computePnlUsd(position, exitPrice, feePct)
  const pnlGbp = pnlUsd / gbpUsdRate
  const outcome = classifyOutcome(pnlGbp)
  const rMultiple = riskAmountGbp > 0 ? pnlGbp / riskAmountGbp : 0

  const trade: SimulatedTrade = {
    pair: position.pair,
    direction: position.direction,
    entry_at: position.entry_at,
    entry_price: position.entry_price,
    stop_price: position.stop_price,
    target_price: position.target_price,
    exit_at: exitAt,
    exit_price: exitPrice,
    exit_reason: exitReason,
    size_coin: position.size_coin,
    size_usd: position.size_usd,
    pnl_usd: pnlUsd,
    pnl_gbp: pnlGbp,
    r_multiple: rMultiple,
    outcome,
    conditions_at_signal: position.conditions_at_signal,
  }

  state.closed_trades.push(trade)
  state.open_positions.delete(position.pair)

  const day = isoDay(exitAt)
  state.daily_pnl_gbp.set(day, (state.daily_pnl_gbp.get(day) ?? 0) + pnlGbp)

  if (outcome === 'loss') {
    state.consecutive_losers += 1
    state.last_loss_at = exitAt
  } else if (outcome === 'win') {
    state.consecutive_losers = 0
  }
}

type RuleViolation = { rule: string; reason: string }

function evaluateRules(
  state: SimState,
  config: BacktestConfig,
  proposedRiskGbp: number,
  signalAt: Date,
  rrRatio: number,
): RuleViolation[] {
  const violations: RuleViolation[] = []

  if (state.open_positions.size >= config.max_concurrent_positions) {
    violations.push({
      rule: 'max_concurrent_positions',
      reason: `Already at ${state.open_positions.size}/${config.max_concurrent_positions} open positions`,
    })
  }

  if (config.max_daily_loss_gbp != null) {
    const today = isoDay(signalAt)
    const realised = state.daily_pnl_gbp.get(today) ?? 0
    const projected = realised - proposedRiskGbp
    if (-projected > config.max_daily_loss_gbp) {
      violations.push({
        rule: 'max_daily_loss',
        reason: `Daily loss cap would be exceeded`,
      })
    }
  }

  if (
    config.max_consecutive_losers != null &&
    state.consecutive_losers >= config.max_consecutive_losers &&
    state.last_loss_at !== null
  ) {
    const hoursSinceLoss =
      (signalAt.getTime() - state.last_loss_at.getTime()) / 3_600_000
    if (hoursSinceLoss < 24) {
      violations.push({
        rule: 'consecutive_losers_pause',
        reason: `${state.consecutive_losers} consecutive losses, cooling-off period`,
      })
    }
  }

  if (rrRatio < config.min_rr) {
    violations.push({
      rule: 'rr_below_min',
      reason: `R:R ${rrRatio.toFixed(2)} below minimum ${config.min_rr}`,
    })
  }

  return violations
}

export async function runBacktest(
  config: BacktestConfig,
): Promise<RunBacktestResult> {
  const framework = FRAMEWORKS.get(config.framework_id)
  if (!framework) {
    throw new Error(`Unknown framework: ${config.framework_id}`)
  }
  if (config.pairs.length === 0) {
    throw new Error('At least one pair is required')
  }
  if (config.date_range_end.getTime() <= config.date_range_start.getTime()) {
    throw new Error('date_range_end must be after date_range_start')
  }

  const gbpUsdRate = await fetchGbpUsdRate(config.date_range_end)

  const perPairCandles = new Map<string, BacktestCandle[]>()
  for (const pair of config.pairs) {
    const candles = await ensureCandles(
      pair,
      config.timeframe,
      config.date_range_start,
      config.date_range_end,
    )
    perPairCandles.set(pair, candles)
  }

  const timeline = buildTimeline(perPairCandles)

  const state: SimState = {
    open_positions: new Map(),
    closed_trades: [],
    blocked_signals: [],
    daily_pnl_gbp: new Map(),
    consecutive_losers: 0,
    last_loss_at: null,
    signals_total: 0,
    signals_blocked: 0,
  }

  const feePct = config.assume_taker
    ? config.taker_fee_pct
    : config.maker_fee_pct
  const timeoutCandles = TIMEOUT_CANDLES[config.timeframe]

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]!

    // Order matters: exits before timeouts before signal evaluation.
    // A target hit on the same bar that would otherwise time out
    // should be recorded as a target_hit, not a timeout.
    checkExits(
      state,
      entry,
      feePct,
      config.slippage_pct,
      gbpUsdRate,
      config.risk_amount_gbp,
    )
    maybeTimeout(
      state,
      entry,
      timeoutCandles,
      feePct,
      gbpUsdRate,
      config.risk_amount_gbp,
    )

    if (state.open_positions.has(entry.pair)) {
      // One position per pair at a time; do not stack signals.
      continue
    }

    const pairCandles = perPairCandles.get(entry.pair)!
    if (entry.index < FRAMEWORK_WARMUP_CANDLES) continue

    const trailing = pairCandles
      .slice(
        Math.max(0, entry.index - FRAMEWORK_WARMUP_CANDLES + 1),
        entry.index + 1,
      )
      .map(toHyperliquidCandle)
    const last = trailing[trailing.length - 1]!

    const snapshot: MarketSnapshot = {
      symbol: entry.pair,
      markPrice: last.c,
      funding: 0,
      openInterest: 0,
      dayNotionalVolume: 0,
      candles: trailing,
    }

    const result = framework.evaluate(snapshot, config.framework_thresholds)
    if (!result.triggered) continue

    state.signals_total += 1

    const direction = result.suggestedDirection
    const rawEntry = result.suggestedEntry
    const rawStop = result.suggestedStop
    const rawTarget = result.suggestedTarget
    if (
      !direction ||
      rawEntry === undefined ||
      rawStop === undefined ||
      rawTarget === undefined
    ) {
      continue
    }

    // Lookahead avoidance: framework evaluates on close of candle N,
    // we open the trade at the open of candle N+1 on this pair. If
    // there is no next candle in this pair's series, we cannot fill,
    // so skip the signal.
    const nextCandle = pairCandles[entry.index + 1]
    if (!nextCandle) continue

    const fillPriceRaw = nextCandle.open
    const fillPrice = applySlippage(
      fillPriceRaw,
      config.slippage_pct,
      direction === 'long' ? 'long-entry' : 'short-entry',
    )

    // Reanchor stop and target around the actual fill so the
    // intended stop distance and R-multiple survive the slippage
    // adjustment. Without this, slippage flips trades into
    // immediate stop-outs or kills the R:R ratio.
    const intendedRisk = Math.abs(rawEntry - rawStop)
    const intendedReward = Math.abs(rawTarget - rawEntry)
    const stopPrice =
      direction === 'long' ? fillPrice - intendedRisk : fillPrice + intendedRisk
    const targetPrice =
      direction === 'long'
        ? fillPrice + intendedReward
        : fillPrice - intendedReward

    const rrRatio = intendedRisk > 0 ? intendedReward / intendedRisk : 0

    const violations = evaluateRules(
      state,
      config,
      config.risk_amount_gbp,
      nextCandle.candle_open_at,
      rrRatio,
    )

    if (violations.length > 0) {
      const placeholderSize = 0
      state.signals_blocked += 1
      state.blocked_signals.push({
        pair: entry.pair,
        direction,
        entry_at: nextCandle.candle_open_at,
        entry_price: fillPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        exit_at: null,
        exit_price: null,
        exit_reason: 'rules_blocked',
        size_coin: placeholderSize,
        size_usd: placeholderSize,
        pnl_usd: 0,
        pnl_gbp: 0,
        r_multiple: 0,
        outcome: 'breakeven',
        conditions_at_signal: {
          ...result.conditionValues,
          rules_violations: violations,
        },
      })
      continue
    }

    // Position size from risk: risk_amount_gbp -> usd, divide by
    // per-coin risk distance.
    const riskUsd = config.risk_amount_gbp * gbpUsdRate
    const perCoinRisk = Math.abs(fillPrice - stopPrice)
    if (perCoinRisk <= 0) continue
    const sizeCoin = riskUsd / perCoinRisk
    const sizeUsd = sizeCoin * fillPrice

    state.open_positions.set(entry.pair, {
      pair: entry.pair,
      direction,
      entry_at: nextCandle.candle_open_at,
      entry_candle_open_at: nextCandle.candle_open_at,
      entry_price: fillPrice,
      stop_price: stopPrice,
      target_price: targetPrice,
      size_coin: sizeCoin,
      size_usd: sizeUsd,
      conditions_at_signal: { ...result.conditionValues },
      candles_open: 0,
    })
  }

  // End of timeline: any still-open positions close at the last
  // candle's close on their pair.
  state.open_positions.forEach((pos) => {
    const candles = perPairCandles.get(pos.pair) ?? []
    if (candles.length === 0) return
    const last = candles[candles.length - 1]!
    closePosition(
      state,
      pos,
      last.close,
      last.candle_open_at,
      'open_at_period_end',
      feePct,
      gbpUsdRate,
      config.risk_amount_gbp,
    )
  })

  return {
    trades: [...state.closed_trades, ...state.blocked_signals],
    signals_total: state.signals_total,
    signals_blocked_by_rules: state.signals_blocked,
    gbp_usd_rate_used: gbpUsdRate,
  }
}
