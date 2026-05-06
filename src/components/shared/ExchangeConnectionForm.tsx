'use client'

import { useState, useTransition } from 'react'

import {
  connectExchangeAction,
  disconnectExchangeAction,
  type ExchangeStatus,
} from '@/app/actions/exchange-credentials'
import { SafetyLimitsPanel } from '@/components/shared/SafetyLimitsPanel'
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

// Hyperliquid's userAbstraction values are camelCase enum
// strings; map each to a short display label so the connected-
// state UI does not just read 'unifiedAccount' verbatim.
function abstractionModeLabel(
  mode:
    | 'default'
    | 'disabled'
    | 'unifiedAccount'
    | 'portfolioMargin'
    | 'dexAbstraction'
    | 'mock',
): string {
  switch (mode) {
    case 'default':
      return 'Standard (default)'
    case 'disabled':
      return 'Standard (abstraction disabled)'
    case 'unifiedAccount':
      return 'Unified Account'
    case 'portfolioMargin':
      return 'Portfolio Margin'
    case 'dexAbstraction':
      return 'HIP-3 DEX Abstraction'
    case 'mock':
      return 'Mock client'
  }
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
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet')
  const [mainnetAcknowledged, setMainnetAcknowledged] = useState(false)

  const submitDisabled =
    isPending || (network === 'mainnet' && !mainnetAcknowledged)

  function statusBanner() {
    if (status.connected) {
      const isMainnet = status.network === 'mainnet'
      return (
        <div
          className={
            isMainnet
              ? 'rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4 text-sm text-red-200'
              : 'rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] p-4 text-sm text-emerald-200'
          }
        >
          <div className="font-semibold">
            Connected to Hyperliquid {isMainnet ? 'mainnet' : 'testnet'}
          </div>
          <div className="mt-1 text-xs text-white/70">
            {isMainnet
              ? 'Live deployments place real orders with real funds. Hardcoded safety caps still apply.'
              : 'Live deployments will route real orders through this API wallet on testnet.'}
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
              'Disconnect and reconnect with valid credentials.'}
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
          Hyperliquid API wallet below to place real orders.
        </div>
      </div>
    )
  }

  function connectedDetail() {
    if (!status.connected) return null
    const isMainnet = status.network === 'mainnet'
    return (
      <>
        <section className="mt-4 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
            Connection
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/45">
                Network
              </dt>
              <dd
                className={
                  isMainnet
                    ? 'mt-1 inline-flex rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-red-200'
                    : 'mt-1 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200'
                }
              >
                {isMainnet ? 'Mainnet' : 'Testnet'}
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
              <dd
                className="mt-1 font-mono text-xs text-white/85"
                title={status.api_wallet_address}
              >
                {shortAddress(status.api_wallet_address)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/45">
                Master account
              </dt>
              <dd
                className="mt-1 font-mono text-xs text-white/85"
                title={status.master_account_address}
              >
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
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/45">
                Account mode
              </dt>
              <dd className="mt-1 text-xs text-white/85">
                {abstractionModeLabel(status.abstraction_mode)}
                {status.abstraction_mode === 'unifiedAccount' ||
                status.abstraction_mode === 'portfolioMargin' ? (
                  <span
                    className="ml-2 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55"
                    title="Balance is read from the spot clearinghouse for this mode."
                  >
                    spot balance
                  </span>
                ) : null}
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
        <div className="mt-4">
          <SafetyLimitsPanel
            tone={isMainnet ? 'red' : 'amber'}
            subtitle={
              isMainnet
                ? 'Hardcoded floor enforced before every order placed on mainnet. Cannot be raised without a redeploy.'
                : 'Hardcoded floor enforced before every order. Same limits apply on mainnet.'
            }
          />
        </div>
      </>
    )
  }

  function connectForm() {
    if (status.connected) return null
    const showMainnetWarning = network === 'mainnet'
    return (
      <form
        className="mt-4 flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          if (network === 'mainnet' && !mainnetAcknowledged) {
            setError(
              'Tick the acknowledgement checkbox before connecting to mainnet.',
            )
            return
          }
          startTransition(async () => {
            const r = await connectExchangeAction({
              api_wallet_private_key: apiWalletKey,
              api_wallet_address: apiWalletAddress,
              master_account_address: masterAddress,
              network,
              mainnet_acknowledged: mainnetAcknowledged,
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
              network,
              api_wallet_address: apiWalletAddress.toLowerCase(),
              master_account_address: masterAddress.toLowerCase(),
              balance_usd: 0,
              open_position_count: 0,
              open_order_count: 0,
              // Optimistic placeholder; the next page render
              // replaces it with the real mode from the probe.
              abstraction_mode: 'default',
            })
            setApiWalletKey('')
            setMainnetAcknowledged(false)
          })
        }}
      >
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
          Connect to Hyperliquid
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
              onClick={() => {
                setNetwork('testnet')
                setMainnetAcknowledged(false)
              }}
              aria-pressed={network === 'testnet'}
              className={
                network === 'testnet'
                  ? 'rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-200'
                  : 'rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/55 hover:border-white/20 hover:text-white'
              }
            >
              Testnet
            </button>
            <button
              type="button"
              onClick={() => setNetwork('mainnet')}
              aria-pressed={network === 'mainnet'}
              className={
                network === 'mainnet'
                  ? 'rounded-full border border-red-500/50 bg-red-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-red-200'
                  : 'rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/55 hover:border-red-500/40 hover:text-red-300'
              }
            >
              Mainnet
            </button>
          </div>
        </div>

        {showMainnetWarning ? (
          <>
            <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4 text-sm text-red-200">
              <div className="font-semibold">
                Mainnet places real orders with real funds.
              </div>
              <p className="mt-2 text-xs text-white/80">
                Hardcoded safety caps are enforced before every order:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/75">
                <li>Max £100 (≈ $130) notional per trade</li>
                <li>Max £3 risk per trade</li>
                <li>Max £15 cumulative loss in any rolling 24h window</li>
                <li>Max 1 concurrent open position tenant-wide</li>
                <li>
                  First 5 trades require explicit per-trade confirmation
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-white/60">
                These are code constants in src/lib/live/safety-limits.ts and
                cannot be changed without a redeploy.
              </p>
            </div>
            <SafetyLimitsPanel
              tone="red"
              subtitle="These caps apply to every order routed through mainnet."
            />
            <label className="flex items-start gap-2 text-xs text-white/85">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={mainnetAcknowledged}
                onChange={(e) => setMainnetAcknowledged(e.target.checked)}
              />
              <span>
                I understand this places real orders with real funds and
                have read the safety limits above.
              </span>
            </label>
          </>
        ) : null}

        <p className="text-[11px] text-white/55">
          On submit we probe the {network} API with these credentials before
          persisting anything. The private key is encrypted via Supabase
          Vault; only the masked preview is ever sent back to the browser.
        </p>
        <div className="flex justify-end">
          <Button type="submit" disabled={submitDisabled} className="w-auto">
            {isPending
              ? 'Validating…'
              : `Connect to Hyperliquid ${network === 'mainnet' ? 'mainnet' : 'testnet'}`}
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
