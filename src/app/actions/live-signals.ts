'use server'

// Server actions for the live-signal lifecycle: confirm / skip
// from the UI, fire a synthetic test signal for end-to-end
// dev-loop verification, and step the monitor (the same logic a
// future cron job will run).

import { revalidatePath } from 'next/cache'

import { getExchangeClient, getMockClientIfActive } from '@/lib/exchange/factory'
import {
  buildOrderIntent,
  computeExpiryAt,
  placeEntryOrder,
  preflightCheck,
  preflightSkipStatus,
  runMonitorTick,
  type SignalIntent,
} from '@/lib/live/pipeline'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type SignalActionResult =
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

// --- Manual test-signal (Phase 1 dev tool) -------------------------

export type FireTestSignalInput = {
  deployment_id: string
  pair: string
  direction: 'long' | 'short'
  signal_close_price: number
  raw_stop_price: number
  raw_target_price: number
}

export async function fireTestSignalAction(
  input: FireTestSignalInput,
): Promise<SignalActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()

  const { data: deployment, error: deployErr } = await service
    .from('strategy_deployments')
    .select('*')
    .eq('id', input.deployment_id)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (deployErr || !deployment) {
    return { ok: false, message: deployErr?.message ?? 'Deployment not found' }
  }

  // Resolve sizing from whichever source produced the deployment.
  let definition: StrategyDefinition | null = null
  if (deployment.strategy_definition_id) {
    const { data: defRow } = await service
      .from('strategy_definitions')
      .select('definition')
      .eq('id', deployment.strategy_definition_id)
      .single()
    definition =
      (defRow?.definition as unknown as StrategyDefinition | undefined) ?? null
  }
  const intent: SignalIntent | null = buildOrderIntent({
    pair: input.pair,
    direction: input.direction,
    signal_at: new Date(),
    signal_close_price: input.signal_close_price,
    raw_stop_price: input.raw_stop_price,
    raw_target_price: input.raw_target_price,
    sizing: definition
      ? { kind: 'composable', definition }
      : { kind: 'legacy', risk_gbp: Number(deployment.live_risk_gbp) },
    deployment_risk_gbp: Number(deployment.live_risk_gbp),
  })
  if (!intent) {
    return { ok: false, message: 'Could not size order from inputs' }
  }

  const preflight = await preflightCheck(
    service,
    deployment,
    input.pair,
    intent,
  )
  if (!preflight.ok) {
    const status = preflightSkipStatus(preflight.reason)
    const { data: row } = await service
      .from('live_signals')
      .insert({
        tenant_id: ctx.tenantId,
        user_id: ctx.user.id,
        deployment_id: deployment.id,
        pair: intent.pair,
        direction: intent.direction,
        signal_at: intent.signal_at.toISOString(),
        signal_close_price: intent.signal_close_price,
        intended_entry_price: intent.intended_entry_price,
        intended_stop_price: intent.intended_stop_price,
        intended_target_price: intent.intended_target_price,
        intended_size_coin: intent.intended_size_coin,
        intended_size_usd: intent.intended_size_usd,
        intended_risk_gbp: intent.intended_risk_gbp,
        intended_rr: intent.intended_rr,
        status,
        failure_reason: preflight.detail,
      })
      .select('id')
      .single()
    revalidatePath('/live')
    return { ok: true, id: row?.id ?? '' }
  }

  const { data: row, error: insertErr } = await service
    .from('live_signals')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.user.id,
      deployment_id: deployment.id,
      pair: intent.pair,
      direction: intent.direction,
      signal_at: intent.signal_at.toISOString(),
      signal_close_price: intent.signal_close_price,
      intended_entry_price: intent.intended_entry_price,
      intended_stop_price: intent.intended_stop_price,
      intended_target_price: intent.intended_target_price,
      intended_size_coin: intent.intended_size_coin,
      intended_size_usd: intent.intended_size_usd,
      intended_risk_gbp: intent.intended_risk_gbp,
      intended_rr: intent.intended_rr,
      status: 'pending_confirmation',
      notification_sent_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (insertErr || !row) {
    return { ok: false, message: insertErr?.message ?? 'Insert failed' }
  }
  revalidatePath('/live')
  return { ok: true, id: row.id }
}

// --- Confirm / skip (Telegram + app share this) --------------------

export async function confirmSignalAction(
  id: string,
  source: 'app' | 'telegram',
): Promise<SignalActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  // First-response-wins: a row that's already moved past
  // pending_confirmation is treated as a no-op so the second
  // confirmation source does not double-place.
  const { data: signal, error } = await service
    .from('live_signals')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (error || !signal) {
    return { ok: false, message: error?.message ?? 'Signal not found' }
  }
  if (signal.status !== 'pending_confirmation') {
    return { ok: true, id }
  }
  const { data: deployment } = await service
    .from('strategy_deployments')
    .select('*')
    .eq('id', signal.deployment_id)
    .single()
  if (!deployment) {
    return { ok: false, message: 'Deployment not found' }
  }
  // Mark confirmed so a racing second confirmation no-ops.
  await service
    .from('live_signals')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmation_source: source,
    })
    .eq('id', id)
    .eq('status', 'pending_confirmation')
  // Re-fetch to pick up the new row state.
  const { data: confirmed } = await service
    .from('live_signals')
    .select('*')
    .eq('id', id)
    .single()
  if (!confirmed) {
    return { ok: false, message: 'Signal vanished after confirmation' }
  }

  const { client } = await getExchangeClient(ctx.tenantId)
  const expiresAt = computeExpiryAt(
    new Date(confirmed.signal_at),
    // Phase 1 deployments only run from composable strategies in
    // practice; legacy framework timeframe lives elsewhere. The
    // monitor tick treats expires_at as authoritative regardless,
    // so falling back to a 1h candle here is safe.
    '1h',
    deployment.live_order_lifetime_candles,
  )
  await placeEntryOrder(service, client, confirmed, expiresAt)
  revalidatePath('/live')
  return { ok: true, id }
}

export async function skipSignalAction(
  id: string,
  source: 'app' | 'telegram',
): Promise<SignalActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  await service
    .from('live_signals')
    .update({
      status: 'skipped_by_user',
      confirmed_at: new Date().toISOString(),
      confirmation_source: source,
      failure_reason: 'user skipped',
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'pending_confirmation')
  revalidatePath('/live')
  return { ok: true, id }
}

// --- Monitor tick (manual trigger; cron wires Phase 2) -------------

export async function runMonitorTickAction(): Promise<
  | {
      ok: true
      signals_inspected: number
      fills_recorded: number
      expirations: number
      closes_recorded: number
      errors: string[]
    }
  | { ok: false; message: string }
> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const { client } = await getExchangeClient(ctx.tenantId)
  const result = await runMonitorTick(service, client)
  revalidatePath('/live')
  return { ok: true, ...result }
}

// --- Mock-only debug controls --------------------------------------

export async function pushMockTickAction(input: {
  pair: string
  price: number
  high: number
  low: number
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const mock = await getMockClientIfActive(ctx.tenantId)
  if (!mock) {
    return { ok: false, message: 'Mock client is not active' }
  }
  mock.pushTick({
    pair: input.pair,
    price: input.price,
    high: input.high,
    low: input.low,
    at: new Date(),
  })
  // Also try to settle anything that became filled / triggered as
  // a result of this tick so the operator does not have to also
  // press "Run monitor tick".
  const service = createServiceClient()
  const { client } = await getExchangeClient(ctx.tenantId)
  const tickResult = await runMonitorTick(service, client)
  revalidatePath('/live')
  return { ok: true, ...({ tickResult } as object) }
}

export async function forceFillEntryAction(
  signal_id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const mock = await getMockClientIfActive(ctx.tenantId)
  if (!mock) return { ok: false, message: 'Mock client is not active' }
  const service = createServiceClient()
  const { data: signal } = await service
    .from('live_signals')
    .select('exchange_order_id, intended_entry_price')
    .eq('id', signal_id)
    .single()
  if (!signal?.exchange_order_id) {
    return { ok: false, message: 'No exchange_order_id on signal' }
  }
  mock.forceFillOpenLimit(
    signal.exchange_order_id,
    Number(signal.intended_entry_price),
  )
  const { client } = await getExchangeClient(ctx.tenantId)
  await runMonitorTick(service, client)
  revalidatePath('/live')
  return { ok: true }
}

export async function forceTriggerStopAction(
  signal_id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const mock = await getMockClientIfActive(ctx.tenantId)
  if (!mock) return { ok: false, message: 'Mock client is not active' }
  const service = createServiceClient()
  const { data: signal } = await service
    .from('live_signals')
    .select('exchange_stop_order_id, intended_stop_price')
    .eq('id', signal_id)
    .single()
  if (!signal?.exchange_stop_order_id) {
    return { ok: false, message: 'No stop order id on signal' }
  }
  mock.forceTriggerStop(
    signal.exchange_stop_order_id,
    Number(signal.intended_stop_price),
  )
  const { client } = await getExchangeClient(ctx.tenantId)
  await runMonitorTick(service, client)
  revalidatePath('/live')
  return { ok: true }
}

export async function forceTriggerTargetAction(
  signal_id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const mock = await getMockClientIfActive(ctx.tenantId)
  if (!mock) return { ok: false, message: 'Mock client is not active' }
  const service = createServiceClient()
  const { data: signal } = await service
    .from('live_signals')
    .select('exchange_target_order_id, intended_target_price')
    .eq('id', signal_id)
    .single()
  if (!signal?.exchange_target_order_id) {
    return { ok: false, message: 'No target order id on signal' }
  }
  mock.forceTriggerTakeProfit(
    signal.exchange_target_order_id,
    Number(signal.intended_target_price),
  )
  const { client } = await getExchangeClient(ctx.tenantId)
  await runMonitorTick(service, client)
  revalidatePath('/live')
  return { ok: true }
}
