// Side-effect imports register every condition's schema and
// evaluator with the strategy registries. Adding a new condition
// is a matter of dropping the file in this directory and
// importing it here.

import './rsi_threshold'
import './rsi_crossing'
import './stochastic_threshold'
import './williams_r_threshold'
import './sma_position'
import './ema_position'
import './sma_distance'
import './sma_crossover'
import './volume_ratio'
import './volume_threshold'
import './atr_threshold'
import './atr_ratio'
import './bollinger_position'
import './near_recent_high'
import './near_recent_low'
import './candle_close_above'
import './level_proximity'
import './bullish_candle'
import './bearish_candle'
import './wick_ratio'
import './close_position'
import './hour_of_day'
import './day_of_week'
import './funding_threshold'
