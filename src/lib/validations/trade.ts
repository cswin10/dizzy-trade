import { z } from 'zod'

import { NARRATIVE_TAGS, SETUP_TYPES } from '@/lib/constants/trade'

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value))

const optionalPositiveNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || value === '') return undefined
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return Number.NaN
    return n
  })
  .refine(
    (value) => value === undefined || (value > 0 && Number.isFinite(value)),
    {
      message: 'Must be a positive number',
    },
  )

const optionalDate = z
  .union([z.string(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || value === '') return undefined
    const d = value instanceof Date ? value : new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  })

export const logTradeSchema = z
  .object({
    asset_symbol: z
      .string()
      .trim()
      .min(1, 'Asset is required')
      .max(20, 'Asset symbol must be 20 characters or fewer')
      .transform((s) => s.toUpperCase()),
    coingecko_id: optionalString,
    direction: z.enum(['long', 'short'], {
      errorMap: () => ({ message: 'Direction must be long or short' }),
    }),
    entry_price: z.coerce
      .number({ invalid_type_error: 'Entry price is required' })
      .positive('Entry price must be greater than zero'),
    entry_size: z.coerce
      .number({ invalid_type_error: 'Entry size is required' })
      .positive('Entry size must be greater than zero'),
    leverage: z.coerce
      .number({ invalid_type_error: 'Leverage must be a number' })
      .positive('Leverage must be greater than zero')
      .default(1),
    venue: z.string().trim().min(1, 'Venue is required'),
    narrative_tag: z.enum(NARRATIVE_TAGS, {
      errorMap: () => ({ message: 'Pick a narrative tag' }),
    }),
    setup_type: z
      .union([z.enum(SETUP_TYPES), z.literal('')])
      .optional()
      .transform((v) => (v === '' || v === undefined ? undefined : v)),
    thesis: optionalString.pipe(
      z
        .string()
        .max(2000, 'Thesis must be 2000 characters or fewer')
        .optional(),
    ),
    risk_amount_gbp: optionalPositiveNumber,
    entry_at: z.union([z.string(), z.date()]).transform((value) => {
      if (value === '' || value === undefined) return new Date()
      const d = value instanceof Date ? value : new Date(value)
      return Number.isNaN(d.getTime()) ? new Date() : d
    }),
    exit_price: optionalPositiveNumber,
    exit_size: optionalPositiveNumber,
    exit_at: optionalDate,
    lesson: optionalString,
    alert_id: z
      .string()
      .uuid('Invalid alert reference')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' || v === undefined ? undefined : v)),
  })
  .superRefine((value, ctx) => {
    const exitPriceSet = value.exit_price !== undefined
    const exitSizeSet = value.exit_size !== undefined
    if (exitPriceSet !== exitSizeSet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exit_price'],
        message: 'Exit price and exit size must be set together',
      })
    }
  })

export type LogTradeInput = z.infer<typeof logTradeSchema>

export const closeTradeSchema = z.object({
  trade_id: z.string().uuid('Missing trade reference'),
  exit_price: z.coerce
    .number({ invalid_type_error: 'Exit price is required' })
    .positive('Exit price must be greater than zero'),
  exit_size: z.coerce
    .number({ invalid_type_error: 'Exit size is required' })
    .positive('Exit size must be greater than zero'),
  exit_at: z
    .union([z.string(), z.date()])
    .optional()
    .transform((value) => {
      if (value === '' || value === undefined) return new Date()
      const d = value instanceof Date ? value : new Date(value)
      return Number.isNaN(d.getTime()) ? new Date() : d
    }),
  lesson: optionalString,
})

export type CloseTradeInput = z.infer<typeof closeTradeSchema>

export const editLessonSchema = z.object({
  trade_id: z.string().uuid('Missing trade reference'),
  lesson: z
    .string()
    .max(4000, 'Lesson must be 4000 characters or fewer')
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
})

export type EditLessonInput = z.infer<typeof editLessonSchema>

export const deleteTradeSchema = z.object({
  trade_id: z.string().uuid('Missing trade reference'),
})
