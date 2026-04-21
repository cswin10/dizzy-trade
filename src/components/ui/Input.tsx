import { forwardRef, type InputHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, className, ...props },
  ref,
) {
  const inputId = id ?? props.name

  return (
    <label htmlFor={inputId} className="flex flex-col gap-2">
      {label ? (
        <span className="text-xs font-medium uppercase tracking-widest text-light/60">
          {label}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={twMerge(
          'h-11 w-full rounded-sm border border-light/15 bg-transparent px-3',
          'font-sans text-sm text-light placeholder:text-light/30',
          'outline-none transition-colors',
          'focus:border-teal focus:ring-1 focus:ring-teal',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </label>
  )
})
