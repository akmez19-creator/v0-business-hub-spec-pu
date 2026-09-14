import { generateText, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { titleCase } from '@/lib/products/title-case'
import { PRODUCT_CATEGORIES, normaliseCategory, type ProductCategory } from '@/lib/products/categories'

/**
 * THE house naming logic - one module, used by everything that names a product.
 *
 * The owner's request: "when create a product, name should have the same logic
 * as the one that got through all my products and suggest a name based on
 * picture, two words; the AI sees the product names of all the system; the
 * product should be well categorised too."
 *
 * That logic lived INSIDE the PO import's `suggest-names` route, so the one
 * other place that mints products - "Create in inventory" on the local
 * purchasing page - could not reach it. It used the stock-count identifier
 * instead, whose job is to say WHAT AN OBJECT IS ("air fryer silicone pot"),
 * not what the shop CALLS it ("Silicone Pot"). Two vocabularies, one catalogue,
 * and the duplicates that follow. Moving the rules here means the PO import
 * and the create dialog cannot drift apart again: same prompt, same two-word
 * clamp, same Title Case, same category list.
 *
 * Category is part of naming, not an afterthought: the same photo that says
 * "Meat Slicer" says "Kitchen & Dining", and asking once is cheaper and more
 * consistent than a second call. The model may only pick from the canonical
 * list in categories.ts (stored verbatim in products.category) or say none -
 * `normaliseCategory` throws away anything it invents.
 */

export type HouseNameInput = {
  /** Public photo URL - the strongest signal. Optional: text-only is allowed. */
  imageUrl?: string | null
  /** What it is called today: an inventory name, an Excel cell, a supplier's invoice line. */
  currentName: string
  /**
   * Every product name the shop already uses. This is how a new name lands in
   * the house style rather than the model's own ("Silicone Pot", not
   * "Silicone Cooking Vessel"), and how it reuses an existing term instead of
   * coining a synonym. Send them all - ~850 names is a few thousand tokens.
   */
  vocabulary: string[]
  /**
   * How the shop files things: a few real (name -> category) pairs per
   * category. Teaches the boundary cases the list alone cannot ("Sweeping
   * Robot" is Home Appliances here, not Electronics).
   */
  categoryExamples?: { name: string; category: string }[]
}

export type HouseNameResult = {
  /** Two Title Case words (three only when the model insisted). */
  name: string
  /** One of PRODUCT_CATEGORIES, or null when nothing fits - never a guess. */
  category: ProductCategory | null
  /** Under eight words, for the person deciding whether to accept. */
  reason: string
  /** Whether a photo was actually seen. Text-only names are weaker. */
  source: 'vision' | 'text'
}

/** Enforce the 2-word rule (3 only when the model insisted and it reads well). */
export function clampWords(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 3) return words.join(' ')
  // Keep the last two words: the head noun almost always sits at the end
  // ("Stainless Steel Meat Slicer" -> "Meat Slicer").
  return words.slice(-2).join(' ')
}

export function cleanName(raw: string): string {
  const stripped = raw
    .replace(/["'`\u201c\u201d]/g, '')
    .replace(/[^A-Za-z0-9 \-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return titleCase(clampWords(stripped))
}

export const HOUSE_NAME_SYSTEM =
  'You name consumer products for the inventory of a Mauritius delivery shop. ' +
  'You are given a photo and/or the current messy name, plus the vocabulary the shop already uses. ' +
  'Return the single best retail product name and the category it belongs in.\n' +
  'HARD RULES FOR THE NAME:\n' +
  '- Exactly TWO words. Use three ONLY when two words genuinely cannot identify the product.\n' +
  '- Title Case (e.g. "Meat Slicer"). Keep real acronyms uppercase (LED, USB, PVC).\n' +
  '- Reuse the shop vocabulary when a matching term already exists, so names stay consistent.\n' +
  '- Describe WHAT THE PRODUCT IS, not its colour, quantity, packaging or brand.\n' +
  '- No model numbers, no sizes, no marketing words ("premium", "high quality", "hot sale").\n' +
  '- If the current name is already good and only has bad casing or a typo, just fix that.\n' +
  'HARD RULES FOR THE CATEGORY:\n' +
  `- Pick EXACTLY ONE of these, spelled exactly: ${PRODUCT_CATEGORIES.join(' | ')}.\n` +
  '- Follow the shop\'s own filing shown in the examples when the product is similar to one of them.\n' +
  '- If none of them fits, use null. Never invent a category.\n' +
  'Reply with STRICT JSON only, no markdown fence: {"name":"Two Words","category":"One Of The List","reason":"under 8 words"}'

function parseAnswer(raw: string): { name: string; category: string | null; reason: string } | null {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    const o = JSON.parse(cleaned.slice(start, end + 1)) as { name?: unknown; category?: unknown; reason?: unknown }
    if (!o.name || typeof o.name !== 'string') return null
    return {
      name: o.name,
      category: typeof o.category === 'string' ? o.category : null,
      reason: typeof o.reason === 'string' ? o.reason : '',
    }
  } catch {
    return null
  }
}

/** One generateText call with the gateway, falling back to a direct Gemini key. */
export async function runNamingModel(system: string, messages: ModelMessage[]) {
  try {
    const { text } = await generateText({ model: 'google/gemini-3-flash', system, messages })
    return text
  } catch (gatewayError) {
    const googleKey = process.env.GOOGLE_AI_API_KEY
    if (!googleKey) throw gatewayError
    console.error(
      '[v0] house-name: gateway failed, falling back to Gemini:',
      gatewayError instanceof Error ? gatewayError.name : gatewayError,
    )
    const google = createGoogleGenerativeAI({ apiKey: googleKey })
    const { text } = await generateText({ model: google('gemini-2.5-flash'), system, messages })
    return text
  }
}

/**
 * Turns the vocabulary and examples into the prompt's teaching block. Capped
 * so a runaway catalogue cannot blow the context, but the cap is generous:
 * the point is that the model sees the shop's names, not a sample of them.
 */
function teachingBlock(input: HouseNameInput): string {
  const vocab = input.vocabulary.filter(Boolean).join(', ').slice(0, 24_000)
  const examples = (input.categoryExamples ?? [])
    .map((e) => `${e.name} -> ${e.category}`)
    .join('\n')
    .slice(0, 6_000)
  return (
    `Shop vocabulary already in use:\n${vocab || '(none yet)'}` +
    (examples ? `\n\nHow the shop files products (name -> category):\n${examples}` : '')
  )
}

/**
 * Names and categorises ONE product. Returns null when the model gave nothing
 * usable; callers keep whatever name they had.
 */
export async function houseName(input: HouseNameInput): Promise<HouseNameResult | null> {
  const hasImage = !!input.imageUrl && /^https?:\/\//i.test(input.imageUrl)
  const current = input.currentName.trim()
  const prompt = hasImage
    ? `Name and categorise the product in this photo. The shop currently calls it "${current}" - trust the photo over that label if they disagree.\n\n${teachingBlock(input)}`
    : `Give the best two-word retail name and the category for a product currently called "${current}". There is no photo, so keep the meaning of the current name and only fix wording, casing or spelling.\n\n${teachingBlock(input)}`

  const content: ({ type: 'text'; text: string } | { type: 'image'; image: URL })[] = [{ type: 'text', text: prompt }]
  if (hasImage) {
    try {
      content.push({ type: 'image', image: new URL(input.imageUrl as string) })
    } catch {
      // Malformed URL - fall through as a text-only request.
    }
  }

  const raw = await runNamingModel(HOUSE_NAME_SYSTEM, [{ role: 'user', content }])
  const parsed = parseAnswer(raw)
  if (!parsed) return null
  const name = cleanName(parsed.name)
  if (!name) return null
  return {
    name,
    category: normaliseCategory(parsed.category),
    reason: parsed.reason,
    source: content.length > 1 ? 'vision' : 'text',
  }
}
