'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { TRADES_GOAL, type AnalyticsFilters } from '@/lib/validations/analytics'

export type AnalyticsOverview = {
  total_trades: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
  best_trade_pnl: number
  worst_trade_pnl: number
  days_active: number
  trades_progress_pct: number
}

export type PnlCurvePoint = {
  date: string
  cumulative_pnl_gbp: number
  trade_count: number
}

export type WinRatePoint = {
  date: string
  rolling_20_win_rate: number
  trade_count_to_date: number
}

type TenantContext =
  | { ok: true; tenantId: string }
  | { ok: false; reason: 'unauthenticated' | 'no_tenant' }

async function resolveTenant(): Promise<TenantContext> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }
  const { data: memberships } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false, reason: 'no_tenant' }
  return { ok: true, tenantId }
}

type ClosedTrade = {
  id: string
  asset_symbol: string
  direction: 'long' | 'short'
  narrative_tag: string | null
  outcome: 'win' | 'loss' | 'breakeven'
  pnl: number
  exit_at: string
  entry_at: string
  risk_amount_gbp: number | null
}

// Resolve the date range filter to an inclusive (from, to) bound. The
// `to` is exclusive in the SQL filter (we use lt) so the end-of-day
// boundary works whichever interpretation the caller meant.
function resolveDateBounds(filter: AnalyticsFilters['date_range']): {
  from: Date | null
  to: Date | null
} {
  if (filter === 'all') return { from: null, to: null }
  if (filter === '7d' || filter === '30d' || filter === '90d') {
    const days = filter === '7d' ? 7 : filter === '30d' ? 30 : 90
    return { from: new Date(Date.now() - days * 24 * 60 * 60 * 1000), to: null }
  }
  return { from: filter.from, to: filter.to }
}

async function loadFilteredClosedTrades(
  tenantId: string,
  filters: AnalyticsFilters,
): Promise<ClosedTrade[]> {
  const service = createServiceClient()
  let query = service
    .from('trades')
    .select(
      'id, asset_symbol, direction, narrative_tag, outcome, pnl, exit_at, entry_at, risk_amount_gbp',
    )
    .eq('tenant_id', tenantId)
    .in('outcome', ['win', 'loss', 'breakeven'])
    .not('exit_at', 'is', null)

  const bounds = resolveDateBounds(filters.date_range)
  if (bounds.from) query = query.gte('exit_at', bounds.from.toISOString())
  if (bounds.to) query = query.lte('exit_at', bounds.to.toISOString())

  if (filters.outcome !== 'all') query = query.eq('outcome', filters.outcome)
  if (filters.direction !== 'all')
    query = query.eq('direction', filters.direction)
  if (filters.narrative) query = query.eq('narrative_tag', filters.narrative)
  if (filters.pairs && filters.pairs.length > 0) {
    query = query.in('asset_symbol', filters.pairs)
  }

  const { data, error } = await query.order('exit_at', { ascending: true })
  if (error) {
    console.warn(`[analytics] trades query failed: ${error.message}`)
    return []
  }
  const rows: ClosedTrade[] = []
  for (const row of data ?? []) {
    if (!row.exit_at) continue
    if (
      row.outcome !== 'win' &&
      row.outcome !== 'loss' &&
      row.outcome !== 'breakeven'
    ) {
      continue
    }
    rows.push({
      id: String(row.id),
      asset_symbol: String(row.asset_symbol),
      direction: row.direction as 'long' | 'short',
      narrative_tag: row.narrative_tag ?? null,
      outcome: row.outcome,
      pnl: typeof row.pnl === 'number' ? row.pnl : Number(row.pnl ?? 0),
      exit_at: row.exit_at,
      entry_at: row.entry_at,
      risk_amount_gbp:
        row.risk_amount_gbp == null ? null : Number(row.risk_amount_gbp),
    })
  }
  return rows
}

async function loadActiveStrategyRisk(
  tenantId: string,
): Promise<number | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('strategies')
    .select('risk_amount_gbp')
    .eq('is_active', true)
    .limit(1)
  if (error || !data || data.length === 0) return null
  void tenantId
  const value = data[0]?.risk_amount_gbp
  return value == null ? null : Number(value)
}

const EMPTY_OVERVIEW: AnalyticsOverview = {
  total_trades: 0,
  win_rate: 0,
  avg_r: 0,
  total_pnl_gbp: 0,
  best_trade_pnl: 0,
  worst_trade_pnl: 0,
  days_active: 0,
  trades_progress_pct: 0,
}

function dateBucket(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export async function getAnalyticsOverview(
  filters: AnalyticsFilters,
): Promise<AnalyticsOverview> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return EMPTY_OVERVIEW

  const [trades, fallbackRisk] = await Promise.all([
    loadFilteredClosedTrades(ctx.tenantId, filters),
    loadActiveStrategyRisk(ctx.tenantId),
  ])
  if (trades.length === 0) return EMPTY_OVERVIEW

  let wins = 0
  let totalPnl = 0
  let best = trades[0]!.pnl
  let worst = trades[0]!.pnl
  let rSum = 0
  let rCount = 0
  const dayBuckets = new Set<string>()

  for (const t of trades) {
    if (t.outcome === 'win') wins++
    totalPnl += t.pnl
    if (t.pnl > best) best = t.pnl
    if (t.pnl < worst) worst = t.pnl
    const risk = t.risk_amount_gbp ?? fallbackRisk
    if (risk && risk > 0 && Number.isFinite(t.pnl)) {
      rSum += t.pnl / risk
      rCount++
    }
    dayBuckets.add(dateBucket(t.exit_at))
  }

  const totalTrades = trades.length
  return {
    total_trades: totalTrades,
    win_rate: totalTrades > 0 ? wins / totalTrades : 0,
    avg_r: rCount > 0 ? rSum / rCount : 0,
    total_pnl_gbp: totalPnl,
    best_trade_pnl: best,
    worst_trade_pnl: worst,
    days_active: dayBuckets.size,
    trades_progress_pct: Math.min(1, totalTrades / TRADES_GOAL),
  }
}

export async function getPnlCurve(
  filters: AnalyticsFilters,
): Promise<PnlCurvePoint[]> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return []
  const trades = await loadFilteredClosedTrades(ctx.tenantId, filters)
  if (trades.length === 0) return []

  // Bucket by exit date so multiple trades on the same day collapse
  // into a single curve point.
  const byDate = new Map<string, { sum: number; count: number }>()
  for (const t of trades) {
    const day = dateBucket(t.exit_at)
    const bucket = byDate.get(day) ?? { sum: 0, count: 0 }
    bucket.sum += t.pnl
    bucket.count += 1
    byDate.set(day, bucket)
  }
  const sortedDays = [...byDate.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )

  const out: PnlCurvePoint[] = []
  let cumulative = 0
  let runningCount = 0
  for (const [day, bucket] of sortedDays) {
    cumulative += bucket.sum
    runningCount += bucket.count
    out.push({
      date: day,
      cumulative_pnl_gbp: cumulative,
      trade_count: runningCount,
    })
  }
  return out
}

export async function getWinRateOverTime(
  filters: AnalyticsFilters,
): Promise<WinRatePoint[]> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return []
  const trades = await loadFilteredClosedTrades(ctx.tenantId, filters)
  if (trades.length === 0) return []

  // Rolling window over the most recent 20 trades up to and including
  // the current one. For early trades we use whatever's available.
  const out: WinRatePoint[] = []
  for (let i = 0; i < trades.length; i++) {
    const start = Math.max(0, i + 1 - 20)
    let wins = 0
    let total = 0
    for (let j = start; j <= i; j++) {
      if (trades[j]!.outcome === 'win') wins++
      total++
    }
    const trade = trades[i]!
    out.push({
      date: dateBucket(trade.exit_at),
      rolling_20_win_rate: total > 0 ? wins / total : 0,
      trade_count_to_date: i + 1,
    })
  }
  return out
}

export type DashboardWidgetData = {
  overview: AnalyticsOverview
  curve: PnlCurvePoint[]
}

const DASHBOARD_FILTERS: AnalyticsFilters = {
  date_range: '30d',
  pairs: null,
  direction: 'all',
  narrative: null,
  outcome: 'all',
}

/**
 * Combined fetch for the dashboard widget. Same auth and tenant
 * scoping as the other actions; default 30d filter so the dashboard
 * shows recent activity rather than lifetime history.
 */
export async function getDashboardAnalytics(): Promise<DashboardWidgetData> {
  const [overview, curve] = await Promise.all([
    getAnalyticsOverview(DASHBOARD_FILTERS),
    getPnlCurve(DASHBOARD_FILTERS),
  ])
  return { overview, curve }
}
