import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

type Variant = 'primary' | 'ghost'

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-navy hover:bg-accent-hover disabled:bg-accent/40 disabled:text-navy/60',
  ghost:
    'bg-transparent text-light/80 border border-light/15 hover:border-light/30 hover:text-light disabled:text-light/30',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = 'primary', className, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={twMerge(
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm',
          'px-4 text-xs font-semibold uppercase tracking-widest',
          'outline-none transition-colors',
          'focus-visible:ring-1 focus-visible:ring-teal',
          'disabled:cursor-not-allowed',
          variantClass[variant],
          className,
        )}
        {...props}
      />
    )
  },
)
