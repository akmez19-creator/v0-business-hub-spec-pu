// AI second opinion on candidate duplicate pairs.
//
// String distance cannot tell "misspelled" from "different model" - it rated
// "Mini Pot" and "Mini Mop" as one edit apart, and "Pet Comb" and "Heat Comb"
// likewise. A language model knows a pot is not a mop. That is the whole job
// here: product knowledge, applied to names the arithmetic already flagged.
//
// It NEVER merges anything. It annotates the review queue so the obviously
// wrong pairs can be dismissed quickly and the genuine ones stand out.
import { generateText, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type { DuplicatePair } from './duplicates'

/**
 * Direct Google key first, Gateway second - the same order the photo identify
 * pipeline settled on. On this account every Gateway model is either paywalled
 * ("Free tier users do not have access") or rate-limited, so leading with it
 * burns two failed round-trips before succeeding.
 */
const DIRECT_MODEL = 'gemini-2.5-flash'
const GATEWAY_MODEL = 'google/gemini-2.5-flash'

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      pair_number: z.number().int(),
      same_product: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string().describe('One short sentence a warehouse manager would find useful'),
    }),
  ),
})

export type AiVerdict = {
  sameProduct: boolean
  confidence: number
  reason: string
}

const SYSTEM = `You review a warehouse product catalogue for accidental duplicates.

Each pair was flagged only because the two names are spelled almost identically.
Your job is to say whether they are the SAME physical product entered twice, or
two DIFFERENT products that happen to have similar names.

Rules:
- Different function means different product. A pot is not a mop. A comb for
  pets is not a heated hair comb. A board is not a bar.
- An accessory or consumable is NEVER the same as the appliance it is used with.
  Air fryer parchment paper is not an air fryer. A brush for a car is not a car.
- Different size, capacity, model code, colour or layer count means different
  product, even when everything else matches.
- A pure spelling or spacing difference of the same words IS the same product:
  "Garage Tile"/"Garage Tiles", "Airfryer Backet"/"Air Fryer Basket" (backet is
  a misspelling of basket), "U Shape Pillow"/"U-Shaped Pillow".
- If the two sit in different warehouse zones, that is evidence they are
  different physical items, but it is not conclusive on its own - the same item
  can be entered twice and shelved in two places.
- When genuinely unsure, say same_product false with low confidence. A missed
  duplicate costs a little tidiness; a wrong merge destroys a stock count.`

function describePair(pair: DuplicatePair, index: number): string {
  const side = (p: DuplicatePair['a']) =>
    `"${p.name}" (zone ${p.zone?.trim() || 'none'}, on-hand ${p.quantity ?? 0}, ` +
    `${p.po_count} purchase orders, ${p.image_count} photos, ` +
    `${p.last_counted_at ? 'counted' : 'never counted'})`
  return `Pair ${index + 1}:\n  A: ${side(pair.a)}\n  B: ${side(pair.b)}`
}

async function run<T>(
  fn: (model: Parameters<typeof generateText>[0]['model']) => Promise<T>,
): Promise<T> {
  let lastError: unknown

  const key = process.env.GOOGLE_AI_API_KEY
  if (key) {
    try {
      return await fn(createGoogleGenerativeAI({ apiKey: key })(DIRECT_MODEL))
    } catch (error) {
      lastError = error
      console.log('[v0] duplicate-ai: direct Google failed -', (error as Error).message)
    }
  }

  try {
    return await fn(GATEWAY_MODEL)
  } catch (error) {
    console.log('[v0] duplicate-ai: gateway failed -', (error as Error).message)
    throw lastError ?? error
  }
}

/**
 * Judge up to a few dozen pairs in one call. Batched deliberately: the names
 * are short, and one request is far cheaper and faster than one per pair on an
 * account where the model is rate-limited.
 */
export async function reviewDuplicatePairs(pairs: DuplicatePair[]): Promise<Map<number, AiVerdict>> {
  const result = new Map<number, AiVerdict>()
  if (!pairs.length) return result

  const { output } = await run(model =>
    generateText({
      model,
      maxRetries: 1,
      system: SYSTEM,
      prompt:
        `Review these ${pairs.length} candidate pairs and return a verdict for every one.\n\n` +
        pairs.map(describePair).join('\n\n'),
      experimental_output: Output.object({ schema: verdictSchema }),
    }),
  )

  for (const v of output.verdicts) {
    const i = v.pair_number - 1
    if (i < 0 || i >= pairs.length) continue
    result.set(i, {
      sameProduct: v.same_product,
      confidence: v.confidence,
      reason: v.reason,
    })
  }
  return result
}
