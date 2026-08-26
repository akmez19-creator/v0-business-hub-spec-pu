/**
 * WHAT PHYSICALLY CAME BACK TO THE STORE - the single source of truth.
 *
 * Any screen asking "what should I expect off this van?" MUST call
 * `incomingToStore()` rather than re-deriving it. Three screens used to answer
 * this differently and disagreed with each other.
 *
 * THE BUG THIS REPLACES (live, measured on 26 Aug 2026):
 * the returns pages asked `isReturnType ? return_product : products`, which
 * IGNORES THE STATUS. 9 of 125 pending rows were wrong:
 *   - 6 rows still `assigned`/`pending` - the rider has not gone yet, nothing
 *     has come back, yet they were listed to be counted.
 *   - 2 `trade_in`/`exchange` + `cms` - the client was never met, so they KEPT
 *     their old item and the REPLACEMENT came back unsold. The screen named the
 *     old item, still in the client's house, while the replacement physically
 *     in front of the storekeeper went unbooked.
 *   - 1 `refund` + `cms` - a refund carries nothing out and cms means the
 *     client was never met, so nothing was collected either. Pure phantom: a
 *     row that could never be found, so the list could never reach zero.
 */

/** Follow-ups: a client is being settled, not just goods moving. */
export const FOLLOW_UP_SALES_TYPES = ['exchange', 'trade_in', 'refund'] as const
export type FollowUpSalesType = (typeof FOLLOW_UP_SALES_TYPES)[number]

export function isFollowUp(salesType?: string | null): boolean {
  return !!salesType && (FOLLOW_UP_SALES_TYPES as readonly string[]).includes(salesType)
}

/** `IN: x` / `IN : x` / `in: x` all appear in live data. Strip the marker. */
export function stripInPrefix(s: string): string {
  return s.replace(/^\s*in\s*:\s*/i, '').trim()
}

/**
 * True when the row sends goods OUT to the client.
 *
 * Only a refund does not: the client hands the item back and takes their money.
 * Trade-ins and exchanges DO send a replacement out, and only their
 * `return_product` comes back.
 *
 * Tests for 'refund' positively rather than `!== 'refund'` on a nullable
 * column, so a null/unknown sales_type keeps the ordinary "goods go out"
 * behaviour instead of silently disappearing from stock. All 284 undelivered
 * orders carry a NULL sales_type, so this is the common case, not an edge one.
 */
export function movesStockOut(salesType: string | null | undefined): boolean {
  return String(salesType || '').trim().toLowerCase() !== 'refund'
}

/**
 * Units of `products` leaving the warehouse / going onto the van.
 *
 * Use `?? 1`, never `|| 1`: a stored 0 is a deliberate "nothing goes out",
 * while a genuinely absent qty still means the ordinary single-item row.
 * Reading that 0 through `qty || 1` is what made refunds reserve a unit that
 * never left the warehouse.
 */
export function outgoingQty(row: {
  qty?: number | string | null
  sales_type?: string | null
  replacement_from_van?: boolean | null
}): number {
  if (!movesStockOut(row.sales_type)) return 0
  // The replacement was handed over from stock the rider was ALREADY carrying,
  // because the follow-up was raised after the storekeeper validated the day's
  // load. That load sheet is fixed, so counting this unit again would invent a
  // shortage against what was physically counted onto the van. The unit is
  // still gone from the warehouse - it was counted when the van was loaded.
  if (row.replacement_from_van === true) return 0
  const n = Number(row.qty ?? 1)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

/**
 * Units coming back, read off the `return_product` text.
 *
 * composeReturnLine() writes "Product x3" when more than one unit returns, so
 * the trailing count is the only place a return quantity is recorded - it
 * cannot live in `qty`, which describes what the rider CARRIES OUT. Matches
 * only a trailing " xN" to avoid eating real names: nothing in the live
 * catalogue ends that way, but "Set of 4" style suffixes must survive.
 */
export function parseReturnCount(returnProduct: string | null | undefined): number {
  const text = String(returnProduct || '').trim()
  const m = text.match(/\sx(\d+)\s*$/i)
  if (!m) return 1
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** The return label without its trailing " xN" count. */
export function stripReturnCount(returnProduct: string | null | undefined): string {
  return String(returnProduct || '').replace(/\sx\d+\s*$/i, '').trim()
}

/**
 * Units coming BACK from the client on a follow-up row.
 *
 * Deliberately does NOT fall back to `qty`. On a trade-in the two are different
 * numbers, and on a refund `qty` is 0, so borrowing it would either over-count
 * the return or wipe it out entirely.
 */
export function incomingQty(row: {
  sales_type?: string | null
  return_product?: string | null
}): number {
  if (!isFollowUp(String(row.sales_type || '').trim().toLowerCase())) return 0
  if (!String(row.return_product || '').trim()) return 0
  return parseReturnCount(row.return_product)
}

/**
 * How many units of a product can PHYSICALLY come back off a van.
 *
 * A CMS row means "went out, customer missed, comes back" - but that first step
 * is an ASSUMPTION. When the storekeeper had none to give, or handed over fewer
 * than the day's orders needed, the missing units never reached the van and
 * cannot return from it. The returns screens still listed them, so the
 * storekeeper hunted for goods that had never left his own shelf and the
 * pending count could never reach zero.
 *
 * The cap is derived from what actually happened, not from the shortfall,
 * because a shortfall does not say WHICH orders went unserved:
 *
 *     returnable = received - delivered
 *
 * Whatever the rider was actually handed, minus whatever he actually gave away,
 * is what is still in the van. Nothing else can be.
 *
 * Only ever call this with a CONFIRMED received count. `received_qty` is seeded
 * equal to `expected_qty` when the day's stock rows are generated, so on an
 * unvalidated row it is a placeholder, not a measurement - trusting it would
 * invent shortages.
 */
export function returnableAfterShortfall(received: number, delivered: number): number {
  const r = Number(received)
  const d = Number(delivered)
  if (!Number.isFinite(r) || r <= 0) return 0
  if (!Number.isFinite(d) || d < 0) return r
  return Math.max(r - d, 0)
}

export type IncomingKind =
  /** Went out to be sold, nobody bought it, it came back. */
  | 'unsold'
  /** A follow-up completed: the client's own item was handed over. */
  | 'collected'
  /** A follow-up whose client was MISSED: the replacement came back instead. */
  | 'cms'

export interface IncomingRow {
  status?: string | null
  sales_type?: string | null
  products?: string | null
  return_product?: string | null
  qty?: number | string | null
}

export interface Incoming {
  /** The product to physically look for. Never invented - always off the row. */
  product: string
  qty: number
  kind: IncomingKind
}

/**
 * Returns what came back, or NULL when nothing did.
 *
 * NULL is a real answer and must be respected: rendering a row for it is how
 * the phantom above happened.
 */
export function incomingToStore(row: IncomingRow): Incoming | null {
  const status = (row.status || '').toLowerCase()
  const salesType = (row.sales_type || '').toLowerCase()
  const qty = Math.max(1, Number(row.qty) || 1)
  const followUp = isFollowUp(salesType)

  // NOTHING HAS HAPPENED YET. `assigned`, `pending`, `nwd` - the goods are
  // still on the van or still in the store. The old query pulled every
  // follow-up row regardless of status, which is how a refund the rider has
  // not even attempted yet (JASSAM / Aliza Zainub, 26 Aug) appeared on a
  // returns list.
  if (status !== 'cms' && status !== 'delivered') return null

  if (status === 'delivered') {
    // A plain delivered sale brings nothing back.
    if (!followUp) return null
    // A completed refund/exchange/trade-in: the CLIENT'S item changed hands.
    // `return_product` is the convention for it; fall back to the sold product
    // only when nothing else is recorded, since a refund returns that product.
    const raw = row.return_product || row.products
    if (!raw) return null
    return { product: stripInPrefix(raw), qty, kind: 'collected' }
  }

  // status === 'cms' - the client was never met.
  if (followUp) {
    // A refund hands nothing over, so with no client met, nothing came back.
    if (salesType === 'refund') return null
    // exchange / trade_in: the REPLACEMENT went out and returned unsold. The
    // client still has their old item, so naming `return_product` here sends
    // the storekeeper looking for something that is not in the building.
    if (!row.products) return null
    return { product: row.products.trim(), qty, kind: 'cms' }
  }

  // Ordinary unsold goods coming back.
  if (!row.products) return null
  return { product: row.products.trim(), qty, kind: 'unsold' }
}

/**
 * Units handed to a client off the rider's OWN van, rather than issued by the
 * store that morning.
 *
 * ONLY when `delivered`: a missed exchange never changed hands, so its
 * replacement is still in the van and must not be deducted.
 */
export function vanReplacementQty(row: IncomingRow & { replacement_from_van?: boolean | null }): number {
  if (!row.replacement_from_van) return 0
  if ((row.status || '').toLowerCase() !== 'delivered') return 0
  return Math.max(1, Number(row.qty) || 1)
}

/**
 * How much of a van re-issue may cancel out of the returns pile.
 *
 * THE CAP IS THE WHOLE POINT. A replacement can only cancel a unit the screen
 * is ALREADY counting as coming back - one that went out, was refused, and was
 * re-handed to someone else. If the rider used a SPARE he was carrying, that
 * spare is on no delivery row, was never counted as returning, and deducting
 * would push the pile one too LOW.
 */
export function deductibleVanReplacement(vanQty: number, cmsQtySameProduct: number): number {
  return Math.min(Math.max(0, vanQty), Math.max(0, cmsQtySameProduct))
}
