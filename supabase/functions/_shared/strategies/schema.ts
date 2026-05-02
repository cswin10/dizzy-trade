// Schema-side stub for the Deno scanner runtime.
//
// The Node version (src/lib/strategies/schema.ts) holds zod schemas
// for every condition / stop / target / sizing rule and exposes a
// validateStrategyDefinition entry point used by the application
// actions. The scanner runs on rows that have already been
// validated upstream, so we can avoid pulling zod into the Edge
// Function bundle by stubbing the same surface here without
// runtime validation.
//
// API parity with the Node version is preserved so condition and
// exit-rule files compile unmodified: registerXxxSchema accepts
// any value and stores it in a registry that nothing reads at
// scanner runtime. validateStrategyDefinition is a typed cast.

import type {
  Condition,
  SizingRule,
  StopRule,
  StrategyDefinition,
  TargetRule,
} from './types.ts'

const conditionSchemaRegistry = new Map<string, unknown>()
const stopRuleSchemaRegistry = new Map<string, unknown>()
const targetRuleSchemaRegistry = new Map<string, unknown>()
const sizingRuleSchemaRegistry = new Map<string, unknown>()

export function registerConditionSchema(type: string, schema: unknown): void {
  conditionSchemaRegistry.set(type, schema)
}

export function registerStopRuleSchema(type: string, schema: unknown): void {
  stopRuleSchemaRegistry.set(type, schema)
}

export function registerTargetRuleSchema(type: string, schema: unknown): void {
  targetRuleSchemaRegistry.set(type, schema)
}

export function registerSizingRuleSchema(type: string, schema: unknown): void {
  sizingRuleSchemaRegistry.set(type, schema)
}

export function getRegisteredConditionTypes(): string[] {
  return Array.from(conditionSchemaRegistry.keys())
}

// Trusted-input cast. The Node action layer is responsible for
// validating definitions before they hit the database; the scanner
// reads only validated rows and so does not re-run validation.
export function validateStrategyDefinition(raw: unknown): StrategyDefinition {
  return raw as StrategyDefinition
}

// Suppress unused-binding warnings on the rule registries; they
// exist for API parity with the Node version even though the
// scanner never inspects them.
void stopRuleSchemaRegistry
void targetRuleSchemaRegistry
void sizingRuleSchemaRegistry

// Type re-exports are dropped here on purpose: the bundler used
// for the Edge Function deploy strips export keywords during
// concatenation, which would leave a dangling type re-export
// list at module scope. Callers import these types directly
// from ./types.ts.
