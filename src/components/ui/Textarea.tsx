import { forwardRef, type TextareaHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, hint, id, className, ...props }, ref) {
    const textareaId = id ?? props.name

    return (
      <label htmlFor={textareaId} className="flex flex-col gap-2">
        {label ? <span className="text-xs text-white/45">{label}</span> : null}
        <textarea
          ref={ref}
          id={textareaId}
          className={twMerge(
            'min-h-[88px] w-full rounded-md border border-white/10 bg-transparent px-3 py-2.5',
            'font-sans text-sm text-white placeholder:text-white/30',
            'outline-none transition-colors duration-200',
            'focus:border-accent focus:ring-1 focus:ring-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {hint ? <span className="text-xs text-white/35">{hint}</span> : null}
      </label>
    )
  },
)
