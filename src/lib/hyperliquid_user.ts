// Hyperliquid per-account read API.
//
// Hyperliquid exposes positions and fills publicly given an account
// address: no auth, no signing. v1 of the position tracker is
// therefore read-only, and the only piece of user-supplied state we
// need is the main account address.
//
// When v1.1 introduces trade execution, an API wallet (a separate
// authorised key) is layered on top of this client; for now both
// functions hit the public `info` endpoint.
//
// Kept in lockstep with supabase/functions/_shared/hyperliquid_user.ts:
// same shapes, same retry semantics, same timeouts. If you touch one,
// touch the other.

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const REQUEST_TIMEOUT_MS = 10_000

export type HyperliquidPosition = {
  coin: string
  szi: number
  entryPx: number | null
  positionValue: number | null
  unrealizedPnl: number | null
  liquidationPx: number | null
}

export type HyperliquidUserState = {
  positions: HyperliquidPosition[]
}

export type HyperliquidFillDir =
  | 'Open Long'
  | 'Close Long'
  | 'Open Short'
  | 'Close Short'

export type HyperliquidFill = {
  coin: string
  px: number
  sz: number
  side: 'A' | 'B'
  time: number
  dir: HyperliquidFillDir | string
  closedPnl: number | null
}

type RawAssetPosition = {
  position?: {
    coin?: string
    szi?: string | number
    entryPx?: string | number
    positionValue?: string | number
    unrealizedPnl?: string | number
    liquidationPx?: string | number | null
  }
}

type RawUserState = {
  assetPositions?: RawAssetPosition[]
}

type RawFill = {
  coin?: string
  px?: string | number
  sz?: string | number
  side?: string
  time?: number
  dir?: string
  closedPnl?: string | number | null
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function requireNumber(value: string | number | null | undefined): number {
  return toNumber(value) ?? 0
}

async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Hyperliquid ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await once()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[hyperliquid_user] first attempt failed: ${message}`)
    return await once()
  }
}

/**
 * Returns the open positions and account summary for a Hyperliquid
 * main address. Throws after two failed attempts.
 */
export async function getUserState(
  mainAddress: string,
): Promise<HyperliquidUserState> {
  const raw = await postInfo<RawUserState>({
    type: 'clearinghouseState',
    user: mainAddress,
  })
  const positions: HyperliquidPosition[] = []
  for (const entry of raw.assetPositions ?? []) {
    const p = entry.position
    if (!p || !p.coin) continue
    const szi = toNumber(p.szi) ?? 0
    if (szi === 0) continue
    positions.push({
      coin: String(p.coin),
      szi,
      entryPx: toNumber(p.entryPx),
      positionValue: toNumber(p.positionValue),
      unrealizedPnl: toNumber(p.unrealizedPnl),
      liquidationPx: toNumber(p.liquidationPx ?? null),
    })
  }
  return { positions }
}

/**
 * Returns completed fills for a Hyperliquid main address. Optionally
 * filtered to fills at or after `startTime` (Unix milliseconds).
 */
export async function getUserFills(
  mainAddress: string,
  startTime?: number,
): Promise<HyperliquidFill[]> {
  const body: Record<string, unknown> = startTime
    ? {
        type: 'userFillsByTime',
        user: mainAddress,
        startTime,
      }
    : {
        type: 'userFills',
        user: mainAddress,
      }
  const raw = await postInfo<RawFill[]>(body)
  return (raw ?? []).map((row) => ({
    coin: String(row.coin ?? ''),
    px: requireNumber(row.px),
    sz: requireNumber(row.sz),
    side: row.side === 'A' || row.side === 'B' ? row.side : 'A',
    time: typeof row.time === 'number' ? row.time : 0,
    dir: String(row.dir ?? ''),
    closedPnl: toNumber(row.closedPnl ?? null),
  }))
}
