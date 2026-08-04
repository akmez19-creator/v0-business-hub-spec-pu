/**
 * Scores a product photo on the things that actually decide whether it makes a
 * good poster or listing image.
 *
 * The five axes are not arbitrary. Four are ordinary photo quality; the fifth,
 * `textFree`, exists because this catalogue is largely Chinese marketplace
 * photos whose packaging carries Chinese sales copy. That copy leaks into
 * generated posters - the poster prompt already fights it at generation time,
 * and scoring it here means the cleanest source photo gets picked in the first
 * place, which is a much more reliable fix than instructing a model to ignore
 * writing that is sitting in the middle of the image.
 */

import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export interface ImageScores {
  /** Sharp and in focus, not blurry or pixelated (0-10) */
  clarity: number
  /** Product fills the frame well, nothing important cropped off (0-10) */
  framing: number
  /** Evenly lit, no harsh shadows or blown highlights (0-10) */
  lighting: number
  /** Clean, uncluttered background the product can be cut out of (0-10) */
  background: number
  /** FREE of foreign/marketing text on the product or packaging (0-10) */
  textFree: number
}

export interface ImageVerdict {
  scores: ImageScores
  total: number
  reason: string
}

/**
 * Weights. textFree and clarity carry the most because they are the two that
 * make an image unusable rather than merely mediocre: a blurry photo cannot be
 * rescued, and visible Chinese text ends up reprinted on the poster.
 */
const WEIGHTS: Record<keyof ImageScores, number> = {
  clarity: 1.25,
  framing: 1,
  lighting: 1,
  background: 1,
  textFree: 1.25,
}

const MAX_WEIGHTED = Object.values(WEIGHTS).reduce((a, b) => a + b, 0) * 10

/** Combine the five axes into a single 0-100 score. */
export function weightedTotal(s: ImageScores): number {
  const sum = (Object.keys(WEIGHTS) as Array<keyof ImageScores>).reduce(
    (acc, k) => acc + clamp(s[k]) * WEIGHTS[k],
    0,
  )
  return Math.round((sum / MAX_WEIGHTED) * 100)
}

function clamp(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(Math.max(v, 0), 10)
}

const SYSTEM =
  'You grade product photographs for use in e-commerce posters and marketplace listings. ' +
  'You are strict and consistent. Reply with JSON only, no prose, no markdown fences.'

const PROMPT = `Score this product photo on five axes, each 0-10.

clarity: sharpness and focus. 10 = crisp, 0 = badly blurred or heavily pixelated.
framing: how well the product sits in the frame. 10 = fills the frame with nothing important cut off, 0 = tiny, awkwardly cropped, or key parts missing.
lighting: exposure quality. 10 = even and bright with visible detail, 0 = very dark, blown out, or harsh distracting shadows.
background: how cleanly the product can be cut out. 10 = plain, uncluttered background, 0 = busy scene the product is lost in.
textFree: how FREE the image is of written text on the product, its packaging, its label, or as an overlaid graphic. 10 = no writing at all anywhere. 0 = covered in text. Score LOW for Chinese, Japanese, Korean, Arabic or other non-Latin writing, and LOW for overlaid marketing badges, prices or watermarks. A plain logo alone is a 7.

Reply with exactly this JSON shape:
{"clarity":0,"framing":0,"lighting":0,"background":0,"textFree":0,"reason":"one short sentence naming the deciding factor"}`

/** Strip markdown fences a model may wrap the JSON in. */
function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Grade one image. Throws when the model is unavailable so the caller can tell
 * "scored badly" apart from "could not be scored" - silently recording a zero
 * would permanently bury a perfectly good photo.
 */
export async function scoreProductImage(imageBytes: Uint8Array): Promise<ImageVerdict> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set, so images cannot be scored')

  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'file', mediaType: 'image/jpeg', data: imageBytes },
        ],
      },
    ],
  })

  const parsed = parseJson(text)
  if (!parsed) throw new Error('The scoring model did not return usable JSON')

  const scores: ImageScores = {
    clarity: clamp(parsed.clarity),
    framing: clamp(parsed.framing),
    lighting: clamp(parsed.lighting),
    background: clamp(parsed.background),
    textFree: clamp(parsed.textFree),
  }

  return {
    scores,
    total: weightedTotal(scores),
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
  }
}

/** Human-readable label for a 0-100 total. */
export function qualityLabel(total: number): string {
  if (total >= 80) return 'Excellent'
  if (total >= 65) return 'Good'
  if (total >= 45) return 'Usable'
  return 'Poor'
}
