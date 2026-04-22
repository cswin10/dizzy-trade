import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

type Variant = 'primary' | 'ghost'

const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40 disabled:text-white/60',
  ghost:
    'bg-transparent text-white/70 border border-white/10 hover:border-white/20 hover:text-white disabled:text-white/30',
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
          'inline-flex h-11 w-full items-center justify-center gap-2 rounded-md',
          'px-4 text-sm font-medium',
          'outline-none transition-colors duration-200',
          'focus-visible:ring-1 focus-visible:ring-accent',
          'disabled:cursor-not-allowed',
          variantClass[variant],
          className,
        )}
        {...props}
      />
    )
  },
)
