'use server'

import { revalidatePath } from 'next/cache'

import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  stripJsonFence,
  type AnalysisAlertContext,
  type AnalysisCandle,
  type AnalysisContext,
  type AnalysisSimilarTrade,
  type AnalysisTradeRecord,
} from '@/lib/analysis-prompt'
import { DEFAULT_ANALYSIS_MODEL, sendMessage } from '@/lib/claude/client'
import { getCandles } from '@/lib/hyperliquid'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ANALYSIS_PROMPT_VERSION,
  tradeAnalysisSchema,
} from '@/lib/validations/analysis'

export type AnalysisActionResult =
  | { status: 'success'; trade_id: string }
  | { status: 'skipped'; trade_id: string; reason: string }
  | { status: 'error'; trade_id: string; message: string }

const DAILY_CAP = 50
const MAX_CONCURRENT_PER_TENANT = 5
const CANDLE_INTERVAL_MS = 60 * 60 * 1000

// Process-local concurrency gate. Each tenant has a counter; we refuse
// new analyses while the count is at the cap. This is best-effort: a
// fresh server instance starts with empty counters, but the daily cap
// (which is database-backed) provides the durable backstop.
const inFlight = new Map<string, number>()

function acquire(tenantId: string): boolean {
  const current = inFlight.get(tenantId) ?? 0
  if (current >= MAX_CONCURRENT_PER_TENANT) return false
  inFlight.set(tenantId, current + 1)
  return true
}

function release(tenantId: string) {
  const current = inFlight.get(tenantId) ?? 0
  if (current <= 1) inFlight.delete(tenantId)
  else inFlight.set(tenantId, current - 1)
}

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, reason: 'unauthenticated' as const }

  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false as const, reason: 'no_tenant' as const }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, reason: 'no_tenant' as const }
  return { ok: true as const, tenantId }
}

async function loadTrade(
  tenantId: string,
  tradeId: string,
): Promise<AnalysisTradeRecord | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('trades')
    .select(
      'asset_symbol, direction, entry_price, exit_price, entry_size, exit_size, leverage, entry_at, exit_at, outcome, pnl, risk_amount_gbp, narrative_tag, setup_type, thesis, lesson, source, btc_context_at_entry',
    )
    .eq('id', tradeId)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (error || !data || data.length === 0) return null
  const row = data[0]!
  return {
    asset_symbol: String(row.asset_symbol),
    direction: row.direction as 'long' | 'short',
    entry_price: Number(row.entry_price),
    exit_price: row.exit_price == null ? null : Number(row.exit_price),
    entry_size: Number(row.entry_size),
    exit_size: row.exit_size == null ? null : Number(row.exit_size),
    leverage: row.leverage == null ? null : Number(row.leverage),
    entry_at: String(row.entry_at),
    exit_at: row.exit_at == null ? null : String(row.exit_at),
    outcome: row.outcome,
    pnl: row.pnl == null ? null : Number(row.pnl),
    risk_amount_gbp:
      row.risk_amount_gbp == null ? null : Number(row.risk_amount_gbp),
    narrative_tag: row.narrative_tag ?? null,
    setup_type: row.setup_type ?? null,
    thesis: row.thesis ?? null,
    lesson: row.lesson ?? null,
    source: row.source,
    btc_context_at_entry: row.btc_context_at_entry,
  }
}

async function loadAlertForTrade(
  tradeId: string,
): Promise<AnalysisAlertContext | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('alerts')
    .select(
      'framework_id, triggered_at, suggested_direction, suggested_entry, suggested_stop, suggested_target, position_size_coin, position_size_usd, leverage_implied, rules_status, rules_violations',
    )
    .eq('trade_id', tradeId)
    .limit(1)
  if (error || !data || data.length === 0) return null
  const row = data[0]!
  return {
    framework_id: String(row.framework_id),
    triggered_at: String(row.triggered_at),
    suggested_direction: row.suggested_direction,
    suggested_entry:
      row.suggested_entry == null ? null : Number(row.suggested_entry),
    suggested_stop:
      row.suggested_stop == null ? null : Number(row.suggested_stop),
    suggested_target:
      row.suggested_target == null ? null : Number(row.suggested_target),
    position_size_coin:
      row.position_size_coin == null ? null : Number(row.position_size_coin),
    position_size_usd:
      row.position_size_usd == null ? null : Number(row.position_size_usd),
    leverage_implied:
      row.leverage_implied == null ? null : Number(row.leverage_implied),
    rules_status: row.rules_status,
    rules_violations: row.rules_violations ?? null,
  }
}

async function safeGetCandles(
  symbol: string,
  lookback: number,
  endAt: Date | null,
): Promise<AnalysisCandle[]> {
  try {
    // The Node Hyperliquid client always returns candles ending at "now".
    // For historical contexts we over-fetch and trim to the candles
    // whose timestamp is at or before the requested endAt.
    const overFetch = endAt ? lookback + 200 : lookback
    const candles = await getCandles(symbol, '1h', overFetch)
    if (!endAt) return candles.slice(-lookback)
    const cutoff = endAt.getTime()
    const upTo = candles.filter((c) => c.t <= cutoff)
    return upTo.slice(-lookback)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[analysis] candle fetch failed for ${symbol}: ${message}`)
    return []
  }
}

async function loadSimilarPairTrades(
  tenantId: string,
  tradeId: string,
  pair: string,
  direction: 'long' | 'short',
): Promise<AnalysisSimilarTrade[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('trades')
    .select(
      'asset_symbol, direction, outcome, pnl, entry_at, exit_at, setup_type, lesson',
    )
    .eq('tenant_id', tenantId)
    .eq('asset_symbol', pair)
    .eq('direction', direction)
    .neq('id', tradeId)
    .in('outcome', ['win', 'loss', 'breakeven'])
    .order('exit_at', { ascending: false })
    .limit(5)
  if (error || !data) return []
  return data
    .filter(
      (row) =>
        row.outcome === 'win' ||
        row.outcome === 'loss' ||
        row.outcome === 'breakeven',
    )
    .map((row) => ({
      asset_symbol: String(row.asset_symbol),
      direction: row.direction as 'long' | 'short',
      outcome: row.outcome as 'win' | 'loss' | 'breakeven',
      pnl: row.pnl == null ? null : Number(row.pnl),
      entry_at: String(row.entry_at),
      exit_at: row.exit_at == null ? null : String(row.exit_at),
      setup_type: row.setup_type ?? null,
      lesson: row.lesson ?? null,
    }))
}

async function loadSimilarFrameworkOutcomeTrades(
  tenantId: string,
  tradeId: string,
  frameworkId: string | null,
  outcome: 'win' | 'loss' | 'breakeven',
): Promise<AnalysisSimilarTrade[]> {
  if (!frameworkId) return []
  const service = createServiceClient()
  // Trades are linked to frameworks via the alerts table. This pulls
  // alerts in the same framework that have a trade attached, then
  // hydrates each trade's row.
  const { data: alertRows, error: alertErr } = await service
    .from('alerts')
    .select('trade_id')
    .eq('framework_id', frameworkId)
    .not('trade_id', 'is', null)
    .neq('trade_id', tradeId)
    .order('triggered_at', { ascending: false })
    .limit(40)
  if (alertErr || !alertRows) return []
  const ids = alertRows
    .map((r) => r.trade_id)
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []

  const { data, error } = await service
    .from('trades')
    .select(
      'asset_symbol, direction, outcome, pnl, entry_at, exit_at, setup_type, lesson',
    )
    .eq('tenant_id', tenantId)
    .in('id', ids)
    .eq('outcome', outcome)
    .order('exit_at', { ascending: false })
    .limit(5)
  if (error || !data) return []
  return data
    .filter(
      (row) =>
        row.outcome === 'win' ||
        row.outcome === 'loss' ||
        row.outcome === 'breakeven',
    )
    .map((row) => ({
      asset_symbol: String(row.asset_symbol),
      direction: row.direction as 'long' | 'short',
      outcome: row.outcome as 'win' | 'loss' | 'breakeven',
      pnl: row.pnl == null ? null : Number(row.pnl),
      entry_at: String(row.entry_at),
      exit_at: row.exit_at == null ? null : String(row.exit_at),
      setup_type: row.setup_type ?? null,
      lesson: row.lesson ?? null,
    }))
}

async function loadTopLessonTags(
  tenantId: string,
): Promise<{ tag: string; count: number }[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('trades')
    .select('analysis_lesson_tag')
    .eq('tenant_id', tenantId)
    .not('analysis_lesson_tag', 'is', null)
  if (error || !data) return []
  const counts = new Map<string, number>()
  for (const row of data) {
    const tag = row.analysis_lesson_tag
    if (typeof tag !== 'string' || tag.length === 0) continue
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

async function countAnalysesToday(tenantId: string): Promise<number> {
  const service = createServiceClient()
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count, error } = await service
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('analysis_generated_at', startOfDay.toISOString())
  if (error) return 0
  return count ?? 0
}

async function buildContext(
  tenantId: string,
  tradeId: string,
): Promise<AnalysisContext | null> {
  const trade = await loadTrade(tenantId, tradeId)
  if (!trade) return null

  const alert = await loadAlertForTrade(tradeId)

  const entryDate = new Date(trade.entry_at)
  const exitDate = trade.exit_at ? new Date(trade.exit_at) : null
  // We want the 20 1h candles ending at entry, so step back one
  // candle from the entry timestamp to avoid leaking the entry bar
  // itself. Same for the exit window.
  const entryEnd = Number.isNaN(entryDate.getTime())
    ? null
    : new Date(entryDate.getTime() - CANDLE_INTERVAL_MS)
  const exitEnd =
    exitDate && !Number.isNaN(exitDate.getTime())
      ? new Date(exitDate.getTime())
      : null

  const [
    pairCandlesAtEntry,
    btcCandlesAtEntry,
    pairCandlesAtExit,
    similarPairTrades,
    topLessonTags,
  ] = await Promise.all([
    safeGetCandles(trade.asset_symbol, 20, entryEnd),
    safeGetCandles('BTC', 20, entryEnd),
    safeGetCandles(trade.asset_symbol, 10, exitEnd),
    loadSimilarPairTrades(
      tenantId,
      tradeId,
      trade.asset_symbol,
      trade.direction,
    ),
    loadTopLessonTags(tenantId),
  ])

  const outcome = trade.outcome
  const similarFrameworkOutcomeTrades =
    outcome === 'win' || outcome === 'loss' || outcome === 'breakeven'
      ? await loadSimilarFrameworkOutcomeTrades(
          tenantId,
          tradeId,
          alert?.framework_id ?? null,
          outcome,
        )
      : []

  return {
    trade,
    alert,
    pairCandlesAtEntry,
    btcCandlesAtEntry,
    pairCandlesAtExit,
    similarPairTrades,
    similarFrameworkOutcomeTrades,
    topLessonTags,
  }
}

async function persistAnalysis(
  tenantId: string,
  tradeId: string,
  payload: ReturnType<typeof tradeAnalysisSchema.parse>,
  model: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const service = createServiceClient()
  const { error } = await service
    .from('trades')
    .update({
      analysis_text: payload.analysis_text,
      analysis_what_went_right: payload.what_went_right,
      analysis_what_went_wrong: payload.what_went_wrong,
      analysis_pattern_insight: payload.pattern_insight ?? null,
      analysis_lesson_tag: payload.lesson_tag,
      analysis_generated_at: new Date().toISOString(),
      analysis_model: model,
      analysis_prompt_version: ANALYSIS_PROMPT_VERSION,
    })
    .eq('id', tradeId)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/**
 * Generate (or regenerate, when force=true) the post-trade analysis
 * for a closed trade. Refuses to run on open trades, on trades that
 * already have a current-version analysis (unless forced), when the
 * tenant is at the daily cap, or when the per-tenant concurrent slot
 * is full.
 */
export async function generateTradeAnalysisAction(
  tradeId: string,
  force = false,
): Promise<AnalysisActionResult> {
  if (!tradeId) {
    return { status: 'error', trade_id: '', message: 'Missing trade id' }
  }
  const ctx = await resolveTenant()
  if (!ctx.ok) {
    return {
      status: 'error',
      trade_id: tradeId,
      message:
        ctx.reason === 'unauthenticated' ? 'Not authenticated' : 'No tenant',
    }
  }
  const { tenantId } = ctx

  const service = createServiceClient()
  const { data: existing, error: existingErr } = await service
    .from('trades')
    .select('outcome, analysis_text, analysis_prompt_version')
    .eq('id', tradeId)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (existingErr || !existing || existing.length === 0) {
    return { status: 'error', trade_id: tradeId, message: 'Trade not found' }
  }
  const row = existing[0]!
  if (row.outcome === 'open') {
    return {
      status: 'skipped',
      trade_id: tradeId,
      reason: 'Trade is still open',
    }
  }
  const isCurrent =
    typeof row.analysis_text === 'string' &&
    row.analysis_text.length > 0 &&
    Number(row.analysis_prompt_version ?? 0) >= ANALYSIS_PROMPT_VERSION
  if (isCurrent && !force) {
    return {
      status: 'skipped',
      trade_id: tradeId,
      reason: 'Analysis already exists',
    }
  }

  if (!acquire(tenantId)) {
    return {
      status: 'skipped',
      trade_id: tradeId,
      reason: 'Too many analyses in flight, try again shortly',
    }
  }

  try {
    const todayCount = await countAnalysesToday(tenantId)
    if (todayCount >= DAILY_CAP) {
      return {
        status: 'skipped',
        trade_id: tradeId,
        reason: 'Daily analysis cap reached',
      }
    }

    const context = await buildContext(tenantId, tradeId)
    if (!context) {
      return { status: 'error', trade_id: tradeId, message: 'Trade not found' }
    }

    const userPrompt = buildAnalysisUserPrompt(context)

    let result
    try {
      result = await sendMessage({
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        userPrompt,
        model: DEFAULT_ANALYSIS_MODEL,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[analysis] Claude call failed for ${tradeId}: ${message}`)
      return {
        status: 'error',
        trade_id: tradeId,
        message: 'Analysis service unavailable',
      }
    }

    let parsed
    try {
      const json = JSON.parse(stripJsonFence(result.text))
      parsed = tradeAnalysisSchema.parse(json)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[analysis] parse failed for ${tradeId}: ${message}`)
      return {
        status: 'error',
        trade_id: tradeId,
        message: 'Analysis was malformed',
      }
    }

    const persisted = await persistAnalysis(
      tenantId,
      tradeId,
      parsed,
      result.model,
    )
    if (!persisted.ok) {
      return { status: 'error', trade_id: tradeId, message: persisted.message }
    }

    revalidatePath('/journal')
    return { status: 'success', trade_id: tradeId }
  } finally {
    release(tenantId)
  }
}
