// Thin server-only wrapper around the Anthropic SDK so the rest of the
// codebase doesn't have to know about message-shape details. Lazily
// constructs a single client per process; the SDK handles connection
// pooling internally.
import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { env } from '@/lib/env'

export const DEFAULT_ANALYSIS_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_MAX_TOKENS = 1500
export const DEFAULT_TEMPERATURE = 0.7

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (client) return client
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client
}

export type ClaudeMessageOptions = {
  systemPrompt: string
  userPrompt: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export type ClaudeMessageResult = {
  text: string
  model: string
}

/**
 * Send a single-turn message to Claude and return the concatenated text
 * blocks. Throws on transport errors and on responses that contain no
 * text content; callers are expected to surface those failures to the
 * user without retrying (the action layer enforces concurrency caps).
 */
export async function sendMessage(
  options: ClaudeMessageOptions,
): Promise<ClaudeMessageResult> {
  const model = options.model ?? DEFAULT_ANALYSIS_MODEL
  const response = await getClient().messages.create({
    model,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    system: options.systemPrompt,
    messages: [{ role: 'user', content: options.userPrompt }],
  })

  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
  if (!text) {
    throw new Error('Claude returned no text content')
  }
  return { text, model }
}
