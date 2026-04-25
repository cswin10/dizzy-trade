'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { WinRatePoint } from '@/app/actions/analytics'

const ACCENT = '#3B82FF'
const POSITIVE = '#4ADE80'
const GLOW_FILTER = 'drop-shadow(0 0 6px rgba(59,130,255,0.55))'

export type WinRateOverTimeChartProps = {
  data: WinRatePoint[]
}

type ChartPoint = WinRatePoint & {
  trade_index: number
  win_rate_pct: number
}

const dayMonthFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return dayMonthFormatter.format(d)
}

export function WinRateOverTimeChart({ data }: WinRateOverTimeChartProps) {
  // Plot trade index on the X axis so the curve has even spacing even
  // when many trades land on the same day. Pre-compute the percent
  // form so the tooltip and axis can reuse it.
  const points: ChartPoint[] = data.map((p) => ({
    ...p,
    trade_index: p.trade_count_to_date,
    win_rate_pct: p.rolling_20_win_rate * 100,
  }))

  return (
    <div className="min-h-[280px] w-full">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={points}
          margin={{ top: 12, right: 30, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="trade_index"
            tickFormatter={(v) => `#${v}`}
            tick={{
              fill: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: 1,
            }}
            stroke="rgba(255,255,255,0.1)"
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{
              fill: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            }}
            stroke="rgba(255,255,255,0.1)"
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ReferenceLine
            y={50}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="3 3"
            label={{
              value: 'coin flip',
              position: 'right',
              fill: 'rgba(255,255,255,0.35)',
              fontSize: 10,
            }}
          />
          <ReferenceLine
            y={33}
            stroke="rgba(74,222,128,0.4)"
            strokeDasharray="3 3"
            label={{
              value: 'v1 floor',
              position: 'right',
              fill: 'rgba(74,222,128,0.65)',
              fontSize: 10,
            }}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null
              const point = props.payload[0]?.payload as ChartPoint | undefined
              if (!point) return null
              return (
                <div className="rounded-md border border-white/15 bg-base px-3 py-2 font-mono text-[11px] shadow-xl">
                  <p className="text-white/55">
                    Trade #{point.trade_index} · {formatDate(point.date)}
                  </p>
                  <p className="mt-1 text-accent">
                    {point.win_rate_pct.toFixed(0)}% win rate
                  </p>
                  <p className="mt-1 text-white/45">rolling 20 trades</p>
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="win_rate_pct"
            stroke={ACCENT}
            strokeWidth={1.75}
            isAnimationActive
            style={{ filter: GLOW_FILTER }}
            dot={(dotProps) => {
              const { cx, cy, payload, key } = dotProps as {
                cx?: number
                cy?: number
                payload?: ChartPoint
                key?: string
              }
              if (
                cx == null ||
                cy == null ||
                !payload ||
                payload.win_rate_pct < 33
              ) {
                return (
                  <circle
                    key={key ?? `dot-${cx ?? 0}-${cy ?? 0}`}
                    cx={cx ?? 0}
                    cy={cy ?? 0}
                    r={0}
                    fill="transparent"
                  />
                )
              }
              return (
                <circle
                  key={key ?? `dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={2.5}
                  fill={POSITIVE}
                  style={{
                    filter: 'drop-shadow(0 0 4px rgba(74,222,128,0.6))',
                  }}
                />
              )
            }}
            activeDot={{
              r: 4,
              fill: ACCENT,
              stroke: 'rgba(59,130,255,0.4)',
              strokeWidth: 4,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
