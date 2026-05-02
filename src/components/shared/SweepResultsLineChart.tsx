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

const ACCENT = '#3B82FF'

export type LineChartPoint = {
  x: number | string
  total_pnl_gbp: number | null
}

export type SweepResultsLineChartProps = {
  xKey: string
  points: LineChartPoint[]
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

export function SweepResultsLineChart({
  xKey,
  points,
}: SweepResultsLineChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-xs uppercase tracking-widest text-white/35">
        No completed combinations yet
      </div>
    )
  }
  return (
    <div className="min-h-[260px] w-full">
      <div className="mb-2 text-xs text-white/45">
        Parameter sensitivity: {xKey} versus total PnL
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart
          data={points}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="x"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickFormatter={formatGbp}
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 10 }}
            width={60}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <Tooltip
            contentStyle={{
              background: 'rgba(20,22,30,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
            formatter={(value: number | string) =>
              typeof value === 'number'
                ? [formatGbp(value), 'PnL']
                : [value, '']
            }
            labelFormatter={(label) => `${xKey} = ${label}`}
          />
          <Line
            type="monotone"
            dataKey="total_pnl_gbp"
            stroke={ACCENT}
            strokeWidth={2}
            dot={{ r: 3, fill: ACCENT }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
