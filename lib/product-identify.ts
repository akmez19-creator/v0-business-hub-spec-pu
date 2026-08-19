// The photo-to-product identification pipeline.
//
// Lives in lib/ rather than in the route so it can be exercised directly
// against real catalogue photos - accuracy here is the whole feature, and a
// pipeline that can only be run through an authenticated HTTP call cannot be
// checked properly.
import { generateText, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/server'
import {
  shortlistProducts,
  textOnlyConfidence,
  MATCH_CONFIDENCE_FLOOR,
  VISUAL_CANDIDATE_LIMIT,
  type PhotoDescription,
  type ScoredProduct,
  type ScorableProduct,
} from '@/lib/product-match'
import type { MatchCandidate } from '@/lib/types'

/**
 * Gateway models, tried in order.
 *
 * gemini-2.5-flash is FIRST because it is the only vision model this account can
 * actually reach: gemini-3.7-flash and gemini-3.5-flash both return "Free tier
 * users do not have access to this model", and gpt-4o-mini is rate-limited on
 * the free tier. Leading with a paywalled model cost two wasted round-trips on
 * every single photo, which is what made real identifications fail.
 *
 * If the account gets paid credits, put the newer models in front of this one.
 */
const MODELS = ['google/gemini-2.5-flash']

/** Direct-provider model, used when the gateway itself is the problem. */
const DIRECT_MODEL = 'gemini-2.5-flash'

/**
 * A gateway rate-limit / quota rejection is account-wide, not per-model, so
 * every other gateway model will fail the same way. Detecting it lets the call
 * jump straight to the direct provider key instead of burning a few seconds
 * proving the obvious - which matters when someone is stood at a shelf waiting.
 */
function isAccountWideLimit(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase() || ''
  return (
    message.includes('rate-limited') ||
    message.includes('rate limited') ||
    message.includes('quota') ||
    message.includes('free tier') ||
    message.includes('billing') ||
    message.includes('credit')
  )
}

/**
 * Downscale before sending. A phone photo is 3-5MB; thirteen of them in one
 * request would be slow and expensive, and the extra pixels add nothing to a
 * "same product or not" judgement.
 */
async function downscale(input: ArrayBuffer | Buffer): Promise<Buffer> {
  return sharp(Buffer.from(input as Buffer))
    .rotate() // Honour EXIF orientation, or a sideways photo confuses the model.
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await downscale(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Try the direct Google key first, then the AI Gateway.
 *
 * Direct-first looks backwards but is what the evidence supports: on this
 * account every Gateway vision model is either paywalled or rate-limited on the
 * free tier, so leading with the Gateway burnt two failed round-trips on every
 * photo before succeeding. That wasted latency is the likely reason a real
 * identification timed out in the warehouse and reported a stocked product as
 * missing. The Gateway stays as the fallback so this keeps working if the
 * direct key is ever removed - and if the account gets paid credits, swapping
 * the two blocks back is a one-line change.
 */
async function withFallback<T>(
  run: (model: Parameters<typeof generateText>[0]['model']) => Promise<T>,
): Promise<T> {
  let lastError: unknown

  const key = process.env.GOOGLE_AI_API_KEY
  if (key) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: key })
      return await run(google(DIRECT_MODEL))
    } catch (error) {
      lastError = error
      console.log('[v0] identify: direct Google failed -', (error as Error).message)
    }
  }

  for (const model of MODELS) {
    try {
      return await run(model)
    } catch (error) {
      lastError = error
      console.log(`[v0] identify: ${model} failed -`, (error as Error).message)
      // No point trying a second gateway model against an account-wide limit.
      if (isAccountWideLimit(error)) break
    }
  }

  throw lastError
}

const descriptionSchema = z.object({
  label: z.string().describe('Short plain name for the object, e.g. "spray bottle"'),
  category: z.string().nullable(),
  form_factor: z.string().nullable().describe('Physical shape, e.g. "bottle", "boxed appliance"'),
  colour: z.string().nullable(),
  material: z.string().nullable(),
  packaging_text: z
    .array(z.string())
    .describe('Every word or brand name legible on the item or its box, copied exactly'),
  alternate_names: z
    .array(z.string())
    .describe('Other names a shop might list this under'),
})

const verdictSchema = z.object({
  matches: z.array(
    z.object({
      candidate_number: z.number().int(),
      confidence: z.number().min(0).max(1),
      reason: z.string().describe('One short concrete reason, max 12 words'),
    }),
  ),
})

/** Stage 1: describe the photographed item. */
async function describePhoto(photo: Buffer): Promise<PhotoDescription> {
  const { output } = await withFallback(model =>
    generateText({
      model,
      // One attempt per model. The SDK default of three turns a busy model into a
      // long stall, and switching model recovers from a 503 far faster than
      // retrying the model that is already overloaded.
      maxRetries: 1,
      system:
        'You are cataloguing warehouse stock. Describe ONLY the product in the photo - ignore hands, ' +
        'shelves, floors and background. Copy any text or brand name printed on the item or its ' +
        'packaging EXACTLY as it appears, character for character, even if it looks misspelled or is ' +
        'not English. That text is the single most useful clue for identifying the product, so never ' +
        'paraphrase, translate or correct it. If no text is legible, return an empty list.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What product is this? Describe it for stock matching.' },
            { type: 'image', image: photo },
          ],
        },
      ],
      output: Output.object({ schema: descriptionSchema }),
    }),
  )
  return output as PhotoDescription
}

/**
 * Read a photo and propose names to search a supplier marketplace with.
 *
 * Exists because the photo search had no idea what it was looking at. 1688's
 * image search is pure visual similarity, and the route drops the keyword
 * entirely in image mode - so a photo of a clothesline matched anything
 * rope-shaped, and the spreadsheet name was passed in and then ignored.
 *
 * Names are deliberately plain English: a storekeeper has to read these and
 * judge which one describes the thing in their hand, so a native trade term
 * they cannot evaluate would be worse than useless.
 *
 * The FIRST term is the one searched automatically, so ordering is the whole
 * game. Measured against the live marketplace:
 *   "kettle"          -> top hits were a plastic water cup and a cold-water jug
 *   "stovetop kettle" -> top hits were all actual whistling stovetop kettles
 * So a bare one-word label is not good enough to lead with, even though the
 * model sometimes returns exactly that. Two or three words is the sweet spot:
 * enough to pin the object down, not so much that the search returns nothing.
 *
 * Colour-qualified terms are pushed to the back on purpose - "silver kettle"
 * matches anything silver, so colour narrows the results without making them
 * more relevant.
 */
export async function suggestSearchTerms(imageUrl: string): Promise<{
  label: string
  terms: string[]
}> {
  const photo = await fetchImage(imageUrl)
  if (!photo) throw new Error('Could not read that photo')

  const d = await describePhoto(photo)
  const label = (d.label || '').trim()
  if (!label) throw new Error('Could not tell what is in that photo')

  // A brand read off the packaging is the strongest term available, but only
  // paired with the object - a bare brand name matches that seller's whole range.
  const brand = (d.packaging_text || [])
    .map(t => t.trim())
    .filter(t => t.length > 2 && t.length < 20 && /^[\p{L}][\p{L}\d\s&.-]*$/u.test(t))[0]

  /**
   * Take the first value of a list-like field.
   *
   * These fields come back as "Metal, Plastic" or "Silver, Black" often enough
   * that using them raw produced chips like "Metal, Plastic Kettle" - unreadable
   * to the storekeeper who has to choose between them, and a keyword no
   * marketplace will match.
   */
  const firstOf = (value: string | null) => (value || '').split(/[,/]|\bor\b|\band\b/i)[0].trim()

  /**
   * Qualify the label without repeating a word it already contains.
   *
   * Without this, a model that returns label "Kettle" and form factor "stovetop
   * kettle" yields the chip "Stovetop kettle Kettle".
   */
  const qualify = (qualifier: string | null, base: string) => {
    const q = firstOf(qualifier)
    if (!q) return null
    // A long qualifier is a description, not a name: form_factor came back as
    // "Container with handle and spout", which is no use as a search term.
    if (q.split(/\s+/).length > 2) return null
    const words = new Set(base.toLowerCase().split(/\s+/))
    const kept = q.split(/\s+/).filter(w => !words.has(w.toLowerCase()))
    return kept.length > 0 ? `${kept.join(' ')} ${base}` : null
  }

  // `kind` records where a term came from, because that predicts how useful it
  // is far better than the words themselves do.
  const candidates: { term: string; kind: 'name' | 'brand' | 'material' | 'colour' }[] = [
    { term: label, kind: 'name' },
    ...(d.alternate_names || []).map(t => ({ term: t, kind: 'name' as const })),
    ...(() => {
      const t = qualify(d.form_factor, label)
      return t ? [{ term: t, kind: 'name' as const }] : []
    })(),
    ...(brand ? [{ term: `${brand} ${label}`, kind: 'brand' as const }] : []),
    ...(() => {
      const t = qualify(d.material, label)
      return t ? [{ term: t, kind: 'material' as const }] : []
    })(),
    ...(() => {
      const t = qualify(d.colour, label)
      return t ? [{ term: t, kind: 'colour' as const }] : []
    })(),
  ]

  // Case-insensitive de-duplication, first occurrence wins.
  const seen = new Set<string>()
  const clean = candidates
    .map(c => ({ ...c, term: c.term.trim().replace(/\s+/g, ' ') }))
    .filter(c => {
      if (c.term.length < 2 || c.term.length > 60) return false
      const key = c.term.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  /**
   * Lower sorts earlier, and position 0 is what gets searched automatically.
   * A one-word term is demoted below the multi-word ones describing the same
   * object: it is the case that measurably returned the wrong products.
   */
  const rank = (c: (typeof clean)[number]) => {
    const words = c.term.split(' ').length
    const vague = words === 1 ? 4 : 0
    const byKind = { name: 0, brand: 1, material: 2, colour: 3 }[c.kind]
    // Beyond three words the search starts returning nothing at all.
    const tooLong = words > 3 ? 2 : 0
    return vague + byKind + tooLong
  }

  const terms = [...clean]
    // Stable sort, so equally-ranked terms keep the model's own ordering.
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6)
    .map(c => c.term)

  return { label, terms }
}

/**
 * Stage 2: put the agent's photo next to the shortlisted catalogue photos and
 * ask which are the same product. This is the step that carries the accuracy -
 * 422 of 488 products have an image, so the deciding comparison is
 * picture-against-picture rather than word-against-word.
 */
async function verifyVisually(
  photo: Buffer,
  candidates: ScoredProduct[],
): Promise<Map<string, { confidence: number; reason: string }>> {
  const withImages = candidates
    .filter(c => c.image_url)
    .slice(0, VISUAL_CANDIDATE_LIMIT)

  if (!withImages.length) return new Map()

  const images = await Promise.all(
    withImages.map(async c => ({ product: c, buffer: await fetchImage(c.image_url as string) })),
  )
  const usable = images.filter(i => i.buffer)
  if (!usable.length) return new Map()

  const content: Array<
    { type: 'text'; text: string } | { type: 'image'; image: Buffer }
  > = [
    {
      type: 'text',
      text:
        'IMAGE 0 is a photo taken in the warehouse. The images after it are catalogue photos of ' +
        'candidate products. Decide which candidates are THE SAME product as image 0.',
    },
    { type: 'image', image: photo },
  ]

  usable.forEach((item, i) => {
    content.push({
      type: 'text',
      text: `Candidate ${i + 1}: "${item.product.name}"`,
    })
    content.push({ type: 'image', image: item.buffer as Buffer })
  })

  const { output } = await withFallback(model =>
    generateText({
      model,
      // One attempt per model. The SDK default of three turns a busy model into a
      // long stall, and switching model recovers from a 503 far faster than
      // retrying the model that is already overloaded.
      maxRetries: 1,
      system:
        'You verify warehouse stock identity by comparing photographs. Judge whether each candidate ' +
        'is the SAME product as the warehouse photo - not merely a similar or related one. Lighting, ' +
        'angle, background and packaging wear differ between a shelf photo and a catalogue photo, so ' +
        'ignore those and compare the product itself: shape, proportions, colour, printed text and ' +
        'distinguishing details.\n' +
        'Scoring: 0.9+ only when clearly the identical product. 0.6-0.9 probable. Below 0.4 for a ' +
        'different product that merely looks similar. It is far better to report low confidence than ' +
        'to guess - a wrong match corrupts real stock figures. Omit candidates that are clearly wrong. ' +
        'Give one short concrete reason citing what you actually saw.',
      messages: [{ role: 'user', content }],
      output: Output.object({ schema: verdictSchema }),
    }),
  )

  const out = new Map<string, { confidence: number; reason: string }>()
  for (const m of (output as z.infer<typeof verdictSchema>).matches) {
    const item = usable[m.candidate_number - 1]
    if (!item) continue // Model invented an index - ignore rather than mis-assign.
    out.set(item.product.id, { confidence: m.confidence, reason: m.reason })
  }
  return out
}

interface AnalysisResult {
  status: 'suggested' | 'unmatched'
  label: string | null
  candidates: MatchCandidate[]
}

/**
 * The whole pipeline for one photo, independent of where the photo came from.
 *
 * `catalogue` is injectable so the matching can be exercised against real
 * products without a request context - accuracy is the entire point of this
 * feature, and it has to be measurable.
 */
export async function analysePhoto(
  photoUrl: string,
  catalogue?: ScorableProduct[],
): Promise<AnalysisResult> {
  const photo = await fetchImage(photoUrl)
  if (!photo) throw new Error('The photo could not be read')

  const description = await describePhoto(photo)

  let products = catalogue
  if (!products) {
    const { data } = await createAdminClient()
      .from('products')
      .select('id, name, category, description, sku, image_url')
      .eq('is_active', true)
    products = (data || []) as ScorableProduct[]
  }

  const shortlist = shortlistProducts(description, products)

  // Nothing even vaguely similar in the catalogue - say so plainly rather than
  // offering the least-bad row.
  if (!shortlist.length) {
    return { status: 'unmatched', label: description.label, candidates: [] }
  }

  const verdicts = await verifyVisually(photo, shortlist)

  const candidates: MatchCandidate[] = shortlist
    .map(product => {
      const verdict = verdicts.get(product.id)
      return {
        product_id: product.id,
        name: product.name,
        image_url: product.image_url,
        // A visually confirmed score always beats a text-only guess, which is
        // capped below certainty on purpose.
        confidence: verdict ? verdict.confidence : textOnlyConfidence(product.score),
        reason: verdict
          ? verdict.reason
          : product.image_url
            ? `No visual match - ${product.basis}`
            : `No catalogue photo to compare - ${product.basis}`,
        visually_compared: Boolean(verdict),
      }
    })
    .sort((a, b) => {
      // Visual evidence outranks text similarity regardless of score.
      if (a.visually_compared !== b.visually_compared) {
        return a.visually_compared ? -1 : 1
      }
      return b.confidence - a.confidence
    })
    .slice(0, 5)

  const best = candidates[0]
  // Candidates are still returned when unmatched: a 0.3 suggestion is a useful
  // starting point for a human, as long as it is not presented as an answer.
  return {
    status: best && best.confidence >= MATCH_CONFIDENCE_FLOOR ? 'suggested' : 'unmatched',
    label: description.label,
    candidates,
  }
}

export type { AnalysisResult }
