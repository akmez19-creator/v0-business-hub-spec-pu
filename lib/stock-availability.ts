/**
 * "No stock" as REPORTED BY A PERSON, never inferred from the catalogue.
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT WAS WRONG
 * The first version guessed. It joined every outgoing row to `products` and
 * flagged anything marked `sold_out`, unzoned, or counted at zero. The owner
 * rejected that outright: "the stock logic is not good, here i can varies, do
 * not link no stock to it". He is right, and the data agrees - `quantity` is 0
 * on 239 of 851 live products purely because nobody has counted them, and a
 * missing zone means "sold out" or "never filled in" with no way to tell which.
 * Inferring a shortage from those accuses people on the strength of stale
 * catalogue admin.
 *
 * The real event has exactly two witnesses, and both are already at the shelf:
 *
 *   1. THE STOREKEEPER, while validating stock out. He now has a "none to
 *      give" button that writes `deliveries.no_stock`.
 *   2. THE RIDER, while validating his load in the morning. He already records
 *      what he ACTUALLY received in `contractor_daily_stock.received_qty`, so
 *      `received_qty < expected_qty` is a rider-reported shortage. That data
 *      has been there all along and nothing ever surfaced it: 33 short rows,
 *      20 of them where he got none at all.
 *
 * This module reads those two reports and nothing else. If neither man said a
 * word, there is no shortage to show - that is the correct answer, not a gap
 * to be filled with a guess.
 */

export type ShortageSource = 'storekeeper' | 'rider'

export interface ShortageItem {
  /** Delivery id for a storekeeper report, daily-stock id for a rider one. */
  id: string
  product: string
  contractorId: string
  contractorName: string
  date: string
  /** Units nobody could hand over: the line qty, or expected minus received. */
  qty: number
  source: ShortageSource
  /** Rider reports carry both figures; the storekeeper's is all-or-nothing. */
  expectedQty?: number
  receivedQty?: number
  customer?: string
  reportedAt?: string | null
  /** Free-text reason typed at the time, when the reporter gave one. */
  note?: string
  /**
   * Admin ruling on a RIDER report. null = nobody has decided yet, and the
   * units stay on the storekeeper's returns list until somebody does.
   * 'confirmed' drops them from that list; 'rejected' puts them back.
   */
  review?: 'confirmed' | 'rejected' | null
  reviewedAt?: string | null
  reviewNote?: string | null
}

export interface ShortageGroup {
  key: string
  product: string
  qty: number
  items: ShortageItem[]
  /** Which side reported it. Both at once is the strongest signal there is. */
  sources: ShortageSource[]
  contractors: string[]
  latestDate: string
}

export interface OutgoingRowLike {
  id: string
  delivery_date: string
  contractor_id: string | null
  products: string | null
  qty: number | null
  sales_type: string | null
  customer_name?: string | null
  no_stock_at?: string | null
  replacement_from_van?: boolean | null
}

export interface DailyStockRowLike {
  id: string
  contractor_id: string | null
  stock_date: string
  product: string | null
  expected_qty: number | null
  received_qty: number | null
  shortfall_review?: 'confirmed' | 'rejected' | null
  shortfall_reviewed_at?: string | null
  shortfall_review_note?: string | null
}

/**
 * Everything the storekeeper and the rider reported.
 *
 * Deliberately unbounded on date so the caller decides the window: a shortage
 * from last week is still a shortage, and defaulting to a narrow range is how
 * a page ends up looking clean while work rots behind it.
 */
export async function fetchShortageReports(db: any) {
  const [storekeeper, rider, contractors] = await Promise.all([
    db.from('deliveries')
      .select('id, delivery_date, contractor_id, products, qty, sales_type, ' +
              'customer_name, no_stock_at, replacement_from_van')
      .eq('no_stock', true),
    // THE ROW CAP. PostgREST silently returns at most 1000 rows and reports no
    // error, and this table already holds ~2100. Reading it plainly and
    // filtering in JS therefore lost 15 of 33 real shortage reports: the page
    // showed ONE rider short by ONE unit on a day that actually had five
    // reports and eight missing units - precisely the quiet undercount this
    // screen exists to catch.
    //
    // `.range(0, 49_999)` was tried here and DOES NOT WORK - measured, the
    // response is still exactly 1000 rows, so this screen was still hiding the
    // 22 oldest reports (only the newest days happened to survive, which is
    // why the bug looked fixed). A column-to-column filter is not expressible
    // either: `.filter('received_qty','lt','expected_qty')` sends the
    // right-hand side as a LITERAL and matches nothing.
    //
    // get_stock_shortfalls() does the comparison in SQL and returns only the
    // ~33 short rows, which no cap can truncate.
    db.rpc('get_stock_shortfalls'),
    db.from('contractors').select('id, name'),
  ])

  const nameById = new Map<string, string>(
    (contractors.data || []).map((c: any) => [c.id as string, (c.name as string) || 'Unassigned']),
  )

  return {
    storekeeperRows: (storekeeper.data || []) as OutgoingRowLike[],
    // The shortfall comparison itself, done here because PostgREST cannot
    // compare two columns. The null rule is the important part: `received_qty`
    // null means "not counted yet", NOT "got none" - reading it as zero would
    // invent a shortage for every uncounted row the moment somebody skips a
    // morning count.
    riderRows: ((rider.data || []) as DailyStockRowLike[]).filter(
      r => r.received_qty != null && (r.expected_qty ?? 0) > r.received_qty,
    ),
    nameById,
  }
}

/**
 * Folds the order text down so two reports of the same thing group together.
 *
 * Intentionally light, with NO catalogue lookup: the product may not be in the
 * catalogue at all, and that must never be a reason to hide what somebody
 * reported.
 */
function groupKey(product: string) {
  return product
    .toLowerCase()
    .replace(/\s*[-\u2013]\s*b1g1(\s+free)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Merges both report streams into one list per product.
 *
 * Grouped by product rather than by person on purpose: the question being
 * asked is "what did we run out of", and one product missing across four
 * riders is one supply problem, not four incidents.
 */
export function buildShortages(
  storekeeperRows: OutgoingRowLike[],
  riderRows: DailyStockRowLike[],
  nameById: Map<string, string>,
): ShortageGroup[] {
  const groups = new Map<string, ShortageGroup>()

  const push = (product: string, item: ShortageItem) => {
    const key = groupKey(product)
    if (!key) return
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        product: product.trim(),
        qty: 0,
        items: [],
        sources: [],
        contractors: [],
        latestDate: item.date,
      }
      groups.set(key, g)
    }
    g.items.push(item)
    g.qty += item.qty
    if (!g.sources.includes(item.source)) g.sources.push(item.source)
    if (item.contractorName && !g.contractors.includes(item.contractorName)) {
      g.contractors.push(item.contractorName)
    }
    if (item.date > g.latestDate) g.latestDate = item.date
  }

  for (const r of storekeeperRows) {
    const product = (r.products || '').trim()
    if (!product) continue
    // A refund sends nothing out, and a van replacement was already counted on
    // an earlier load. Neither can be a shortage even if flagged by mistake.
    if ((r.sales_type || '').toLowerCase() === 'refund') continue
    if (r.replacement_from_van) continue
    push(product, {
      id: r.id,
      product,
      contractorId: r.contractor_id || '',
      contractorName: nameById.get(r.contractor_id || '') || 'Unassigned',
      date: r.delivery_date,
      qty: Math.max(0, r.qty ?? 1),
      source: 'storekeeper',
      customer: (r.customer_name || '').trim() || undefined,
      reportedAt: r.no_stock_at ?? null,
    })
  }

  for (const r of riderRows) {
    const product = (r.product || '').trim()
    if (!product) continue
    const expected = r.expected_qty ?? 0
    const received = r.received_qty ?? 0
    const missing = expected - received
    if (missing <= 0) continue
    push(product, {
      id: r.id,
      product,
      contractorId: r.contractor_id || '',
      contractorName: nameById.get(r.contractor_id || '') || 'Unassigned',
      date: r.stock_date,
      // The GAP, not the whole line - he did receive `received_qty` of them.
      qty: missing,
      source: 'rider',
      expectedQty: expected,
      receivedQty: received,
      // Carried so the admin screen can show what still needs a decision.
      // Only a rider report is reviewable: the storekeeper's "none to give" is
      // made BY the store, so there is nothing for the store to confirm.
      review: r.shortfall_review ?? null,
      reviewedAt: r.shortfall_reviewed_at ?? null,
      reviewNote: r.shortfall_review_note ?? null,
    })
  }

  // Most recent first: a shortage this morning matters more than one in April.
  return [...groups.values()].sort(
    (a, b) => (a.latestDate < b.latestDate ? 1 : a.latestDate > b.latestDate ? -1 : b.qty - a.qty),
  )
}
