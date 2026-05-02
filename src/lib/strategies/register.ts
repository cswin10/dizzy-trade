// One-call registration entry point. Importing this module pulls
// in every condition and exit-rule index so that, by the time any
// caller imports the evaluator, every registry is fully populated.
//
// The evaluator module imports this file at module load, so callers
// of evaluateStrategy / validateStrategyDefinition do not need to
// remember to import anything else.

import './conditions'
import './exit-rules'

let registered = false

// Idempotent. Calling this directly is harmless; the side-effect
// imports above already do the work the first time the module
// loads. The function exists so callers that want an explicit
// "make sure the registries are populated" line can have one.
export function registerAllStrategyComponents(): void {
  registered = true
}

export function areStrategyComponentsRegistered(): boolean {
  return registered
}

// Auto-mark on first import. Subsequent registers stay no-ops.
registerAllStrategyComponents()
