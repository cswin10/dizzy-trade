'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'

import { twMerge } from 'tailwind-merge'

import { fetchCurrentPrice, type AssetResult } from '@/app/actions/assets'
import { closeTradeAction, logTradeAction } from '@/app/actions/trade'
import {
  initialTradeActionState,
  type TradeActionState,
} from '@/app/actions/trade-types'
import { AssetPicker } from '@/components/ui/AssetPicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PillToggle } from '@/components/ui/PillToggle'
import { StatusDot } from '@/components/ui/StatusDot'
import { Textarea } from '@/components/ui/Textarea'
import {
  NARRATIVE_TAGS,
  SETUP_TYPES,
  VENUE_SUGGESTIONS,
  type NarrativeTag,
  type SetupType,
} from '@/lib/constants/trade'

export type LogTradePanelMode = 'create' | 'close'

type Prefill = {
  trade_id?: string
  asset_symbol?: string
  coingecko_id?: string
  direction?: 'long' | 'short'
  entry_price?: number
  entry_size?: number
  venue?: string
  narrative_tag?: string
  setup_type?: string
  thesis?: string
  alert_id?: string
  framework_id?: string
  framework_name?: string
  suggested_stop?: number
  suggested_target?: number
}

// Maps scanner framework IDs to the human-readable setup_type strings
// used by the SETUP_TYPES taxonomy. When an alert is opened in the
// panel we pre-select the setup so the trader doesn't have to.
const FRAMEWORK_TO_SETUP: Record<string, SetupType> = {
  liquidation_hunt_v1: 'Liquidation hunt',
  narrative_breakout_v1: 'Narrative breakout',
  mean_reversion_v1: 'Mean reversion',
}

type Direction = 'long' | 'short'

export type LogTradePanelProps = {
  open: boolean
  mode: LogTradePanelMode
  prefill?: Prefill
  onClose: () => void
}

function localNowString(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
      {children}
    </h3>
  )
}

function ErrorBlock({
  message,
  violations,
}: {
  message: string
  violations?: import('@/lib/rules').RuleViolation[]
}) {
  if (violations && violations.length > 0) {
    return (
      <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2.5 text-sm text-negative">
        <p className="font-medium">Trade blocked by your rules</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-negative/85">
          {violations.map((v, idx) => (
            <li key={`${v.rule}-${idx}`}>{v.reason}</li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
      <span className="font-medium">Error</span>
      <span className="text-negative/80"> · {message}</span>
    </div>
  )
}

function WarningBlock({
  violations,
}: {
  violations: import('@/lib/rules').RuleViolation[]
}) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
      <p className="font-medium">Heads up</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-warning/85">
        {violations.map((v, idx) => (
          <li key={`${v.rule}-${idx}`}>{v.reason}</li>
        ))}
      </ul>
    </div>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close panel"
      className="text-white/45 transition-colors duration-200 hover:text-white"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4">
        <path
          d="M3 3 L13 13 M13 3 L3 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

function SubmitLabel({
  busyLabel,
  idleLabel,
}: {
  busyLabel: string
  idleLabel: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-auto px-5">
      {pending ? (
        <>
          <StatusDot tone="accent" pulse />
          <span>{busyLabel}</span>
        </>
      ) : (
        <span>{idleLabel}</span>
      )}
    </Button>
  )
}

function ScreenshotPlaceholder() {
  return (
    <div className="mb-4 flex h-20 items-center justify-center rounded-md border border-dashed border-white/10 px-4 text-center text-xs text-white/35">
      Screenshot autofill coming soon
    </div>
  )
}

function VenueInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Input
        label="Venue"
        name="venue"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Where did you trade?"
        required
      />
      <div className="flex flex-wrap gap-2">
        {VENUE_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onChange(suggestion)}
            className={twMerge(
              'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors duration-200',
              value === suggestion
                ? 'border-accent bg-accent/15 text-white'
                : 'border-white/10 bg-transparent text-white/55 hover:border-white/20 hover:text-white',
            )}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}

function matchNarrative(value: string | undefined): NarrativeTag | undefined {
  if (!value) return undefined
  return (NARRATIVE_TAGS as readonly string[]).includes(value)
    ? (value as NarrativeTag)
    : undefined
}

function matchSetup(value: string | undefined): SetupType | undefined {
  if (!value) return undefined
  return (SETUP_TYPES as readonly string[]).includes(value)
    ? (value as SetupType)
    : undefined
}

function resolveSetup(prefill: Prefill | undefined): SetupType | undefined {
  const direct = matchSetup(prefill?.setup_type)
  if (direct) return direct
  const fromFramework = prefill?.framework_id
    ? FRAMEWORK_TO_SETUP[prefill.framework_id]
    : undefined
  return fromFramework
}

// The create form has no dedicated stop/target inputs, so we append the
// suggested levels to the thesis when the alert carries them. If the
// thesis already mentions "stop" or "target" we leave it alone so the
// alert source's wording wins.
function augmentThesis(prefill: Prefill | undefined): string {
  const base = prefill?.thesis ?? ''
  const stop = prefill?.suggested_stop
  const target = prefill?.suggested_target
  if (stop === undefined && target === undefined) return base
  if (/stop|target/i.test(base)) return base
  const parts: string[] = []
  if (stop !== undefined) parts.push(`stop ${stop}`)
  if (target !== undefined) parts.push(`target ${target}`)
  if (parts.length === 0) return base
  const suffix = `Suggested ${parts.join(', ')}.`
  return base ? `${base} ${suffix}` : suffix
}

function CreateTradeForm({
  prefill,
  onSuccess,
}: {
  prefill?: Prefill
  onSuccess: () => void
}) {
  const [state, formAction] = useFormState<TradeActionState, FormData>(
    logTradeAction,
    initialTradeActionState,
  )

  const [direction, setDirection] = useState<Direction>(
    prefill?.direction ?? 'long',
  )
  const [narrative, setNarrative] = useState<NarrativeTag | undefined>(
    matchNarrative(prefill?.narrative_tag),
  )
  const [setup, setSetup] = useState<SetupType | undefined>(
    resolveSetup(prefill),
  )
  const [venue, setVenue] = useState(prefill?.venue ?? '')
  const [entrySize, setEntrySize] = useState(
    prefill?.entry_size !== undefined ? String(prefill.entry_size) : '',
  )
  const [entryPrice, setEntryPrice] = useState(
    prefill?.entry_price !== undefined ? String(prefill.entry_price) : '',
  )
  const [priceStatus, setPriceStatus] = useState<
    'idle' | 'loading' | 'fetched' | 'error'
  >(prefill?.entry_price !== undefined ? 'fetched' : 'idle')
  const [exitOpen, setExitOpen] = useState(false)
  const [exitFilled, setExitFilled] = useState(false)
  const defaultEntryAt = useMemo(localNowString, [])

  const handleAssetSelected = async (asset: AssetResult) => {
    setEntryPrice('')
    setPriceStatus('loading')
    const result = await fetchCurrentPrice(asset.coingecko_id)
    if ('error' in result) {
      setPriceStatus('error')
      return
    }
    setEntryPrice(String(result.price))
    setPriceStatus('fetched')
  }

  const priceHelper = (() => {
    if (priceStatus === 'loading') {
      return <span className="text-white/45">Fetching current price...</span>
    }
    if (priceStatus === 'fetched') {
      return (
        <span className="text-white/45">
          Current market price, edit if your fill was different
        </span>
      )
    }
    if (priceStatus === 'error') {
      return (
        <span className="text-warning">
          Could not fetch price, enter manually
        </span>
      )
    }
    return null
  })()

  useEffect(() => {
    // On a clean success the panel auto-closes. When the trade was
    // accepted with a rules warning, we keep the panel open so the
    // operator sees the heads-up and dismisses it explicitly.
    if (
      state.status === 'success' &&
      (!state.warnings || state.warnings.length === 0)
    ) {
      onSuccess()
    }
  }, [state, onSuccess])

  return (
    <form action={formAction} className="flex flex-1 flex-col overflow-hidden">
      {prefill?.alert_id ? (
        <input type="hidden" name="alert_id" value={prefill.alert_id} />
      ) : null}
      <div className="flex-1 space-y-7 overflow-y-auto px-4 py-5 sm:px-6">
        {prefill?.alert_id ? (
          <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            Pre-filled from alert. Review, adjust, and log when ready.
          </div>
        ) : (
          <ScreenshotPlaceholder />
        )}

        <section className="space-y-4">
          <SectionTitle>Entry</SectionTitle>
          <AssetPicker
            label="Asset symbol"
            name="asset_symbol"
            coingeckoIdName="coingecko_id"
            required
            initialSymbol={prefill?.asset_symbol ?? ''}
            initialCoingeckoId={prefill?.coingecko_id ?? ''}
            onAssetSelected={handleAssetSelected}
          />
          <PillToggle<Direction>
            label="Direction"
            name="direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'long', label: 'Long' },
              { value: 'short', label: 'Short' },
            ]}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Input
                label="Entry price"
                name="entry_price"
                type="number"
                step="any"
                min="0"
                value={entryPrice}
                onChange={(e) => {
                  setEntryPrice(e.target.value)
                  if (priceStatus !== 'idle') setPriceStatus('idle')
                }}
                required
              />
              {priceHelper ? <p className="text-xs">{priceHelper}</p> : null}
            </div>
            <Input
              label="Entry size"
              name="entry_size"
              type="number"
              step="any"
              min="0"
              value={entrySize}
              onChange={(e) => setEntrySize(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Leverage"
              name="leverage"
              type="number"
              step="any"
              min="0"
              defaultValue={1}
            />
            <Input
              label="Risk (£)"
              name="risk_amount_gbp"
              type="number"
              step="any"
              min="0"
              placeholder="Optional"
            />
          </div>
          <p className="-mt-2 text-xs text-white/35">
            How much you were willing to lose
          </p>
          <VenueInput value={venue} onChange={setVenue} />
          <Input
            label="Entry at"
            name="entry_at"
            type="datetime-local"
            defaultValue={defaultEntryAt}
            required
          />
        </section>

        <section className="space-y-4">
          <SectionTitle>Context</SectionTitle>
          <PillToggle<NarrativeTag>
            label="Narrative"
            name="narrative_tag"
            value={narrative}
            onChange={setNarrative}
            options={NARRATIVE_TAGS}
            required
          />
          <PillToggle<SetupType>
            label="Setup"
            name="setup_type"
            value={setup}
            onChange={setSetup}
            options={SETUP_TYPES}
          />
          <Textarea
            label="Thesis"
            name="thesis"
            rows={4}
            placeholder="Why are you taking this trade?"
            maxLength={2000}
            defaultValue={augmentThesis(prefill)}
          />
        </section>

        <section className="space-y-4">
          <SectionTitle>Exit (optional)</SectionTitle>
          <label className="flex items-center gap-3 text-sm text-white/70">
            <input
              type="checkbox"
              checked={exitOpen}
              onChange={(e) => setExitOpen(e.target.checked)}
              className="h-4 w-4 rounded border border-white/20 bg-transparent accent-accent"
            />
            <span>Mark as closed trade</span>
          </label>
          {exitOpen ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Exit price"
                  name="exit_price"
                  type="number"
                  step="any"
                  min="0"
                  onChange={(e) => setExitFilled(e.target.value !== '')}
                  required={exitOpen}
                />
                <Input
                  label="Exit size"
                  name="exit_size"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={entrySize}
                  required={exitOpen}
                />
              </div>
              <Input
                label="Exit at"
                name="exit_at"
                type="datetime-local"
                defaultValue={defaultEntryAt}
                required={exitOpen}
              />
              <Textarea
                label="Lesson"
                name="lesson"
                rows={3}
                placeholder="What did you learn from this trade?"
              />
            </div>
          ) : null}
        </section>

        {state.status === 'error' ? (
          <ErrorBlock message={state.message} violations={state.violations} />
        ) : null}
        {state.status === 'success' &&
        state.warnings &&
        state.warnings.length > 0 ? (
          <WarningBlock violations={state.warnings} />
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-white/[0.06] bg-surface px-4 py-4 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          className="w-auto px-4"
          onClick={onSuccess}
        >
          Cancel
        </Button>
        <SubmitLabel
          busyLabel={exitOpen && exitFilled ? 'Logging' : 'Logging'}
          idleLabel={exitOpen && exitFilled ? 'Log closed trade' : 'Log trade'}
        />
      </footer>
    </form>
  )
}

function CloseTradeForm({
  prefill,
  onSuccess,
}: {
  prefill: Prefill
  onSuccess: () => void
}) {
  const [state, formAction] = useFormState<TradeActionState, FormData>(
    closeTradeAction,
    initialTradeActionState,
  )

  const defaultExitAt = useMemo(localNowString, [])

  useEffect(() => {
    if (state.status === 'success') onSuccess()
  }, [state, onSuccess])

  if (!prefill.trade_id) return null

  return (
    <form action={formAction} className="flex flex-1 flex-col overflow-hidden">
      <input type="hidden" name="trade_id" value={prefill.trade_id} />
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="rounded-md border border-white/[0.06] bg-surface-2 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-white">
              {prefill.asset_symbol ?? '—'}
            </span>
            <span
              className={twMerge(
                'rounded px-2 py-0.5 text-xs font-medium',
                prefill.direction === 'short'
                  ? 'bg-negative/15 text-negative'
                  : 'bg-positive/15 text-positive',
              )}
            >
              {prefill.direction === 'short' ? 'Short' : 'Long'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-white/55">
            <span>Entry · {prefill.entry_price ?? '—'}</span>
            <span>Size · {prefill.entry_size ?? '—'}</span>
            {prefill.venue ? <span>Venue · {prefill.venue}</span> : null}
          </div>
        </div>

        <section className="space-y-4">
          <SectionTitle>Exit</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Exit price"
              name="exit_price"
              type="number"
              step="any"
              min="0"
              required
            />
            <Input
              label="Exit size"
              name="exit_size"
              type="number"
              step="any"
              min="0"
              defaultValue={prefill.entry_size ?? ''}
              required
            />
          </div>
          <Input
            label="Exit at"
            name="exit_at"
            type="datetime-local"
            defaultValue={defaultExitAt}
            required
          />
          <Textarea
            label="Lesson"
            name="lesson"
            rows={3}
            placeholder="What did you learn from this trade?"
          />
        </section>

        {state.status === 'error' ? (
          <ErrorBlock message={state.message} />
        ) : null}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-white/[0.06] bg-surface px-4 py-4 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          className="w-auto px-4"
          onClick={onSuccess}
        >
          Cancel
        </Button>
        <SubmitLabel busyLabel="Closing" idleLabel="Log closed trade" />
      </footer>
    </form>
  )
}

export function LogTradePanel({
  open,
  mode,
  prefill,
  onClose,
}: LogTradePanelProps) {
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute right-0 top-0 flex h-screen w-full flex-col border-l border-white/[0.06] bg-surface sm:w-[480px]">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <h2 className="text-base font-medium tracking-tight text-white">
              {mode === 'close' ? 'Close trade' : 'Log trade'}
            </h2>
            <p className="mt-1 text-xs text-white/45">
              {mode === 'close'
                ? 'Record the exit and capture the lesson'
                : 'Track a new position or closed trade'}
            </p>
          </div>
          <CloseButton onClose={onClose} />
        </header>
        {mode === 'close' && prefill ? (
          <CloseTradeForm prefill={prefill} onSuccess={onClose} />
        ) : (
          <CreateTradeForm prefill={prefill} onSuccess={onClose} />
        )}
      </div>
    </div>
  )
}
