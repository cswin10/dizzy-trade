'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { computeTradePnl, outcomeForPnl } from '@/lib/trade-helpers'
import {
  closeTradeSchema,
  deleteTradeSchema,
  editLessonSchema,
  logTradeSchema,
} from '@/lib/validations/trade'

import type { TradeActionState } from './trade-types'

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

  let pnl: number | null = null
  let outcome: 'win' | 'loss' | 'breakeven' | 'open' = 'open'
  if (d.exit_price !== undefined && d.exit_size !== undefined) {
    pnl = computeTradePnl(d.direction, d.entry_price, d.exit_size, d.exit_price)
    outcome = outcomeForPnl(pnl)
  }

  const { error } = await supabase.from('trades').insert({
    tenant_id: tenantId,
    user_id: user.id,
    asset_symbol: d.asset_symbol,
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
  })

  if (error) return { status: 'error', message: error.message }

  revalidateAll()
  return { status: 'success' }
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
