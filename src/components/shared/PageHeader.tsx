import { type ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageHeader({ title, subtitle, rightSlot }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-white/[0.04] pb-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pb-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium tracking-tight text-white sm:text-2xl">
          {title}
        </h1>
        {subtitle ? <p className="text-sm text-white/45">{subtitle}</p> : null}
      </div>
      {rightSlot ? (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {rightSlot}
        </div>
      ) : null}
    </header>
  )
}
