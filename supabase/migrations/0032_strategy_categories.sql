-- Strategy categories.
--
-- The /settings/strategies list flattens every strategy into a single
-- column, which becomes unmanageable past ~20 rows. Adding a coarse
-- category lets the operator filter the library without committing
-- to a tag taxonomy: every strategy lives in exactly one bucket and
-- the bucket itself is a fixed enum so the UI does not need to deal
-- with free-form values.
--
-- Existing rows backfill to 'Other' so they are visible by default
-- and the operator can re-categorise them by hand.

alter table public.strategy_definitions
  add column if not exists category text not null default 'Other'
    check (category in (
      'Momentum',
      'Mean Reversion',
      'Volatility',
      'Breakout',
      'Time-based',
      'Funding',
      'Other'
    ));

create index if not exists strategy_definitions_category_idx
  on public.strategy_definitions (tenant_id, category)
  where is_archived = false;

notify pgrst, 'reload schema';
