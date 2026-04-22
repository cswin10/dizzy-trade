'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { twMerge } from 'tailwind-merge'

import {
  popularAssets,
  searchAssets,
  type AssetResult,
} from '@/app/actions/assets'

const DEBOUNCE_MS = 150

export type AssetPickerProps = {
  label?: string
  name?: string
  coingeckoIdName?: string
  required?: boolean
  initialSymbol?: string
  initialCoingeckoId?: string
  onAssetSelected?: (asset: AssetResult) => void
}

export function AssetPicker({
  label = 'Asset symbol',
  name = 'asset_symbol',
  coingeckoIdName = 'coingecko_id',
  required,
  initialSymbol = '',
  initialCoingeckoId = '',
  onAssetSelected,
}: AssetPickerProps) {
  const [query, setQuery] = useState(initialSymbol)
  const [coingeckoId, setCoingeckoId] = useState(initialCoingeckoId)
  const [results, setResults] = useState<AssetResult[]>([])
  const [suggestions, setSuggestions] = useState<AssetResult[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [loading, setLoading] = useState(false)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const latestQueryRef = useRef(query)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionsLoadedRef = useRef(false)

  const loadSuggestions = useCallback(async () => {
    if (suggestionsLoadedRef.current) return
    suggestionsLoadedRef.current = true
    const top = await popularAssets()
    setSuggestions(top)
  }, [])

  const runSearch = useCallback(async (value: string) => {
    latestQueryRef.current = value
    if (value.trim().length === 0) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const found = await searchAssets(value)
    // Ignore stale results from earlier keystrokes.
    if (latestQueryRef.current !== value) return
    setResults(found)
    setHighlight(0)
    setLoading(false)
  }, [])

  const scheduleSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void runSearch(value)
      }, DEBOUNCE_MS)
    },
    [runSearch],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [open])

  const handleSelect = useCallback(
    (asset: AssetResult) => {
      setQuery(asset.symbol)
      setCoingeckoId(asset.coingecko_id)
      setResults([])
      setOpen(false)
      onAssetSelected?.(asset)
    },
    [onAssetSelected],
  )

  // Which list is currently on screen drives both keyboard navigation and
  // the rendered rows: results when the user has typed, suggestions when
  // the input is focused but empty.
  const activeList = query.trim().length > 0 ? results : suggestions
  const showSuggestions = query.trim().length === 0 && suggestions.length > 0
  const showNoMatches =
    !loading && results.length === 0 && query.trim().length > 0
  const showDropdown = open

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      setHighlight((i) => Math.min(i + 1, Math.max(activeList.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      if (open && activeList[highlight]) {
        event.preventDefault()
        handleSelect(activeList[highlight]!)
      }
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const inputId = useMemo(() => name ?? 'asset-picker', [name])

  return (
    <div ref={wrapperRef} className="flex flex-col gap-2">
      {label ? (
        <label htmlFor={inputId} className="text-xs text-white/45">
          {label}
          {required ? <span className="text-negative"> *</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            const value = e.target.value
            setQuery(value)
            setCoingeckoId('')
            setOpen(true)
            setHighlight(0)
            scheduleSearch(value)
          }}
          onFocus={() => {
            setOpen(true)
            void loadSuggestions()
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search by symbol or name"
          required={required}
          className={twMerge(
            'h-11 w-full rounded-md border border-white/10 bg-transparent px-3',
            'font-sans text-sm text-white placeholder:text-white/30',
            'outline-none transition-colors duration-200',
            'focus:border-accent focus:ring-1 focus:ring-accent',
          )}
        />
        {showDropdown ? (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-white/[0.06] bg-surface bg-panel-lit p-1 shadow-xl"
          >
            {showSuggestions ? (
              <li className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-white/35">
                Popular
              </li>
            ) : null}
            {loading && results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-white/45">Searching...</li>
            ) : null}
            {activeList.map((asset, index) => {
              const active = index === highlight
              return (
                <li key={asset.coingecko_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(asset)
                    }}
                    className={twMerge(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left',
                      active ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="text-sm font-medium uppercase text-white">
                      {asset.symbol}
                    </span>
                    <span className="truncate pl-4 text-sm text-white/55">
                      {asset.name}
                    </span>
                  </button>
                </li>
              )
            })}
            {showNoMatches ? (
              <li className="px-3 py-2 text-sm text-white/45">No matches</li>
            ) : null}
            {!showSuggestions &&
            !showNoMatches &&
            activeList.length === 0 &&
            !loading ? (
              <li className="px-3 py-2 text-sm text-white/45">
                Start typing to search
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <input type="hidden" name={name} value={query} readOnly />
      <input
        type="hidden"
        name={coingeckoIdName}
        value={coingeckoId}
        readOnly
      />
    </div>
  )
}
