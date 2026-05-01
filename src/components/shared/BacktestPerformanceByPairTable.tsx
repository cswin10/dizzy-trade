// Per-pair performance breakdown. Sorted by total PnL desc so the
// strategy's best pairs surface first.

export type PairPerformanceRow = {
  pair: string
  trades: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
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
                className={`px-3 py-2 text-right font-mono ${
                  row.total_pnl_gbp > 0
                    ? 'text-emerald-300'
                    : row.total_pnl_gbp < 0
                      ? 'text-red-300'
                      : ''
                }`}
              >
                {formatGbp(row.total_pnl_gbp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
