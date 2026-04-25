-- Post-trade analysis layer.
--
-- Each closed trade can carry a Claude-generated review covering what
-- went right, what went wrong, an optional pattern insight referencing
-- past trades, and a single categorical lesson tag. All columns are
-- nullable: trades logged before this feature simply have no analysis,
-- and the journal renders a "Generate" button on those rows.
--
-- analysis_prompt_version starts at 1 and bumps any time we change the
-- prompt enough to invalidate prior outputs. The journal page uses it
-- to decide whether an analysis is "stale" and worth regenerating.
--
-- Idempotent so the migration can be re-run safely.

alter table public.trades
  add column if not exists analysis_text text;

alter table public.trades
  add column if not exists analysis_lesson_tag text;

alter table public.trades
  add column if not exists analysis_what_went_right text;

alter table public.trades
  add column if not exists analysis_what_went_wrong text;

alter table public.trades
  add column if not exists analysis_pattern_insight text;

alter table public.trades
  add column if not exists analysis_generated_at timestamptz;

alter table public.trades
  add column if not exists analysis_model text;

alter table public.trades
  add column if not exists analysis_prompt_version int default 1;

-- Lookups for the lesson-tag filter on /journal. Partial index keeps it
-- small: most rows will have a tag, but trades logged pre-feature do
-- not, and trades that failed analysis stay null forever.
create index if not exists trades_analysis_lesson_tag_idx
  on public.trades (tenant_id, analysis_lesson_tag)
  where analysis_lesson_tag is not null;
