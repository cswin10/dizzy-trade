'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getUserFills, getUserState } from '@/lib/hyperliquid_user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeTradePnl, outcomeForPnl } from '@/lib/trade-helpers'
import {
  setHyperliquidConfigSchema,
  tradeIdSchema,
} from '@/lib/validations/hyperliquid'

export type HyperliquidActionResult = {
  ok: boolean
  message?: string
}

const SIZE_MATCH_TOLERANCE = 0.01 // within 1% of entry_size

async function resolveTenant(): Promise<
  | { ok: false; message: string }
  | { ok: true; tenantId: string; userId: string }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not authenticated' }

  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false, message: error.message }

  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false, message: 'No tenant for user' }

  return { ok: true, tenantId, userId: user.id }
}

function firstMessage(error: z.ZodError): string {
  return error.errors[0]?.message ?? 'Invalid input'
}

export async function setHyperliquidConfigAction(
  main_address: string,
): Promise<HyperliquidActionResult> {
  const parsed = setHyperliquidConfigSchema.safeParse({ main_address })
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const tenant = await resolveTenant()
  if (!tenant.ok) return tenant

  const service = createServiceClient()
  const { error } = await service.from('user_hyperliquid_config').upsert(
    {
      tenant_id: tenant.tenantId,
      main_address: parsed.data.main_address,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

export async function removeHyperliquidConfigAction(): Promise<HyperliquidActionResult> {
  const tenant = await resolveTenant()
  if (!tenant.ok) return tenant

  const service = createServiceClient()
  // Two updates: clear config and revert any live trades to not_live
  // so the journal stops claiming exchange linkage. Neither destroys
  // historical data: snapshots and the trade rows persist.
  const [clearLive, deleteConfig] = await Promise.all([
    service
      .from('trades')
      .update({
        live_status: 'not_live',
        hyperliquid_position_id: null,
        hyperliquid_address: null,
      })
      .eq('tenant_id', tenant.tenantId)
      .in('live_status', ['live', 'pending_link']),
    service
      .from('user_hyperliquid_config')
      .delete()
      .eq('tenant_id', tenant.tenantId),
  ])

  if (clearLive.error) return { ok: false, message: clearLive.error.message }
  if (deleteConfig.error) {
    return { ok: false, message: deleteConfig.error.message }
  }

  revalidatePath('/settings')
  revalidatePath('/journal')
  revalidatePath('/dashboard')
  return { ok: true }
}

type TradeRow = {
  id: string
  asset_symbol: string
  direction: 'long' | 'short'
  entry_size: number
  live_status: string | null
}

async function loadTrade(
  service: ReturnType<typeof createServiceClient>,
  tenantId: string,
  tradeId: string,
): Promise<TradeRow | null> {
  const { data, error } = await service
    .from('trades')
    .select('id, asset_symbol, direction, entry_size, live_status')
    .eq('id', tradeId)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (error) throw new Error(error.message)
  const row = data?.[0]
  if (!row) return null
  return {
    id: String(row.id),
    asset_symbol: String(row.asset_symbol),
    direction: row.direction as 'long' | 'short',
    entry_size: Number(row.entry_size),
    live_status: row.live_status ?? null,
  }
}

export async function linkTradeToPositionAction(
  tradeId: string,
): Promise<HyperliquidActionResult> {
  const parsed = tradeIdSchema.safeParse({ trade_id: tradeId })
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const tenant = await resolveTenant()
  if (!tenant.ok) return tenant

  const service = createServiceClient()

  const trade = await loadTrade(service, tenant.tenantId, tradeId)
  if (!trade) return { ok: false, message: 'Trade not found' }

  const { data: configRows, error: configError } = await service
    .from('user_hyperliquid_config')
    .select('main_address')
    .eq('tenant_id', tenant.tenantId)
    .limit(1)
  if (configError) return { ok: false, message: configError.message }
  const mainAddress = configRows?.[0]?.main_address as string | undefined
  if (!mainAddress) {
    return {
      ok: false,
      message:
        'Set your Hyperliquid address in Settings before marking trades as live',
    }
  }

  const linkedAt = new Date().toISOString()
  const { error: pendingError } = await service
    .from('trades')
    .update({ live_status: 'pending_link', linked_at: linkedAt })
    .eq('id', trade.id)
    .eq('tenant_id', tenant.tenantId)
  if (pendingError) return { ok: false, message: pendingError.message }

  let state
  try {
    state = await getUserState(mainAddress)
  } catch (error) {
    await service
      .from('trades')
      .update({ live_status: 'not_live', linked_at: null })
      .eq('id', trade.id)
      .eq('tenant_id', tenant.tenantId)
    const message =
      error instanceof Error ? error.message : 'Hyperliquid request failed'
    return { ok: false, message }
  }

  const wantedSign = trade.direction === 'long' ? 1 : -1
  const matches = state.positions.filter((p) => {
    if (p.coin !== trade.asset_symbol) return false
    const sign = p.szi >= 0 ? 1 : -1
    if (sign !== wantedSign) return false
    const size = Math.abs(p.szi)
    if (trade.entry_size <= 0) return false
    const drift = Math.abs(size - trade.entry_size) / trade.entry_size
    return drift <= SIZE_MATCH_TOLERANCE
  })

  if (matches.length === 0) {
    await service
      .from('trades')
      .update({
        live_status: 'not_live',
        linked_at: null,
        hyperliquid_address: null,
        hyperliquid_position_id: null,
      })
      .eq('id', trade.id)
      .eq('tenant_id', tenant.tenantId)
    return {
      ok: false,
      message: 'No matching open position found on Hyperliquid for this trade',
    }
  }
  if (matches.length > 1) {
    await service
      .from('trades')
      .update({
        live_status: 'not_live',
        linked_at: null,
        hyperliquid_address: null,
        hyperliquid_position_id: null,
      })
      .eq('id', trade.id)
      .eq('tenant_id', tenant.tenantId)
    return {
      ok: false,
      message:
        'Multiple open positions match this trade. Please specify which one.',
    }
  }

  // Hyperliquid does not assign per-position ids; positions are
  // identified by (account, coin) since one open position per pair
  // is allowed. We synthesise an id from the linkage moment so it
  // survives across reopens within the same trade row.
  const positionId = `${mainAddress}:${trade.asset_symbol}:${linkedAt}`
  const { error: liveError } = await service
    .from('trades')
    .update({
      live_status: 'live',
      hyperliquid_address: mainAddress,
      hyperliquid_position_id: positionId,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', trade.id)
    .eq('tenant_id', tenant.tenantId)
  if (liveError) return { ok: false, message: liveError.message }

  revalidatePath('/journal')
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function unlinkTradeAction(
  tradeId: string,
): Promise<HyperliquidActionResult> {
  const parsed = tradeIdSchema.safeParse({ trade_id: tradeId })
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const tenant = await resolveTenant()
  if (!tenant.ok) return tenant

  const service = createServiceClient()
  const { error } = await service
    .from('trades')
    .update({
      live_status: 'not_live',
      hyperliquid_position_id: null,
      hyperliquid_address: null,
    })
    .eq('id', tradeId)
    .eq('tenant_id', tenant.tenantId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/journal')
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function resyncTradeAction(
  tradeId: string,
): Promise<HyperliquidActionResult> {
  const parsed = tradeIdSchema.safeParse({ trade_id: tradeId })
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const tenant = await resolveTenant()
  if (!tenant.ok) return tenant

  const service = createServiceClient()
  const { data: rows, error } = await service
    .from('trades')
    .select(
      'id, asset_symbol, direction, entry_price, entry_size, hyperliquid_address, linked_at, live_status',
    )
    .eq('id', tradeId)
    .eq('tenant_id', tenant.tenantId)
    .limit(1)
  if (error) return { ok: false, message: error.message }
  const row = rows?.[0]
  if (!row) return { ok: false, message: 'Trade not found' }
  const mainAddress = row.hyperliquid_address as string | null
  if (!mainAddress) {
    return {
      ok: false,
      message: 'This trade is not linked to a Hyperliquid position',
    }
  }

  const linkedAt = row.linked_at
    ? Date.parse(String(row.linked_at))
    : Date.now() - 7 * 24 * 60 * 60 * 1000
  let fills
  try {
    fills = await getUserFills(mainAddress, linkedAt)
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Hyperliquid request failed'
    return { ok: false, message }
  }

  const closeDir = row.direction === 'long' ? 'Close Long' : 'Close Short'
  const matchingClose = [...fills]
    .filter((f) => f.coin === row.asset_symbol && f.dir === closeDir)
    .sort((a, b) => b.time - a.time)[0]
  if (!matchingClose) {
    return {
      ok: false,
      message: 'No closing fill found yet for this trade on Hyperliquid',
    }
  }

  const exitPrice = matchingClose.px
  const exitSize = matchingClose.sz
  const pnlUsd = computeTradePnl(
    row.direction as 'long' | 'short',
    Number(row.entry_price),
    exitSize,
    exitPrice,
  )
  const outcome = outcomeForPnl(pnlUsd)

  const { error: updateError } = await service
    .from('trades')
    .update({
      exit_price: exitPrice,
      exit_size: exitSize,
      exit_at: new Date(matchingClose.time).toISOString(),
      pnl: pnlUsd,
      outcome,
      live_status: 'closed_auto',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('tenant_id', tenant.tenantId)
  if (updateError) return { ok: false, message: updateError.message }

  revalidatePath('/journal')
  revalidatePath('/dashboard')
  return { ok: true }
}
