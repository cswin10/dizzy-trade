'use client'

import { useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  removeHyperliquidConfigAction,
  setHyperliquidConfigAction,
} from '@/app/actions/hyperliquid'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Panel } from '@/components/ui/Panel'

export type HyperliquidSettingsProps = {
  initialAddress: string | null
  lastSyncedAt: string | null
}

const relativeFormatter = new Intl.RelativeTimeFormat('en-GB', {
  numeric: 'auto',
})

function relative(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now()
  const abs = Math.abs(diffMs)
  if (!Number.isFinite(abs)) return 'Never'
  if (abs < 60_000)
    return relativeFormatter.format(Math.round(diffMs / 1_000), 'second')
  if (abs < 3_600_000)
    return relativeFormatter.format(Math.round(diffMs / 60_000), 'minute')
  if (abs < 86_400_000)
    return relativeFormatter.format(Math.round(diffMs / 3_600_000), 'hour')
  return relativeFormatter.format(Math.round(diffMs / 86_400_000), 'day')
}

function truncate(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function HyperliquidSettings({
  initialAddress,
  lastSyncedAt,
}: HyperliquidSettingsProps) {
  const [address, setAddress] = useState<string | null>(initialAddress)
  const [editing, setEditing] = useState<boolean>(initialAddress === null)
  const [draft, setDraft] = useState<string>(initialAddress ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = () => {
    setError(null)
    startTransition(async () => {
      const result = await setHyperliquidConfigAction(draft.trim())
      if (!result.ok) {
        setError(result.message ?? 'Save failed')
        return
      }
      setAddress(draft.trim().toLowerCase())
      setEditing(false)
    })
  }

  const disconnect = () => {
    if (
      !window.confirm(
        'Disconnect Hyperliquid? Any trades currently linked to live positions will revert to manual.',
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await removeHyperliquidConfigAction()
      if (!result.ok) {
        setError(result.message ?? 'Disconnect failed')
        return
      }
      setAddress(null)
      setDraft('')
      setEditing(true)
    })
  }

  return (
    <Panel title="Hyperliquid connection">
      {address && !editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-mono text-sm text-white/85">
                {truncate(address)}
              </span>
              <span className="text-xs text-white/45">
                Connected
                {lastSyncedAt
                  ? ` · Last sync ${relative(lastSyncedAt)}`
                  : ' · No syncs yet'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraft(address)
                  setEditing(true)
                }}
                className="text-xs text-accent transition-colors duration-150 hover:text-accent/80"
              >
                Update address
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={pending}
                className="text-xs text-white/45 transition-colors duration-150 hover:text-negative disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
          {error ? <p className="text-xs text-negative">{error}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-white/55">
            Connect your Hyperliquid account to enable position tracking. We
            only read your positions, never trade on your behalf.
          </p>
          <Input
            label="Hyperliquid address"
            name="hyperliquid_address"
            placeholder="0x..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="-mt-1 text-xs text-white/45">
            Your Hyperliquid main account address. Find it in the Hyperliquid
            app under Account settings.
          </p>
          {error ? <p className="text-xs text-negative">{error}</p> : null}
          <div
            className={twMerge(
              'flex items-center gap-3',
              address ? 'justify-between' : 'justify-end',
            )}
          >
            {address ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setDraft(address)
                  setError(null)
                }}
                className="text-xs text-white/45 transition-colors duration-150 hover:text-white"
              >
                Cancel
              </button>
            ) : null}
            <Button
              type="button"
              onClick={save}
              disabled={pending || draft.trim().length === 0}
              className="w-auto px-4"
            >
              {pending ? 'Saving' : address ? 'Update' : 'Save address'}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}
