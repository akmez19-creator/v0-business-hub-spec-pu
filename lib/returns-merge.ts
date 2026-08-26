/**
 * ONE ROW PER PRODUCT for the storekeeper's returns pile.
 *
 * He is counting a physical heap off a van, so rendering one row per ORDER
 * makes him add up in his head: JEFFREY's screen showed "Make Up Pen 1 /
 * Make Up Pen 1 / 1x Make Up Pen 1 / Car Restorer Cream 1 / Car Restorer
 * Cream 1" across 17 rows.
 *
 * The CONTRACTOR screen deliberately does NOT use this - he settles clients,
 * and two people returning the same item are two conversations. Only
 * `FOLLOW_UP_SALES_TYPES` is shared.
 *
 * Pure: no React, no server imports, so the DB-backed test can call it.
 */

export const FOLLOW_UP_SALES_TYPES = ['exchange', 'trade_in', 'refund'] as const
export type SettlementKind = (typeof FOLLOW_UP_SALES_TYPES)[number]

export function isFollowUpType(t?: string | null): t is SettlementKind {
  return !!t && (FOLLOW_UP_SALES_TYPES as readonly string[]).includes(t)
}

/**
 * Normalise a product string so the same physical item merges.
 *
 * NEVER substring matching - "Shampoo" matches "Shampoo Brush" and over-flags
 * 53 of 843 products. Exact equality on a normalised string only.
 */
export function returnMergeKey(raw?: string | null): string {
  let s = (raw || '').trim()
  if (!s) return ''

  // 1. The `IN:` convention marks the item coming BACK on a trade-in/exchange.
  //    Spelled at least three ways live: "IN : Juicer Blender",
  //    "IN: jUICER BLENDER", "in: GAP STorage". Without stripping it, the third
  //    Juicer Blender never merges with the other two.
  s = s.replace(/^\s*in\s*:\s*/i, '')

  // 2. A leading cart multiplier: "1x Make Up Pen - Set of 3" is the SAME
  //    product as "Make Up Pen - Set of 3". `qty` is the authority for units,
  //    so the prefix is redundant - EXCEPT when the string lists several
  //    products ("1x Mini Speaker - Blue, 1x Mini Speaker - White"), where the
  //    multiplier belongs to one item and dropping it would be a lie. No
  //    pending return row has a comma today; this is a guard, not dead code.
  if (!s.includes(',')) s = s.replace(/^\s*\d+\s*x\s+/i, '')

  // 3. DO NOT strip after " - ". It is real product data here ("Set of 4",
  //    "B1G1"), yet one live row is "IN: Electric Grinder - Client not
  //    satisfied" where the tail is a REASON. Nothing distinguishes them, so
  //    that row stays unmerged rather than folding into the wrong product.
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** How SHOUTY a label is - mid-word capitals. Lower wins a frequency tie. */
function shoutiness(s: string): number {
  let n = 0
  for (let i = 1; i < s.length; i++) {
    if (/[A-Z]/.test(s[i]) && /[a-zA-Z]/.test(s[i - 1])) n++
  }
  return n
}

/**
 * Pick the spelling to show. ALWAYS a string that exists in the data - never
 * invented, never title-cased into something nobody typed.
 *
 * Prefer a label not written as `IN:` (that prefix is bookkeeping, not a
 * name), then the most frequent, then the least shouty. Without the shoutiness
 * tie-break a trade-in-only pile displayed "jUICER BLENDER".
 */
export function pickDisplayLabel(labels: string[]): string {
  const usable = labels.map(l => (l || '').trim()).filter(Boolean)
  if (!usable.length) return 'Unknown Product'

  const freq = new Map<string, number>()
  for (const l of usable) freq.set(l, (freq.get(l) || 0) + 1)

  return [...freq.keys()].sort((a, b) => {
    const aIn = /^\s*in\s*:/i.test(a) ? 1 : 0
    const bIn = /^\s*in\s*:/i.test(b) ? 1 : 0
    if (aIn !== bIn) return aIn - bIn
    const f = (freq.get(b) || 0) - (freq.get(a) || 0)
    if (f !== 0) return f
    const sh = shoutiness(a) - shoutiness(b)
    if (sh !== 0) return sh
    return a.localeCompare(b)
  })[0]
}

export interface MergeableEntry {
  id: string
  product: string
  qty: number
  source: 'delivery' | 'return_collection'
  salesType?: string | null
  incomingKind?: 'unsold' | 'collected' | 'cms'
  customerName?: string | null
  gaveProduct?: string | null
  fromVan?: boolean
  date?: string
  riderName?: string
  /**
   * The day this order has been rescheduled to, if any.
   *
   * DISPLAY ONLY, and deliberately NOT part of the merge key: the goods came
   * back on `date` and are on the shelf now, so a reschedule must never move a
   * return to a different day or split one product pile in two. It exists so
   * the storekeeper can see a pile is going back out rather than assume it is
   * dead stock.
   */
  rescheduledTo?: string | null
}

export interface ReturnGroup<T extends MergeableEntry = MergeableEntry> {
  /** Product + settlement kind. Use `productKey` for per-product lookups. */
  key: string
  productKey: string
  settlementKind: SettlementKind | null
  label: string
  totalQty: number
  entries: T[]
  /**
   * Entries whose qty is 0 - a real data gap, never silently read as 1 here.
   *
   * NOT rendered on the storekeeper screen: `incomingToStore()` upstream already
   * floors qty at 1 (the same convention the outbound sheets use), so by the
   * time rows reach that screen a DB 0 has become a 1 and this can never be
   * non-zero there. Kept because this helper is also correct for callers that
   * do NOT go through `incomingToStore()`, and because it is the honest place
   * to catch the 4 live qty-0 rows if that flooring is ever revisited.
   */
  missingQtyCount: number
}

/** The settlement kind, or null for plain unsold stock. */
export function settlementKindOf(e: MergeableEntry): SettlementKind | null {
  // A follow-up whose client was MISSED is just unsold stock coming back:
  // nothing changed hands, so there is nobody to settle and it belongs in the
  // plain pile.
  if (e.incomingKind === 'cms') return null
  return isFollowUpType(e.salesType) ? e.salesType : null
}

/**
 * Merge by product AND settlement kind.
 *
 * Same product, DIFFERENT job = different row. A pile of 3 juicers that is
 * really 2 refusals plus one trade-in hid the trade-in behind an expander;
 * the trade-in has a client waiting, so it earns its own row.
 */
export function groupReturns<T extends MergeableEntry>(items: T[]): ReturnGroup<T>[] {
  const groups = new Map<string, ReturnGroup<T>>()

  for (const item of items) {
    const productKey = returnMergeKey(item.product)
    const settlementKind = settlementKindOf(item)
    const key = `${productKey}::${settlementKind ?? 'plain'}`

    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        productKey,
        settlementKind,
        label: item.product,
        totalQty: 0,
        entries: [],
        missingQtyCount: 0,
      }
      groups.set(key, g)
    }

    const qty = Number(item.qty) || 0
    g.entries.push(item)
    g.totalQty += qty
    if (qty === 0) g.missingQtyCount++
  }

  for (const g of groups.values()) {
    g.label = pickDisplayLabel(g.entries.map(e => e.product))
  }

  return [...groups.values()]
}

/**
 * Split a merged row's entries by the table they must be written to.
 * A single pile can span both: `deliveries.stock_verified` and
 * `return_collections.verified`.
 */
export function splitBySource<T extends MergeableEntry>(entries: T[]) {
  return {
    deliveryIds: entries.filter(e => e.source === 'delivery').map(e => e.id),
    collectionIds: entries.filter(e => e.source === 'return_collection').map(e => e.id),
  }
}
