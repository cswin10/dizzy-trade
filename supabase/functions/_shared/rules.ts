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

export type RuleId =
  | 'max_concurrent'
  | 'max_daily_loss'
  | 'consecutive_losers_pause'
  | 'rr_below_min'
  | 'risk_amount_mismatch'

export type RuleSeverity = 'block' | 'warn'

export type RuleViolation = {
  rule: RuleId
  severity: RuleSeverity
  reason: string
  current_value: number | string
  limit_value: number | string
}

export type RulesStatus = 'passed' | 'blocked' | 'warning'

export type RulesResult = {
  status: RulesStatus
  violations: RuleViolation[]
}

export type RulesContext = {
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
export function evaluateRules(ctx: RulesContext): RulesResult {
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
