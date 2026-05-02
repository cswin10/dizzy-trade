// Parameter sweep expansion. Takes a list of dimensions describing
// which parameters to vary and produces the cartesian product of
// their values, one combination per element.
//
// Three dimension types are supported:
//   range:   { type: 'range', start, end, step }
//   enum:    { type: 'enum', values: [...] }
//   boolean: { type: 'boolean' }
//
// Dimension keys are validated against a whitelist of sweepable
// parameters (framework thresholds, risk parameters, fees). The
// engine itself is unaware of sweeps; it only sees the merged
// per-combination configs the orchestrator produces.

export type SweepDimensionRange = {
  type: 'range'
  key: string
  start: number
  end: number
  step: number
}

export type SweepDimensionEnum = {
  type: 'enum'
  key: string
  values: Array<number | string | boolean>
}

export type SweepDimensionBoolean = {
  type: 'boolean'
  key: string
}

export type SweepDimension =
  | SweepDimensionRange
  | SweepDimensionEnum
  | SweepDimensionBoolean

export type SweepCombination = Record<string, number | string | boolean>

// Hard cap on combinations per sweep. Sized so a 200-combination
// sweep with 30s per backtest, batched 5 at a time, fits inside
// roughly 20 minutes wall clock; well within reason for an
// interactive workflow but long enough to be uncomfortable, which
// is the desired UX signal.
export const MAX_COMBINATIONS = 200

// Whitelist of keys that are safe to sweep. Keeping this explicit
// stops a typo'd dimension key from silently producing identical
// runs (no error, no signal change), and keeps the UI dropdown
// authoritative.
//
// Risk and fee keys are common to every framework. Threshold keys
// vary; the form passes the framework's thresholds in to validate.
export const COMMON_SWEEPABLE_KEYS = [
  'risk_amount_gbp',
  'min_rr',
  'max_concurrent_positions',
  'max_daily_loss_gbp',
  'slippage_pct',
  'maker_fee_pct',
  'taker_fee_pct',
] as const

export const BOOLEAN_SWEEPABLE_KEYS = ['assume_taker'] as const

function expandRange(dim: SweepDimensionRange): number[] {
  if (!Number.isFinite(dim.start) || !Number.isFinite(dim.end)) {
    throw new Error(`Range dimension "${dim.key}" has non-finite start/end`)
  }
  if (dim.step <= 0) {
    throw new Error(`Range dimension "${dim.key}" needs step > 0`)
  }
  if (dim.end < dim.start) {
    throw new Error(`Range dimension "${dim.key}" needs end >= start`)
  }
  const values: number[] = []
  // Use rounded multiplication rather than repeated addition so
  // values stay clean (e.g. 0.05 + 0.05 + 0.05 != 0.15 in float).
  // Round to 8 decimals which is fine for any sane sweep granularity.
  const steps = Math.floor((dim.end - dim.start) / dim.step + 1e-9) + 1
  for (let i = 0; i < steps; i++) {
    const raw = dim.start + i * dim.step
    values.push(Math.round(raw * 1e8) / 1e8)
  }
  return values
}

function expandDimension(
  dim: SweepDimension,
): Array<number | string | boolean> {
  switch (dim.type) {
    case 'range':
      return expandRange(dim)
    case 'enum':
      if (!Array.isArray(dim.values) || dim.values.length === 0) {
        throw new Error(`Enum dimension "${dim.key}" has no values`)
      }
      return dim.values
    case 'boolean':
      return [true, false]
  }
}

export function expandSweepDimensions(
  dimensions: SweepDimension[],
): SweepCombination[] {
  if (dimensions.length === 0) {
    throw new Error('At least one sweep dimension is required')
  }

  const expanded = dimensions.map((dim) => ({
    key: dim.key,
    values: expandDimension(dim),
  }))

  let total = 1
  for (const dim of expanded) {
    total *= dim.values.length
  }
  if (total > MAX_COMBINATIONS) {
    throw new Error(
      `Reduce ranges. Max ${MAX_COMBINATIONS} combinations (this sweep would produce ${total}).`,
    )
  }

  // Standard cartesian product. Iterate by extending each partial
  // combination with the values of the next dimension.
  let combinations: SweepCombination[] = [{}]
  for (const dim of expanded) {
    const next: SweepCombination[] = []
    for (const combo of combinations) {
      for (const value of dim.values) {
        next.push({ ...combo, [dim.key]: value })
      }
    }
    combinations = next
  }
  return combinations
}

export function countCombinations(dimensions: SweepDimension[]): number {
  if (dimensions.length === 0) return 0
  let total = 1
  for (const dim of dimensions) {
    try {
      total *= expandDimension(dim).length
    } catch {
      return 0
    }
  }
  return total
}

// Applies a combination's overrides on top of a base config.
// Threshold keys go into framework_thresholds; everything else
// becomes a top-level override on the run config. Knowing which
// bucket a key belongs to is the orchestrator's responsibility.
export type MergedRunConfig = {
  framework_thresholds: Record<string, number>
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  slippage_pct: number
  maker_fee_pct: number
  taker_fee_pct: number
  assume_taker: boolean
}

export type BaseRunConfig = MergedRunConfig

export function applyCombination(
  base: BaseRunConfig,
  combo: SweepCombination,
): MergedRunConfig {
  const merged: MergedRunConfig = {
    ...base,
    framework_thresholds: { ...base.framework_thresholds },
  }
  for (const [key, value] of Object.entries(combo)) {
    if (key === 'risk_amount_gbp' && typeof value === 'number') {
      merged.risk_amount_gbp = value
    } else if (key === 'min_rr' && typeof value === 'number') {
      merged.min_rr = value
    } else if (
      key === 'max_concurrent_positions' &&
      typeof value === 'number'
    ) {
      merged.max_concurrent_positions = Math.round(value)
    } else if (key === 'max_daily_loss_gbp' && typeof value === 'number') {
      merged.max_daily_loss_gbp = value
    } else if (key === 'slippage_pct' && typeof value === 'number') {
      merged.slippage_pct = value
    } else if (key === 'maker_fee_pct' && typeof value === 'number') {
      merged.maker_fee_pct = value
    } else if (key === 'taker_fee_pct' && typeof value === 'number') {
      merged.taker_fee_pct = value
    } else if (key === 'assume_taker' && typeof value === 'boolean') {
      merged.assume_taker = value
    } else if (typeof value === 'number') {
      // Anything else with a numeric value is treated as a framework
      // threshold override.
      merged.framework_thresholds[key] = value
    }
  }
  return merged
}
