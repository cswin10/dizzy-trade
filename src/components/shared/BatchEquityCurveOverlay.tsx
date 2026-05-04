'use client'

import { useMemo, useState } from 'react'

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

// Distinct hues so up to ten strategies stay distinguishable in
// the overlay without a colour-blind nightmare. Cycles past ten
// using the same palette; ten lines is already a lot to read.
const PALETTE = [
  '#3B82FF',
  '#4ADE80',
  '#F87171',
  '#FBBF24',
  '#A78BFA',
  '#22D3EE',
  '#FB923C',
  '#F472B6',
  '#34D399',
  '#60A5FA',
]

export type BatchEquitySeries = {
  run_id: string
  name: string
  points: Array<{ t: number; pnl: number }>
}

export type BatchEquityCurveOverlayProps = {
  series: BatchEquitySeries[]
  // Optional combined-portfolio overlay rendered as a thicker
  // white stroke on top of the per-strategy lines. When omitted
  // the chart behaves exactly as it did before this prop landed.
  combined?: BatchEquitySeries
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatDateTick(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })
}

export function BatchEquityCurveOverlay({
  series,
  combined,
}: BatchEquityCurveOverlayProps) {
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(series.map((s) => [s.run_id, true])),
  )
  const [combinedVisible, setCombinedVisible] = useState(true)

  // Treat the combined overlay as an additional virtual series so
  // the merge / forward-fill below stays single-codepath. The
  // combined line uses a distinct dataKey ('__combined__') and
  // never collides with a real run_id (uuid).
  const allSeries = useMemo(
    () =>
      combined ? [...series, { ...combined, run_id: '__combined__' }] : series,
    [series, combined],
  )

  // The chart needs a single data array: combine every series'
  // points into one ordered timeline keyed by ISO timestamp, with
  // each strategy's pnl populated where it has a tick. recharts
  // handles missing keys with the standard connectNulls=false
  // behaviour.
  const merged = useMemo(() => {
    const buckets = new Map<number, Record<string, number | null>>()
    for (const s of allSeries) {
      for (const p of s.points) {
        const slot = buckets.get(p.t) ?? { t: p.t }
        slot[s.run_id] = p.pnl
        buckets.set(p.t, slot)
      }
    }
    return Array.from(buckets.values())
      .sort((a, b) => (a.t as number) - (b.t as number))
      .map((entry) => {
        const out: Record<string, number | null> = { ...entry }
        // Forward-fill so a strategy with sparse trade exits draws
        // a flat line between its own data points instead of
        // disappearing.
        return out
      })
  }, [allSeries])

  // Forward-fill in a separate pass so the merge step above keeps
  // its readability.
  const filled = useMemo(() => {
    const lastValue = new Map<string, number | null>()
    return merged.map((row) => {
      const out: Record<string, number | null> = { t: row.t as number }
      for (const s of allSeries) {
        const cell = row[s.run_id]
        if (cell != null) {
          lastValue.set(s.run_id, cell)
        }
        out[s.run_id] = lastValue.get(s.run_id) ?? null
      }
      return out
    })
  }, [merged, allSeries])

  if (series.length === 0 || filled.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-xs uppercase tracking-widest text-white/35">
        No completed trades to chart
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="min-h-[300px] w-full">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={filled}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatDateTick}
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
              labelFormatter={(label) =>
                new Date(label as number).toLocaleString('en-GB')
              }
              formatter={(value: number | string, key: string) => {
                if (key === '__combined__') {
                  return [
                    typeof value === 'number' ? formatGbp(value) : value,
                    combined?.name ?? 'Combined',
                  ]
                }
                const s = series.find((x) => x.run_id === key)
                return [
                  typeof value === 'number' ? formatGbp(value) : value,
                  s?.name ?? key,
                ]
              }}
            />
            {series.map((s, i) =>
              visibility[s.run_id] ? (
                <Line
                  key={s.run_id}
                  type="monotone"
                  dataKey={s.run_id}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : null,
            )}
            {combined && combinedVisible ? (
              <Line
                key="__combined__"
                type="monotone"
                dataKey="__combined__"
                stroke="#FFFFFF"
                strokeWidth={2.6}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-2">
        {combined ? (
          <li key="__combined__">
            <button
              type="button"
              onClick={() => setCombinedVisible((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md border border-white/20 px-2 py-1 text-xs font-semibold text-white transition-colors hover:border-white/40"
              style={{ opacity: combinedVisible ? 1 : 0.35 }}
            >
              <span
                className="h-2 w-3 rounded-sm"
                style={{ background: '#FFFFFF' }}
              />
              {combined.name}
            </button>
          </li>
        ) : null}
        {series.map((s, i) => {
          const visible = visibility[s.run_id]
          return (
            <li key={s.run_id}>
              <button
                type="button"
                onClick={() =>
                  setVisibility((current) => ({
                    ...current,
                    [s.run_id]: !current[s.run_id],
                  }))
                }
                className="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white"
                style={{ opacity: visible ? 1 : 0.35 }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
                {s.name}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
