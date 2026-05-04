'use server'

import { revalidatePath } from 'next/cache'

import { getBtcContextAtNow } from '@/lib/hyperliquid'
import { evaluateRules, type RulesContext } from '@/lib/rules'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeTradePnl, outcomeForPnl } from '@/lib/trade-helpers'
import {
  closeTradeSchema,
  deleteTradeSchema,
  editLessonSchema,
  logTradeSchema,
} from '@/lib/validations/trade'

import type { TradeActionState } from './trade-types'

type ActiveStrategyRow = {
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
}

// Loads the operator's discipline guardrails: the active strategy plus
// the live state for the current tenant. Returns null when there is
// no active strategy, in which case the caller short-circuits the
// rules gate (nothing to enforce against).
async function loadRulesContext(
  tenantId: string,
  proposedRiskGbp: number | null,
): Promise<RulesContext | null> {
  const service = createServiceClient()

  const [strategyRes, openRes, todayPnlRes, lastLossRes, losersRes] =
    await Promise.all([
      service
        .from('strategies')
        .select(
          'risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
        )
        .eq('deployment_status', 'live')
        .limit(1),
      service
        .from('trades')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('outcome', 'open'),
      service
        .from('trades')
        .select('pnl')
        .eq('tenant_id', tenantId)
        .in('outcome', ['win', 'loss', 'breakeven'])
        .gte('exit_at', startOfTodayUtcIso()),
      service
        .from('trades')
        .select('exit_at')
        .eq('tenant_id', tenantId)
        .eq('outcome', 'loss')
        .order('exit_at', { ascending: false })
        .limit(1),
      service.rpc('consecutive_loser_count', { p_tenant_id: tenantId }),
    ])

  const strategyRow = strategyRes.data?.[0] as ActiveStrategyRow | undefined
  if (!strategyRow) return null

  let today_realised_pnl_gbp = 0
  for (const row of todayPnlRes.data ?? []) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      today_realised_pnl_gbp += pnl
    }
  }

  const lastLossRaw = lastLossRes.data?.[0]?.exit_at
  const last_loss_at =
    typeof lastLossRaw === 'string' ? new Date(lastLossRaw) : null

  const consecutive_losers_count = Number(losersRes.data ?? 0)

  return {
    strategy: {
      risk_amount_gbp: Number(strategyRow.risk_amount_gbp),
      min_rr: Number(strategyRow.min_rr),
      max_concurrent_positions: Number(strategyRow.max_concurrent_positions),
      max_daily_loss_gbp:
        strategyRow.max_daily_loss_gbp == null
          ? null
          : Number(strategyRow.max_daily_loss_gbp),
      max_consecutive_losers:
        strategyRow.max_consecutive_losers == null
          ? null
          : Number(strategyRow.max_consecutive_losers),
    },
    proposedTrade: {
      risk_amount_gbp: proposedRiskGbp,
      // The trade form does not collect a stop or target, so we
      // cannot compute an RR ratio at submission time. The scanner
      // covers the rr_below_min rule for alerts; the form gate
      // skips it.
      rr_ratio: null,
    },
    currentState: {
      open_positions_count: openRes.count ?? 0,
      today_realised_pnl_gbp,
      consecutive_losers_count,
      last_loss_at,
    },
  }
}

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function firstMessage(errors: Record<string, string[] | undefined>): string {
  for (const key of Object.keys(errors)) {
    const list = errors[key]
    if (list && list.length > 0 && list[0]) return list[0]
  }
  return 'Invalid input'
}

function rawForm(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  formData.forEach((value, key) => {
    out[key] = typeof value === 'string' ? value : ''
  })
  return out
}

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const { data: memberships, error: membershipError } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (membershipError)
    return { ok: false as const, error: membershipError.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }

  return { ok: true as const, supabase, user, tenantId }
}

function revalidateAll() {
  revalidatePath('/journal')
  revalidatePath('/dashboard')
}

export async function logTradeAction(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const parsed = logTradeSchema.safeParse(rawForm(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const ctx = await resolveTenant()
  if (!ctx.ok) return { status: 'error', message: ctx.error }
  const { supabase, user, tenantId } = ctx

  const d = parsed.data

  // Discipline gate. Skipped only when there is no active strategy:
  // nothing to enforce against. When a strategy exists we either
  // block (and refuse the insert) or warn (insert and surface the
  // warning so the UI can render a heads-up).
  let warnings: import('@/lib/rules').RuleViolation[] | undefined
  const rulesContext = await loadRulesContext(
    tenantId,
    d.risk_amount_gbp ?? null,
  )
  if (rulesContext) {
    const rulesResult = evaluateRules(rulesContext)
    if (rulesResult.status === 'blocked') {
      return {
        status: 'error',
        message: 'Trade blocked by your rules',
        violations: rulesResult.violations,
      }
    }
    if (rulesResult.status === 'warning') {
      warnings = rulesResult.violations
    }
  }

  let pnl: number | null = null
  let outcome: 'win' | 'loss' | 'breakeven' | 'open' = 'open'
  if (d.exit_price !== undefined && d.exit_size !== undefined) {
    pnl = computeTradePnl(d.direction, d.entry_price, d.exit_size, d.exit_price)
    outcome = outcomeForPnl(pnl)
  }

  // Capture BTC trend at log time for the per-context analytics chart.
  // The fetcher has its own 3s timeout and returns null on any error,
  // so a Hyperliquid hiccup never blocks the trade from being saved.
  const btcContext = await getBtcContextAtNow()

  const { data: inserted, error } = await supabase
    .from('trades')
    .insert({
      tenant_id: tenantId,
      user_id: user.id,
      asset_symbol: d.asset_symbol,
      coingecko_id: d.coingecko_id ?? null,
      direction: d.direction,
      entry_price: d.entry_price,
      entry_size: d.entry_size,
      leverage: d.leverage,
      venue: d.venue,
      narrative_tag: d.narrative_tag,
      setup_type: d.setup_type ?? null,
      thesis: d.thesis ?? null,
      risk_amount_gbp: d.risk_amount_gbp ?? null,
      entry_at: d.entry_at.toISOString(),
      exit_price: d.exit_price ?? null,
      exit_size: d.exit_size ?? null,
      exit_at: d.exit_at ? d.exit_at.toISOString() : null,
      lesson: d.lesson ?? null,
      pnl,
      outcome,
      source: 'manual',
      btc_context_at_entry: btcContext,
    })
    .select('id')
    .single()

  if (error) return { status: 'error', message: error.message }

  // If the trade was opened from an alert, record the link so the alert
  // stops showing as actionable and the journal row carries the source.
  if (d.alert_id && inserted?.id) {
    const { error: linkError } = await supabase
      .from('alerts')
      .update({ trade_id: inserted.id })
      .eq('id', d.alert_id)
    if (linkError) {
      console.warn(
        `[logTradeAction] failed to link alert ${d.alert_id}: ${linkError.message}`,
      )
    } else {
      revalidatePath('/alerts')
    }
  }

  revalidateAll()
  return warnings && warnings.length > 0
    ? { status: 'success', warnings }
    : { status: 'success' }
}

export async function closeTradeAction(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const parsed = closeTradeSchema.safeParse(rawForm(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const ctx = await resolveTenant()
  if (!ctx.ok) return { status: 'error', message: ctx.error }
  const { supabase, tenantId } = ctx

  const d = parsed.data

  const { data: rows, error: fetchError } = await supabase
    .from('trades')
    .select('direction, entry_price')
    .eq('id', d.trade_id)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (fetchError) return { status: 'error', message: fetchError.message }
  const existing = rows?.[0]
  if (!existing) return { status: 'error', message: 'Trade not found' }

  const pnl = computeTradePnl(
    existing.direction,
    existing.entry_price,
    d.exit_size,
    d.exit_price,
  )
  const outcome = outcomeForPnl(pnl)

  const { error } = await supabase
    .from('trades')
    .update({
      exit_price: d.exit_price,
      exit_size: d.exit_size,
      exit_at: d.exit_at.toISOString(),
      lesson: d.lesson ?? null,
      pnl,
      outcome,
    })
    .eq('id', d.trade_id)
    .eq('tenant_id', tenantId)

  if (error) return { status: 'error', message: error.message }

  revalidateAll()
  return { status: 'success' }
}

export async function editLessonAction(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const parsed = editLessonSchema.safeParse(rawForm(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const ctx = await resolveTenant()
  if (!ctx.ok) return { status: 'error', message: ctx.error }
  const { supabase, tenantId } = ctx

  const { error } = await supabase
    .from('trades')
    .update({ lesson: parsed.data.lesson })
    .eq('id', parsed.data.trade_id)
    .eq('tenant_id', tenantId)

  if (error) return { status: 'error', message: error.message }

  revalidateAll()
  return { status: 'success' }
}

export async function deleteTradeAction(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const parsed = deleteTradeSchema.safeParse(rawForm(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const ctx = await resolveTenant()
  if (!ctx.ok) return { status: 'error', message: ctx.error }
  const { supabase, tenantId } = ctx

  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('id', parsed.data.trade_id)
    .eq('tenant_id', tenantId)

  if (error) return { status: 'error', message: error.message }

  revalidateAll()
  return { status: 'success' }
}
