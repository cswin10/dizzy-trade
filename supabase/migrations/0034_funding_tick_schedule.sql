-- Funding-rate live ingestion schedule.
--
-- Hyperliquid pays funding once an hour on perps. The scanner runs
-- every minute on a tight time budget, so funding ingestion is
-- factored into its own edge function (funding-tick) on its own
-- hourly cron rather than tacked on to the per-minute scan. The
-- minute-15 offset gives Hyperliquid time to publish the latest
-- rate before we go fetch it.
--
-- Before applying this migration, substitute:
--   <PROJECT_REF>         -> your Supabase project ref
--   <SERVICE_ROLE_KEY>    -> the project's service role key
--
-- To remove the schedule:
--   select cron.unschedule('funding-tick');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'funding-tick',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/funding-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
