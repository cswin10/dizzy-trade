-- Trade extras for the journal feature.
--
-- Adds the optional `risk_amount_gbp` column so users can record how much
-- they were willing to lose on each entry, and adds the trades table to
-- the supabase_realtime publication so client subscriptions receive
-- INSERT, UPDATE, and DELETE events. RLS on trades is unchanged, so the
-- subscription is automatically scoped to the caller's tenant.

alter table public.trades
  add column if not exists risk_amount_gbp numeric;

alter publication supabase_realtime add table public.trades;
