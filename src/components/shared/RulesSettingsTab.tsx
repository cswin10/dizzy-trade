import {
  RulesStatusPanel,
  type RulesLiveState,
} from '@/components/shared/RulesStatusPanel'
import { Panel } from '@/components/ui/Panel'

export type RulesSettingsTabProps = {
  tenantId: string | null
  strategy: {
    name: string
    max_concurrent_positions: number
    max_daily_loss_gbp: number | null
    risk_amount_gbp: number
    min_rr: number
    max_consecutive_losers: number | null
  } | null
  initialState: RulesLiveState
}

// Settings → Rules tab. The rules themselves live on the active
// strategy and are edited under Settings → Strategies; this tab
// renders a read-only summary so the operator can see what is
// currently in force, plus the live status panel that shows whether
// they can take a new trade right now.
export function RulesSettingsTab({
  tenantId,
  strategy,
  initialState,
}: RulesSettingsTabProps) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel
        title={strategy ? `Active rules (${strategy.name})` : 'Active rules'}
      >
        {strategy ? (
          <ul className="flex flex-col gap-2 text-sm text-white/80">
            <RuleLine
              label="Max concurrent positions"
              value={String(strategy.max_concurrent_positions)}
            />
            <RuleLine
              label="Max daily loss"
              value={
                strategy.max_daily_loss_gbp != null
                  ? `£${Number(strategy.max_daily_loss_gbp).toFixed(0)}`
                  : 'Not set'
              }
            />
            <RuleLine
              label="Risk per trade"
              value={`£${Number(strategy.risk_amount_gbp).toFixed(0)}`}
            />
            <RuleLine
              label="Minimum RR"
              value={`${Number(strategy.min_rr).toFixed(1)}:1`}
            />
            <RuleLine
              label="Max consecutive losers"
              value={
                strategy.max_consecutive_losers != null
                  ? `${strategy.max_consecutive_losers} (24h cool-down)`
                  : 'Not set'
              }
            />
          </ul>
        ) : (
          <p className="py-3 text-sm text-white/45">
            No active strategy. Activate one under Strategies to enable rule
            enforcement.
          </p>
        )}
        <p className="mt-4 text-xs text-white/35">
          Edit these values under Strategies.
        </p>
      </Panel>

      {tenantId && strategy ? (
        <RulesStatusPanel
          tenantId={tenantId}
          initial={initialState}
          limits={{
            max_concurrent_positions: strategy.max_concurrent_positions,
            max_daily_loss_gbp:
              strategy.max_daily_loss_gbp == null
                ? null
                : Number(strategy.max_daily_loss_gbp),
            max_consecutive_losers: strategy.max_consecutive_losers,
          }}
        />
      ) : (
        <Panel title="Live status">
          <p className="py-3 text-sm text-white/45">
            Live status appears here once a strategy is active.
          </p>
        </Panel>
      )}
    </div>
  )
}

function RuleLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2 last:border-0">
      <span className="text-white/55">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </li>
  )
}
