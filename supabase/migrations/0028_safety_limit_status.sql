-- Add 'skipped_safety_limit' to the live_signals.status enum.
--
-- Phase 2b enables mainnet behind hardcoded safety caps (max
-- notional, max risk per trade, max 24h loss, max concurrent
-- positions, manual-confirmation gate for the first N trades).
-- A signal that fails any of those caps lands in this new
-- terminal state with the failing constraint recorded in
-- failure_reason. Splitting from the existing skipped_*
-- statuses keeps the audit trail clean: skipped_safety_limit
-- is the hardcoded floor, the other skipped_* states are
-- per-deployment / per-tenant guardrails the operator can
-- adjust.

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
      'failed'
    )
  );

notify pgrst, 'reload schema';
