// One-call registration entry point. Mirrors
// src/lib/strategies/register.ts. Importing this module side-
// effect-imports every condition and exit-rule index so the
// registries are populated by the time evaluator.ts runs.

import './conditions/index.ts'
import './exit-rules/index.ts'

let registered = false

export function registerAllStrategyComponents(): void {
  registered = true
}

export function areStrategyComponentsRegistered(): boolean {
  return registered
}

registerAllStrategyComponents()
