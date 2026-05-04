'use client'

import { useState, useTransition } from 'react'

import {
  connectExchangeAction,
  disconnectExchangeAction,
  type ExchangeStatus,
} from '@/app/actions/exchange-credentials'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export type ExchangeConnectionFormProps = {
  initialStatus: ExchangeStatus
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-GB', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function ExchangeConnectionForm({
  initialStatus,
}: ExchangeConnectionFormProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ExchangeStatus>(initialStatus)

  const [apiWalletKey, setApiWalletKey] = useState('')
  const [apiWalletAddress, setApiWalletAddress] = useState('')
  const [masterAddress, setMasterAddress] = useState('')

  function statusBanner() {
    if (status.connected) {
      return (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4 text-sm text-emerald-200">
          <div className="font-semibold">Connected to Hyperliquid testnet</div>
          <div className="mt-1 text-xs text-white/70">
            Live deployments will route real orders through this API wallet.
          </div>
        </div>
      )
    }
    if (status.reason === 'mainnet_blocked') {
      return (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.05] p-4 text-sm text-red-200">
          <div className="font-semibold">Mainnet credentials present</div>
          <div className="mt-1 text-xs text-white/70">
            Phase 2a only allows testnet. The factory ignores this row and
            falls back to the mock client. Disconnect to remove the row, or
            wait for Phase 2c.
          </div>
        </div>
      )
    }
    if (status.reason === 'misconfigured') {
      return (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4 text-sm text-amber-200">
          <div className="font-semibold">Credentials misconfigured</div>
          <div className="mt-1 text-xs text-white/70">
            {status.detail ??
              'Disconnect and reconnect with valid testnet credentials.'}
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-white/[0.08] bg-surface p-4 text-sm text-white/70">
        <div className="font-semibold text-white">
          Not connected · using mock client
        </div>
        <div className="mt-1 text-xs text-white/55">
          Live deployments use an in-memory mock exchange. Connect a
          Hyperliquid testnet API wallet below to place real orders on
          testnet.
        </div>
      </div>
    )
  }

  function connectedDetail() {
    if (!status.connected) return null
    return (
      <section className="mt-4 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Connection
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              Network
            </dt>
            <dd className="mt-1 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
              Testnet
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              Account balance (USD)
            </dt>
            <dd className="mt-1 font-mono text-white/90">
              {formatUsd(status.balance_usd)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              API wallet
            </dt>
            <dd className="mt-1 font-mono text-xs text-white/85" title={status.api_wallet_address}>
              {shortAddress(status.api_wallet_address)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              Master account
            </dt>
            <dd className="mt-1 font-mono text-xs text-white/85" title={status.master_account_address}>
              {shortAddress(status.master_account_address)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              Open positions
            </dt>
            <dd className="mt-1 font-mono text-white/85">
              {status.open_position_count}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              Open orders
            </dt>
            <dd className="mt-1 font-mono text-white/85">
              {status.open_order_count}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="w-auto border border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null)
                const r = await disconnectExchangeAction()
                if (!r.ok) setError(r.message)
                else
                  setStatus({ connected: false, reason: 'no_credentials' })
              })
            }
          >
            Disconnect
          </Button>
        </div>
      </section>
    )
  }

  function connectForm() {
    if (status.connected) return null
    return (
      <form
        className="mt-4 flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          startTransition(async () => {
            const r = await connectExchangeAction({
              api_wallet_private_key: apiWalletKey,
              api_wallet_address: apiWalletAddress,
              master_account_address: masterAddress,
              network: 'testnet',
            })
            if (!r.ok) {
              setError(r.message)
              return
            }
            // Surface the freshly connected state without an
            // extra round-trip. The next render will replace this
            // with the live probe data.
            setStatus({
              connected: true,
              network: 'testnet',
              api_wallet_address: apiWalletAddress.toLowerCase(),
              master_account_address: masterAddress.toLowerCase(),
              balance_usd: 0,
              open_position_count: 0,
              open_order_count: 0,
            })
            setApiWalletKey('')
          })
        }}
      >
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
          Connect to Hyperliquid testnet
        </h2>
        <Input
          label="API wallet private key (0x + 64 hex)"
          type="password"
          autoComplete="off"
          value={apiWalletKey}
          onChange={(e) => setApiWalletKey(e.target.value)}
        />
        <Input
          label="API wallet address (0x + 40 hex)"
          autoComplete="off"
          value={apiWalletAddress}
          onChange={(e) => setApiWalletAddress(e.target.value)}
        />
        <Input
          label="Master account address (0x + 40 hex)"
          autoComplete="off"
          value={masterAddress}
          onChange={(e) => setMasterAddress(e.target.value)}
        />
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Network
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-200"
              aria-pressed
            >
              Testnet
            </button>
            <button
              type="button"
              disabled
              title="Mainnet enables in Phase 2c"
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/35"
            >
              Mainnet (Phase 2c)
            </button>
          </div>
        </div>
        <p className="text-[11px] text-white/55">
          On submit we probe the testnet API with these credentials before
          persisting anything. The private key is encrypted via Supabase
          Vault; only the masked preview is ever sent back to the browser.
        </p>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isPending}
            className="w-auto"
          >
            {isPending ? 'Validating…' : 'Connect to Hyperliquid testnet'}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {statusBanner()}
      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      {connectForm()}
      {connectedDetail()}
    </div>
  )
}
