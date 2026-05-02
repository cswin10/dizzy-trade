-- Distinguishing legacy framework alerts from composable
-- strategy_definition alerts on the alerts table.
--
-- Legacy alerts carry framework_id and a flat condition_values
-- object. Composable alerts carry the same condition_values
-- (now interpreted as a per-condition map keyed by
-- condition_type@index) plus a group index and direction. We
-- discriminate via alert_source so the UI can render them
-- differently without inferring from null fields.

alter table public.alerts
  add column if not exists alert_source text
    not null default 'framework';

alter table public.alerts
  drop constraint if exists alerts_alert_source_check;

alter table public.alerts
  add constraint alerts_alert_source_check
    check (alert_source in ('framework', 'composable'));

create index if not exists alerts_alert_source_idx
  on public.alerts (alert_source);
