'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { PnlCurvePoint } from '@/app/actions/analytics'

const ACCENT = '#3B82FF'
const GLOW_FILTER = 'drop-shadow(0 0 6px rgba(59,130,255,0.55))'

export type PnlCurveChartProps = {
  data: PnlCurvePoint[]
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

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

export function PnlCurveChart({ data }: PnlCurveChartProps) {
  return (
    <div className="min-h-[280px] w-full">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={data}
          margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="dt-pnl-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.25} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{
              fill: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: 1,
            }}
            stroke="rgba(255,255,255,0.1)"
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={formatGbp}
            tick={{
              fill: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            }}
            stroke="rgba(255,255,255,0.1)"
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <ReferenceLine
            y={0}
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="3 3"
          />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null
              const point = props.payload[0]?.payload as
                | PnlCurvePoint
                | undefined
              if (!point) return null
              return (
                <div className="rounded-md border border-white/15 bg-base px-3 py-2 font-mono text-[11px] shadow-xl">
                  <p className="text-white/55">{formatDate(point.date)}</p>
                  <p className="mt-1 text-accent">
                    {formatGbp(point.cumulative_pnl_gbp)}
                  </p>
                  <p className="mt-1 text-white/45">
                    {point.trade_count} trade
                    {point.trade_count === 1 ? '' : 's'} to date
                  </p>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="cumulative_pnl_gbp"
            stroke={ACCENT}
            strokeWidth={1.75}
            fill="url(#dt-pnl-gradient)"
            fillOpacity={1}
            isAnimationActive
            style={{ filter: GLOW_FILTER }}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
