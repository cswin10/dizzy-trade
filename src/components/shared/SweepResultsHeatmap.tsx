'use client'

import { useMemo, useState } from 'react'

export type HeatmapCell = {
  xValue: number | string | boolean
  yValue: number | string | boolean
  pnlGbp: number | null
  totalTrades: number | null
  winRate: number | null
  avgR: number | null
  sharpe: number | null
  runId: string | null
}

export type SweepResultsHeatmapProps = {
  xKey: string
  yKey: string
  cells: HeatmapCell[]
}

function formatGbp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatLabel(value: number | string | boolean): string {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString()
    return value.toFixed(4).replace(/\.?0+$/, '')
  }
  return String(value)
}

function colourFor(value: number | null, maxAbs: number): string {
  if (value === null || !Number.isFinite(value) || maxAbs === 0) {
    return 'rgba(255,255,255,0.04)'
  }
  const intensity = Math.min(1, Math.abs(value) / maxAbs)
  if (value > 0) {
    return `rgba(74, 222, 128, ${0.1 + intensity * 0.55})`
  }
  return `rgba(248, 113, 113, ${0.1 + intensity * 0.55})`
}

export function SweepResultsHeatmap({
  xKey,
  yKey,
  cells,
}: SweepResultsHeatmapProps) {
  const [hovered, setHovered] = useState<HeatmapCell | null>(null)

  const xValues = useMemo(() => {
    const set = new Set<string>()
    const order: Array<number | string | boolean> = []
    for (const cell of cells) {
      const key = String(cell.xValue)
      if (!set.has(key)) {
        set.add(key)
        order.push(cell.xValue)
      }
    }
    return order.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b
      return String(a).localeCompare(String(b))
    })
  }, [cells])

  const yValues = useMemo(() => {
    const set = new Set<string>()
    const order: Array<number | string | boolean> = []
    for (const cell of cells) {
      const key = String(cell.yValue)
      if (!set.has(key)) {
        set.add(key)
        order.push(cell.yValue)
      }
    }
    return order.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b
      return String(a).localeCompare(String(b))
    })
  }, [cells])

  const maxAbs = useMemo(() => {
    let m = 0
    for (const cell of cells) {
      if (cell.pnlGbp != null && Math.abs(cell.pnlGbp) > m) {
        m = Math.abs(cell.pnlGbp)
      }
    }
    return m
  }, [cells])

  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>()
    for (const cell of cells) {
      map.set(`${String(cell.xValue)}|${String(cell.yValue)}`, cell)
    }
    return map
  }, [cells])

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-white/45">
        X axis: {xKey} · Y axis: {yKey} · cell colour by total PnL
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="p-2 text-[10px] uppercase tracking-wider text-white/35">
                {yKey} \ {xKey}
              </th>
              {xValues.map((xv) => (
                <th
                  key={String(xv)}
                  className="p-2 text-[10px] uppercase tracking-wider text-white/45"
                >
                  {formatLabel(xv)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yValues.map((yv) => (
              <tr key={String(yv)}>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-white/45">
                  {formatLabel(yv)}
                </th>
                {xValues.map((xv) => {
                  const cell = cellMap.get(`${String(xv)}|${String(yv)}`)
                  const bg = colourFor(cell?.pnlGbp ?? null, maxAbs)
                  return (
                    <td
                      key={`${String(xv)}-${String(yv)}`}
                      onMouseEnter={() => setHovered(cell ?? null)}
                      onMouseLeave={() => setHovered(null)}
                      className="cursor-default rounded p-2 text-center font-mono text-[11px] text-white/85"
                      style={{ background: bg, minWidth: 64 }}
                    >
                      {cell ? formatGbp(cell.pnlGbp) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hovered ? (
        <div className="rounded-md border border-white/[0.06] bg-surface-2 p-3 font-mono text-xs text-white/85">
          {xKey}={formatLabel(hovered.xValue)} · {yKey}=
          {formatLabel(hovered.yValue)} · trades={hovered.totalTrades ?? '—'} ·
          win=
          {hovered.winRate != null
            ? `${(hovered.winRate * 100).toFixed(1)}%`
            : '—'}
          {' · '}
          avgR={hovered.avgR != null ? hovered.avgR.toFixed(2) : '—'} · Sharpe=
          {hovered.sharpe != null ? hovered.sharpe.toFixed(2) : '—'} · pnl=
          {formatGbp(hovered.pnlGbp)}
        </div>
      ) : null}
    </div>
  )
}
