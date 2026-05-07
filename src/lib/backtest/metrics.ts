// Aggregate metrics for a set of simulated trades. Operates on the
// trades that actually executed: signals blocked by rules are kept
// in the trades table for analysis but are excluded here because
// they did not contribute PnL.

import type { BacktestMetrics, SimulatedTrade } from './types'

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

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Annualised Sharpe on a daily PnL series. Buckets per-trade pnl_gbp
// by UTC exit day, zero-fills idle days inside the active range so a
// sporadic strategy still has a realistic stddev, then computes
// mean/stddev × sqrt(365). Crypto trades 24/7 so daily is the right
// base regardless of candle timeframe — feeding per-trade R-multiples
// straight into Sharpe with sqrt(8760) (the previous bug) inflated
// hourly-strategy Sharpes by ~5x and was the headline finding of the
// engine audit. The ratio is scale-invariant so daily pnl_gbp,
// daily R, or daily USD all produce the same Sharpe.
function annualisedDailySharpe(
  trades: Array<{ exit_at: Date | null; pnl_gbp: number }>,
): number {
  const dated = trades.filter(
    (t): t is { exit_at: Date; pnl_gbp: number } => t.exit_at != null,
  )
  if (dated.length < 2) return 0

  let minMs = Infinity
  let maxMs = -Infinity
  const byDay = new Map<string, number>()
  for (const t of dated) {
    const at = t.exit_at.getTime()
    if (at < minMs) minMs = at
    if (at > maxMs) maxMs = at
    const day = t.exit_at.toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + t.pnl_gbp)
  }
  // Walk every UTC day from the earliest to the latest exit. Days
  // with no trades land at 0 PnL.
  const startDay = Math.floor(minMs / MS_PER_DAY) * MS_PER_DAY
  const endDay = Math.floor(maxMs / MS_PER_DAY) * MS_PER_DAY
  const dailyPnl: number[] = []
  for (let cursor = startDay; cursor <= endDay; cursor += MS_PER_DAY) {
    const day = new Date(cursor).toISOString().slice(0, 10)
    dailyPnl.push(byDay.get(day) ?? 0)
  }
  if (dailyPnl.length < 2) return 0
  const m = mean(dailyPnl)
  const sd = stddev(dailyPnl)
  if (sd <= 0) return 0
  return (m / sd) * Math.sqrt(365)
}

export function computeMetrics(
  trades: SimulatedTrade[],
  // Kept on the signature for caller compatibility; previously used
  // by a per-timeframe annualisation factor that was wrong (see the
  // annualisedDailySharpe comment). Daily Sharpe is timeframe-agnostic.
  _timeframe = '1h',
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

  const sharpe = annualisedDailySharpe(executed)

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
