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

const ACCENT = '#3B82FF'

export type EquityCurvePoint = {
  index: number
  cumulative_pnl_gbp: number
  in_train: boolean
  entry_at_iso: string
}

export type BacktestEquityCurveChartProps = {
  points: EquityCurvePoint[]
  splitIndex: number | null
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

export function BacktestEquityCurveChart({
  points,
  splitIndex,
}: BacktestEquityCurveChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-xs uppercase tracking-widest text-white/35">
        No trades to chart
      </div>
    )
  }

  return (
    <div className="min-h-[280px] w-full">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={points}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="bt-equity-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="index"
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
          {splitIndex !== null ? (
            <ReferenceLine
              x={splitIndex}
              stroke="rgba(255,196,0,0.6)"
              strokeDasharray="4 4"
              label={{
                value: 'train | test',
                fill: 'rgba(255,196,0,0.8)',
                fontSize: 10,
                position: 'top',
              }}
            />
          ) : null}
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
                ? [formatGbp(value), 'Equity']
                : [value, '']
            }
            labelFormatter={(label) => `Trade #${label}`}
          />
          <Area
            type="monotone"
            dataKey="cumulative_pnl_gbp"
            stroke={ACCENT}
            strokeWidth={2}
            fill="url(#bt-equity-gradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
