-- Alert payload extensions for trader-facing sizing and validity.
--
-- The scanner now pre-computes everything a trader needs to act on
-- an alert without doing risk maths in their head: position size in
-- the base asset, notional size in USD, the leverage that would
-- result from the strategy's risk amount, and a validity window
-- aligned to the strategy's timeframe candle close.
--
-- All columns are nullable so historic alerts (which predate the
-- sizing pipeline) continue to render in the UI without backfill.
-- gbp_usd_rate is captured at alert time so the displayed sizing
-- stays meaningful even if the FX rate moves before the user opens
-- the trade.

alter table public.alerts
  add column position_size_coin numeric,
  add column position_size_usd numeric,
  add column leverage_implied numeric,
  add column valid_until timestamptz,
  add column risk_amount_gbp numeric,
  add column gbp_usd_rate numeric;

create index alerts_valid_until_idx on public.alerts (valid_until)
  where valid_until is not null;
