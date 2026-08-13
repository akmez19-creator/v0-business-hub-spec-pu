import { generateText, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export const maxDuration = 300

interface IncomingItem {
  key: string // the Excel product name, used to correlate the response
  currentName: string // name shown today (inventory name if mapped, else Excel name)
  imageUrl?: string | null // product photo - the strongest naming signal
}

interface NameSuggestion {
  key: string
  suggested: string
  reason: string
  source: 'vision' | 'text'
}

/**
 * Title Case that leaves genuinely uppercase tokens alone (LED, USB, 3M) and
 * keeps short joiners lowercase unless they lead. Fixes "meat slicer" ->
 * "Meat Slicer" and "Solar Led Bulb" -> "Solar LED Bulb".
 */
const ACRONYMS = new Set([
  'LED', 'USB', 'TV', 'PVC', 'ABS', 'DC', 'AC', 'HD', 'SD', 'RGB',
  'BBQ', 'LCD', 'GPS', 'UV', 'XL', 'XXL', 'MM', 'CM', '3D', 'AA', 'AAA',
])
const MINOR = new Set(['and', 'or', 'for', 'to', 'of', 'with', 'in', 'on'])

export function titleCase(input: string): string {
  const words = input.trim().split(/\s+/)
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, '')
      if (ACRONYMS.has(bare.toUpperCase())) return bare.toUpperCase()
      const lower = w.toLowerCase()
      if (i > 0 && MINOR.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/** Enforce the 2-word rule (3 only when the model insisted and it reads well). */
function clampWords(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 3) return words.join(' ')
  // Keep the last two words: the head noun almost always sits at the end
  // ("Stainless Steel Meat Slicer" -> "Meat Slicer").
  return words.slice(-2).join(' ')
}

function cleanName(raw: string): string {
  const stripped = raw
    .replace(/["'`\u201c\u201d]/g, '')
    .replace(/[^A-Za-z0-9 \-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return titleCase(clampWords(stripped))
}

const SYSTEM =
  'You name consumer products for the inventory of a Mauritius delivery shop. ' +
  'You are given a photo and/or the current messy name, plus the vocabulary the shop already uses. ' +
  'Return the single best retail product name.\n' +
  'HARD RULES:\n' +
  '- Exactly TWO words. Use three ONLY when two words genuinely cannot identify the product.\n' +
  '- Title Case (e.g. "Meat Slicer"). Keep real acronyms uppercase (LED, USB, PVC).\n' +
  '- Reuse the shop vocabulary when a matching term already exists, so names stay consistent.\n' +
  '- Describe WHAT THE PRODUCT IS, not its colour, quantity, packaging or brand.\n' +
  '- No model numbers, no sizes, no marketing words ("premium", "high quality", "hot sale").\n' +
  '- If the current name is already good and only has bad casing or a typo, just fix that.\n' +
  'Reply with STRICT JSON only, no markdown fence: {"name":"Two Words","reason":"under 8 words"}'

function parseName(raw: string): { name: string; reason: string } | null {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    const o = JSON.parse(cleaned.slice(start, end + 1)) as { name?: string; reason?: string }
    if (!o.name || typeof o.name !== 'string') return null
    return { name: o.name, reason: typeof o.reason === 'string' ? o.reason : '' }
  } catch {
    return null
  }
}

/** One generateText call with the gateway, falling back to a direct Gemini key. */
async function runModel(system: string, messages: ModelMessage[]) {
  try {
    const { text } = await generateText({ model: 'google/gemini-3-flash', system, messages })
    return text
  } catch (gatewayError) {
    const googleKey = process.env.GOOGLE_AI_API_KEY
    if (!googleKey) throw gatewayError
    console.error(
      '[v0] suggest-names: gateway failed, falling back to Gemini:',
      gatewayError instanceof Error ? gatewayError.name : gatewayError,
    )
    const google = createGoogleGenerativeAI({ apiKey: googleKey })
    const { text } = await generateText({ model: google('gemini-2.5-flash'), system, messages })
    return text
  }
}

async function nameOne(item: IncomingItem, vocabulary: string): Promise<NameSuggestion | null> {
  const hasImage = !!item.imageUrl && /^https?:\/\//i.test(item.imageUrl)
  const prompt = hasImage
    ? `Name the product in this photo. The shop currently calls it "${item.currentName}" - trust the photo over that label if they disagree.\n\nShop vocabulary already in use:\n${vocabulary}`
    : `Give the best two-word retail name for a product currently called "${item.currentName}". There is no photo, so keep the meaning of the current name and only fix wording, casing or spelling.\n\nShop vocabulary already in use:\n${vocabulary}`

  const content: ({ type: 'text'; text: string } | { type: 'image'; image: URL })[] = [
    { type: 'text', text: prompt },
  ]
  if (hasImage) {
    try {
      content.push({ type: 'image', image: new URL(item.imageUrl as string) })
    } catch {
      // Malformed URL - fall through as a text-only request.
    }
  }

  try {
    const raw = await runModel(SYSTEM, [{ role: 'user', content }])
    const parsed = parseName(raw)
    if (!parsed) return null
    const suggested = cleanName(parsed.name)
    if (!suggested) return null
    return {
      key: item.key,
      suggested,
      reason: parsed.reason,
      source: content.length > 1 ? 'vision' : 'text',
    }
  } catch (err) {
    console.error('[v0] suggest-names failed for', item.key, err instanceof Error ? err.message : err)
    return null
  }
}

/** Run with a small concurrency cap so vision calls do not get rate limited. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      items?: IncomingItem[]
      inventoryNames?: string[]
    }
    const items = (body.items || []).filter(i => i && i.key && i.currentName)
    if (!items.length) {
      return Response.json({ success: false, error: 'No products supplied' }, { status: 400 })
    }
    // Cap per request so a 591-product import is paged by the client instead
    // of firing hundreds of vision calls in one function invocation.
    if (items.length > 60) {
      return Response.json(
        { success: false, error: 'Too many products in one request (max 60)' },
        { status: 400 },
      )
    }

    // A sample of real inventory names teaches the model the house style.
    const vocabulary = (body.inventoryNames || [])
      .filter(Boolean)
      .slice(0, 300)
      .join(', ')
      .slice(0, 6000)

    const settled = await mapLimited(items, 4, item => nameOne(item, vocabulary))
    const suggestions = settled.filter((s): s is NameSuggestion => !!s)

    // Only surface names that actually differ from what is there today.
    const changed = suggestions.filter(
      s => s.suggested.toLowerCase() !== (items.find(i => i.key === s.key)?.currentName || '').toLowerCase(),
    )

    return Response.json({
      success: true,
      suggestions,
      stats: {
        requested: items.length,
        named: suggestions.length,
        changed: changed.length,
        failed: items.length - suggestions.length,
      },
    })
  } catch (err) {
    console.error('[v0] suggest-names route error:', err)
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : 'Naming failed' },
      { status: 500 },
    )
  }
}
