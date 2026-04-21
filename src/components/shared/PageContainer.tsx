import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type PageContainerProps = {
  className?: string
  children: ReactNode
}

export function PageContainer({ className, children }: PageContainerProps) {
  return (
    <div className={twMerge('mx-auto w-full max-w-7xl px-8 py-8', className)}>
      {children}
    </div>
  )
}
