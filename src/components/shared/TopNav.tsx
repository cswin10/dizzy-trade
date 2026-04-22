'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { twMerge } from 'tailwind-merge'

type NavItem = { label: string; href: string }

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Journal', href: '/journal' },
  { label: 'Alerts', href: '/alerts' },
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
    <nav className="sticky top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-white/[0.06] bg-base/80 px-6 backdrop-blur-sm">
      <div className="justify-self-start">
        <Link
          href="/dashboard"
          className="group inline-flex items-center gap-2.5"
        >
          <span
            aria-hidden="true"
            className="animate-breathe h-1.5 w-1.5 rounded-full bg-accent"
          />
          <span className="text-base font-medium tracking-tight text-white">
            Dizzy Trade
          </span>
        </Link>
      </div>

      <ul className="flex items-center gap-7 justify-self-center">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                className={twMerge(
                  'text-sm font-medium transition-colors duration-200',
                  active ? 'text-white' : 'text-white/55 hover:text-white',
                )}
              >
                {item.label}
              </Link>
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-[18px] left-0 right-0 h-px bg-accent"
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
          className={twMerge(
            'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5',
            'text-sm text-white/55 transition-colors duration-200',
            'hover:bg-surface hover:text-white',
            open && 'bg-surface text-white',
          )}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="max-w-[180px] truncate">{userEmail}</span>
          <Chevron open={open} />
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 min-w-[180px] rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-1"
          >
            <form method="post" action="/sign-out">
              <button
                type="submit"
                role="menuitem"
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/70 transition-colors duration-200 hover:bg-surface-2 hover:text-white"
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
        'h-2.5 w-2.5 transition-transform duration-200',
        open ? 'rotate-180' : 'rotate-0',
      )}
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
  )
}
