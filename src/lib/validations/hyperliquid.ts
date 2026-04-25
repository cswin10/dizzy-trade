import { z } from 'zod'

// Hyperliquid main account addresses follow the standard EVM 0x
// prefix plus 40 hex characters. We lowercase on input so the column
// stays canonical regardless of case the user pastes.
export const hyperliquidAddressSchema = z
  .string()
  .trim()
  .regex(
    /^0x[a-fA-F0-9]{40}$/,
    'Address must be 0x followed by 40 hex characters',
  )
  .transform((v) => v.toLowerCase())

export const setHyperliquidConfigSchema = z.object({
  main_address: hyperliquidAddressSchema,
})

export type SetHyperliquidConfigInput = z.infer<
  typeof setHyperliquidConfigSchema
>

export const tradeIdSchema = z.object({
  trade_id: z.string().uuid('Missing trade reference'),
})
