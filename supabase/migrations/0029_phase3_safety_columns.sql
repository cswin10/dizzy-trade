-- Phase 1 critical-safety columns + status.
--
-- Adds the requires_manual_confirmation flag the preflight check
-- already computes but had no column to write to, so a future
-- auto-execute path inherits the cap without re-counting closed
-- trades. Adds exchange_stop_cloid so the monitor tick can resolve
-- a real oid for a trigger order that initially placed as
-- 'waitingForTrigger' (the SDK returns no oid in that case and we
-- previously wrote a synthetic 'pending:stop:<ts>' string into
-- exchange_stop_order_id which could never be looked up). Adds
-- the safety_rejected status so a confirm-time safety failure
-- has a distinct terminal state from skipped_safety_limit (which
-- happens at fire time).

alter table public.live_signals
  add column if not exists requires_manual_confirmation boolean not null default false,
  add column if not exists exchange_stop_cloid text,
  add column if not exists exchange_target_cloid text;

alter table public.live_signals
  drop constraint if exists live_signals_status_check;

alter table public.live_signals
  add constraint live_signals_status_check check (
    status in (
      'pending_confirmation',
      'confirmed',
      'order_placed',
      'filled',
      'expired_unfilled',
      'cancelled',
      'closed_at_stop',
      'closed_at_target',
      'skipped_by_user',
      'skipped_max_positions',
      'skipped_daily_loss',
      'skipped_consecutive_losers',
      'skipped_safety_limit',
      'safety_rejected',
      'failed'
    )
  );

create index if not exists live_signals_stop_cloid_idx
  on public.live_signals (exchange_stop_cloid)
  where exchange_stop_cloid is not null;

create index if not exists live_signals_target_cloid_idx
  on public.live_signals (exchange_target_cloid)
  where exchange_target_cloid is not null;

notify pgrst, 'reload schema';
