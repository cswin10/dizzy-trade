'use client'

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { PerformanceByHourRow } from '@/app/actions/analytics'

const NEUTRAL = 'rgba(255, 255, 255, 0.12)'
const POSITIVE_RGB: [number, number, number] = [74, 222, 128]
const NEGATIVE_RGB: [number, number, number] = [248, 113, 113]

export type PerformanceByTimeOfDayChartProps = {
  data: PerformanceByHourRow[]
}

function colourFor(rate: number, tradeCount: number): string {
  if (tradeCount === 0) return NEUTRAL
  // 0% rate is fully red, 100% is fully green, 50% sits at the muted midpoint.
  const ratio = Math.max(0, Math.min(1, rate))
  const target = ratio >= 0.5 ? POSITIVE_RGB : NEGATIVE_RGB
  const intensity = Math.abs(ratio - 0.5) * 2 // 0 at 50%, 1 at 0% or 100%
  const opacity = 0.25 + intensity * 0.6
  return `rgba(${target[0]}, ${target[1]}, ${target[2]}, ${opacity.toFixed(2)})`
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function findBestWindow(
  data: PerformanceByHourRow[],
): { from: number; to: number; winRate: number; trades: number } | null {
  // Slide a 3-hour window over the 24-hour series and pick the
  // window with the highest win rate, requiring at least 5 trades.
  let best: {
    from: number
    to: number
    winRate: number
    trades: number
  } | null = null
  for (let i = 0; i < 24; i++) {
    const a = data[i]!
    const b = data[(i + 1) % 24]!
    const c = data[(i + 2) % 24]!
    const trades = a.trade_count + b.trade_count + c.trade_count
    if (trades < 5) continue
    const wins = a.wins + b.wins + c.wins
    const winRate = wins / trades
    if (!best || winRate > best.winRate) {
      best = { from: i, to: (i + 3) % 24, winRate, trades }
    }
  }
  return best
}

export function PerformanceByTimeOfDayChart({
  data,
}: PerformanceByTimeOfDayChartProps) {
  if (data.every((d) => d.trade_count === 0)) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
          No trades match these filters
        </p>
      </div>
    )
  }
  const best = findBestWindow(data)

  return (
    <div className="flex flex-col gap-2">
      <div className="min-h-[260px] w-full">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <XAxis
              dataKey="hour"
              tickFormatter={(v) => formatHour(Number(v))}
              ticks={[0, 6, 12, 18]}
              tick={{
                fill: 'rgba(255,255,255,0.4)',
                fontSize: 10,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                letterSpacing: 1,
              }}
              stroke="rgba(255,255,255,0.08)"
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{
                fill: 'rgba(255,255,255,0.4)',
                fontSize: 10,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
              stroke="rgba(255,255,255,0.08)"
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              content={(props) => {
                if (!props.active || !props.payload?.length) return null
                const point = props.payload[0]?.payload as
                  | PerformanceByHourRow
                  | undefined
                if (!point) return null
                const next = (point.hour + 1) % 24
                return (
                  <div className="rounded-md border border-white/15 bg-base px-3 py-2 font-mono text-[11px] shadow-xl">
                    <p className="text-white">
                      {formatHour(point.hour)} - {formatHour(next)} UTC
                    </p>
                    <p className="mt-1 text-white/55">
                      {point.trade_count} trade
                      {point.trade_count === 1 ? '' : 's'} · {point.wins} win
                      {point.wins === 1 ? '' : 's'}
                    </p>
                    <p className="mt-1 text-accent">
                      {Math.round(point.win_rate * 100)}% win rate
                    </p>
                    <p className="mt-1 text-white/45">
                      PnL {formatGbp(point.total_pnl_gbp)}
                    </p>
                  </div>
                )
              }}
            />
            <Bar
              dataKey="trade_count"
              isAnimationActive
              animationDuration={400}
              radius={[1, 1, 0, 0]}
            >
              {data.map((entry) => (
                <Cell
                  key={`hour-${entry.hour}`}
                  fill={colourFor(entry.win_rate, entry.trade_count)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {best ? (
        <p className="px-1 font-mono text-[11px] tabular-nums text-white/55">
          Your best window: {formatHour(best.from)}-{formatHour(best.to)} UTC (
          {Math.round(best.winRate * 100)}% win rate, {best.trades} trades)
        </p>
      ) : null}
    </div>
  )
}
