-- Framework thresholds and narrative tags.
--
-- Moves the per-framework tuning knobs out of TypeScript constants and
-- into a table the scanner reads at runtime. This lets an operator
-- retune a framework (e.g. tighten funding_threshold) without
-- redeploying the Edge Function, and gives the settings UI (part 2) a
-- durable place to write edits.
--
-- narrative_tags seeds a manual heat classification for symbols until a
-- proper news module ships. narrative_breakout_v1 reads it to gate its
-- "hot" condition.
--
-- RLS is deliberately left off on both tables. They are global
-- reference data read by the scanner (service role) and the settings
-- page (which goes through server actions under service role as well).

-- Thresholds ----------------------------------------------------------

create table public.framework_thresholds (
  id uuid primary key default gen_random_uuid(),
  framework_id text not null,
  key text not null,
  value numeric not null,
  description text,
  updated_at timestamptz default now(),
  unique (framework_id, key)
);

create index framework_thresholds_framework_id_idx
  on public.framework_thresholds (framework_id);

-- Liquidation hunt (Framework 3) --------------------------------------
insert into public.framework_thresholds
  (framework_id, key, value, description) values
  ('liquidation_hunt_v1', 'funding_threshold', 0.0001,
    'Minimum funding rate magnitude to qualify as extreme'),
  ('liquidation_hunt_v1', 'oi_elevation_multiplier', 1.3,
    'Open interest must exceed this multiple of 24h average'),
  ('liquidation_hunt_v1', 'wick_to_body_ratio', 1.5,
    'Rejection wick must be at least this ratio of candle body'),
  ('liquidation_hunt_v1', 'stop_buffer', 0.002,
    'Percentage buffer beyond wick extreme for stop'),
  ('liquidation_hunt_v1', 'target_rr_multiple', 2.0,
    'Target is this multiple of risk distance');

-- Narrative breakout (Framework 1) ------------------------------------
insert into public.framework_thresholds
  (framework_id, key, value, description) values
  ('narrative_breakout_v1', 'heat_score_absolute', 0.7,
    'Dormant until news module ships'),
  ('narrative_breakout_v1', 'heat_delta_6h', 0.15,
    'Dormant until news module ships'),
  ('narrative_breakout_v1', 'breakout_lookback_candles', 20,
    'Number of prior 4h candles to compute resistance'),
  ('narrative_breakout_v1', 'volume_multiplier', 1.5,
    'Volume must exceed this multiple of SMA20'),
  ('narrative_breakout_v1', 'btc_outperformance_24h', 0.05,
    'Asset must outperform BTC by this percentage over 24h'),
  ('narrative_breakout_v1', 'funding_min_hourly', 0,
    'Funding must be above this hourly rate'),
  ('narrative_breakout_v1', 'funding_max_hourly', 0.005,
    'Funding must be below this hourly rate');

-- Mean reversion (Framework 2) ----------------------------------------
insert into public.framework_thresholds
  (framework_id, key, value, description) values
  ('mean_reversion_v1', 'swing_lookback_candles', 50,
    'Lookback window for swing detection'),
  ('mean_reversion_v1', 'swing_min_age_candles', 10,
    'Minimum age of swing level to matter'),
  ('mean_reversion_v1', 'level_proximity_pct', 0.005,
    'Price must be within this fraction of level'),
  ('mean_reversion_v1', 'rsi_period', 14,
    'RSI period'),
  ('mean_reversion_v1', 'rsi_lookback_candles', 20,
    'Lookback for RSI divergence'),
  ('mean_reversion_v1', 'rsi_overbought', 65,
    'RSI threshold for short setups'),
  ('mean_reversion_v1', 'rsi_oversold', 35,
    'RSI threshold for long setups'),
  ('mean_reversion_v1', 'rejection_wick_body_ratio', 2.0,
    'Wick must be this ratio of body'),
  ('mean_reversion_v1', 'rejection_close_position_threshold', 0.6,
    'Close position in candle range for rejection'),
  ('mean_reversion_v1', 'funding_stretch_long_setup', -0.003,
    'Funding must be at or below this for long setup'),
  ('mean_reversion_v1', 'funding_stretch_short_setup', 0.01,
    'Funding must be at or above this for short setup');

-- Narrative tags ------------------------------------------------------

create table public.narrative_tags (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  heat_level text not null
    check (heat_level in ('hot', 'warm', 'cool', 'cold')),
  note text,
  updated_at timestamptz default now()
);

insert into public.narrative_tags (symbol, heat_level) values
  ('FET', 'hot'),
  ('TAO', 'hot'),
  ('ONDO', 'warm'),
  ('WIF', 'warm'),
  ('ARB', 'cool');
