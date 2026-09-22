import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'

/**
 * Standby chain for customer-facing text generation.
 *
 * MEASURED 15 Sep 2026: the shop's OpenAI key is on 30,000 tokens per MINUTE.
 * One inbox draft carries the catalogue, business context and 25 turns, so two
 * agents drafting together exhaust the minute in two or three clicks, and the
 * autopilots draw on the same key in the background. A 429 here is therefore
 * routine, not a fault, and the answer is another quota - not a retry loop the
 * agent has to sit through.
 *
 * Order: same model on the shop's key -> the SAME model through Vercel AI
 * Gateway (separate quota, billed to the Vercel account, zero config on Vercel)
 * -> Gemini on the Google key as the last resort. gpt-4.1 was chosen on a real
 * Kreol thread (cheaper models produced fluent nonsense), so the first two
 * tiers keep the exact model; only the last tier changes it, and the caller is
 * told which tier answered so it can be surfaced.
 */
export type StandbyTier = 'openai' | 'gateway' | 'gemini'

const OPENAI_MODEL = 'gpt-4.1'
const GATEWAY_MODEL = 'openai/gpt-4.1'
const GEMINI_MODEL = 'gemini-2.5-flash'

function tiers(): { tier: StandbyTier; model: LanguageModel }[] {
  const list: { tier: StandbyTier; model: LanguageModel }[] = []
  if (process.env.OPENAI_API_KEY) {
    list.push({ tier: 'openai', model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(OPENAI_MODEL) })
  }
  // A plain "provider/model" string routes through AI Gateway; the Vercel
  // runtime supplies its credentials.
  list.push({ tier: 'gateway', model: GATEWAY_MODEL })
  if (process.env.GOOGLE_AI_API_KEY) {
    list.push({ tier: 'gemini', model: createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_AI_API_KEY })(GEMINI_MODEL) })
  }
  return list
}

/** Errors that mean "this provider cannot serve us right now" - try the next one. */
export function isStandbyWorthy(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string; name?: string } | null
  const status = e?.statusCode
  const message = e?.message ?? ''
  if (status === 429 || status === 402) return true
  if (status !== undefined && status >= 500) return true
  if (/rate limit|quota|no credits|insufficient_quota|billing|overloaded|capacity|Too Many Requests/i.test(message)) return true
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true
  return /timeout|timed out|ECONNRESET|fetch failed|network/i.test(message)
}

export type StandbyOutcome<T> = { value: T; tier: StandbyTier; skipped: { tier: StandbyTier; reason: string }[] }

/**
 * Call `run` with each tier's model in turn. Callers MUST pass `maxRetries: 0`
 * to generateText so a 429 falls through immediately instead of provider
 * back-off stacking up in front of the agent. Errors that are NOT capacity
 * problems (schema failures, bad request) propagate at once - another
 * provider would not fix them.
 */
export async function withStandbyModel<T>(
  run: (model: LanguageModel, tier: StandbyTier) => Promise<T>,
  options: { allow?: StandbyTier[] } = {},
): Promise<StandbyOutcome<T>> {
  const skipped: { tier: StandbyTier; reason: string }[] = []
  const candidates = tiers().filter((t) => !options.allow || options.allow.includes(t.tier))
  if (!candidates.length) throw new Error('No AI provider is configured.')
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const value = await run(candidate.model, candidate.tier)
      if (skipped.length) console.warn('[ai-standby] served by', candidate.tier, 'after', skipped.map((s) => `${s.tier}: ${s.reason}`).join(' | '))
      return { value, tier: candidate.tier, skipped }
    } catch (err) {
      lastError = err
      if (!isStandbyWorthy(err)) throw err
      const e = err as { statusCode?: number; message?: string }
      skipped.push({ tier: candidate.tier, reason: `${e?.statusCode ?? ''} ${(e?.message ?? '').slice(0, 120)}`.trim() })
    }
  }
  throw lastError
}

/** One line for the agent when a draft came from the last-resort model. */
export function standbyNotice(tier: StandbyTier): string | null {
  return tier === 'gemini' ? 'Drafted by the standby model (Gemini) because the main AI is at its limit - read it closely before sending.' : null
}
