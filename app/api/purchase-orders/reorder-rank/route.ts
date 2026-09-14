import { generateText, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'

export const maxDuration = 120

// Free tier on this account: Gateway models are paywalled/throttled, so the
// direct Google key leads and the Gateway is only a fallback. Same pattern as
// lib/products/candidate-ai.ts.
const DIRECT_MODEL = 'gemini-2.5-flash'
const GATEWAY_MODEL = 'google/gemini-2.5-flash'

const schema = z.object({
  ranked: z.array(
    z.object({
      id: z.string().describe('The product id exactly as given'),
      urgency: z.enum(['high', 'medium', 'low']),
      reason: z.string().describe('One short sentence for a buyer, citing only the figures given'),
    }),
  ),
})

type Item = {
  id: string
  name: string
  stock: number | null
  suggestedQty: number | null
  dailyUnits: number | null
  alreadyOrdered: number
  leadDays: number | null
  coverDays: number | null
  bufferDays: number | null
  warnings: string[]
}

const SYSTEM = `You help a buyer decide which products to reorder from China first.

Each product line gives you REAL figures: recorded stock, the planning system's
suggested buy quantity, the daily sales rate, how many units are already on open
orders, and the lead/cover/buffer day assumptions. Some figures may be unknown.

Rank every product by how urgently it needs reordering:
- high: out of stock, or stock is far below what the daily rate needs before new goods could arrive (lead + cover days).
- medium: stock is getting low relative to the rate and lead time, but not critical.
- low: comfortable stock, already covered by open orders, or not enough data to worry.

Write ONE short sentence per product explaining the call, for a buyer. Cite ONLY
the figures given - never invent a number, price, or sales figure. If stock is
unknown or there is no sales rate, say the data is thin and rank it low unless it
is flagged sold out. Return exactly one entry for every product id given.`

async function run<T>(fn: (model: Parameters<typeof generateText>[0]['model']) => Promise<T>): Promise<T> {
  let lastError: unknown
  const key = process.env.GOOGLE_AI_API_KEY
  if (key) {
    try {
      return await fn(createGoogleGenerativeAI({ apiKey: key })(DIRECT_MODEL))
    } catch (error) {
      lastError = error
      console.log('[v0] reorder-rank: direct Google failed -', (error as Error).message)
    }
  }
  try {
    return await fn(GATEWAY_MODEL)
  } catch (error) {
    console.log('[v0] reorder-rank: gateway failed -', (error as Error).message)
    throw lastError ?? error
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { items?: Item[] }
    // Cap the batch: this is an advisory re-sort of the already-shortlisted
    // products, not the whole 883-item catalogue.
    const items = (body.items ?? []).slice(0, 120)
    if (!items.length) return Response.json({ ranked: [] })

    const block = items
      .map(
        (it) =>
          `- id ${it.id} | "${it.name}" | stock ${it.stock ?? 'unknown'} | suggested buy ${
            it.suggestedQty ?? 'n/a'
          } | rate ${it.dailyUnits ?? 'unknown'}/day | already on order ${it.alreadyOrdered} | lead ${
            it.leadDays ?? '?'
          } cover ${it.coverDays ?? '?'} buffer ${it.bufferDays ?? '?'} days${
            it.warnings?.length ? ` | notes: ${it.warnings.join('; ')}` : ''
          }`,
      )
      .join('\n')

    const { output } = await run((model) =>
      generateText({
        model,
        maxRetries: 1,
        system: SYSTEM,
        prompt: `Products to prioritise for a China reorder:\n${block}\n\nReturn a ranking for EVERY product by its id.`,
        experimental_output: Output.object({ schema }),
      }),
    )

    const known = new Set(items.map((i) => i.id))
    const ranked = (output?.ranked ?? []).filter((r) => known.has(r.id))
    return Response.json({ ranked })
  } catch (error) {
    console.error('[v0] reorder-rank error:', error)
    return Response.json({ error: 'Ranking failed' }, { status: 500 })
  }
}
