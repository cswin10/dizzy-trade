import { ema, sma } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'candle_close_above'

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
