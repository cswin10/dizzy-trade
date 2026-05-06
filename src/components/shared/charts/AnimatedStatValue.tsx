'use client'

import { twMerge } from 'tailwind-merge'

import { useCountUp } from '@/lib/hooks/useCountUp'

export type StatFormat = 'integer' | 'percent' | 'currency-gbp' | 'r-multiple'

export type AnimatedStatValueProps = {
  value: number
  format: StatFormat
  className?: string
  // When true, render `—` instead of the formatted value. Empty cards
  // pass this rather than a sentinel value.
  empty?: boolean
}

const gbpAbsFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function formatValue(value: number, format: StatFormat): string {
  if (!Number.isFinite(value)) return '-'
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString('en-GB')
    case 'percent':
      return `${Math.round(value * 100)}%`
    case 'r-multiple': {
      const sign = value > 0 ? '+' : value < 0 ? '-' : ''
      return `${sign}${Math.abs(value).toFixed(2)}R`
    }
    case 'currency-gbp': {
      const sign = value > 0 ? '+' : value < 0 ? '-' : ''
      return `${sign}£${gbpAbsFormatter.format(Math.abs(value))}`
    }
  }
}

export function AnimatedStatValue({
  value,
  format,
  className,
  empty,
}: AnimatedStatValueProps) {
  const animated = useCountUp(empty ? 0 : value)
  if (empty) {
    return (
      <span
        className={twMerge(
          'font-mono text-3xl tabular-nums text-white/35',
          className,
        )}
      >
        —
      </span>
    )
  }
  return (
    <span
      className={twMerge(
        'font-mono text-3xl font-medium tabular-nums tracking-tight',
        className,
      )}
    >
      {formatValue(animated, format)}
    </span>
  )
}
