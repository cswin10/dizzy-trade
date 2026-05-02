import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import {
  CONDITION_DESCRIPTOR_BY_TYPE,
  SIZING_RULE_DESCRIPTORS,
  STOP_RULE_DESCRIPTORS,
  TARGET_RULE_DESCRIPTORS,
} from '@/lib/strategies/condition-ui-descriptors'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Strategy · Dizzy Trade',
}

export default async function StrategyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: row, error } = await supabase
    .from('strategy_definitions')
    .select('*')
    .eq('id', params.id)
    .single()
  if (error || !row) notFound()
  const definition = row.definition as unknown as StrategyDefinition

  return (
    <PageContainer>
      <PageHeader
        title={row.name}
        subtitle={
          row.description ?? `${definition.direction} · ${row.timeframe}`
        }
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/backtest/new?strategy_definition_id=${row.id}`}
              className="contents"
            >
              <Button variant="ghost" className="w-auto">
                Backtest this strategy
              </Button>
            </Link>
            <Link
              href={`/settings/strategies/${row.id}/edit`}
              className="contents"
            >
              <Button className="w-auto">Edit</Button>
            </Link>
            <Link href="/settings/strategies" className="contents">
              <Button variant="ghost" className="w-auto">
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryPanel title="Configuration">
          <KV label="Status" value={row.is_active ? 'Active' : 'Inactive'} />
          <KV label="Timeframe" value={row.timeframe} />
          <KV label="Pairs" value={(row.pairs ?? []).join(', ') || '—'} />
          <KV
            label="Max concurrent positions"
            value={String(row.max_concurrent_positions)}
          />
          <KV
            label="Max daily loss"
            value={
              row.max_daily_loss_gbp == null
                ? 'Not set'
                : `£${Number(row.max_daily_loss_gbp).toFixed(0)}`
            }
          />
          <KV
            label="Max consecutive losers"
            value={
              row.max_consecutive_losers == null
                ? 'Not set'
                : String(row.max_consecutive_losers)
            }
          />
        </SummaryPanel>

        <SummaryPanel title="Exit and sizing">
          <KV
            label="Stop"
            value={describeRule(definition.exit.stop, STOP_RULE_DESCRIPTORS)}
          />
          <KV
            label="Target"
            value={describeRule(
              definition.exit.target,
              TARGET_RULE_DESCRIPTORS,
            )}
          />
          <KV
            label="Timeout"
            value={
              definition.exit.timeout_candles == null
                ? 'No timeout'
                : `${definition.exit.timeout_candles} candles`
            }
          />
          <KV
            label="Sizing"
            value={describeRule(definition.sizing, SIZING_RULE_DESCRIPTORS)}
          />
        </SummaryPanel>
      </div>

      <SummaryPanel title="Entry conditions" className="mt-4">
        <ol className="flex flex-col gap-3 text-sm text-white/85">
          {definition.entry.groups.map((group, gi) => (
            <li
              key={gi}
              className="rounded-md border border-white/[0.06] bg-surface-2 p-3"
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-white/55">
                <span>Group {gi + 1}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/65">
                  {group.direction}
                </span>
              </div>
              {group.conditions.length === 0 ? (
                <p className="text-xs text-white/45">
                  Always-true group (no conditions configured).
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-xs">
                  {group.conditions.map((c, ci) => {
                    const descriptor = CONDITION_DESCRIPTOR_BY_TYPE.get(c.type)
                    return (
                      <li
                        key={ci}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-white">
                          {descriptor?.title ?? c.type}
                        </span>
                        <span className="font-mono text-[10px] text-white/45">
                          {Object.entries(c.params)
                            .map(([k, v]) => `${k}=${formatParamValue(v)}`)
                            .join(' · ') || 'no params'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </SummaryPanel>

      <details className="mt-4 rounded-lg border border-white/[0.06] bg-surface p-4">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-white/55">
          Raw JSON
        </summary>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-white/65">
          {JSON.stringify(definition, null, 2)}
        </pre>
      </details>
    </PageContainer>
  )
}

function SummaryPanel({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-white/[0.06] bg-surface p-4 ${className ?? ''}`}
    >
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
        {title}
      </h2>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">{children}</dl>
    </section>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/45">{label}</dt>
      <dd className="text-right font-mono text-white/85">{value}</dd>
    </>
  )
}

function describeRule(
  rule: { type: string } & Record<string, unknown>,
  descriptors: Array<{ type: string; title: string }>,
): string {
  const descriptor = descriptors.find((d) => d.type === rule.type)
  const fields = Object.entries(rule)
    .filter(([k]) => k !== 'type')
    .map(([k, v]) => `${k}=${formatParamValue(v)}`)
  const tail = fields.length === 0 ? '' : ` (${fields.join(', ')})`
  return `${descriptor?.title ?? rule.type}${tail}`
}

function formatParamValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.join(',')}]`
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(4).replace(/\.?0+$/, '')
  }
  return String(value)
}
