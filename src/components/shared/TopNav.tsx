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
  { label: 'Backtest', href: '/backtest' },
  { label: 'Rules', href: '/rules' },
  { label: 'Analytics', href: '/analytics' },
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Close the mobile drawer when the route changes so navigating
  // doesn't leave a stale overlay sitting on top of the new page.
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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

  useEffect(() => {
    if (!mobileOpen) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <nav className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-white/[0.06] bg-base/80 px-4 backdrop-blur-sm sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr]">
      <div className="lg:justify-self-start">
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

      <ul className="hidden items-center gap-7 lg:flex lg:justify-self-center">
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

      <div className="flex items-center gap-1 lg:justify-self-end">
        <div ref={wrapperRef} className="relative hidden lg:block">
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

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-white/70 transition-colors duration-200 hover:bg-surface hover:text-white lg:hidden"
        >
          {mobileOpen ? <CrossIcon /> : <MenuIcon />}
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col bg-base/95 backdrop-blur-md lg:hidden">
          <ul className="flex flex-col gap-1 px-4 py-4">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={twMerge(
                      'flex items-center justify-between rounded-md px-3 py-3 text-base transition-colors duration-150',
                      active
                        ? 'bg-accent/15 text-white'
                        : 'text-white/65 hover:bg-surface hover:text-white',
                    )}
                  >
                    <span>{item.label}</span>
                    {active ? (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-accent"
                      />
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto border-t border-white/[0.06] px-4 py-4">
            <p className="mb-2 truncate text-xs text-white/45">{userEmail}</p>
            <form method="post" action="/sign-out">
              <button
                type="submit"
                className="w-full rounded-md border border-white/10 px-3 py-2.5 text-left text-sm text-white/75 transition-colors duration-150 hover:border-white/25 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M2 4 H14 M2 8 H14 M2 12 H14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 3 L13 13 M13 3 L3 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
