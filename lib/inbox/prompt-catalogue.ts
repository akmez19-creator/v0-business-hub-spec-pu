/**
 * Which products go INTO THE PROMPT for an agent draft.
 *
 * The full catalogue (888 items, ~10k tokens) used to ride along on every
 * draft: $0.03 a draft and two simultaneous drafts filled the 30k tokens/min
 * limit. The model only ever needs the products this conversation can be
 * about, so the list is narrowed to:
 *
 *   1. the ad's product (always, when known) - most threads are about it;
 *   2. products named in the customer's past or open orders;
 *   3. products whose name shares a distinctive word with anything said in the
 *      thread, with a typo-tolerant prefix match ("masager" -> massager);
 *   4. products sharing a word with the AD PRODUCT NAME ("EMS Foot Massager"
 *      brings the other massagers), so "do you have the bigger one?" can be
 *      answered.
 *
 * Re-grounding after the model answers still uses the FULL catalogue on the
 * server, so a product the model names from memory is matched correctly and
 * nothing here can create a wrong order - it can only make the model ask
 * "which product?" where it previously had the list, and that is the right
 * answer when the thread genuinely names nothing.
 */

export interface PromptProduct { name: string }

const MAX_PROMPT_PRODUCTS = 40
/** Words too common across the catalogue to select an item on their own. */
const GENERIC = new Set([
  'with', 'and', 'for', 'the', 'set', 'pcs', 'pack', 'mini', 'portable', 'multi', 'multifunction', 'home', 'kitchen', 'new',
  'black', 'white', 'blue', 'pink', 'red', 'green', 'grey', 'gray', 'large', 'small', 'size', 'free', 'delivery', 'price', 'order',
  'rs', 'one', 'two', 'piece', 'pieces', 'pair', 'kit', 'usb', 'led', 'electric', 'automatic', 'smart', 'premium', 'quality',
  'plastic', 'stainless', 'steel', 'silicone', 'foldable', 'folding', 'adjustable', 'rechargeable', 'wireless', 'pro', 'max', 'plus',
])

export function normaliseWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
}

/**
 * One letter added, dropped or swapped counts as the same word on words of 5+
 * letters (masager/massager, vaccum/vacuum, stoll/stool). Shorter words must
 * match exactly - one edit on "lamp" reaches too many other words.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

export function shortlistForPrompt<T extends PromptProduct>(input: {
  catalogue: T[]
  productHint?: string | null
  adName?: string | null
  transcript: string
  orderProductNames?: Array<string | null | undefined>
}): T[] {
  const entries = input.catalogue.map((p) => ({ p, words: normaliseWords(p.name) }))

  // Word frequency across the catalogue: a word on <= 8 products is distinctive
  // enough to pick items by itself; "cleaner" (dozens) needs a second word.
  const freq = new Map<string, number>()
  for (const e of entries) for (const w of new Set(e.words)) freq.set(w, (freq.get(w) ?? 0) + 1)
  const distinctive = (w: string) => (freq.get(w) ?? 0) <= 8

  const said = new Set(normaliseWords(input.transcript))
  const anchors = new Set([
    ...normaliseWords(input.productHint ?? ''),
    ...normaliseWords(input.adName ?? ''),
    ...(input.orderProductNames ?? []).flatMap((n) => normaliseWords(n ?? '')),
  ])

  const scored: Array<{ p: T; score: number }> = []
  for (const { p, words } of entries) {
    let score = 0
    const hitSaid = words.filter((w) => [...said].some((s) => sameWord(s, w)))
    const hitAnchor = words.filter((w) => [...anchors].some((a) => sameWord(a, w)))
    if (input.productHint && normaliseWords(input.productHint).join(' ') === words.join(' ')) score += 100
    if (hitAnchor.length >= 2 || hitAnchor.some(distinctive)) score += 20 + hitAnchor.length * 5
    if (hitSaid.length >= 2 || hitSaid.some(distinctive)) score += 10 + hitSaid.length * 5
    // A product fully named in the thread beats one sharing a single word.
    if (words.length && hitSaid.length === words.length) score += 30
    if (score) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
  return scored.slice(0, MAX_PROMPT_PRODUCTS).map((s) => s.p)
}
