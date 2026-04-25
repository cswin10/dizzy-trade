// Deno runtime Telegram notifier. Opt-in via env: if the token or chat
// id are unset we return false and skip the notification, so a
// partially-configured deployment still runs cleanly.

export type TelegramAlertPayload = {
  framework_name: string
  symbol: string
  direction: 'long' | 'short'
  entry: number
  stop: number
  target: number
  funding: number
  oiDeltaPct: number
  appUrl: string
  positionSizeCoin?: number | null
  positionSizeUsd?: number | null
  leverageImplied?: number | null
  riskAmountGbp?: number | null
  validUntil?: Date | null
  timeframe?: '15m' | '1h' | '4h' | '1d' | null
}

function pct(x: number, digits = 2): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
}

function priceDiffPct(from: number, to: number): string {
  if (!Number.isFinite(from) || from === 0) return '-'
  return `${((Math.abs(to - from) / from) * 100).toFixed(2)}%`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1')
}

function rrLabel(entry: number, stop: number, target: number): string {
  const risk = Math.abs(entry - stop)
  if (risk <= 0) return ''
  const reward = Math.abs(target - entry)
  const ratio = reward / risk
  if (!Number.isFinite(ratio) || ratio <= 0) return ''
  return `1:${ratio.toFixed(1)} RR`
}

function formatCoin(value: number, symbol: string): string {
  const abs = Math.abs(value)
  let decimals: number
  if (abs >= 1000) decimals = 0
  else if (abs >= 1) decimals = 4
  else if (abs >= 0.01) decimals = 2
  else decimals = 0
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${symbol}`
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatValidUntil(validUntil: Date, timeframe: string | null): string {
  const hh = String(validUntil.getUTCHours()).padStart(2, '0')
  const mm = String(validUntil.getUTCMinutes()).padStart(2, '0')
  const tfLabel = timeframe ? ` (next ${timeframe} close)` : ''
  return `${hh}:${mm} UTC${tfLabel}`
}

export function formatAlertMessage(alert: TelegramAlertPayload): string {
  const dirLabel = alert.direction.toUpperCase()
  const fundingLabel = pct(alert.funding, 3)
  const oiLabel = `${alert.oiDeltaPct >= 0 ? '+' : ''}${alert.oiDeltaPct.toFixed(0)}% vs 24h avg`

  const stopLine = (() => {
    const distancePct = priceDiffPct(alert.entry, alert.stop)
    const riskTail =
      alert.riskAmountGbp != null && alert.riskAmountGbp > 0
        ? ` / £${alert.riskAmountGbp.toFixed(0)} risk`
        : ''
    return `Stop: ${alert.stop.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${distancePct}${riskTail})`
  })()

  const targetLine = (() => {
    const rr = rrLabel(alert.entry, alert.stop, alert.target)
    const tail = rr ? ` (${rr})` : ''
    return `Target: ${alert.target.toLocaleString(undefined, { maximumFractionDigits: 6 })}${tail}`
  })()

  const lines: string[] = [
    `🚨 *${escapeMarkdown(alert.framework_name)}* — *${escapeMarkdown(alert.symbol)}*`,
    `Direction: *${dirLabel}*`,
    `Entry: ${alert.entry.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
    stopLine,
    targetLine,
    `Funding: ${fundingLabel} | OI: ${oiLabel}`,
  ]

  if (
    alert.positionSizeCoin != null &&
    alert.positionSizeUsd != null &&
    alert.positionSizeCoin > 0
  ) {
    lines.push('')
    lines.push(
      `Position: ${formatCoin(alert.positionSizeCoin, alert.symbol)} (${formatUsd(alert.positionSizeUsd)})`,
    )
    if (alert.leverageImplied != null && alert.leverageImplied > 0) {
      const lev = Math.round(alert.leverageImplied)
      const warn = lev > 100 ? ' ⚠️ HIGH LEVERAGE' : ''
      lines.push(`Leverage: ${lev}x${warn}`)
    }
  }

  if (alert.validUntil) {
    lines.push('')
    lines.push(
      `Valid until: ${formatValidUntil(alert.validUntil, alert.timeframe ?? null)}`,
    )
  }

  lines.push('')
  lines.push(`View in Dizzy Trade: ${alert.appUrl}`)

  return lines.join('\n')
}

export async function sendTelegramAlert(
  alert: TelegramAlertPayload,
): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) {
    console.warn('[telegram] not configured, skipping notification')
    return false
  }

  const text = formatAlertMessage(alert)
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      console.error(
        `[telegram] send failed ${response.status}: ${body.slice(0, 200)}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error('[telegram] send errored:', error)
    return false
  }
}
