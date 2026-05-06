/**
 * Hardcoded safety limits enforced before every order placement.
 *
 * These are code constants, not configuration. They cannot be
 * overridden via the UI, via a server action, via a database
 * column, or via an environment variable. Changing any value
 * here requires editing this file and redeploying. That is the
 * point: the live pipeline reaches into this module on every
 * preflight check, so an attacker (or a misconfigured form, or a
 * future code path that forgets a guard) cannot route around the
 * caps by mutating a row.
 *
 * Sized for a starting account of approximately £100. Adjust as
 * the account grows; do not move these into runtime config.
 */
export const HARDCODED_SAFETY_LIMITS = {
  // No single trade's notional can exceed this in USD. Notional
  // is computed from the entry fill price and the sized
  // coin-quantity (size_coin × intended_entry_price), not from
  // the user-configured risk.
  MAX_NOTIONAL_USD_PER_TRADE: 130,

  // No single trade can risk more than this in GBP regardless of
  // sizing rule. Caps both fixed_gbp_risk amounts (rejected at
  // pipeline preflight) and fixed_position_size derived risks
  // (rejected when the per-coin stop distance × size implies a
  // larger loss than this in GBP).
  MAX_RISK_GBP_PER_TRADE: 3,

  // Maximum cumulative loss in any rolling 24h window across
  // every live deployment for the tenant. Sums realised_pnl_gbp
  // from live_signals closed in the last 24h; the magnitude
  // (negative pnl summed as a positive number) is compared
  // against this cap.
  MAX_DAILY_LOSS_GBP: 15,

  // Maximum concurrent open positions across all live
  // deployments tenant-wide. Counts live_signals in
  // ('order_placed', 'filled') status.
  MAX_CONCURRENT_POSITIONS_GLOBAL: 1,

  // First N closed trades require per-trade confirmation. Set
  // to a forward-looking value: auto-execute does not exist yet
  // and the pipeline currently always requires manual
  // confirmation, but the preflight check tags signals
  // accordingly via requires_manual_confirmation so a future
  // auto-execute path inherits the rule without forgetting it.
  REQUIRE_MANUAL_CONFIRMATION_FIRST_N_TRADES: 5,
} as const

// Convenient label / value pairs the UI surfaces in the "Active
// safety limits" panel. Kept here so the ordering and the human-
// readable phrasing live alongside the constants themselves; if
// the values change the panel updates automatically without a
// second source of truth.
export type SafetyLimitDisplay = {
  label: string
  value: string
  detail: string
}

export function describeSafetyLimits(): SafetyLimitDisplay[] {
  const c = HARDCODED_SAFETY_LIMITS
  return [
    {
      label: 'Max notional per trade',
      value: `$${c.MAX_NOTIONAL_USD_PER_TRADE}`,
      detail: 'Computed from size × fill price.',
    },
    {
      label: 'Max risk per trade',
      value: `£${c.MAX_RISK_GBP_PER_TRADE}`,
      detail: 'Caps every sizing rule, including fixed_position_size.',
    },
    {
      label: 'Max 24h loss',
      value: `£${c.MAX_DAILY_LOSS_GBP}`,
      detail: 'Rolling 24h window, summed across every live deployment.',
    },
    {
      label: 'Max concurrent positions',
      value: String(c.MAX_CONCURRENT_POSITIONS_GLOBAL),
      detail: 'Tenant-wide, every deployment combined.',
    },
    {
      label: 'Manual confirmation required',
      value: `First ${c.REQUIRE_MANUAL_CONFIRMATION_FIRST_N_TRADES} trades`,
      detail: 'Forward-looking; auto-execute will respect this when it lands.',
    },
  ]
}
