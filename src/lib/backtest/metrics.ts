// Aggregate metrics for a set of simulated trades. Operates on the
// trades that actually executed: signals blocked by rules are kept
// in the trades table for analysis but are excluded here because
// they did not contribute PnL.

import type { BacktestMetrics, SimulatedTrade } from './types'

const ANNUALISATION_FACTOR_BY_TIMEFRAME: Record<string, number> = {
  '1m': 365 * 24 * 60,
  '5m': 365 * 24 * 12,
  '15m': 365 * 24 * 4,
  '30m': 365 * 24 * 2,
  '1h': 365 * 24,
  '4h': 365 * 6,
  '1d': 365,
}

function executedTrades(trades: SimulatedTrade[]): SimulatedTrade[] {
  return trades.filter((t) => t.exit_reason !== 'rules_blocked')
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const variance =
    xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(variance)
}

export function computeMetrics(
  trades: SimulatedTrade[],
  timeframe = '1h',
): BacktestMetrics {
  const executed = executedTrades(trades)
  const total = executed.length

  if (total === 0) {
    return {
      total_trades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      win_rate: 0,
      avg_r: 0,
      total_pnl_gbp: 0,
      max_drawdown_gbp: 0,
      max_drawdown_pct: 0,
      sharpe_ratio: 0,
      longest_losing_streak: 0,
      expectancy_per_trade_gbp: 0,
    }
  }

  let wins = 0
  let losses = 0
  let breakevens = 0
  for (const trade of executed) {
    if (trade.outcome === 'win') wins += 1
    else if (trade.outcome === 'loss') losses += 1
    else breakevens += 1
  }

  const winRate = wins / total
  const rValues = executed.map((t) => t.r_multiple)
  const pnlValues = executed.map((t) => t.pnl_gbp)
  const totalPnlGbp = pnlValues.reduce((a, b) => a + b, 0)
  const avgR = mean(rValues)

  // Max drawdown: walk the equity curve in chronological order,
  // track the running peak, and capture the largest peak-to-trough
  // distance. equity starts at 0, so a deep early loss can produce
  // a negative peak; clamp the divisor to avoid a divide-by-zero or
  // a misleading negative drawdown percentage.
  const sortedByExit = [...executed].sort(
    (a, b) => (a.exit_at?.getTime() ?? 0) - (b.exit_at?.getTime() ?? 0),
  )
  let equity = 0
  let peak = 0
  let maxDdGbp = 0
  let maxPeakSeen = 0
  for (const trade of sortedByExit) {
    equity += trade.pnl_gbp
    if (equity > peak) peak = equity
    if (peak > maxPeakSeen) maxPeakSeen = peak
    const dd = peak - equity
    if (dd > maxDdGbp) maxDdGbp = dd
  }
  const maxDdPct = maxPeakSeen > 0 ? (maxDdGbp / maxPeakSeen) * 100 : 0

  // Sharpe approximation. Per-trade returns are PnL / risk (i.e. R
  // multiples). Multiply by sqrt(annualisation factor) so the value
  // is roughly comparable to a daily-returns Sharpe. When variance
  // is zero we leave Sharpe at 0 to avoid Infinity.
  const meanR = mean(rValues)
  const sdR = stddev(rValues)
  const annualisation = ANNUALISATION_FACTOR_BY_TIMEFRAME[timeframe] ?? 365
  const sharpe = sdR > 0 ? (meanR / sdR) * Math.sqrt(annualisation) : 0

  let longestLosingStreak = 0
  let currentStreak = 0
  for (const trade of sortedByExit) {
    if (trade.outcome === 'loss') {
      currentStreak += 1
      if (currentStreak > longestLosingStreak)
        longestLosingStreak = currentStreak
    } else {
      currentStreak = 0
    }
  }

  const winningPnls = executed
    .filter((t) => t.outcome === 'win')
    .map((t) => t.pnl_gbp)
  const losingPnls = executed
    .filter((t) => t.outcome === 'loss')
    .map((t) => Math.abs(t.pnl_gbp))
  const avgWin = winningPnls.length > 0 ? mean(winningPnls) : 0
  const avgLoss = losingPnls.length > 0 ? mean(losingPnls) : 0
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss

  return {
    total_trades: total,
    wins,
    losses,
    breakevens,
    win_rate: winRate,
    avg_r: avgR,
    total_pnl_gbp: totalPnlGbp,
    max_drawdown_gbp: maxDdGbp,
    max_drawdown_pct: maxDdPct,
    sharpe_ratio: sharpe,
    longest_losing_streak: longestLosingStreak,
    expectancy_per_trade_gbp: expectancy,
  }
}

export type SplitMetrics = {
  train: BacktestMetrics
  test: BacktestMetrics
  // null means we did not have enough trades on either side to make
  // a meaningful judgement. Treat that as "insufficient data" in the
  // UI rather than collapsing it to "consistent" (which is what
  // happens when both sides have zero trades and every gap is 0).
  overfit_warning_triggered: boolean | null
}

// Below this threshold on either side, the divergence check is
// noise. A handful of trades can produce wild swings in win rate
// and avg R, so any apparent "consistency" is meaningless.
const MIN_TRADES_FOR_SPLIT_VERDICT = 5

// Splits trades by entry_at into the first `splitPct`% (train) and
// the remainder (test) of the calendar window the trades cover.
// Returns train and test metrics plus a flag set when train metrics
// significantly outperform test metrics. Threshold is intentionally
// loose: a 15-percentage-point win-rate gap or a 0.5-R gap in avg R
// is unusual and worth flagging.
export function computeSplitMetrics(
  trades: SimulatedTrade[],
  rangeStart: Date,
  rangeEnd: Date,
  splitPct: number,
  timeframe: string,
): SplitMetrics {
  const cutoff =
    rangeStart.getTime() +
    ((rangeEnd.getTime() - rangeStart.getTime()) * splitPct) / 100

  const trainTrades: SimulatedTrade[] = []
  const testTrades: SimulatedTrade[] = []
  for (const trade of trades) {
    if (trade.entry_at.getTime() < cutoff) trainTrades.push(trade)
    else testTrades.push(trade)
  }

  const train = computeMetrics(trainTrades, timeframe)
  const test = computeMetrics(testTrades, timeframe)

  if (
    train.total_trades < MIN_TRADES_FOR_SPLIT_VERDICT ||
    test.total_trades < MIN_TRADES_FOR_SPLIT_VERDICT
  ) {
    return { train, test, overfit_warning_triggered: null }
  }

  const winRateGap = train.win_rate - test.win_rate
  const avgRGap = train.avg_r - test.avg_r
  const overfit = winRateGap > 0.15 || avgRGap > 0.5

  return { train, test, overfit_warning_triggered: overfit }
}

// Splits trades by entry_at without recomputing metrics. Useful for
// the trades-table renderer when it needs to badge each trade as
// in_train_period.
export function isInTrainPeriod(
  entryAt: Date,
  rangeStart: Date,
  rangeEnd: Date,
  splitPct: number,
): boolean {
  const cutoff =
    rangeStart.getTime() +
    ((rangeEnd.getTime() - rangeStart.getTime()) * splitPct) / 100
  return entryAt.getTime() < cutoff
}
