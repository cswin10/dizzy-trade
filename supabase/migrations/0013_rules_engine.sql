-- Rules engine schema.
--
-- The rules engine enforces trading discipline at two layers: a hard
-- gate at trade submission and an informational tag on alerts so the
-- operator can see which alerts they could not have taken.
--
-- alerts gains:
--   rules_status     'passed' | 'blocked' | 'warning'  (nullable)
--   rules_violations jsonb array of {rule, reason, current_value, limit}
-- Both nullable so historic alerts (which predate the engine) keep
-- rendering.
--
-- daily_pnl is a view aggregating closed trades per UTC day so the
-- rules engine and the dashboard share a single source of truth on
-- realised PnL.
--
-- consecutive_loser_count is a helper function that walks the most
-- recent closed trades for a tenant in reverse chronological order
-- and returns the streak length up to the most recent non-loss. The
-- function is security definer so it can read trades regardless of
-- the caller's RLS context, but it filters by the supplied tenant_id
-- parameter so a caller can only count their own streak.

-- Each block is idempotent so the migration can be re-run safely
-- after a partial failure (the original publication line had no
-- IF NOT EXISTS form and could leave earlier statements applied
-- while later ones rolled back).

alter table public.alerts
  add column if not exists rules_status text
    check (rules_status in ('passed', 'blocked', 'warning')),
  add column if not exists rules_violations jsonb;

create or replace view public.daily_pnl as
select
  user_id,
  tenant_id,
  date_trunc('day', exit_at) as trade_date,
  sum(pnl) as realised_pnl_gbp,
  count(*) as trades_count
from public.trades
where outcome in ('win', 'loss', 'breakeven')
  and exit_at is not null
group by user_id, tenant_id, date_trunc('day', exit_at);

grant select on public.daily_pnl to authenticated, service_role;

create or replace function public.consecutive_loser_count(p_tenant_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  losers integer := 0;
  trade_record record;
begin
  for trade_record in
    select outcome
    from public.trades
    where tenant_id = p_tenant_id
      and outcome in ('win', 'loss', 'breakeven')
      and exit_at is not null
    order by exit_at desc
    limit 20
  loop
    if trade_record.outcome = 'loss' then
      losers := losers + 1;
    else
      exit;
    end if;
  end loop;
  return losers;
end;
$$;

grant execute on function public.consecutive_loser_count(uuid)
  to authenticated, service_role;

-- Realtime on trades powers the live status panel on /rules. The
-- panel also polls every 10s as a backstop, but the subscription
-- gives instant updates when a trade is logged or closed. Wrapped in
-- a DO block because alter publication add table has no
-- IF NOT EXISTS form, and an earlier deploy may already have added
-- the table.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table public.trades;
  end if;
end $$;
