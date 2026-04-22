import { forwardRef, type SelectHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, id, className, children, ...props }, ref) {
    const selectId = id ?? props.name

    return (
      <label htmlFor={selectId} className="flex flex-col gap-2">
        {label ? <span className="text-xs text-white/45">{label}</span> : null}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={twMerge(
              'h-11 w-full appearance-none rounded-md border border-white/10 bg-transparent pl-3 pr-9',
              'font-sans text-sm text-white',
              'outline-none transition-colors duration-200',
              'focus:border-accent focus:ring-1 focus:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-white/45"
          >
            <path
              d="M2 4 L6 8 L10 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </label>
    )
  },
)
