// Side-effect imports register every condition's schema and
// evaluator with the strategy registries. Adding a new condition
// is a matter of dropping the file in this directory and
// importing it here.

import './rsi_threshold.ts'
import './rsi_crossing.ts'
import './stochastic_threshold.ts'
import './williams_r_threshold.ts'
import './sma_position.ts'
import './ema_position.ts'
import './sma_distance.ts'
import './sma_crossover.ts'
import './volume_ratio.ts'
import './volume_threshold.ts'
import './atr_threshold.ts'
import './atr_ratio.ts'
import './bollinger_position.ts'
import './near_recent_high.ts'
import './near_recent_low.ts'
import './candle_close_above.ts'
import './level_proximity.ts'
import './bullish_candle.ts'
import './bearish_candle.ts'
import './wick_ratio.ts'
import './close_position.ts'
import './hour_of_day.ts'
import './day_of_week.ts'
import './funding_threshold.ts'
