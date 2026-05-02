import { registerStopEvaluator } from '../evaluator.ts'
import type { StopRule } from '../types.ts'

const TYPE = 'recent_swing'
const DEFAULT_BUFFER_PCT = 0.2

registerStopEvaluator(TYPE, (rule, context, direction, entryPrice) => {
  if (rule.type !== TYPE) {
    throw new Error(`recent_swing stop received wrong rule type ${rule.type}`)
  }
  const buffer = (rule.buffer_pct ?? DEFAULT_BUFFER_PCT) / 100
  const window = context.candles.slice(-rule.lookback_candles)
  if (window.length === 0) {
    return direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01
  }
  if (direction === 'long') {
    let lowest = Infinity
    for (const c of window) if (c.l < lowest) lowest = c.l
    if (!Number.isFinite(lowest) || lowest <= 0) return entryPrice * 0.99
    return lowest * (1 - buffer)
  }
  let highest = -Infinity
  for (const c of window) if (c.h > highest) highest = c.h
  if (!Number.isFinite(highest)) return entryPrice * 1.01
  return highest * (1 + buffer)
})
