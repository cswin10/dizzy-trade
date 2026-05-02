// Zod validation for strategy definitions.
//
// Conditions, stop rules, target rules, and sizing rules each go
// through a registry of per-type validators. The strategy
// composer's job is to write a Condition (or rule) implementation,
// register its zod schema here and its evaluator in evaluator.ts;
// the core does not need to change.
//
// validateStrategyDefinition is the single entry point used by the
// server actions. It produces clear, path-prefixed error messages
// so the UI can highlight the offending field.

import { z } from 'zod'

import type {
  Condition,
  SizingRule,
  StopRule,
  StrategyDefinition,
  TargetRule,
} from './types'

// --- Registries -------------------------------------------------

const conditionSchemaRegistry = new Map<string, z.ZodType<Condition>>()
const stopRuleSchemaRegistry = new Map<string, z.ZodType<StopRule>>()
const targetRuleSchemaRegistry = new Map<string, z.ZodType<TargetRule>>()
const sizingRuleSchemaRegistry = new Map<string, z.ZodType<SizingRule>>()

export function registerConditionSchema(
  type: string,
  schema: z.ZodType<Condition>,
): void {
  conditionSchemaRegistry.set(type, schema)
}

export function registerStopRuleSchema(
  type: string,
  schema: z.ZodType<StopRule>,
): void {
  stopRuleSchemaRegistry.set(type, schema)
}

export function registerTargetRuleSchema(
  type: string,
  schema: z.ZodType<TargetRule>,
): void {
  targetRuleSchemaRegistry.set(type, schema)
}

export function registerSizingRuleSchema(
  type: string,
  schema: z.ZodType<SizingRule>,
): void {
  sizingRuleSchemaRegistry.set(type, schema)
}

export function getRegisteredConditionTypes(): string[] {
  return Array.from(conditionSchemaRegistry.keys())
}

// --- Built-in rule schemas --------------------------------------

// The simplest stop and target rules are registered here so the
// engine can produce a working entry/stop/target for the
// stub-strategy fixture without depending on the (forthcoming)
// condition library prompt. Anything more elaborate (ATR-based
// stops, swing-anchored stops, the full condition library) lives
// in its own module and registers itself via the helpers above.

const fixedPctStopSchema: z.ZodType<StopRule> = z.object({
  type: z.literal('fixed_pct'),
  pct: z.coerce.number().positive('Stop pct must be greater than zero'),
})
registerStopRuleSchema('fixed_pct', fixedPctStopSchema)

const fixedPctTargetSchema: z.ZodType<TargetRule> = z.object({
  type: z.literal('fixed_pct'),
  pct: z.coerce.number().positive('Target pct must be greater than zero'),
})
registerTargetRuleSchema('fixed_pct', fixedPctTargetSchema)

const fixedRrTargetSchema: z.ZodType<TargetRule> = z.object({
  type: z.literal('fixed_rr'),
  rr: z.coerce.number().positive('R:R must be greater than zero'),
})
registerTargetRuleSchema('fixed_rr', fixedRrTargetSchema)

const fixedGbpRiskSizingSchema: z.ZodType<SizingRule> = z.object({
  type: z.literal('fixed_gbp_risk'),
  amount: z.coerce.number().positive('Risk amount must be greater than zero'),
})
registerSizingRuleSchema('fixed_gbp_risk', fixedGbpRiskSizingSchema)

const fixedPositionSizeSizingSchema: z.ZodType<SizingRule> = z.object({
  type: z.literal('fixed_position_size'),
  size: z.coerce.number().positive('Size must be greater than zero'),
})
registerSizingRuleSchema('fixed_position_size', fixedPositionSizeSizingSchema)

// --- Validation -------------------------------------------------

class ValidationError extends Error {
  constructor(
    public path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'StrategyValidationError'
  }
}

function dispatchByType<T>(
  registry: Map<string, z.ZodType<T>>,
  raw: unknown,
  path: string,
  kind: string,
): T {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError(path, `${kind} must be an object`)
  }
  const t = (raw as { type?: unknown }).type
  if (typeof t !== 'string' || t.length === 0) {
    throw new ValidationError(`${path}.type`, `${kind} type is required`)
  }
  const schema = registry.get(t)
  if (!schema) {
    throw new ValidationError(
      `${path}.type`,
      `unknown ${kind} type "${t}" (registered: ${
        Array.from(registry.keys()).join(', ') || 'none'
      })`,
    )
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const subPath = issue?.path.join('.') ?? ''
    const fullPath = subPath ? `${path}.${subPath}` : path
    throw new ValidationError(fullPath, issue?.message ?? `invalid ${kind}`)
  }
  return parsed.data
}

const baseConditionSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.unknown()).optional().default({}),
})

function validateCondition(raw: unknown, path: string): Condition {
  const base = baseConditionSchema.safeParse(raw)
  if (!base.success) {
    const issue = base.error.issues[0]
    throw new ValidationError(
      path,
      issue?.message ?? 'condition must have a type',
    )
  }
  const schema = conditionSchemaRegistry.get(base.data.type)
  if (!schema) {
    // 20a deliberately ships with no condition types registered.
    // Permit conditions to round-trip through validation as long
    // as their shape is { type, params? }; the evaluator will
    // refuse to run a condition with no registered evaluator at
    // execution time. This keeps validate -> save -> reload
    // working for in-progress strategies before 20b lands.
    return {
      type: base.data.type,
      params: base.data.params ?? {},
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const subPath = issue?.path.join('.') ?? ''
    const fullPath = subPath ? `${path}.${subPath}` : path
    throw new ValidationError(fullPath, issue?.message ?? 'invalid condition')
  }
  return parsed.data
}

const directionSchema = z.enum(['long_only', 'short_only', 'both'])
const groupDirectionSchema = z.enum(['long', 'short'])

export function validateStrategyDefinition(raw: unknown): StrategyDefinition {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('', 'strategy definition must be an object')
  }
  const obj = raw as Record<string, unknown>

  if (obj.schema_version !== 1) {
    throw new ValidationError(
      'schema_version',
      'only schema_version 1 is supported',
    )
  }

  const name = z
    .string()
    .trim()
    .min(1, 'name is required')
    .max(160, 'name too long')
    .safeParse(obj.name)
  if (!name.success) {
    throw new ValidationError(
      'name',
      name.error.issues[0]?.message ?? 'invalid name',
    )
  }
  const description =
    obj.description == null
      ? undefined
      : z.string().max(2000).parse(obj.description)

  const direction = directionSchema.safeParse(obj.direction)
  if (!direction.success) {
    throw new ValidationError(
      'direction',
      'direction must be one of long_only, short_only, both',
    )
  }

  const entry = obj.entry as { groups?: unknown } | undefined
  if (!entry || !Array.isArray(entry.groups) || entry.groups.length === 0) {
    throw new ValidationError(
      'entry.groups',
      'at least one entry group is required',
    )
  }
  const groups = entry.groups.map((rawGroup, gi) => {
    if (typeof rawGroup !== 'object' || rawGroup === null) {
      throw new ValidationError(
        `entry.groups[${gi}]`,
        'group must be an object',
      )
    }
    const g = rawGroup as Record<string, unknown>
    const dir = groupDirectionSchema.safeParse(g.direction)
    if (!dir.success) {
      throw new ValidationError(
        `entry.groups[${gi}].direction`,
        'direction must be long or short',
      )
    }
    if (!Array.isArray(g.conditions)) {
      throw new ValidationError(
        `entry.groups[${gi}].conditions`,
        'conditions must be an array',
      )
    }
    const conditions = g.conditions.map((cond, ci) =>
      validateCondition(cond, `entry.groups[${gi}].conditions[${ci}]`),
    )
    return { direction: dir.data, conditions }
  })

  // Cross-check: long_only / short_only strategies cannot mix group
  // directions. This catches a copy-paste error early.
  if (direction.data === 'long_only') {
    groups.forEach((g, i) => {
      if (g.direction !== 'long') {
        throw new ValidationError(
          `entry.groups[${i}].direction`,
          'long_only strategy cannot contain a short group',
        )
      }
    })
  } else if (direction.data === 'short_only') {
    groups.forEach((g, i) => {
      if (g.direction !== 'short') {
        throw new ValidationError(
          `entry.groups[${i}].direction`,
          'short_only strategy cannot contain a long group',
        )
      }
    })
  }

  const exit = obj.exit as
    | { stop?: unknown; target?: unknown; timeout_candles?: unknown }
    | undefined
  if (!exit) {
    throw new ValidationError('exit', 'exit block is required')
  }
  const stop = dispatchByType(
    stopRuleSchemaRegistry,
    exit.stop,
    'exit.stop',
    'stop',
  )
  const target = dispatchByType(
    targetRuleSchemaRegistry,
    exit.target,
    'exit.target',
    'target',
  )
  let timeoutCandles: number | undefined
  if (exit.timeout_candles !== undefined && exit.timeout_candles !== null) {
    const tc = z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .safeParse(exit.timeout_candles)
    if (!tc.success) {
      throw new ValidationError(
        'exit.timeout_candles',
        'timeout_candles must be a positive integer',
      )
    }
    timeoutCandles = tc.data
  }

  const sizing = dispatchByType(
    sizingRuleSchemaRegistry,
    obj.sizing,
    'sizing',
    'sizing',
  )

  const metadata =
    obj.metadata == null ? undefined : z.record(z.unknown()).parse(obj.metadata)

  return {
    schema_version: 1,
    name: name.data,
    description,
    direction: direction.data,
    entry: { groups },
    exit: {
      stop,
      target,
      ...(timeoutCandles !== undefined
        ? { timeout_candles: timeoutCandles }
        : {}),
    },
    sizing,
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

export type StrategyValidationOutcome =
  | { ok: true; parsed: StrategyDefinition }
  | { ok: false; errors: string[] }

// Wrapper for the validator that returns a discriminated result
// instead of throwing, so the UI can render multiple errors
// without a try/catch.
export function tryValidateStrategyDefinition(
  raw: unknown,
): StrategyValidationOutcome {
  try {
    const parsed = validateStrategyDefinition(raw)
    return { ok: true, parsed }
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, errors: [error.message] }
    }
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        errors: error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
      }
    }
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}
