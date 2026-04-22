import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

type Variant = 'default' | 'compact' | 'hero'

const headerPadding: Record<Variant, string> = {
  default: 'px-5 pb-0 pt-4',
  compact: 'px-4 pb-0 pt-3',
  hero: 'px-6 pb-0 pt-5',
}

const bodyPadding: Record<Variant, string> = {
  default: 'px-5 py-4',
  compact: 'px-4 py-3',
  hero: 'px-6 py-5',
}

export type PanelProps = {
  title?: string
  headerRight?: ReactNode
  interactive?: boolean
  variant?: Variant
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

export function Panel({
  title,
  headerRight,
  interactive = false,
  variant = 'default',
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={twMerge(
        'rounded-lg border border-white/[0.06] bg-surface bg-panel-lit',
        'transition-colors duration-200',
        interactive &&
          'cursor-pointer hover:border-white/10 hover:bg-surface-2',
        !interactive && 'hover:border-white/10 hover:bg-surface-2',
        className,
      )}
    >
      {title || headerRight ? (
        <header
          className={twMerge(
            'flex items-center justify-between',
            headerPadding[variant],
          )}
        >
          {title ? (
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {headerRight ? (
            <div className="flex items-center gap-3">{headerRight}</div>
          ) : null}
        </header>
      ) : null}
      <div className={twMerge(bodyPadding[variant], bodyClassName)}>
        {children}
      </div>
    </section>
  )
}
