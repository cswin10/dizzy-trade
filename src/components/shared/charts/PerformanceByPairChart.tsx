'use client'

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { PerformanceByPairRow } from '@/app/actions/analytics'

const POSITIVE = '#4ADE80'
const NEGATIVE = '#F87171'

export type PerformanceByPairChartProps = {
  data: PerformanceByPairRow[]
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

export function PerformanceByPairChart({ data }: PerformanceByPairChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
          No trades match these filters
        </p>
      </div>
    )
  }

  // Sort ascending so the most negative bar sits at the bottom and the
  // most positive at the top.
  const points = [...data].sort((a, b) => a.total_pnl_gbp - b.total_pnl_gbp)

  return (
    <div className="min-h-[280px] w-full">
      <ResponsiveContainer
        width="100%"
        height={Math.max(280, 36 * points.length + 60)}
      >
        <BarChart
          data={points}
          layout="vertical"
          margin={{ top: 8, right: 60, bottom: 0, left: 0 }}
          barCategoryGap={8}
        >
          <XAxis
            type="number"
            tickFormatter={formatGbp}
            tick={{
              fill: 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            }}
            stroke="rgba(255,255,255,0.08)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="pair"
            tick={{
              fill: 'rgba(255,255,255,0.65)',
              fontSize: 11,
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              letterSpacing: 1,
            }}
            stroke="rgba(255,255,255,0.08)"
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <ReferenceLine
            x={0}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="3 3"
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={(props) => {
              if (!props.active || !props.payload?.length) return null
              const point = props.payload[0]?.payload as
                | PerformanceByPairRow
                | undefined
              if (!point) return null
              return (
                <div className="rounded-md border border-white/15 bg-base px-3 py-2 font-mono text-[11px] shadow-xl">
                  <p className="text-white">{point.pair}</p>
                  <p className="mt-1 text-accent">
                    {formatGbp(point.total_pnl_gbp)}
                  </p>
                  <p className="mt-1 text-white/55">
                    {point.total_trades} trade
                    {point.total_trades === 1 ? '' : 's'} ·{' '}
                    {Math.round(point.win_rate * 100)}% win rate
                  </p>
                  <p className="mt-1 text-white/45">
                    avg {point.avg_r >= 0 ? '+' : ''}
                    {point.avg_r.toFixed(2)}R
                  </p>
                </div>
              )
            }}
          />
          <Bar
            dataKey="total_pnl_gbp"
            isAnimationActive
            animationDuration={400}
            radius={[0, 2, 2, 0]}
          >
            {points.map((entry, idx) => (
              <Cell
                key={`bar-${entry.pair}-${idx}`}
                fill={entry.total_pnl_gbp >= 0 ? POSITIVE : NEGATIVE}
                fillOpacity={0.85}
              />
            ))}
            <LabelList
              dataKey="total_pnl_gbp"
              position="right"
              content={(p) => {
                const { x, y, width, height, value, index } = p as {
                  x?: number
                  y?: number
                  width?: number
                  height?: number
                  value?: number
                  index?: number
                }
                if (
                  x == null ||
                  y == null ||
                  width == null ||
                  height == null ||
                  value == null ||
                  index == null
                ) {
                  return null
                }
                const point = points[index]
                if (!point) return null
                const labelX = value >= 0 ? x + width + 6 : x + width + 6
                const tone = point.total_pnl_gbp >= 0 ? POSITIVE : NEGATIVE
                return (
                  <text
                    x={labelX}
                    y={y + height / 2 + 3}
                    fill={tone}
                    fontSize={10}
                    fontFamily="ui-monospace, monospace"
                  >
                    {`${formatGbp(point.total_pnl_gbp)} · ${point.total_trades}`}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
