'use server'

// Server actions for the live deployments surface. Splits cleanly
// from live-signals.ts so the deploy / pause / archive lifecycle
// stays separate from the per-signal confirm / monitor flow.

import { revalidatePath } from 'next/cache'

import { getExchangeClient } from '@/lib/exchange/factory'
import { pauseAllForTenant } from '@/lib/live/pipeline'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type DeploymentActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string }

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }
  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false as const, error: error.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }
  return { ok: true as const, user, tenantId }
}

export type DeployStrategyInput = {
  // Exactly one of these must be set.
  strategy_definition_id?: string
  legacy_strategy_id?: string
  live_risk_gbp: number
  live_pairs: string[]
  live_max_concurrent_positions: number
  live_max_daily_loss_gbp: number | null
  live_max_consecutive_losers: number | null
  live_order_lifetime_candles: number
  source_backtest_run_id: string | null
}

export async function deployStrategyAction(
  input: DeployStrategyInput,
): Promise<DeploymentActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  if (!input.strategy_definition_id && !input.legacy_strategy_id) {
    return { ok: false, message: 'Pick a strategy to deploy' }
  }
  if (input.strategy_definition_id && input.legacy_strategy_id) {
    return {
      ok: false,
      message: 'Pick exactly one strategy to deploy',
    }
  }
  if (input.live_pairs.length === 0) {
    return { ok: false, message: 'At least one pair is required' }
  }
  if (input.live_risk_gbp <= 0) {
    return { ok: false, message: 'Live risk must be greater than zero' }
  }

  const service = createServiceClient()

  // Snapshot the source backtest summary into the deployment row
  // so the operator's "what did I look at when I deployed this"
  // record stays stable even if the backtest is later deleted or
  // re-run.
  let summary: Record<string, unknown> | null = null
  if (input.source_backtest_run_id) {
    const { data: run } = await service
      .from('backtest_runs')
      .select(
        'name, total_trades, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio',
      )
      .eq('id', input.source_backtest_run_id)
      .single()
    if (run) summary = run as Record<string, unknown>
  }

  const { data, error } = await service
    .from('strategy_deployments')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.user.id,
      strategy_definition_id: input.strategy_definition_id ?? null,
      legacy_strategy_id: input.legacy_strategy_id ?? null,
      live_risk_gbp: input.live_risk_gbp,
      live_pairs: input.live_pairs,
      live_max_concurrent_positions: input.live_max_concurrent_positions,
      live_max_daily_loss_gbp: input.live_max_daily_loss_gbp,
      live_max_consecutive_losers: input.live_max_consecutive_losers,
      live_order_lifetime_candles: input.live_order_lifetime_candles,
      // Phase 1 keeps auto-execute disabled regardless of input.
      live_auto_execute_enabled: false,
      source_backtest_run_id: input.source_backtest_run_id,
      source_backtest_summary: summary,
      status: 'live',
    })
    .select('id')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Insert failed' }
  }

  // Flip the strategy's deployment_status to 'live' so the
  // existing scanner picks it up. This mirrors the prior
  // is_active=true behaviour without re-introducing the column.
  if (input.strategy_definition_id) {
    await service
      .from('strategy_definitions')
      .update({ deployment_status: 'live' })
      .eq('id', input.strategy_definition_id)
      .eq('tenant_id', ctx.tenantId)
  }
  if (input.legacy_strategy_id) {
    await service
      .from('strategies')
      .update({ deployment_status: 'live' })
      .eq('id', input.legacy_strategy_id)
  }

  revalidatePath('/live')
  revalidatePath('/settings/strategies')
  return { ok: true, id: data.id }
}

export async function pauseDeploymentAction(
  id: string,
): Promise<DeploymentActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const { client } = getExchangeClient()
  // Cancel every still-open order belonging to this deployment.
  // Phase 1's mock cancel-all is global so we settle for a per-
  // pair fan-out using the deployment's pairs.
  const { data: deployment } = await service
    .from('strategy_deployments')
    .select('id, live_pairs, strategy_definition_id, legacy_strategy_id')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (!deployment) {
    return { ok: false, message: 'Deployment not found' }
  }
  for (const pair of deployment.live_pairs ?? []) {
    await client.cancelAllOrders({ pair })
  }
  await service
    .from('strategy_deployments')
    .update({ status: 'paused', paused_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  // Cancel any in-flight signals so the monitor tick stops
  // poking them.
  await service
    .from('live_signals')
    .update({ status: 'cancelled', failure_reason: 'deployment paused' })
    .eq('deployment_id', id)
    .in('status', [
      'pending_confirmation',
      'confirmed',
      'order_placed',
      'filled',
    ])
  // Roll deployment_status back so the scanner stops emitting
  // signals from the paused strategy.
  if (deployment.strategy_definition_id) {
    await service
      .from('strategy_definitions')
      .update({ deployment_status: 'paused' })
      .eq('id', deployment.strategy_definition_id)
      .eq('tenant_id', ctx.tenantId)
  }
  if (deployment.legacy_strategy_id) {
    await service
      .from('strategies')
      .update({ deployment_status: 'paused' })
      .eq('id', deployment.legacy_strategy_id)
  }
  revalidatePath('/live')
  return { ok: true, id }
}

export async function archiveDeploymentAction(
  id: string,
): Promise<DeploymentActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  await service
    .from('strategy_deployments')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  revalidatePath('/live')
  return { ok: true, id }
}

export async function killAllAction(): Promise<
  | { ok: true; paused: number; cancelled_orders: number; cancelled_signals: number }
  | { ok: false; message: string }
> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const { client } = getExchangeClient()
  const result = await pauseAllForTenant(service, client, ctx.tenantId)
  // Roll matching strategies back to paused so the scanner stops
  // emitting from them on the next tick.
  await service
    .from('strategy_definitions')
    .update({ deployment_status: 'paused' })
    .eq('tenant_id', ctx.tenantId)
    .eq('deployment_status', 'live')
  await service
    .from('strategies')
    .update({ deployment_status: 'paused' })
    .eq('deployment_status', 'live')
  revalidatePath('/live')
  return {
    ok: true,
    paused: result.paused_deployments,
    cancelled_orders: result.cancelled_orders,
    cancelled_signals: result.cancelled_signals,
  }
}
