'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

import type { TradeActionState } from './trade-types'

const dismissSchema = z.object({
  alert_id: z.string().uuid('Missing alert reference'),
})

const linkSchema = z.object({
  alert_id: z.string().uuid('Missing alert reference'),
  trade_id: z.string().uuid('Missing trade reference'),
})

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

async function requireUser(): Promise<boolean> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return Boolean(user)
}

export async function dismissAlertAction(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const parsed = dismissSchema.safeParse(rawForm(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }
  if (!(await requireUser())) {
    return { status: 'error', message: 'Not authenticated' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('alerts')
    .update({ dismissed: true, dismissed_at: new Date().toISOString() })
    .eq('id', parsed.data.alert_id)

  if (error) return { status: 'error', message: error.message }

  revalidatePath('/alerts')
  return { status: 'success' }
}

export async function linkAlertToTradeAction(
  alertId: string,
  tradeId: string,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = linkSchema.safeParse({ alert_id: alertId, trade_id: tradeId })
  if (!parsed.success) {
    return {
      ok: false,
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('alerts')
    .update({ trade_id: parsed.data.trade_id })
    .eq('id', parsed.data.alert_id)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/alerts')
  revalidatePath('/journal')
  return { ok: true }
}
