/**
 * "We can deliver next week instead" - changing an order that already exists.
 *
 * Until now the inbox could only CREATE an order. When a customer asked to move
 * the day, change the quantity, deliver somewhere else or swap the item, the
 * agent promised it in the chat and the row in Deliveries kept its old values,
 * so the rider still went on the old day to the old address. (Measured 18 Sep:
 * 179 open future orders across 5 different creators, so this happens on other
 * agents' orders too.)
 *
 * The Quick Order panel already holds what we are about to promise - the AI
 * fills it from the conversation. So an amendment is the DIFFERENCE between the
 * panel and the open order, applied when the message goes out.
 *
 * THE MESSAGE DECIDES, NOT THE PANEL. A field is only applied automatically
 * when the text being sent states the new value as a fact. A real draft on
 * Sungalee Malini's thread reads:
 *
 *   "...we can deliver next week instead. Should we deliver to Rose Hill or do
 *    you prefer another location? Please confirm ... for Monday 21 September."
 *
 * The day is promised, so the date moves. The address is still a QUESTION, and
 * the panel happened to hold a stale "Ebene" - applying that silently would
 * have sent the rider to an address nobody agreed to. Unconfirmed changes are
 * listed for the agent to tick instead of being written behind their back.
 */

import { wantsDifferentItem } from './after-sales'

/** The order fields a conversation is allowed to change after the fact. */
export type AmendableField = 'deliveryDate' | 'qty' | 'region' | 'product'

export type Amendment = {
  field: AmendableField
  /** What the order says today, for display. */
  from: string
  /** What the panel proposes, for display. */
  to: string
  /** The value to send to the server. */
  value: string | number
  /** The outgoing message states this new value as a fact: safe to apply. */
  confirmed: boolean
  /** Why it was not auto-selected, shown beside the unticked row. */
  hold?: string
}

const LABELS: Record<AmendableField, string> = {
  deliveryDate: 'Delivery date',
  qty: 'Quantity',
  region: 'Locality',
  product: 'Product',
}

export function amendmentLabel(field: AmendableField): string {
  return LABELS[field]
}

/** Lowercase, accent-free, punctuation kept (sentence ends matter). */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * Sentences, so "deliver to Rose Hill?" can be told apart from "deliver to
 * Rose Hill." A newline ends a sentence too: the confirmation template is a
 * list of lines, most of which carry no full stop.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Does the message ASSERT this value, or only ask about it?
 *
 * A sentence ending in "?" is a question - the customer has not agreed yet, so
 * whatever it mentions is not a promise we can act on.
 */
function assertedIn(text: string, matches: (sentence: string) => boolean): { stated: boolean; askedOnly: boolean } {
  const hits = sentences(text).filter((s) => matches(fold(s)))
  if (!hits.length) return { stated: false, askedOnly: false }
  const asserted = hits.filter((s) => !s.trimEnd().endsWith('?'))
  return { stated: asserted.length > 0, askedOnly: asserted.length === 0 }
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * Does the sentence name this date?
 *
 * Accepts "Monday 21 September", "21 Sept", "21/09", "2026-09-21" and a bare
 * weekday when the sentence carries no competing day number. A bare day number
 * alone is NOT enough: "Rs 375" and "12 tablets" are digits too.
 */
function namesDate(sentence: string, ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return false
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  const month = MONTHS[m - 1]
  const monthShort = month.slice(0, 3)

  const numeric = new RegExp(`\\b${d}\\s*[/-]\\s*0?${m}\\b|\\b${y}-0?${m}-0?${d}\\b`)
  if (numeric.test(sentence)) return true

  const dayNumber = new RegExp(`\\b${d}(?:st|nd|rd|th)?\\b`)
  const hasDay = dayNumber.test(sentence)
  const hasMonth = new RegExp(`\\b${monthShort}[a-z]*\\b`).test(sentence)
  const hasWeekday = new RegExp(`\\b${weekday}\\b`).test(sentence)

  if (hasDay && (hasMonth || hasWeekday)) return true
  // "We'll come Monday" - trustworthy only when no other number could be the day.
  return hasWeekday && !/\b\d{1,2}\b/.test(sentence.replace(/rs\.?\s*\d[\d,.]*/g, ''))
}

/** Quantities the sentence actually states: "2 x", "x2", "3 pcs", "qty 2". */
function statedQuantities(sentence: string): number[] {
  const found: number[] = []
  const patterns = [
    /\b(\d{1,3})\s*(?:x|×)\b/g,
    /\b(?:x|×)\s*(\d{1,3})\b/g,
    /\b(\d{1,3})\s*(?:pcs|pieces?|units?|nos)\b/g,
    /\bqty\s*:?\s*(\d{1,3})\b/g,
    /\b(?:quantity|quantite)\s*(?:to|:)?\s*(\d{1,3})\b/g,
  ]
  for (const re of patterns) {
    for (const match of sentence.matchAll(re)) found.push(Number(match[1]))
  }
  return found
}

/** Words worth matching on: drops sizes, counts and filler from a product name. */
function distinctiveWords(name: string): string[] {
  return fold(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'pcs', 'set', 'pack'].includes(w))
}

/**
 * Does the sentence name this product or locality? The full phrase counts, and
 * so do two or more distinctive words - "EMS massager" for "EMS Foot Massager",
 * the same "touch" rule the ad-product override already uses.
 */
function namesThing(sentence: string, value: string): boolean {
  const folded = fold(value).trim()
  if (!folded) return false
  if (sentence.includes(folded)) return true
  const words = distinctiveWords(value)
  if (words.length < 2) return false
  const present = words.filter((w) => new RegExp(`\\b${w}\\b`).test(sentence))
  return present.length >= Math.min(2, words.length)
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

/** Words that make an outgoing sentence a promise about where the parcel goes. */
const SENDING = /\b(deliver\w*|deliveries|send\w*|sent|bring\w*|drop\w*|ship\w*|come|coming|arrive\w*|reach\w*|livr\w*|apport\w*|amenn?\w*|depoz\w*)\b/i

/**
 * A locality WE promised in this message that is not the one on the order.
 *
 * Only read from a sentence that also talks about sending the order, because
 * the agent's own words mention places for other reasons ("our Rose Hill team
 * packs it"). The panel path needs no such verb - a human picked it there on
 * purpose; here the message is the only evidence, so it has to be explicit.
 */
function promisedRegion(text: string, regions: string[], current: string | null): string | null {
  for (const sentence of sentences(text)) {
    // A question is an offer, not a promise: "Rose Hill or another location?"
    // leaves the address where it is. assertedIn re-checks this for the tick.
    if (sentence.trimEnd().endsWith('?')) continue
    const folded = fold(sentence)
    if (!SENDING.test(folded)) continue
    const hit = regions.find((r) => r && !sameText(r, current) && namesThing(folded, r))
    if (hit) return hit
  }
  return null
}

export type OpenOrderSnapshot = {
  deliveryDate: string | null
  qty: number | null
  locality: string | null
  products: string | null
}

export type ProposedOrder = {
  deliveryDate: string
  qty: number
  region: string
  productName: string | null
}

/**
 * What this message changes on an order that already exists.
 *
 * Returns [] when nothing differs - the normal case, because the panel is
 * prefilled FROM the open order.
 */
export function detectAmendments(input: {
  open: OpenOrderSnapshot
  next: ProposedOrder
  /** The message about to be sent. */
  text: string
  /** Every locality we deliver to, so a promise in the message can be recognised. */
  regions?: string[]
}): Amendment[] {
  const { open, next, text } = input
  const out: Amendment[] = []

  const add = (
    field: AmendableField,
    from: string,
    to: string,
    value: string | number,
    check: { stated: boolean; askedOnly: boolean },
  ) => {
    out.push({
      field,
      from,
      to,
      value,
      confirmed: check.stated,
      hold: check.stated
        ? undefined
        : check.askedOnly
          ? 'the message only asks about it'
          : 'the message does not state it',
    })
  }

  const openDate = open.deliveryDate?.slice(0, 10) || ''
  if (next.deliveryDate && openDate && next.deliveryDate !== openDate) {
    add('deliveryDate', openDate, next.deliveryDate, next.deliveryDate,
      assertedIn(text, (s) => namesDate(s, next.deliveryDate)))
  }

  const openQty = Number(open.qty ?? 0)
  if (next.qty > 0 && openQty > 0 && next.qty !== openQty) {
    add('qty', String(openQty), String(next.qty), next.qty,
      assertedIn(text, (s) => statedQuantities(s).includes(next.qty)))
  }

  // The address can move two ways. Normally the agent picks it in the panel and
  // the message has to back it up. But the message can also be the only place it
  // changes: when the draft promises "we'll deliver to Rose Hill instead" while
  // the panel still holds Ebene, the diff is empty and the promise would be sent
  // with the rider still going to Ebene. Whatever we TELL the customer is what
  // the order must do, so the promised locality is proposed on its own.
  const promised = next.region && open.locality && !sameText(next.region, open.locality)
    ? next.region
    : promisedRegion(text, input.regions ?? [], open.locality)
  if (promised && open.locality && !sameText(promised, open.locality)) {
    add('region', open.locality.trim(), promised, promised,
      assertedIn(text, (s) => namesThing(s, promised)))
  }

  // A DIFFERENT product is normally a second item riding with the open order -
  // the add-on path, which already works and must not be turned into a swap.
  // Only an explicit "instead of / change it to" makes it a change of THIS row.
  if (next.productName && open.products && !sameText(next.productName, open.products) && wantsDifferentItem(text)) {
    add('product', open.products.trim(), next.productName, next.productName,
      assertedIn(text, (s) => namesThing(s, next.productName!)))
  }

  return out
}

/** One line for the toast / activity note: "delivery date 2026-09-19 to 2026-09-21". */
export function describeAmendments(applied: Amendment[]): string {
  return applied.map((a) => `${amendmentLabel(a.field).toLowerCase()} ${a.from} to ${a.to}`).join(', ')
}
