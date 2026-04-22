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
      {label ? <span className="text-xs text-white/45">{label}</span> : null}
      <input
        ref={ref}
        id={inputId}
        className={twMerge(
          'h-11 w-full rounded-md border border-white/10 bg-transparent px-3',
          'font-sans text-sm text-white placeholder:text-white/30',
          'outline-none transition-colors duration-200',
          'focus:border-accent focus:ring-1 focus:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </label>
  )
})
