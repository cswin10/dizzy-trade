// Pure-function analytics over backtest_trades. Lives outside any
// React or Supabase concern so it can be unit-tested in isolation
// and reused by both the per-run detail page and the batch
// detail page. Inputs are SimulatedTrade-shaped rows; outputs are
// JSON-serialisable so they round-trip cleanly between server
// actions and client components.
//
// Conventions:
//   - All counts and bins ignore rules_blocked rows (those are
//     "would-have-been-trades" rather than realised positions).
//   - Currency is GBP throughout; per-trade pnl is read from
//     pnl_gbp and r_multiple verbatim, no recomputation.
//   - Time-of-day and day-of-week analytics use UTC because that
//     is the timezone the engine writes timestamps in.

import type { BacktestMetrics, SimulatedTrade } from './types'

// Lightweight subset of SimulatedTrade fields the analytics need.
// Decoupling from the engine type keeps the action layer free to
// hand in plain DB rows without re-aliasing nullable -> required.
export type AnalyticsTrade = {
  pair: string
  direction: 'long' | 'short'
  entry_at: Date
  exit_at: Date | null
  exit_reason: SimulatedTrade['exit_reason']
  pnl_gbp: number | null
  r_multiple: number | null
  outcome: SimulatedTrade['outcome'] | null
}

function executed(trades: AnalyticsTrade[]): AnalyticsTrade[] {
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

// --- A. Returns by month ---------------------------------------

export type MonthlyReturnRow = {
  // 'YYYY-MM' UTC. Sortable as a plain string.
  month_iso: string
  // Display-friendly e.g. "Mar 2026".
  month_label: string
  trades: number
  wins: number
  losses: number
  win_rate: number
  total_pnl_gbp: number
  avg_r: number
}

export type MonthlyReturnsSummary = {
  rows: MonthlyReturnRow[]
  best_month_label: string | null
  best_month_pnl: number
  worst_month_label: string | null
  worst_month_pnl: number
  profitable_months: number
  total_months: number
}

export function computeMonthlyReturns(
  trades: AnalyticsTrade[],
): MonthlyReturnsSummary {
  const buckets = new Map<string, AnalyticsTrade[]>()
  for (const trade of executed(trades)) {
    const d = trade.entry_at
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    let bucket = buckets.get(iso)
    if (!bucket) {
      bucket = []
      buckets.set(iso, bucket)
    }
    bucket.push(trade)
  }
  const rows: MonthlyReturnRow[] = Array.from(buckets.entries())
    .map(([month_iso, bucketTrades]) => {
      let wins = 0
      let losses = 0
      let totalPnl = 0
      const rs: number[] = []
      for (const t of bucketTrades) {
        const pnl = t.pnl_gbp ?? 0
        totalPnl += pnl
        if (t.outcome === 'win') wins += 1
        else if (t.outcome === 'loss') losses += 1
        if (t.r_multiple != null) rs.push(t.r_multiple)
      }
      const [year, month] = month_iso.split('-').map(Number) as [number, number]
      const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
        'en-GB',
        { month: 'short', year: 'numeric' },
      )
      return {
        month_iso,
        month_label: label,
        trades: bucketTrades.length,
        wins,
        losses,
        win_rate: bucketTrades.length > 0 ? wins / bucketTrades.length : 0,
        total_pnl_gbp: totalPnl,
        avg_r: mean(rs),
      }
    })
    .sort((a, b) => a.month_iso.localeCompare(b.month_iso))

  let best: MonthlyReturnRow | null = null
  let worst: MonthlyReturnRow | null = null
  let profitable = 0
  for (const r of rows) {
    if (best === null || r.total_pnl_gbp > best.total_pnl_gbp) best = r
    if (worst === null || r.total_pnl_gbp < worst.total_pnl_gbp) worst = r
    if (r.total_pnl_gbp > 0) profitable += 1
  }
  return {
    rows,
    best_month_label: best?.month_label ?? null,
    best_month_pnl: best?.total_pnl_gbp ?? 0,
    worst_month_label: worst?.month_label ?? null,
    worst_month_pnl: worst?.total_pnl_gbp ?? 0,
    profitable_months: profitable,
    total_months: rows.length,
  }
}

// --- B. Per-pair full metrics ----------------------------------

export type PairFullRow = {
  pair: string
  trades: number
  wins: number
  losses: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
  max_drawdown_gbp: number
  sharpe_ratio: number
  best_trade_gbp: number
  worst_trade_gbp: number
  // Sum of winning PnL / sum of losing PnL magnitudes. >1 means
  // wins dominate losses; null when there are no losing trades.
  profit_factor: number | null
}

// Same annualisation factors as the engine's metrics module so
// per-pair Sharpe is comparable to the headline Sharpe.
const ANNUALISATION_FACTOR_BY_TIMEFRAME: Record<string, number> = {
  '1m': 365 * 24 * 60,
  '5m': 365 * 24 * 12,
  '15m': 365 * 24 * 4,
  '30m': 365 * 24 * 2,
  '1h': 365 * 24,
  '4h': 365 * 6,
  '1d': 365,
}

function maxDrawdownGbp(orderedTrades: AnalyticsTrade[]): number {
  let equity = 0
  let peak = 0
  let maxDd = 0
  for (const t of orderedTrades) {
    equity += t.pnl_gbp ?? 0
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

export function computePerPairFull(
  trades: AnalyticsTrade[],
  timeframe: string,
): PairFullRow[] {
  const buckets = new Map<string, AnalyticsTrade[]>()
  for (const trade of executed(trades)) {
    let bucket = buckets.get(trade.pair)
    if (!bucket) {
      bucket = []
      buckets.set(trade.pair, bucket)
    }
    bucket.push(trade)
  }
  const annualisation = ANNUALISATION_FACTOR_BY_TIMEFRAME[timeframe] ?? 365
  const rows: PairFullRow[] = []
  buckets.forEach((bucketTrades, pair) => {
    const ordered = [...bucketTrades].sort(
      (a, b) =>
        (a.exit_at?.getTime() ?? a.entry_at.getTime()) -
        (b.exit_at?.getTime() ?? b.entry_at.getTime()),
    )
    let wins = 0
    let losses = 0
    let totalPnl = 0
    const rs: number[] = []
    let bestTrade = -Infinity
    let worstTrade = Infinity
    let winningSum = 0
    let losingSum = 0
    for (const t of ordered) {
      const pnl = t.pnl_gbp ?? 0
      totalPnl += pnl
      if (pnl > bestTrade) bestTrade = pnl
      if (pnl < worstTrade) worstTrade = pnl
      if (t.outcome === 'win') {
        wins += 1
        winningSum += pnl
      } else if (t.outcome === 'loss') {
        losses += 1
        losingSum += Math.abs(pnl)
      }
      if (t.r_multiple != null) rs.push(t.r_multiple)
    }
    const sdR = stddev(rs)
    const meanR = mean(rs)
    const sharpe = sdR > 0 ? (meanR / sdR) * Math.sqrt(annualisation) : 0
    rows.push({
      pair,
      trades: bucketTrades.length,
      wins,
      losses,
      win_rate: bucketTrades.length > 0 ? wins / bucketTrades.length : 0,
      avg_r: meanR,
      total_pnl_gbp: totalPnl,
      max_drawdown_gbp: maxDrawdownGbp(ordered),
      sharpe_ratio: sharpe,
      best_trade_gbp: Number.isFinite(bestTrade) ? bestTrade : 0,
      worst_trade_gbp: Number.isFinite(worstTrade) ? worstTrade : 0,
      profit_factor: losingSum > 0 ? winningSum / losingSum : null,
    })
  })
  return rows.sort((a, b) => b.total_pnl_gbp - a.total_pnl_gbp)
}

// --- C. Time-of-day heatmap ------------------------------------

export type HourBucket = {
  hour_utc: number // 0-23
  trades: number
  wins: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
  // Marker the UI uses to grey out under-sampled rows so the
  // operator does not over-interpret a single trade.
  small_sample: boolean
}

export type HourHeatmapSummary = {
  rows: HourBucket[]
  best_hour_range: string | null
  worst_hour_range: string | null
  // The mean total pnl across hours that have any trades, used by
  // the UI to colour rows above / below average.
  pnl_baseline: number
}

const SMALL_SAMPLE_HOUR = 3

export function computeHourHeatmap(
  trades: AnalyticsTrade[],
): HourHeatmapSummary {
  const rows: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour_utc: h,
    trades: 0,
    wins: 0,
    win_rate: 0,
    avg_r: 0,
    total_pnl_gbp: 0,
    small_sample: false,
  }))
  const rsByHour: number[][] = Array.from({ length: 24 }, () => [])
  for (const trade of executed(trades)) {
    const hour = trade.entry_at.getUTCHours()
    const bucket = rows[hour]!
    bucket.trades += 1
    bucket.total_pnl_gbp += trade.pnl_gbp ?? 0
    if (trade.outcome === 'win') bucket.wins += 1
    if (trade.r_multiple != null) rsByHour[hour]!.push(trade.r_multiple)
  }
  for (let h = 0; h < 24; h++) {
    const row = rows[h]!
    row.win_rate = row.trades > 0 ? row.wins / row.trades : 0
    row.avg_r = mean(rsByHour[h]!)
    row.small_sample = row.trades > 0 && row.trades < SMALL_SAMPLE_HOUR
  }

  const populatedPnls = rows
    .filter((r) => r.trades > 0)
    .map((r) => r.total_pnl_gbp)
  const baseline = mean(populatedPnls)

  // "Best/worst hour range" picks the longest contiguous run of
  // populated hours whose pnl sum is highest / lowest. Falls back
  // to the single best / worst hour if no two are adjacent.
  const bestRange = bestRunRange(rows, 'high')
  const worstRange = bestRunRange(rows, 'low')

  return {
    rows,
    best_hour_range: bestRange,
    worst_hour_range: worstRange,
    pnl_baseline: baseline,
  }
}

function bestRunRange(
  rows: HourBucket[],
  side: 'high' | 'low',
): string | null {
  // Single-pass: track the best contiguous run of hours where the
  // pnl is on the desired side of the median. Three-hour minimum
  // run length avoids labelling a single lucky hour as "best".
  const populated = rows.filter((r) => r.trades > 0)
  if (populated.length === 0) return null
  const sorted = [...populated].sort((a, b) => a.total_pnl_gbp - b.total_pnl_gbp)
  const median = sorted[Math.floor(sorted.length / 2)]!.total_pnl_gbp
  let bestStart = -1
  let bestEnd = -1
  let bestSum = side === 'high' ? -Infinity : Infinity
  let curStart = -1
  let curSum = 0
  for (let h = 0; h < 24; h++) {
    const r = rows[h]!
    const matches =
      r.trades > 0 &&
      (side === 'high' ? r.total_pnl_gbp > median : r.total_pnl_gbp < median)
    if (matches) {
      if (curStart === -1) {
        curStart = h
        curSum = 0
      }
      curSum += r.total_pnl_gbp
    } else if (curStart !== -1) {
      const len = h - curStart
      const better =
        side === 'high'
          ? curSum > bestSum && len >= 1
          : curSum < bestSum && len >= 1
      if (better) {
        bestSum = curSum
        bestStart = curStart
        bestEnd = h - 1
      }
      curStart = -1
      curSum = 0
    }
  }
  if (curStart !== -1) {
    const better =
      side === 'high' ? curSum > bestSum : curSum < bestSum
    if (better) {
      bestSum = curSum
      bestStart = curStart
      bestEnd = 23
    }
  }
  if (bestStart === -1) {
    const single =
      side === 'high'
        ? populated.reduce((a, b) =>
            b.total_pnl_gbp > a.total_pnl_gbp ? b : a,
          )
        : populated.reduce((a, b) =>
            b.total_pnl_gbp < a.total_pnl_gbp ? b : a,
          )
    return `${String(single.hour_utc).padStart(2, '0')}:00 UTC`
  }
  return `${String(bestStart).padStart(2, '0')}:00–${String(bestEnd).padStart(2, '0')}:59 UTC`
}

// --- D. Exit reason distribution -------------------------------

export type ExitReasonRow = {
  exit_reason: NonNullable<SimulatedTrade['exit_reason']>
  count: number
  share_of_trades: number
  avg_r: number
  total_pnl_gbp: number
}

export type ExitReasonBreakdown = {
  rows: ExitReasonRow[]
  // Convenience numbers for the "X% hit stop, Y% hit target …" line.
  stop_hit_share: number
  target_hit_share: number
  timeout_share: number
}

export function computeExitReasonBreakdown(
  trades: AnalyticsTrade[],
): ExitReasonBreakdown {
  const buckets = new Map<
    NonNullable<SimulatedTrade['exit_reason']>,
    AnalyticsTrade[]
  >()
  const ex = executed(trades)
  for (const t of ex) {
    const reason = t.exit_reason
    if (!reason) continue
    let bucket = buckets.get(reason)
    if (!bucket) {
      bucket = []
      buckets.set(reason, bucket)
    }
    bucket.push(t)
  }
  const total = ex.length
  const rows: ExitReasonRow[] = Array.from(buckets.entries())
    .map(([reason, bucketTrades]) => {
      let pnl = 0
      const rs: number[] = []
      for (const t of bucketTrades) {
        pnl += t.pnl_gbp ?? 0
        if (t.r_multiple != null) rs.push(t.r_multiple)
      }
      return {
        exit_reason: reason,
        count: bucketTrades.length,
        share_of_trades: total > 0 ? bucketTrades.length / total : 0,
        avg_r: mean(rs),
        total_pnl_gbp: pnl,
      }
    })
    .sort((a, b) => b.count - a.count)

  function shareOf(
    reason: NonNullable<SimulatedTrade['exit_reason']>,
  ): number {
    return rows.find((r) => r.exit_reason === reason)?.share_of_trades ?? 0
  }
  return {
    rows,
    stop_hit_share: shareOf('stop_hit'),
    target_hit_share: shareOf('target_hit'),
    timeout_share: shareOf('timeout'),
  }
}

// --- E. Drawdown profile ---------------------------------------

export type DrawdownPoint = {
  exit_at_iso: string
  equity_gbp: number
  drawdown_gbp: number
}

export type DrawdownProfile = {
  series: DrawdownPoint[]
  max_drawdown_gbp: number
  max_drawdown_duration_days: number
  // Share of the run spent below a previous equity peak.
  time_in_drawdown_pct: number
  recovery_factor: number | null
  total_pnl_gbp: number
}

export function computeDrawdownProfile(
  trades: AnalyticsTrade[],
): DrawdownProfile {
  const ex = executed(trades).filter((t) => t.exit_at != null)
  ex.sort((a, b) => a.exit_at!.getTime() - b.exit_at!.getTime())

  const series: DrawdownPoint[] = []
  let equity = 0
  let peak = 0
  let peakAt: number | null = null
  let maxDd = 0
  let maxDdDurationMs = 0
  let timeInDdMs = 0
  let totalSpanMs = 0
  let firstAt: number | null = null

  for (const t of ex) {
    const at = t.exit_at!.getTime()
    if (firstAt === null) firstAt = at
    const prevAt = series.length > 0 ? new Date(series[series.length - 1]!.exit_at_iso).getTime() : at
    equity += t.pnl_gbp ?? 0
    if (equity > peak) {
      peak = equity
      peakAt = at
    }
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd

    if (peakAt !== null && dd > 0) {
      const sinceLastPeak = at - peakAt
      if (sinceLastPeak > maxDdDurationMs) maxDdDurationMs = sinceLastPeak
    }
    if (dd > 0 && series.length > 0) {
      timeInDdMs += at - prevAt
    }
    if (series.length > 0) totalSpanMs += at - prevAt

    series.push({
      exit_at_iso: t.exit_at!.toISOString(),
      equity_gbp: equity,
      drawdown_gbp: -dd,
    })
  }

  const totalPnl = equity
  const recovery = maxDd > 0 ? totalPnl / maxDd : null
  return {
    series,
    max_drawdown_gbp: maxDd,
    max_drawdown_duration_days: maxDdDurationMs / (1000 * 60 * 60 * 24),
    time_in_drawdown_pct:
      totalSpanMs > 0 ? (timeInDdMs / totalSpanMs) * 100 : 0,
    recovery_factor: recovery,
    total_pnl_gbp: totalPnl,
  }
}

// --- F. Streak analysis ----------------------------------------

export type StreakAnalysis = {
  max_consecutive_wins: number
  max_consecutive_losses: number
  avg_winning_streak_length: number
  avg_losing_streak_length: number
  // Sign convention: positive = current win streak length,
  // negative = current loss streak length, 0 = last trade was a
  // breakeven or there are no trades.
  current_streak: number
  // Per-trade outcome history in chronological order so the UI
  // can render the green/red sequence bar.
  outcome_sequence: Array<'win' | 'loss' | 'breakeven'>
}

export function computeStreaks(trades: AnalyticsTrade[]): StreakAnalysis {
  const ex = executed(trades).filter((t) => t.outcome != null)
  ex.sort(
    (a, b) =>
      (a.exit_at?.getTime() ?? a.entry_at.getTime()) -
      (b.exit_at?.getTime() ?? b.entry_at.getTime()),
  )
  const seq = ex.map((t) => t.outcome as 'win' | 'loss' | 'breakeven')

  let maxWin = 0
  let maxLoss = 0
  const winStreaks: number[] = []
  const lossStreaks: number[] = []
  let cur = 0
  let curKind: 'win' | 'loss' | null = null
  for (const o of seq) {
    if (o === 'win') {
      if (curKind === 'win') {
        cur += 1
      } else {
        if (curKind === 'loss' && cur > 0) lossStreaks.push(cur)
        curKind = 'win'
        cur = 1
      }
    } else if (o === 'loss') {
      if (curKind === 'loss') {
        cur += 1
      } else {
        if (curKind === 'win' && cur > 0) winStreaks.push(cur)
        curKind = 'loss'
        cur = 1
      }
    } else {
      // Breakeven breaks any streak.
      if (curKind === 'win' && cur > 0) winStreaks.push(cur)
      if (curKind === 'loss' && cur > 0) lossStreaks.push(cur)
      curKind = null
      cur = 0
    }
    if (curKind === 'win' && cur > maxWin) maxWin = cur
    if (curKind === 'loss' && cur > maxLoss) maxLoss = cur
  }
  if (curKind === 'win' && cur > 0) winStreaks.push(cur)
  if (curKind === 'loss' && cur > 0) lossStreaks.push(cur)

  return {
    max_consecutive_wins: maxWin,
    max_consecutive_losses: maxLoss,
    avg_winning_streak_length: mean(winStreaks),
    avg_losing_streak_length: mean(lossStreaks),
    current_streak:
      curKind === 'win' ? cur : curKind === 'loss' ? -cur : 0,
    outcome_sequence: seq,
  }
}

// --- G. Correlation matrix (batch) -----------------------------

export type CorrelationCell = {
  a_run_id: string
  b_run_id: string
  a_name: string
  b_name: string
  // Pearson correlation of daily PnL series. NaN when either
  // series has zero variance (e.g. a strategy with all-zero
  // pnl); we surface those as null so the UI can render '—'.
  correlation: number | null
}

export type CorrelationMatrix = {
  run_ids: string[]
  run_names: string[]
  cells: CorrelationCell[]
  most_uncorrelated_pair: {
    a_name: string
    b_name: string
    correlation: number
  } | null
  most_correlated_pair: {
    a_name: string
    b_name: string
    correlation: number
  } | null
}

export type RunDailyPnl = {
  run_id: string
  name: string
  // Map<'YYYY-MM-DD' UTC, pnl_gbp>. Sparse: only days with trades.
  daily_pnl: Map<string, number>
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx
    const dy = ys[i]! - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  if (!Number.isFinite(denom) || denom === 0) return null
  const r = num / denom
  if (!Number.isFinite(r)) return null
  return r
}

export function computeCorrelationMatrix(
  runs: RunDailyPnl[],
): CorrelationMatrix {
  // Build the union of dates across every run so each pairwise
  // series is aligned (zero-fill missing days, since "no trade
  // that day" really is a 0 daily pnl).
  const allDays = new Set<string>()
  for (const run of runs) {
    run.daily_pnl.forEach((_, day) => allDays.add(day))
  }
  const days = Array.from(allDays).sort()
  const seriesByRun = new Map<string, number[]>()
  for (const run of runs) {
    const series = days.map((d) => run.daily_pnl.get(d) ?? 0)
    seriesByRun.set(run.run_id, series)
  }
  const cells: CorrelationCell[] = []
  let mostNeg: CorrelationCell | null = null
  let mostPos: CorrelationCell | null = null
  for (let i = 0; i < runs.length; i++) {
    for (let j = 0; j < runs.length; j++) {
      const a = runs[i]!
      const b = runs[j]!
      const r = pearson(seriesByRun.get(a.run_id)!, seriesByRun.get(b.run_id)!)
      const cell: CorrelationCell = {
        a_run_id: a.run_id,
        b_run_id: b.run_id,
        a_name: a.name,
        b_name: b.name,
        correlation: r,
      }
      cells.push(cell)
      // Skip self-pairs and null correlations when picking
      // headline pair.
      if (i < j && r !== null) {
        if (mostNeg === null || (r < (mostNeg.correlation ?? 0))) mostNeg = cell
        if (mostPos === null || (r > (mostPos.correlation ?? 0))) mostPos = cell
      }
    }
  }
  return {
    run_ids: runs.map((r) => r.run_id),
    run_names: runs.map((r) => r.name),
    cells,
    most_uncorrelated_pair:
      mostNeg && mostNeg.correlation !== null
        ? {
            a_name: mostNeg.a_name,
            b_name: mostNeg.b_name,
            correlation: mostNeg.correlation,
          }
        : null,
    most_correlated_pair:
      mostPos && mostPos.correlation !== null
        ? {
            a_name: mostPos.a_name,
            b_name: mostPos.b_name,
            correlation: mostPos.correlation,
          }
        : null,
  }
}

// --- H. Combined portfolio simulation --------------------------

export type CombinedPortfolio = {
  // Names of the strategies whose trades were combined. Top 3 by
  // total PnL.
  member_names: string[]
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  total_pnl_gbp: number
  max_drawdown_gbp: number
  sharpe_ratio: number
  recovery_factor: number | null
  // Day-by-day combined equity curve. The batch page overlays this
  // on top of the per-strategy curves with a thicker stroke.
  equity_curve: Array<{ t: number; pnl: number }>
}

export type RunWithTrades = {
  run_id: string
  name: string
  trades: AnalyticsTrade[]
  total_pnl_gbp: number
}

export function computeCombinedPortfolio(
  runs: RunWithTrades[],
  timeframe: string,
): CombinedPortfolio | null {
  if (runs.length < 2) return null
  // Top three by total PnL. If two are tied the order is
  // deterministic on input order, which is fine.
  const top = [...runs]
    .sort((a, b) => b.total_pnl_gbp - a.total_pnl_gbp)
    .slice(0, 3)

  const merged: AnalyticsTrade[] = []
  for (const run of top) merged.push(...executed(run.trades))
  if (merged.length === 0) return null
  merged.sort(
    (a, b) =>
      (a.exit_at?.getTime() ?? a.entry_at.getTime()) -
      (b.exit_at?.getTime() ?? b.entry_at.getTime()),
  )

  let wins = 0
  let losses = 0
  let totalPnl = 0
  const rs: number[] = []
  for (const t of merged) {
    totalPnl += t.pnl_gbp ?? 0
    if (t.outcome === 'win') wins += 1
    else if (t.outcome === 'loss') losses += 1
    if (t.r_multiple != null) rs.push(t.r_multiple)
  }
  const dd = maxDrawdownGbp(merged)
  const sdR = stddev(rs)
  const meanR = mean(rs)
  const annualisation = ANNUALISATION_FACTOR_BY_TIMEFRAME[timeframe] ?? 365
  const sharpe = sdR > 0 ? (meanR / sdR) * Math.sqrt(annualisation) : 0

  // Daily-equity curve: bucket pnl by exit date so the chart
  // overlay does not have N points per day.
  const byDay = new Map<string, number>()
  for (const t of merged) {
    if (!t.exit_at) continue
    const day = t.exit_at.toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + (t.pnl_gbp ?? 0))
  }
  const days = Array.from(byDay.keys()).sort()
  let equity = 0
  const equityCurve = days.map((d) => {
    equity += byDay.get(d) ?? 0
    return { t: new Date(`${d}T00:00:00Z`).getTime(), pnl: equity }
  })

  return {
    member_names: top.map((r) => r.name),
    total_trades: merged.length,
    wins,
    losses,
    win_rate: merged.length > 0 ? wins / merged.length : 0,
    total_pnl_gbp: totalPnl,
    max_drawdown_gbp: dd,
    sharpe_ratio: sharpe,
    recovery_factor: dd > 0 ? totalPnl / dd : null,
    equity_curve: equityCurve,
  }
}

// --- Top-level bundle ------------------------------------------

export type BacktestAnalytics = {
  monthly: MonthlyReturnsSummary
  per_pair: PairFullRow[]
  hour: HourHeatmapSummary
  exit_reasons: ExitReasonBreakdown
  drawdown: DrawdownProfile
  streaks: StreakAnalysis
  // Echoed from the engine's BacktestMetrics so the UI can decide
  // whether to highlight per-pair Sharpe vs the headline.
  headline?: BacktestMetrics
}

export function computeBacktestAnalytics(
  trades: AnalyticsTrade[],
  timeframe: string,
): BacktestAnalytics {
  return {
    monthly: computeMonthlyReturns(trades),
    per_pair: computePerPairFull(trades, timeframe),
    hour: computeHourHeatmap(trades),
    exit_reasons: computeExitReasonBreakdown(trades),
    drawdown: computeDrawdownProfile(trades),
    streaks: computeStreaks(trades),
  }
}

export type BatchAnalytics = {
  correlation: CorrelationMatrix | null
  combined: CombinedPortfolio | null
}

export function computeBatchAnalytics(
  runs: RunWithTrades[],
  timeframe: string,
): BatchAnalytics {
  if (runs.length < 2) {
    return { correlation: null, combined: null }
  }
  const dailyPnls: RunDailyPnl[] = runs.map((run) => {
    const daily = new Map<string, number>()
    for (const t of executed(run.trades)) {
      if (!t.exit_at) continue
      const day = t.exit_at.toISOString().slice(0, 10)
      daily.set(day, (daily.get(day) ?? 0) + (t.pnl_gbp ?? 0))
    }
    return { run_id: run.run_id, name: run.name, daily_pnl: daily }
  })
  return {
    correlation: computeCorrelationMatrix(dailyPnls),
    combined: computeCombinedPortfolio(runs, timeframe),
  }
}
