'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { twMerge } from 'tailwind-merge'

type NavItem = { label: string; href: string }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Journal', href: '/journal' },
  { label: 'Watchlist', href: '/watchlist' },
  { label: 'Rules', href: '/rules' },
  { label: 'Settings', href: '/settings' },
]

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false
  if (pathname === href) return true
  return pathname.startsWith(`${href}/`)
}

export type TopNavProps = {
  userEmail: string
}

export function TopNav({ userEmail }: TopNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handlePointer(event: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <nav className="sticky top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-light/10 bg-navy-deep px-6">
      <div className="justify-self-start">
        <Link
          href="/dashboard"
          className="inline-flex items-baseline text-sm font-semibold uppercase tracking-widest text-accent"
        >
          <span>Dizzy Trade</span>
          <span className="ml-0.5 animate-pulse text-teal">_</span>
        </Link>
      </div>

      <ul className="flex items-center gap-8 justify-self-center">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                className={twMerge(
                  'text-xs font-medium uppercase tracking-widest transition-colors',
                  active ? 'text-accent' : 'text-light/60 hover:text-light',
                )}
              >
                {item.label}
              </Link>
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-[18px] left-0 right-0 h-px bg-teal"
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      <div ref={wrapperRef} className="relative justify-self-end">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 text-xs text-light/60 hover:text-light"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="max-w-[180px] truncate">{userEmail}</span>
          <Chevron open={open} />
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 min-w-[160px] border border-light/10 bg-navy-deep p-1"
          >
            <form method="post" action="/sign-out">
              <button
                type="submit"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-[11px] font-medium uppercase tracking-widest text-light/70 hover:bg-light/5 hover:text-light"
              >
                Sign out
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </nav>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={twMerge(
        'h-2.5 w-2.5 transition-transform',
        open ? 'rotate-180' : 'rotate-0',
      )}
    >
      <path
        d="M2 4 L6 8 L10 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  )
}
