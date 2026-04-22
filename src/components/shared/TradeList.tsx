'use client'

import { twMerge } from 'tailwind-merge'

import { useEditLessonDialog } from './EditLessonDialogContext'
import { useLogTradePanel } from './LogTradePanelContext'
import { TradeRowActions } from './TradeRowActions'
import { Button } from '@/components/ui/Button'
import { formatPnl, pnlTone, type Trade } from '@/lib/trade-helpers'

type Variant = 'full' | 'compact'

export type TradeListProps = {
  trades: Trade[]
  variant?: Variant
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const compactDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function PnlValue({ value }: { value: number | null | undefined }) {
  const tone = pnlTone(value)
  const arrow = tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : '•'
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1 font-medium tabular-nums',
        tone === 'positive' && 'text-positive',
        tone === 'negative' && 'text-negative',
        tone === 'neutral' && 'text-white/55',
      )}
    >
      <span aria-hidden="true" className="text-[10px]">
        {arrow}
      </span>
      <span>{formatPnl(value ?? 0)}</span>
    </span>
  )
}

function DirectionBadge({ direction }: { direction: 'long' | 'short' }) {
  return (
    <span
      className={twMerge(
        'rounded px-1.5 py-0.5 text-[11px] font-medium',
        direction === 'long'
          ? 'bg-positive/15 text-positive'
          : 'bg-negative/15 text-negative',
      )}
    >
      {direction === 'long' ? 'Long' : 'Short'}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: Trade['outcome'] }) {
  const className =
    outcome === 'win'
      ? 'bg-positive/15 text-positive'
      : outcome === 'loss'
        ? 'bg-negative/15 text-negative'
        : outcome === 'breakeven'
          ? 'bg-white/10 text-white/60'
          : 'bg-accent/15 text-accent'
  const label =
    outcome === 'win'
      ? 'Win'
      : outcome === 'loss'
        ? 'Loss'
        : outcome === 'breakeven'
          ? 'Breakeven'
          : 'Open'
  return (
    <span
      className={twMerge(
        'rounded px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {label}
    </span>
  )
}

function NarrativePill({ tag }: { tag: string | null }) {
  if (!tag) return <span className="text-xs text-white/35">—</span>
  return (
    <span className="rounded-md border border-white/[0.06] bg-surface-2 px-2 py-0.5 text-[11px] text-white/70">
      {tag}
    </span>
  )
}

function priceFormat(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

function sizeFormat(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

function EmptyState({ variant }: { variant: Variant }) {
  const { open } = useLogTradePanel()
  if (variant === 'compact') {
    return (
      <p className="py-10 text-center text-sm text-white/35">
        Nothing logged yet
      </p>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-sm text-white/55">
        No trades yet. Log your first trade to get started.
      </p>
      <Button type="button" onClick={() => open()} className="w-auto px-4">
        Log trade
      </Button>
    </div>
  )
}

// Shared behaviour for both table rows and mobile cards: clicking a row
// fires the default action for that trade (close panel for open trades,
// edit lesson for closed). The row-level action menu stops propagation
// so its buttons do not also trigger the row click.
function useRowClick() {
  const { open: openPanel } = useLogTradePanel()
  const { openEditLesson } = useEditLessonDialog()
  return (trade: Trade) => {
    if (trade.outcome === 'open') {
      openPanel({
        mode: 'close',
        trade_id: trade.id,
        asset_symbol: trade.asset_symbol,
        direction: trade.direction,
        entry_price: trade.entry_price,
        entry_size: trade.entry_size,
        venue: trade.venue,
      })
      return
    }
    openEditLesson({
      trade_id: trade.id,
      asset_symbol: trade.asset_symbol,
      lesson: trade.lesson,
    })
  }
}

export function TradeList({ trades, variant = 'full' }: TradeListProps) {
  const onRowClick = useRowClick()

  if (trades.length === 0) return <EmptyState variant={variant} />

  if (variant === 'compact') {
    return (
      <div className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] font-medium uppercase tracking-wider text-white/35">
              <th className="px-3 pb-2 font-medium">Date</th>
              <th className="px-3 pb-2 font-medium">Asset</th>
              <th className="px-3 pb-2 font-medium">Direction</th>
              <th className="px-3 pb-2 text-right font-medium">PnL</th>
              <th className="px-3 pb-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                onClick={() => onRowClick(trade)}
                className="cursor-pointer border-t border-white/[0.04] text-sm transition-colors duration-200 hover:bg-surface-2"
              >
                <td className="whitespace-nowrap px-3 py-2 text-white/55">
                  {compactDateFormatter.format(new Date(trade.entry_at))}
                </td>
                <td className="px-3 py-2 font-medium text-white">
                  {trade.asset_symbol}
                </td>
                <td className="px-3 py-2">
                  <DirectionBadge direction={trade.direction} />
                </td>
                <td className="px-3 py-2 text-right">
                  <PnlValue value={trade.pnl} />
                </td>
                <td className="px-3 py-2">
                  <OutcomeBadge outcome={trade.outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead>
          <tr className="text-left text-[10px] font-medium uppercase tracking-wider text-white/35">
            <th className="px-3 pb-2 font-medium">Date</th>
            <th className="px-3 pb-2 font-medium">Asset</th>
            <th className="px-3 pb-2 font-medium">Direction</th>
            <th className="px-3 pb-2 font-medium">Size</th>
            <th className="px-3 pb-2 font-medium">Entry</th>
            <th className="px-3 pb-2 font-medium">Exit</th>
            <th className="px-3 pb-2 text-right font-medium">PnL</th>
            <th className="px-3 pb-2 font-medium">Outcome</th>
            <th className="px-3 pb-2 font-medium">Narrative</th>
            <th className="px-3 pb-2" />
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr
              key={trade.id}
              onClick={() => onRowClick(trade)}
              className="cursor-pointer border-t border-white/[0.04] text-sm transition-colors duration-200 hover:bg-surface-2"
            >
              <td className="whitespace-nowrap px-3 py-3 text-white/55">
                {dateFormatter.format(new Date(trade.entry_at))}
              </td>
              <td className="px-3 py-3 font-medium text-white">
                {trade.asset_symbol}
              </td>
              <td className="px-3 py-3">
                <DirectionBadge direction={trade.direction} />
              </td>
              <td className="px-3 py-3 text-white/80">
                <div className="flex flex-col">
                  <span>{sizeFormat(trade.entry_size)}</span>
                  {trade.risk_amount_gbp ? (
                    <span className="text-[11px] text-white/40">
                      Risk · £{trade.risk_amount_gbp}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-3 tabular-nums text-white/80">
                {priceFormat(trade.entry_price)}
              </td>
              <td className="px-3 py-3 tabular-nums text-white/80">
                {priceFormat(trade.exit_price)}
              </td>
              <td className="px-3 py-3 text-right">
                <PnlValue value={trade.pnl} />
              </td>
              <td className="px-3 py-3">
                <OutcomeBadge outcome={trade.outcome} />
              </td>
              <td className="px-3 py-3">
                <NarrativePill tag={trade.narrative_tag} />
              </td>
              <td className="px-3 py-3 text-right">
                <TradeRowActions trade={trade} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {trades.map((trade) => (
          <div
            key={trade.id}
            onClick={() => onRowClick(trade)}
            className="cursor-pointer rounded-md border border-white/[0.06] bg-surface bg-panel-lit p-4 transition-colors duration-200 hover:bg-surface-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">
                    {trade.asset_symbol}
                  </span>
                  <DirectionBadge direction={trade.direction} />
                </div>
                <span className="text-xs text-white/45">
                  {dateFormatter.format(new Date(trade.entry_at))}
                </span>
              </div>
              <TradeRowActions trade={trade} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-white/55">
              <div>
                Entry ·{' '}
                <span className="text-white/80">
                  {priceFormat(trade.entry_price)}
                </span>
              </div>
              <div>
                Exit ·{' '}
                <span className="text-white/80">
                  {priceFormat(trade.exit_price)}
                </span>
              </div>
              <div>
                Size ·{' '}
                <span className="text-white/80">
                  {sizeFormat(trade.entry_size)}
                </span>
              </div>
              <div className="text-right">
                <PnlValue value={trade.pnl} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <NarrativePill tag={trade.narrative_tag} />
              <OutcomeBadge outcome={trade.outcome} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
