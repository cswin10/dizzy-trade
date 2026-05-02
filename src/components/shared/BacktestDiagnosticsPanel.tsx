// Renders the per-run diagnostics ledger produced by the backtest
// engine. Exists to make a zero-signal run self-explanatory: the
// operator should not have to guess "did my warmup window fail to
// satisfy my EMA period?" or "did my RSI threshold simply never
// cross?". This component answers both questions front-and-centre
// when no signals fired, and folds quietly into a collapsible
// section when they did.
//
// Source of the data is BacktestDiagnostics in
// src/lib/backtest/types.ts. Pre-migration runs do not have a
// diagnostics row; the parent page is responsible for not rendering
// this component when diagnostics is null.

import type {
  BacktestDiagnostics,
  BacktestDiagnosticsPair,
} from '@/lib/backtest/types'

export type BacktestDiagnosticsPanelProps = {
  diagnostics: BacktestDiagnostics
  zeroSignals: boolean
}

type FailureRow = {
  condition_type: string
  failures: number
  insufficient_data: number
  pct_of_evals: number
}

function buildFailureRows(
  diagnostics: BacktestDiagnostics,
): FailureRow[] {
  const total = Math.max(1, diagnostics.evaluations_total)
  const rows: FailureRow[] = []
  for (const [type, count] of Object.entries(
    diagnostics.condition_failure_breakdown,
  )) {
    rows.push({
      condition_type: type,
      failures: count,
      insufficient_data:
        diagnostics.condition_insufficient_data[type] ?? 0,
      pct_of_evals: (count / total) * 100,
    })
  }
  rows.sort((a, b) => b.failures - a.failures)
  return rows
}

// Translates a (condition, insufficient_data) pair into a short
// hint the operator can act on. Mostly mechanical but the
// "warmup_param_max exceeds warmup_candles_used" case is the
// killer one — it explicitly names the misconfig.
function suggestFix(
  row: FailureRow,
  diagnostics: BacktestDiagnostics,
): string {
  const insufficientShare =
    row.failures === 0 ? 0 : row.insufficient_data / row.failures
  if (insufficientShare > 0.5) {
    if (
      diagnostics.warmup_param_max > 0 &&
      diagnostics.warmup_param_max + 1 > diagnostics.warmup_candles_used
    ) {
      return `Indicator needed ${diagnostics.warmup_param_max} samples but the engine warmup window was ${diagnostics.warmup_candles_used} — extend the date range or shorten the lookback.`
    }
    return `Indicator could not be computed on most evaluations — likely insufficient candles for the configured period.`
  }
  if (row.condition_type.startsWith('rsi_')) {
    return 'Threshold was rarely crossed. Consider relaxing the RSI bound or extending the date range.'
  }
  if (row.condition_type.startsWith('ema_') || row.condition_type.startsWith('sma_')) {
    return 'Price was on the wrong side of the moving average for most of the period.'
  }
  if (row.condition_type === 'volume_ratio' || row.condition_type === 'volume_threshold') {
    return 'Volume rarely met the configured multiple — try a lower threshold.'
  }
  return 'Condition rarely passed. Loosen the parameter or pair it with a different setup.'
}

function buildHeadline(
  diagnostics: BacktestDiagnostics,
  rows: FailureRow[],
): string {
  const pairCount = Object.keys(diagnostics.per_pair).length
  const evals = diagnostics.evaluations_total.toLocaleString('en-GB')
  if (rows.length === 0 || diagnostics.evaluations_passed > 0) {
    return `Strategy was evaluated ${evals} times across ${pairCount} pair${pairCount === 1 ? '' : 's'}.`
  }
  const top = rows[0]!
  const insufficient = top.insufficient_data > top.failures / 2
  const detail = insufficient
    ? `every group hit "${top.condition_type}" with insufficient candle history`
    : `every group hit "${top.condition_type}" before any other condition could pass`
  return `Strategy was evaluated ${evals} times across ${pairCount} pair${pairCount === 1 ? '' : 's'}. 0 signals fired because ${detail}.`
}

function formatInt(value: number): string {
  return value.toLocaleString('en-GB')
}

export function BacktestDiagnosticsPanel({
  diagnostics,
  zeroSignals,
}: BacktestDiagnosticsPanelProps) {
  const rows = buildFailureRows(diagnostics)
  const headline = buildHeadline(diagnostics, rows)
  const warmupMismatch =
    diagnostics.warmup_param_max > diagnostics.warmup_candles_used

  // Top three conditions are the actionable thing; everything else
  // is detail for the curious operator.
  const topRows = rows.slice(0, 3)

  if (zeroSignals) {
    return (
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-amber-200">
          Why no signals?
        </h2>
        <p className="mt-2 text-xs text-white/70">{headline}</p>

        {warmupMismatch ? (
          <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <span className="font-medium">Warmup misconfig.</span>{' '}
            Your strategy needs {diagnostics.warmup_param_max} candles of
            history (largest indicator lookback) but the engine warmup
            window is only {diagnostics.warmup_candles_used}. Indicators
            return NaN and every group fails on the affected condition.
          </div>
        ) : null}

        <DiagnosticBody
          diagnostics={diagnostics}
          topRows={topRows}
          totalRowsCount={rows.length}
        />
      </section>
    )
  }

  return (
    <details className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
      <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-white/55">
        Diagnostics
      </summary>
      <div className="mt-3">
        <p className="text-xs text-white/70">{headline}</p>
        <DiagnosticBody
          diagnostics={diagnostics}
          topRows={topRows}
          totalRowsCount={rows.length}
        />
      </div>
    </details>
  )
}

function DiagnosticBody({
  diagnostics,
  topRows,
  totalRowsCount,
}: {
  diagnostics: BacktestDiagnostics
  topRows: FailureRow[]
  totalRowsCount: number
}) {
  return (
    <>
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Evaluations" value={formatInt(diagnostics.evaluations_total)} />
        <Stat label="Signals fired" value={formatInt(diagnostics.evaluations_passed)} />
        <Stat
          label="Blocked by rules"
          value={formatInt(diagnostics.evaluations_blocked_by_rules)}
        />
        <Stat
          label="Warmup window used"
          value={`${diagnostics.warmup_candles_used} candles`}
        />
        <Stat
          label="Largest indicator lookback"
          value={
            diagnostics.warmup_param_max > 0
              ? `${diagnostics.warmup_param_max} (param)`
              : '— (legacy framework)'
          }
        />
        <Stat
          label="Sample rate"
          value={`${(diagnostics.sample_rate * 100).toFixed(0)}%`}
        />
      </div>

      <div className="mt-5">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
          Per-pair evaluations
        </h3>
        <div className="mt-2 overflow-x-auto rounded border border-white/[0.06]">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-white/45">
              <tr>
                <th className="px-3 py-2 text-left">Pair</th>
                <th className="px-3 py-2 text-right">Loaded</th>
                <th className="px-3 py-2 text-right">Evaluated</th>
                <th className="px-3 py-2 text-right">Long evals</th>
                <th className="px-3 py-2 text-right">Short evals</th>
                <th className="px-3 py-2 text-right">Signals</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diagnostics.per_pair).map(([pair, p]) => (
                <PairRow key={pair} pair={pair} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {topRows.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
            Top failure reasons
          </h3>
          <ol className="mt-2 space-y-2 text-xs text-white/75">
            {topRows.map((row, i) => (
              <li
                key={row.condition_type}
                className="rounded border border-white/[0.06] bg-surface p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono font-medium text-white/90">
                    {i + 1}. {row.condition_type}
                  </span>
                  <span className="text-[11px] text-white/55">
                    {formatInt(row.failures)} failures · {row.pct_of_evals.toFixed(1)}% of evals
                    {row.insufficient_data > 0
                      ? ` · ${formatInt(row.insufficient_data)} insufficient data`
                      : ''}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-white/60">
                  {suggestFix(row, diagnostics)}
                </p>
              </li>
            ))}
          </ol>
          {totalRowsCount > topRows.length ? (
            <p className="mt-2 text-[11px] text-white/45">
              {totalRowsCount - topRows.length} more condition type
              {totalRowsCount - topRows.length === 1 ? '' : 's'} appeared in
              the failure breakdown.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function PairRow({ pair, p }: { pair: string; p: BacktestDiagnosticsPair }) {
  return (
    <tr className="border-t border-white/[0.04] text-white/85">
      <td className="px-3 py-2 font-medium">{pair}</td>
      <td className="px-3 py-2 text-right font-mono">{formatInt(p.candles_loaded)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatInt(p.candles_evaluated)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatInt(p.long_evaluations)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatInt(p.short_evaluations)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatInt(p.signals)}</td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
      <div className="mt-1 font-mono text-sm text-white/90">{value}</div>
    </div>
  )
}
