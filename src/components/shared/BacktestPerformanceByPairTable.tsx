// Per-pair performance breakdown. Sorted by total PnL desc so the
// strategy's best pairs surface first. The detail page passes either
// the legacy lightweight rows (PairPerformanceRow) or the extended
// PairFullRow shape from the analytics module; the component picks
// the columns it can render based on which optional fields are
// present, so we don't need parallel components for the two shapes.

export type PairPerformanceRow = {
  pair: string
  trades: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
  // Optional extras surfaced by the analytics module. Rendered as
  // additional columns when present.
  max_drawdown_gbp?: number
  sharpe_ratio?: number
  best_trade_gbp?: number
  worst_trade_gbp?: number
  profit_factor?: number | null
}

export type BacktestPerformanceByPairTableProps = {
  rows: PairPerformanceRow[]
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function rowTone(value: number): string {
  if (value > 0) return 'text-emerald-300'
  if (value < 0) return 'text-red-300'
  return ''
}

export function BacktestPerformanceByPairTable({
  rows,
}: BacktestPerformanceByPairTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-xs uppercase tracking-widest text-white/35">
        No trades by pair
      </div>
    )
  }
  const sorted = [...rows].sort((a, b) => b.total_pnl_gbp - a.total_pnl_gbp)
  const showExtended = sorted.some(
    (r) =>
      r.max_drawdown_gbp !== undefined ||
      r.sharpe_ratio !== undefined ||
      r.best_trade_gbp !== undefined,
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/45">
            <th className="px-3 py-2 text-left">Pair</th>
            <th className="px-3 py-2 text-right">Trades</th>
            <th className="px-3 py-2 text-right">Win rate</th>
            <th className="px-3 py-2 text-right">Avg R</th>
            <th className="px-3 py-2 text-right">Total PnL</th>
            {showExtended ? (
              <>
                <th className="px-3 py-2 text-right">Max DD</th>
                <th className="px-3 py-2 text-right">Sharpe</th>
                <th className="px-3 py-2 text-right">Best</th>
                <th className="px-3 py-2 text-right">Worst</th>
                <th className="px-3 py-2 text-right">Profit factor</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.pair}
              className="border-t border-white/[0.04] text-white/85"
            >
              <td className="px-3 py-2 font-medium">{row.pair}</td>
              <td className="px-3 py-2 text-right font-mono">{row.trades}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatPct(row.win_rate)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {row.avg_r.toFixed(2)}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${rowTone(row.total_pnl_gbp)}`}
              >
                {formatGbp(row.total_pnl_gbp)}
              </td>
              {showExtended ? (
                <>
                  <td className="px-3 py-2 text-right font-mono text-red-200/85">
                    {row.max_drawdown_gbp !== undefined
                      ? formatGbp(-Math.abs(row.max_drawdown_gbp))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.sharpe_ratio !== undefined
                      ? formatNumber(row.sharpe_ratio)
                      : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      row.best_trade_gbp !== undefined
                        ? rowTone(row.best_trade_gbp)
                        : ''
                    }`}
                  >
                    {row.best_trade_gbp !== undefined
                      ? formatGbp(row.best_trade_gbp)
                      : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      row.worst_trade_gbp !== undefined
                        ? rowTone(row.worst_trade_gbp)
                        : ''
                    }`}
                  >
                    {row.worst_trade_gbp !== undefined
                      ? formatGbp(row.worst_trade_gbp)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.profit_factor === null ||
                    row.profit_factor === undefined
                      ? '—'
                      : formatNumber(row.profit_factor)}
                  </td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
