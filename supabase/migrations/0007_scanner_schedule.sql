-- Scanner schedule.
--
-- Registers a pg_cron job that invokes the scanner Edge Function every
-- minute. pg_cron has a one-minute floor; sub-minute cadence would need
-- a different mechanism (e.g. an external cron runner).
--
-- Before applying this migration, substitute:
--   <PROJECT_REF>         -> your Supabase project ref, e.g. abcd1234.supabase.co
--   <SERVICE_ROLE_KEY>    -> the project's service role key
-- Both values live in the Supabase dashboard (Project Settings > API).
--
-- To remove the schedule:
--   select cron.unschedule('scanner-tick');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'scanner-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/scanner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
