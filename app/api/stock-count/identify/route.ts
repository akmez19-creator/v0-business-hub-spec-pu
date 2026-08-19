import { NextResponse } from 'next/server'
import { generateText, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import sharp from 'sharp'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  shortlistProducts,
  textOnlyConfidence,
  MATCH_CONFIDENCE_FLOOR,
  VISUAL_CANDIDATE_LIMIT,
  type PhotoDescription,
  type ScoredProduct,
} from '@/lib/product-match'
import type { MatchCandidate } from '@/lib/types'

// Two vision calls plus image downscaling. Nowhere near 60s in practice, but a
// cold start on a slow warehouse connection needs the headroom.
export const maxDuration = 60

// Never edge - the AI SDK requires the Node runtime.
export const runtime = 'nodejs'

const MODEL = 'google/gemini-3.7-flash'

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
 * Run a model call through the AI Gateway, falling back to Gemini directly.
 * Mirrors the existing image-search route so a gateway blip degrades rather
 * than takes stock counting offline.
 */
async function withFallback<T>(
  run: (model: Parameters<typeof generateText>[0]['model']) => Promise<T>,
): Promise<T> {
  try {
    return await run(MODEL)
  } catch (gatewayError) {
    const key = process.env.GOOGLE_AI_API_KEY
    if (!key) throw gatewayError
    const google = createGoogleGenerativeAI({ apiKey: key })
    return await run(google('gemini-flash-latest'))
  }
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

/** The whole pipeline for one photo, independent of where the photo came from. */
async function analysePhoto(photoUrl: string): Promise<AnalysisResult> {
  const db = createAdminClient()

  const photo = await fetchImage(photoUrl)
  if (!photo) throw new Error('The photo could not be read')

  const description = await describePhoto(photo)

  const { data: products } = await db
    .from('products')
    .select('id, name, category, description, sku, image_url')
    .eq('is_active', true)

  const shortlist = shortlistProducts(description, products || [])

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

/**
 * Two entry modes:
 *
 *  - `photoUrl`   analyse only. Used while the agent is still typing the
 *                 quantity, so the wait is hidden behind data entry. Nothing is
 *                 written, because the capture row does not exist yet - its
 *                 quantity is not known until they finish.
 *  - `captureId`  analyse and persist onto an existing capture. Used to retry a
 *                 capture that was interrupted, or to re-run one from the admin
 *                 queue.
 */
export async function POST(request: Request) {
  // This output ends up attached to real stock data, so it is not anonymous.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const { captureId, photoUrl } = (await request.json()) as {
    captureId?: string
    photoUrl?: string
  }

  if (!captureId && !photoUrl) {
    return NextResponse.json(
      { error: 'Either captureId or photoUrl is required' },
      { status: 400 },
    )
  }

  const db = createAdminClient()

  // Analyse-only mode.
  if (!captureId && photoUrl) {
    try {
      return NextResponse.json(await analysePhoto(photoUrl))
    } catch (error) {
      console.error('[v0] identify (photo) failed:', error)
      return NextResponse.json({
        status: 'unmatched',
        label: null,
        candidates: [],
        error: 'Could not analyse the photo',
      })
    }
  }

  const { data: capture } = await db
    .from('stock_count_captures')
    .select('id, photo_url, status')
    .eq('id', captureId as string)
    .single()

  if (!capture) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 })
  }
  // Already sorted out by a human - never overwrite their decision.
  if (capture.status === 'resolved') {
    return NextResponse.json({ status: 'resolved', label: null, candidates: [] })
  }

  try {
    const result = await analysePhoto(capture.photo_url)

    await db
      .from('stock_count_captures')
      .update({
        status: result.status,
        ai_label: result.label,
        ai_confidence: result.candidates[0]?.confidence ?? null,
        ai_candidates: result.candidates,
        ai_error: null,
      })
      .eq('id', capture.id)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[v0] identify (capture) failed:', error)
    await db
      .from('stock_count_captures')
      .update({
        status: 'unmatched',
        ai_error: (error as Error).message || 'Matching failed',
      })
      .eq('id', capture.id)
    return NextResponse.json({
      status: 'unmatched',
      label: null,
      candidates: [],
      error: 'Could not analyse the photo',
    })
  }
}
