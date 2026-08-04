/**
 * Decides whether a search-result video actually shows the product you are
 * looking for, from a handful of frames rather than the whole file.
 *
 * Why frames and not the video: Gemini does ingest video directly, but a 30s
 * clip costs roughly 10k tokens. Five small stills cost about 1.3k and answer
 * the only question that matters here - "is this the product?" - just as well.
 * The frames are sampled evenly across the whole clip by the caller, so an
 * intro logo or a talking-head opener cannot dominate the verdict.
 *
 * This is deliberately a RELEVANCE judgement, not a quality one. Production
 * value is irrelevant if the clip is showing the wrong item, and a shaky phone
 * video of the right product is still useful footage.
 */

import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export interface ClipVerdict {
  /** 0-10: how confidently these frames show the requested product */
  relevance: number
  /** True when the product is clearly the subject, not incidental background */
  showsProduct: boolean
  /** One short sentence naming what was actually seen */
  reason: string
}

/**
 * Below this the clip is treated as "not this product" and can be collapsed
 * out of the grid. Set at 5 rather than higher because a false hide is much
 * worse than a false show: you can ignore a bad clip you can see, but you
 * cannot use good footage that was silently removed.
 */
export const RELEVANT_THRESHOLD = 5

const SYSTEM =
  'You judge whether frames taken from a short marketing video show a specific product. ' +
  'You are strict about identity: a different model, a different category, or an unrelated ' +
  'item scores low even when it looks superficially similar. Reply with JSON only, no prose, ' +
  'no markdown fences.'

function buildPrompt(productName: string): string {
  return `These frames are sampled evenly across one short video. The viewer is searching for this product:

"${productName}"

Judge whether the video actually features that product.

relevance: 0-10.
  10 = the product is clearly the subject, shown or demonstrated on screen.
  7-9 = the product appears clearly, though it shares focus with other things.
  4-6 = something in the same category, or possibly the product but hard to confirm.
  1-3 = a different product, or the product is barely visible background.
  0 = completely unrelated content, a person talking with no product shown, a slideshow of text, or pure logo/intro footage.

showsProduct: true only when a viewer would agree the video is ABOUT this product.

Score low for compilations, reaction videos, unrelated marketplace hauls, and clips that are mostly text overlays or watermarks.

Reply with exactly this JSON shape:
{"relevance":0,"showsProduct":false,"reason":"one short sentence naming what is actually shown"}`
}

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

function clamp(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(Math.max(v, 0), 10)
}

/**
 * Grade one clip from its sampled frames.
 *
 * Throws rather than returning a zero when the model is unavailable, so the
 * caller can distinguish "this clip is irrelevant" from "we could not tell".
 * Recording a zero for an infrastructure failure would hide good footage.
 */
export async function scoreClipRelevance(
  frames: Uint8Array[],
  productName: string,
): Promise<ClipVerdict> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set, so clips cannot be scored')
  if (!frames.length) throw new Error('No frames were captured from this clip')

  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(productName) },
          // All frames in ONE call: the model can then reason about change over
          // time (is the product handled? demonstrated?) instead of returning
          // five separate opinions that would need reconciling.
          ...frames.map((data) => ({ type: 'file' as const, mediaType: 'image/jpeg', data })),
        ],
      },
    ],
  })

  const parsed = parseJson(text)
  if (!parsed) throw new Error('The relevance model did not return usable JSON')

  const relevance = clamp(parsed.relevance)
  return {
    relevance,
    // Trust the explicit boolean, but never let it contradict a low score
    showsProduct: Boolean(parsed.showsProduct) && relevance >= RELEVANT_THRESHOLD,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
  }
}

/** Short human label for a 0-10 relevance score. */
export function relevanceLabel(relevance: number): string {
  if (relevance >= 8) return 'Exact match'
  if (relevance >= RELEVANT_THRESHOLD) return 'Likely match'
  if (relevance >= 3) return 'Different item'
  return 'Unrelated'
}
