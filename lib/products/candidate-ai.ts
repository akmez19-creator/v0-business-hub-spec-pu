// Ranks and explains the candidates for ONE product.
//
// Different job from duplicate-ai.ts, which gives a yes/no verdict on pairs the
// unattended sweep already chose. Here the shortlist comes from a recall-first
// search that deliberately includes weak matches, so most candidates are
// expected to be wrong and the model's real task is ORDERING plus a reason the
// reviewer can check at a glance.
//
// It decides nothing. Every candidate the database found is shown whatever the
// model says - the ranking only changes what sits at the top. That matters
// because the model is the least reliable part of this pipeline, and a model
// that silently dropped the true duplicate would defeat the entire point of
// reviewing one product at a time.
import { generateText, generateObject, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type { Candidate, CandidateTarget } from './candidates'

// Free tier on this account: every Gateway model is paywalled or throttled, so
// the direct Google key leads and the Gateway is only a fallback.
const DIRECT_MODEL = 'gemini-2.5-flash'
const GATEWAY_MODEL = 'google/gemini-2.5-flash'

const schema = z.object({
  rankings: z.array(
    z.object({
      candidate_number: z.number().int(),
      verdict: z
        .enum(['same', 'unsure', 'different'])
        .describe('same = the identical physical product entered twice'),
      // Deliberately NOT .min(0).max(1). Measured against this model with real
      // photos: it sometimes answers on a 1-5 scale ("confidence": 5), and a
      // range constraint made the SDK reject the entire response - throwing
      // away a correct, well-argued verdict over one number's units. The value
      // is normalised in toConfidence() instead. Validation that discards good
      // data is worse than no validation.
      confidence: z.number().describe('How sure you are, from 0 to 1'),
      reason: z.string().describe('One short sentence explaining the call, for a warehouse manager'),
    }),
  ),
})

/**
 * Bring whatever scale the model answered on back to 0-1.
 *
 * Percentages and 1-5/1-10 ratings all show up in practice. Anything
 * unparseable becomes 0.5 - "not sure" - which is the honest reading of a
 * confidence we could not interpret, and never overstates certainty.
 */
function toConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0.5
  const n = raw > 1 && raw <= 10 ? raw / 10 : raw > 10 && raw <= 100 ? raw / 100 : raw
  return Math.min(1, Math.max(0, n))
}

export type CandidateVerdict = {
  verdict: 'same' | 'unsure' | 'different'
  confidence: number
  reason: string
}

const SYSTEM = `You help a warehouse manager find products that were accidentally
entered into the catalogue twice.

You are given ONE target product and a shortlist of candidates that a database
search turned up. The search was tuned to miss nothing, so most candidates will
be unrelated. Judge each one independently.

Rules:
- "same" means the identical physical item recorded twice, usually because
  someone typed the name differently. "Airfryer Backet"/"Air Fryer Basket",
  "Garage Tile"/"Garage Tiles", "U Shape Pillow"/"U-Shaped Pillow".
- Different function means different product. A pot is not a mop. A pet comb is
  not a heated hair comb.
- An accessory or consumable is NEVER the same as the appliance it goes with.
  Air fryer paper is not an air fryer. A basket FOR an air fryer is a different
  product from the air fryer itself, but is the same as another basket entry.
- Different size, capacity, colour, model code or pack count means different
  product, even if every other word matches.
- Sharing a photo, a 1688 listing or an SKU is strong evidence of "same" even
  when the names look nothing alike - that usually means one was renamed or
  abbreviated. Say so in your reason when it applies.
- Two products in different warehouse zones can still be one item entered
  twice. Zone is weak evidence, never decisive.
- Use "unsure" freely. It is the honest answer when the names are genuinely
  ambiguous, and it costs the reviewer nothing - they are looking at every
  candidate anyway. Do not force a confident "different" to seem decisive.`

function describe(p: { name: string; zone: string | null; quantity: number | null; po_count: number; image_count: number; sku: string | null }) {
  return (
    `"${p.name}" (zone ${p.zone?.trim() || 'none'}, on-hand ${p.quantity ?? 0}, ` +
    `${p.po_count} purchase orders, ${p.image_count} photos` +
    `${p.sku?.trim() ? `, SKU ${p.sku.trim()}` : ''})`
  )
}

async function run<T>(fn: (model: Parameters<typeof generateText>[0]['model']) => Promise<T>): Promise<T> {
  let lastError: unknown
  const key = process.env.GOOGLE_AI_API_KEY
  if (key) {
    try {
      return await fn(createGoogleGenerativeAI({ apiKey: key })(DIRECT_MODEL))
    } catch (error) {
      lastError = error
      console.log('[v0] candidate-ai: direct Google failed -', (error as Error).message)
    }
  }
  try {
    return await fn(GATEWAY_MODEL)
  } catch (error) {
    console.log('[v0] candidate-ai: gateway failed -', (error as Error).message)
    throw lastError ?? error
  }
}

export async function rankCandidates(
  target: CandidateTarget,
  candidates: Candidate[],
): Promise<Map<number, CandidateVerdict>> {
  const out = new Map<number, CandidateVerdict>()
  if (!candidates.length) return out

  const { output } = await run(model =>
    generateText({
      model,
      maxRetries: 1,
      system: SYSTEM,
      prompt:
        `TARGET product:\n  ${describe(target)}\n\n` +
        `CANDIDATES (${candidates.length}) - return a verdict for every one:\n` +
        candidates
          .map((c, i) => {
            const evidence = c.reasons.length ? `\n     evidence: ${c.reasons.join('; ')}` : ''
            return `  ${i + 1}. ${describe(c)}${evidence}`
          })
          .join('\n'),
      experimental_output: Output.object({ schema }),
    }),
  )

  for (const r of output.rankings) {
    const i = r.candidate_number - 1
    if (i < 0 || i >= candidates.length) continue
    out.set(i, { verdict: r.verdict, confidence: toConfidence(r.confidence), reason: r.reason })
  }
  return out
}

/**
 * How many candidates per product may go to the vision model. Photos are the
 * expensive half, so they are spent only where they change the answer.
 */
const PHOTO_LIMIT = 3
/** A slow supplier CDN must not hang the whole batch. */
const IMAGE_TIMEOUT_MS = 8000
const MAX_IMAGE_BYTES = 4_000_000

/**
 * Whether looking at this pair's photos could actually change the decision.
 *
 * Names-only is right for most candidates: a Vegetable Grater is not a cube
 * cutter and no photo will change that. Vision is worth its cost on the
 * genuinely close calls, and - most importantly - where the text verdict
 * CONTRADICTS name-independent evidence, because a shared 1688 listing with a
 * "different" verdict is exactly the kind of rename this tool exists to catch.
 */
function needsPhotoCheck(c: Candidate, v: CandidateVerdict | undefined): boolean {
  if (!c.image_url) return false
  // Identical file on both rows - the images cannot disagree, and the shared
  // photo is already stronger evidence than anything vision would add.
  if (c.reasons.includes('Same photo')) return false
  if (!v) return false
  const contradicted =
    v.verdict === 'different' && (c.reasons.includes('Same 1688 listing') || c.reasons.includes('Same SKU'))
  if (contradicted) return true
  if (v.verdict === 'unsure') return true
  if (v.verdict === 'same' && v.confidence < 0.9) return true
  if (v.verdict === 'different' && v.confidence < 0.9 && c.score >= 0.4) return true
  return false
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return null
    return buf
  } catch {
    return null
  }
}

const PHOTO_SYSTEM = `You are looking at photographs of warehouse products to
decide whether two catalogue entries are the same physical item.

You see the TARGET product first, then numbered candidates. For each candidate,
say whether the photographs show the same physical product as the target.

- Judge the PRODUCT, not the photo. Different backgrounds, angles, lighting or
  watermarks are irrelevant. Supplier listing photos of one item vary a lot.
- The same item in a different colour or a visibly different size is a
  DIFFERENT product.
- An accessory pictured next to an appliance is not that appliance.
- If a photo is too unclear to judge, say "unsure". Never guess.
- Photographs beat names here: if the names differ but the item is plainly
  identical, say "same" and explain what you can see that proves it.`

/**
 * Second pass: for the close calls only, actually look at the product photos.
 *
 * One call per product with every close candidate in it, rather than one call
 * per pair - the target photo would otherwise be re-uploaded for each
 * comparison, and a 20-product batch would make dozens of round trips.
 *
 * Returns a NEW map; the caller keeps the text verdicts for everything that did
 * not qualify. A failure here is non-fatal by design: the text ranking already
 * stands on its own and every candidate is on screen regardless.
 */
export async function refineWithPhotos(
  target: CandidateTarget,
  candidates: Candidate[],
  verdicts: Map<number, CandidateVerdict>,
): Promise<{ verdicts: Map<number, CandidateVerdict>; lookedAtPhotos: boolean }> {
  const merged = new Map(verdicts)
  if (!target.image_url) return { verdicts: merged, lookedAtPhotos: false }

  const picked = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => needsPhotoCheck(c, verdicts.get(i)))
    .slice(0, PHOTO_LIMIT)
  if (!picked.length) return { verdicts: merged, lookedAtPhotos: false }

  const [targetImage, ...candidateImages] = await Promise.all([
    fetchImage(target.image_url),
    ...picked.map(({ c }) => fetchImage(c.image_url as string)),
  ])
  if (!targetImage) return { verdicts: merged, lookedAtPhotos: false }

  const usable = picked
    .map((p, n) => ({ ...p, image: candidateImages[n] }))
    .filter((p): p is typeof p & { image: Uint8Array } => p.image !== null)
  if (!usable.length) return { verdicts: merged, lookedAtPhotos: false }

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Uint8Array }> = [
    { type: 'text', text: `TARGET: "${target.name}"` },
    { type: 'image', image: targetImage },
  ]
  usable.forEach((p, n) => {
    content.push({ type: 'text', text: `CANDIDATE ${n + 1}: "${p.c.name}"` })
    content.push({ type: 'image', image: p.image })
  })
  content.push({
    type: 'text',
    text: `Return a verdict for each of the ${usable.length} candidates, numbered as labelled.`,
  })

  // generateObject, NOT generateText+experimental_output like the text pass.
  // Measured against this model with real photos: the experimental_output path
  // throws AI_NoObjectGeneratedError ("response did not match schema") on
  // EVERY image request, while generateObject returns clean structured output
  // from the identical messages. That failure was silent - the photo pass
  // appeared to run and simply never changed a verdict.
  let object: z.infer<typeof schema>
  try {
    ;({ object } = await run(model =>
      generateObject({
        model,
        maxRetries: 1,
        system: PHOTO_SYSTEM,
        messages: [{ role: 'user', content }],
        schema,
      }),
    ))
  } catch (error) {
    // Loud on the server, harmless on the page: the text verdicts still stand
    // and every candidate is still shown. But lookedAtPhotos stays FALSE so the
    // page never claims photos were compared when they were not - that claim is
    // what made this bug invisible in the first place.
    console.error('[v0] candidate-ai: photo comparison failed -', (error as Error).message)
    return { verdicts: merged, lookedAtPhotos: false }
  }

  for (const r of object.rankings) {
    const slot = usable[r.candidate_number - 1]
    if (!slot) continue
    merged.set(slot.i, {
      verdict: r.verdict,
      confidence: toConfidence(r.confidence),
      reason: `Looked at the photos: ${r.reason}`,
    })
  }
  return { verdicts: merged, lookedAtPhotos: true }
}
