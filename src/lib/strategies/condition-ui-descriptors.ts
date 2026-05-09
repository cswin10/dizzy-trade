// UI metadata for the strategy builder.
//
// Each entry describes how the visual builder should render a
// condition's parameter form: input types, defaults, value
// constraints, human-readable labels. The condition library
// itself (src/lib/strategies/conditions/*) is the source of
// truth for the parameter shape; this file just pairs each
// shape with a description and per-field input metadata.
//
// Adding a new condition is a two-file change: write the
// condition + register it in the engine, then add a descriptor
// here.

export type ConditionCategory =
  | 'momentum'
  | 'trend'
  | 'volume'
  | 'volatility'
  | 'structure'
  | 'candle_patterns'
  | 'time'
  | 'funding'

export type ParameterDescriptor = {
  key: string
  label: string
  type: 'number' | 'string_enum' | 'boolean' | 'number_array'
  required: boolean
  default: number | string | boolean | number[]
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  step?: number
  helpText?: string
}

export type ConditionUIDescriptor = {
  type: string
  category: ConditionCategory
  title: string
  description: string
  parameters: ParameterDescriptor[]
}

const COMPARATOR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
]

const num = (
  key: string,
  label: string,
  defaults: { default: number; min?: number; max?: number; step?: number },
): ParameterDescriptor => ({
  key,
  label,
  type: 'number',
  required: true,
  default: defaults.default,
  min: defaults.min,
  max: defaults.max,
  step: defaults.step,
})

const enumParam = (
  key: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  defaultValue: string,
): ParameterDescriptor => ({
  key,
  label,
  type: 'string_enum',
  required: true,
  default: defaultValue,
  options,
})

const comparator = enumParam(
  'comparator',
  'Comparison',
  COMPARATOR_OPTIONS,
  'lt',
)

export const CONDITION_DESCRIPTORS: ConditionUIDescriptor[] = [
  // --- Momentum ----------------------------------------------------
  {
    type: 'rsi_threshold',
    category: 'momentum',
    title: 'RSI threshold',
    description: 'Trigger when RSI crosses a threshold',
    parameters: [
      num('period', 'RSI period', { default: 14, min: 2, max: 500, step: 1 }),
      comparator,
      num('value', 'RSI value', { default: 30, min: 0, max: 100, step: 1 }),
    ],
  },
  {
    type: 'rsi_crossing',
    category: 'momentum',
    title: 'RSI crossing',
    description: 'Trigger when RSI crosses a threshold this candle',
    parameters: [
      num('period', 'RSI period', { default: 14, min: 2, max: 500, step: 1 }),
      enumParam(
        'direction',
        'Direction',
        [
          { value: 'crossing_below', label: 'Crossing below' },
          { value: 'crossing_above', label: 'Crossing above' },
        ],
        'crossing_below',
      ),
      num('value', 'RSI value', { default: 30, min: 0, max: 100, step: 1 }),
    ],
  },
  {
    type: 'stochastic_threshold',
    category: 'momentum',
    title: 'Stochastic threshold',
    description: 'Trigger when stochastic %K or %D crosses a threshold',
    parameters: [
      num('k_period', '%K period', { default: 14, min: 1, max: 500, step: 1 }),
      num('d_period', '%D period', { default: 3, min: 1, max: 500, step: 1 }),
      num('smooth', 'Smoothing', { default: 3, min: 1, max: 50, step: 1 }),
      enumParam(
        'line',
        'Line',
        [
          { value: 'k', label: '%K' },
          { value: 'd', label: '%D' },
        ],
        'k',
      ),
      comparator,
      num('value', 'Threshold', { default: 20, min: 0, max: 100, step: 1 }),
    ],
  },
  {
    type: 'williams_r_threshold',
    category: 'momentum',
    title: 'Williams %R threshold',
    description: 'Trigger when Williams %R crosses a threshold',
    parameters: [
      num('period', 'Period', { default: 14, min: 2, max: 500, step: 1 }),
      comparator,
      num('value', 'Threshold', {
        default: -80,
        min: -100,
        max: 0,
        step: 1,
      }),
    ],
  },

  // --- Trend -------------------------------------------------------
  {
    type: 'sma_position',
    category: 'trend',
    title: 'SMA position',
    description: 'Trigger when price is above or below a simple moving average',
    parameters: [
      num('period', 'SMA period', {
        default: 50,
        min: 2,
        max: 1000,
        step: 1,
      }),
      enumParam(
        'position',
        'Position',
        [
          { value: 'above', label: 'Above' },
          { value: 'below', label: 'Below' },
        ],
        'above',
      ),
    ],
  },
  {
    type: 'ema_position',
    category: 'trend',
    title: 'EMA position',
    description:
      'Trigger when price is above or below an exponential moving average',
    parameters: [
      num('period', 'EMA period', {
        default: 21,
        min: 2,
        max: 1000,
        step: 1,
      }),
      enumParam(
        'position',
        'Position',
        [
          { value: 'above', label: 'Above' },
          { value: 'below', label: 'Below' },
        ],
        'above',
      ),
    ],
  },
  {
    type: 'sma_distance',
    category: 'trend',
    title: 'SMA distance',
    description: 'Trigger when price sits a percentage away from an SMA',
    parameters: [
      num('period', 'SMA period', {
        default: 50,
        min: 2,
        max: 1000,
        step: 1,
      }),
      comparator,
      num('distance_pct', 'Distance %', {
        default: 1.5,
        min: 0,
        max: 100,
        step: 0.1,
      }),
      enumParam(
        'side',
        'Side',
        [
          { value: 'above', label: 'Above SMA' },
          { value: 'below', label: 'Below SMA' },
          { value: 'absolute', label: 'Either side' },
        ],
        'above',
      ),
    ],
  },
  {
    type: 'sma_crossover',
    category: 'trend',
    title: 'SMA crossover',
    description: 'Trigger when a fast SMA crosses a slow SMA',
    parameters: [
      num('fast_period', 'Fast period', {
        default: 20,
        min: 2,
        max: 1000,
        step: 1,
      }),
      num('slow_period', 'Slow period', {
        default: 50,
        min: 2,
        max: 1000,
        step: 1,
      }),
      enumParam(
        'direction',
        'Direction',
        [
          { value: 'fast_crossing_above_slow', label: 'Fast above slow' },
          { value: 'fast_crossing_below_slow', label: 'Fast below slow' },
        ],
        'fast_crossing_above_slow',
      ),
    ],
  },

  // --- Volume ------------------------------------------------------
  {
    type: 'volume_ratio',
    category: 'volume',
    title: 'Volume ratio',
    description: 'Trigger when volume is N times the recent average',
    parameters: [
      num('period', 'SMA period', {
        default: 20,
        min: 2,
        max: 1000,
        step: 1,
      }),
      enumParam('comparator', 'Comparison', COMPARATOR_OPTIONS, 'gte'),
      num('multiple', 'Multiplier', {
        default: 1.5,
        min: 0,
        max: 1000,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'volume_threshold',
    category: 'volume',
    title: 'Volume threshold',
    description: 'Trigger on absolute volume crossing a fixed level',
    parameters: [
      enumParam('comparator', 'Comparison', COMPARATOR_OPTIONS, 'gte'),
      num('value', 'Volume', {
        default: 1000,
        min: 0,
        step: 1,
      }),
    ],
  },

  // --- Volatility --------------------------------------------------
  {
    type: 'atr_threshold',
    category: 'volatility',
    title: 'ATR threshold',
    description: 'Trigger when ATR crosses a price-units threshold',
    parameters: [
      num('period', 'ATR period', { default: 14, min: 2, max: 500, step: 1 }),
      comparator,
      num('value', 'ATR value', { default: 0, min: 0, step: 0.1 }),
    ],
  },
  {
    type: 'atr_ratio',
    category: 'volatility',
    title: 'ATR ratio',
    description:
      'Trigger when current ATR is N times the rolling average ATR (volatility expansion / contraction)',
    parameters: [
      num('period', 'ATR period', { default: 14, min: 2, max: 500, step: 1 }),
      num('lookback', 'Average lookback', {
        default: 50,
        min: 2,
        max: 2000,
        step: 1,
      }),
      enumParam('comparator', 'Comparison', COMPARATOR_OPTIONS, 'gte'),
      num('multiple', 'Multiplier', {
        default: 1.5,
        min: 0,
        max: 1000,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'bollinger_position',
    category: 'volatility',
    title: 'Bollinger position',
    description: 'Trigger when price interacts with Bollinger Bands',
    parameters: [
      num('period', 'Period', { default: 20, min: 2, max: 500, step: 1 }),
      num('std_dev', 'Std dev', { default: 2, min: 0, max: 10, step: 0.1 }),
      enumParam(
        'position',
        'Position',
        [
          { value: 'above_upper', label: 'Above upper' },
          { value: 'below_lower', label: 'Below lower' },
          { value: 'inside', label: 'Inside' },
          { value: 'touching_upper', label: 'Touching upper' },
          { value: 'touching_lower', label: 'Touching lower' },
        ],
        'below_lower',
      ),
    ],
  },

  // --- Structure ---------------------------------------------------
  {
    type: 'near_recent_high',
    category: 'structure',
    title: 'Near recent high',
    description: 'Trigger when close is within X% of the recent high',
    parameters: [
      num('lookback', 'Lookback bars', {
        default: 20,
        min: 2,
        max: 2000,
        step: 1,
      }),
      num('within_pct', 'Within %', {
        default: 1,
        min: 0,
        max: 100,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'near_recent_low',
    category: 'structure',
    title: 'Near recent low',
    description: 'Trigger when close is within X% of the recent low',
    parameters: [
      num('lookback', 'Lookback bars', {
        default: 20,
        min: 2,
        max: 2000,
        step: 1,
      }),
      num('within_pct', 'Within %', {
        default: 1,
        min: 0,
        max: 100,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'candle_close_above',
    category: 'structure',
    title: 'Close above reference',
    description: 'Trigger when current close exceeds a reference level',
    parameters: [
      enumParam(
        'reference',
        'Reference',
        [
          { value: 'previous_high', label: 'Previous high' },
          { value: 'previous_close', label: 'Previous close' },
          { value: 'sma', label: 'SMA' },
          { value: 'ema', label: 'EMA' },
        ],
        'previous_high',
      ),
      {
        key: 'sma_period',
        label: 'SMA period (when SMA)',
        type: 'number',
        required: false,
        default: 20,
        min: 2,
        max: 1000,
        step: 1,
      },
      {
        key: 'ema_period',
        label: 'EMA period (when EMA)',
        type: 'number',
        required: false,
        default: 21,
        min: 2,
        max: 1000,
        step: 1,
      },
    ],
  },
  {
    type: 'level_proximity',
    category: 'structure',
    title: 'Level proximity',
    description: 'Trigger when close is within X% of an absolute price',
    parameters: [
      num('level', 'Price level', { default: 0, min: 0, step: 0.0001 }),
      num('within_pct', 'Within %', {
        default: 0.5,
        min: 0,
        max: 100,
        step: 0.1,
      }),
    ],
  },

  // --- Candle patterns --------------------------------------------
  {
    type: 'bullish_candle',
    category: 'candle_patterns',
    title: 'Bullish candle',
    description: 'Trigger when the current candle closes above its open',
    parameters: [],
  },
  {
    type: 'bearish_candle',
    category: 'candle_patterns',
    title: 'Bearish candle',
    description: 'Trigger when the current candle closes below its open',
    parameters: [],
  },
  {
    type: 'wick_ratio',
    category: 'candle_patterns',
    title: 'Wick ratio',
    description: 'Trigger when a wick is N times the body length',
    parameters: [
      enumParam(
        'side',
        'Wick side',
        [
          { value: 'upper', label: 'Upper' },
          { value: 'lower', label: 'Lower' },
        ],
        'lower',
      ),
      enumParam('comparator', 'Comparison', COMPARATOR_OPTIONS, 'gt'),
      num('multiple', 'Multiplier', {
        default: 2,
        min: 0,
        max: 1000,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'close_position',
    category: 'candle_patterns',
    title: 'Close position',
    description: 'Trigger when the close sits in a specific part of the bar',
    parameters: [
      enumParam(
        'position',
        'Position',
        [
          { value: 'upper_third', label: 'Upper third' },
          { value: 'lower_third', label: 'Lower third' },
          { value: 'upper_half', label: 'Upper half' },
          { value: 'lower_half', label: 'Lower half' },
        ],
        'upper_third',
      ),
    ],
  },

  // --- Time -------------------------------------------------------
  {
    type: 'hour_of_day',
    category: 'time',
    title: 'Hour of day (UTC)',
    description: 'Trigger only during the listed UTC hours',
    parameters: [
      {
        key: 'hours',
        label: 'Hours (0-23)',
        type: 'number_array',
        required: true,
        default: [13, 14, 15],
        helpText: 'Comma-separated list of UTC hours',
      },
    ],
  },
  {
    type: 'day_of_week',
    category: 'time',
    title: 'Day of week (UTC)',
    description: 'Trigger only on the listed UTC days (0=Sun, 6=Sat)',
    parameters: [
      {
        key: 'days',
        label: 'Days (0-6)',
        type: 'number_array',
        required: true,
        default: [1, 2, 3, 4, 5],
        helpText: '0=Sun, 1=Mon, 6=Sat',
      },
    ],
  },

  // --- Funding ----------------------------------------------------
  {
    type: 'funding_threshold',
    category: 'funding',
    title: 'Funding threshold',
    description:
      'Trigger when funding crosses a threshold. Backtests look up the prevailing funding rate for the candle from the funding_rates table; condition skips with missing_data if no rate is within ±1h of the candle.',
    parameters: [
      comparator,
      num('value', 'Funding rate', {
        default: 0.001,
        min: -1,
        max: 1,
        step: 0.0001,
      }),
    ],
  },
]

// Map for quick descriptor lookup by type.
export const CONDITION_DESCRIPTOR_BY_TYPE = new Map(
  CONDITION_DESCRIPTORS.map((d) => [d.type, d]),
)

// Categories rendered in the picker, in display order.
export const CATEGORY_DISPLAY: Array<{
  category: ConditionCategory
  label: string
}> = [
  { category: 'momentum', label: 'Momentum' },
  { category: 'trend', label: 'Trend' },
  { category: 'volume', label: 'Volume' },
  { category: 'volatility', label: 'Volatility' },
  { category: 'structure', label: 'Structure' },
  { category: 'candle_patterns', label: 'Candle patterns' },
  { category: 'time', label: 'Time' },
  { category: 'funding', label: 'Funding' },
]

// --- Stop / target / sizing rule descriptors --------------------

export type RuleUIDescriptor = {
  type: string
  title: string
  description: string
  parameters: ParameterDescriptor[]
}

export const STOP_RULE_DESCRIPTORS: RuleUIDescriptor[] = [
  {
    type: 'fixed_pct',
    title: 'Fixed percentage',
    description: 'Stop at a fixed percentage from entry',
    parameters: [
      num('pct', 'Stop %', { default: 1, min: 0.01, max: 100, step: 0.1 }),
    ],
  },
  {
    type: 'atr_multiple',
    title: 'ATR multiple',
    description: 'Stop at N times the recent ATR',
    parameters: [
      num('period', 'ATR period', { default: 14, min: 2, max: 500, step: 1 }),
      num('multiple', 'Multiplier', {
        default: 1.5,
        min: 0.1,
        max: 100,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'recent_swing',
    title: 'Recent swing',
    description:
      'Stop at the recent swing low (long) or swing high (short) plus a buffer',
    parameters: [
      num('lookback_candles', 'Lookback bars', {
        default: 20,
        min: 2,
        max: 2000,
        step: 1,
      }),
      {
        key: 'buffer_pct',
        label: 'Buffer %',
        type: 'number',
        required: false,
        default: 0.2,
        min: 0,
        max: 20,
        step: 0.1,
      },
    ],
  },
]

export const TARGET_RULE_DESCRIPTORS: RuleUIDescriptor[] = [
  {
    type: 'fixed_pct',
    title: 'Fixed percentage',
    description: 'Target at a fixed percentage from entry',
    parameters: [
      num('pct', 'Target %', { default: 2, min: 0.01, max: 100, step: 0.1 }),
    ],
  },
  {
    type: 'fixed_rr',
    title: 'Fixed risk-reward',
    description: 'Target at N times the stop distance, on the opposite side',
    parameters: [
      num('rr', 'R:R multiple', {
        default: 2,
        min: 0.1,
        max: 20,
        step: 0.1,
      }),
    ],
  },
  {
    type: 'atr_multiple',
    title: 'ATR multiple',
    description: 'Target at N times the recent ATR',
    parameters: [
      num('period', 'ATR period', { default: 14, min: 2, max: 500, step: 1 }),
      num('multiple', 'Multiplier', {
        default: 2,
        min: 0.1,
        max: 100,
        step: 0.1,
      }),
    ],
  },
]

export const SIZING_RULE_DESCRIPTORS: RuleUIDescriptor[] = [
  {
    type: 'fixed_gbp_risk',
    title: 'Fixed GBP risk',
    description: 'Risk a fixed GBP amount per trade',
    parameters: [
      num('amount', 'Risk (£)', {
        default: 30,
        min: 0.01,
        max: 100_000,
        step: 1,
      }),
    ],
  },
  {
    type: 'fixed_position_size',
    title: 'Fixed position size',
    description: 'Always trade the same coin amount',
    parameters: [
      num('size', 'Coin size', {
        default: 0.01,
        min: 0.0000001,
        step: 0.001,
      }),
    ],
  },
]
