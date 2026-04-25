import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type PageContainerProps = {
  className?: string
  children: ReactNode
}

export function PageContainer({ className, children }: PageContainerProps) {
  return (
    <div
      className={twMerge(
        'mx-auto w-full max-w-7xl px-4 pb-6 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-8 lg:pt-10',
        className,
      )}
    >
      {children}
    </div>
  )
}
