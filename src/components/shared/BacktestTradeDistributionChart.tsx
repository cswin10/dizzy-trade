'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const POSITIVE = '#4ADE80'
const NEGATIVE = '#F87171'

export type DistributionBucket = {
  label: string
  midpoint: number
  count: number
}

export type BacktestTradeDistributionChartProps = {
  buckets: DistributionBucket[]
}

export function BacktestTradeDistributionChart({
  buckets,
}: BacktestTradeDistributionChartProps) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-xs uppercase tracking-widest text-white/35">
        No trades to chart
      </div>
    )
  }

  return (
    <div className="min-h-[240px] w-full">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={buckets}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 10 }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            tick={{ fontSize: 10 }}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(20,22,30,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: 'rgba(255,255,255,0.55)' }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {buckets.map((bucket) => (
              <Cell
                key={bucket.label}
                fill={bucket.midpoint < 0 ? NEGATIVE : POSITIVE}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
