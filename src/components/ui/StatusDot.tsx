import { twMerge } from 'tailwind-merge'

type Tone = 'accent' | 'positive' | 'warning' | 'negative' | 'muted'

const toneClass: Record<Tone, string> = {
  accent: 'bg-accent shadow-[0_0_8px_rgba(59,130,255,0.5)]',
  positive: 'bg-positive shadow-[0_0_8px_rgba(74,222,128,0.45)]',
  warning: 'bg-warning shadow-[0_0_8px_rgba(245,158,11,0.45)]',
  negative: 'bg-negative shadow-[0_0_8px_rgba(248,113,113,0.45)]',
  muted: 'bg-white/30',
}

export type StatusDotProps = {
  tone?: Tone
  pulse?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function StatusDot({
  tone = 'positive',
  pulse = false,
  size = 'sm',
  className,
}: StatusDotProps) {
  return (
    <span
      className={twMerge(
        'inline-block rounded-full',
        size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        toneClass[tone],
        pulse && 'animate-pulse',
        className,
      )}
      aria-hidden="true"
    />
  )
}
