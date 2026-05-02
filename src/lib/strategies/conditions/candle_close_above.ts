import { z } from 'zod'

import { ema, sma } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'candle_close_above'

export const candleCloseAboveSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z
    .object({
      reference: z.enum(['previous_high', 'previous_close', 'sma', 'ema']),
      sma_period: z.coerce.number().int().min(2).max(1000).optional(),
      ema_period: z.coerce.number().int().min(2).max(1000).optional(),
    })
    .refine(
      (p) =>
        (p.reference === 'sma' && p.sma_period !== undefined) ||
        (p.reference === 'ema' && p.ema_period !== undefined) ||
        p.reference === 'previous_high' ||
        p.reference === 'previous_close',
      'sma reference needs sma_period; ema reference needs ema_period',
    ),
})

registerConditionSchema(TYPE, candleCloseAboveSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    reference: 'previous_high' | 'previous_close' | 'sma' | 'ema'
    sma_period?: number
    ema_period?: number
  }
  const candles = context.candles
  if (candles.length < 2) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  let reference: number = NaN
  switch (params.reference) {
    case 'previous_high':
      reference = candles[candles.length - 2]!.h
      break
    case 'previous_close':
      reference = candles[candles.length - 2]!.c
      break
    case 'sma':
      reference = sma(
        candles.map((c) => c.c),
        params.sma_period!,
      )
      break
    case 'ema':
      reference = ema(
        candles.map((c) => c.c),
        params.ema_period!,
      )
      break
  }
  if (!Number.isFinite(reference)) {
    return { passed: false, values: { reference, reason: 'no reference' } }
  }
  const close = context.currentPrice
  return {
    passed: close > reference,
    values: { reference, close },
  }
})
