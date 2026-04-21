import { twMerge } from 'tailwind-merge'

type Tone = 'active' | 'warning' | 'error' | 'muted'

const toneClass: Record<Tone, string> = {
  active: 'bg-teal',
  warning: 'bg-warning',
  error: 'bg-danger',
  muted: 'bg-light/30',
}

export type StatusDotProps = {
  tone?: Tone
  pulse?: boolean
  className?: string
}

export function StatusDot({
  tone = 'active',
  pulse = false,
  className,
}: StatusDotProps) {
  return (
    <span
      className={twMerge(
        'inline-block h-1.5 w-1.5 rounded-full',
        toneClass[tone],
        pulse && 'animate-pulse',
        className,
      )}
      aria-hidden="true"
    />
  )
}
