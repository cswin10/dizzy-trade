-- Settings tables RLS posture.
--
-- Migration 0009 created framework_thresholds and narrative_tags
-- without enabling RLS or adding policies, on the (incorrect)
-- assumption that they would be readable by any signed-in user as
-- global reference data. Modern Supabase projects enable RLS on new
-- public-schema tables by default, which left both tables readable
-- only by the service role. The visible symptom: the Frameworks tab
-- on /settings rendered an empty container because the SSR anon-key
-- read returned no rows. The Narratives tab silently degraded to
-- showing every symbol as the default 'cool' for the same reason.
--
-- This migration mirrors the posture set in 0008 for the scanner
-- tables: enable RLS explicitly, grant authenticated users SELECT
-- via a permissive policy, and rely on service_role for writes
-- (which bypasses RLS automatically). The settings page reads
-- through the anon client; the threshold and narrative-tag server
-- actions write through the service-role client.

alter table public.framework_thresholds enable row level security;
alter table public.narrative_tags enable row level security;

drop policy if exists framework_thresholds_select_all on public.framework_thresholds;
create policy framework_thresholds_select_all on public.framework_thresholds
  for select to authenticated using (true);

drop policy if exists narrative_tags_select_all on public.narrative_tags;
create policy narrative_tags_select_all on public.narrative_tags
  for select to authenticated using (true);

-- Belt and braces: grant SELECT explicitly in case the project was
-- created without default table grants. Idempotent.
grant select on public.framework_thresholds to authenticated;
grant select on public.narrative_tags to authenticated;
