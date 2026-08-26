/**
 * What is supposed to come BACK to the store, and whether anyone has confirmed
 * it arrived.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SHARED
 *
 * Two screens ask the same question from opposite ends:
 *
 *   - the storekeeper's Stock In page - "what am I counting today?"
 *   - the admin's Stock Validation page - "what did nobody ever count?"
 *
 * They must agree to the unit. This logic used to live inside the storekeeper
 * page, so an admin oversight screen would have had to re-implement
 * incomingToStore()/van-replacement handling and would have drifted the first
 * time either was touched - and the whole point of the admin screen is to be
 * believed when it says a unit is missing.
 *
 * IMPORTANT: verifying is only a FLAG. Nothing here restocks anything.
 * `get_product_stock_summary()` counts POs, in-transit China and undelivered
 * orders; a CMS row simply drops out of "undelivered" and is never added back
 * as on-hand. `stock_movements` exists but has 0 rows. So an unverified return
 * is stock that has left the system entirely - which is exactly the gap the
 * admin page exists to show.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { incomingToStore, vanReplacementQty, deductibleVanReplacement } from './stock-direction'
import { returnMergeKey } from './returns-merge'
import {
  fetchShortfallCaps,
  applyShortfallCaps,
  pendingShortfallFor,
  type ShortfallInfo,
} from './stock-shortfall'

/** Columns every inbound query must select. Listed once so a new consumer
 *  cannot forget one - omitting `replacement_from_van` silently reads
 *  `undefined`, and the van deduction then quietly never happens. */
export const INBOUND_DELIVERY_COLUMNS =
  'id, products, qty, delivery_date, stock_verified, stock_verified_at, stock_verified_by, ' +
  'rider_id, contractor_id, status, return_product, sales_type, customer_name, replacement_from_van'

export const INBOUND_COLLECTION_COLUMNS =
  'id, rider_id, product_name, qty, collection_date, verified, verified_at, verified_by, condition, notes'

/** Sales types that came off a named client and need settling, not just counting. */
export const INBOUND_FOLLOW_UP_TYPES = ['exchange', 'trade_in', 'refund'] as const

export interface InboundItem {
  id: string
  product: string
  qty: number
  date: string
  riderName: string
  verified: boolean
  /** When it was ticked in. Null while outstanding. */
  verifiedAt?: string | null
  /** Who ticked it. Used by the admin screen to separate storekeeper from admin. */
  verifiedBy?: string | null
  salesType?: string
  source: 'delivery' | 'return_collection'
  /** Set only on a completed follow-up - the client the item came off. */
  customerName?: string
  /**
   * Units the rider says he was never given, with no admin ruling yet. The
   * line is still counted - it is only marked, so the storekeeper knows it may
   * not be on the shelf rather than hunting for it.
   */
  unconfirmedShortfall?: number
}

export interface InboundContractor {
  id: string
  name: string
  items: InboundItem[]
  pendingQty: number
  verifiedQty: number
  /** Units re-handed to a client off the van, keyed by merge key. */
  vanReplacements: Record<string, number>
}

/** Raw shapes, only as far as the callers actually filter on them. */
export interface InboundDeliveryRow {
  id: string
  delivery_date: string
  stock_verified: boolean | null
  /** Needed to scope a row to one contractor's day, not just to the date. */
  contractor_id: string | null
  [key: string]: unknown
}

export interface InboundCollectionRow {
  id: string
  collection_date: string
  verified: boolean | null
  /** Collections carry the rider; the contractor comes via riderToContractor. */
  rider_id: string | null
  [key: string]: unknown
}

export interface InboundContext {
  riderMap: Map<string, string>
  riderToContractor: Map<string, string>
  contractorMap: Map<string, string>
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fetches every row that could put something in the storekeeper's hands, plus
 * the name lookups and the list of days that have any.
 *
 * Takes a service-role client: both callers already gate on role themselves,
 * and the storekeeper must be able to see other people's rows to count them.
 */
export async function fetchInboundReturns(adminDb: any): Promise<{
  deliveries: InboundDeliveryRow[]
  returnCollections: InboundCollectionRow[]
  ctx: InboundContext
  dates: string[]
  /** Confirmed caps plus unreviewed reports. Pass to buildContractorData() -
   *  omitting it silently restores the old over-counting, so every caller
   *  hands it straight through. */
  shortfallCaps: ShortfallInfo
}> {
  // 1. CMS status deliveries (full returns)
  const { data: cmsStatusDeliveries } = await adminDb
    .from('deliveries')
    .select(INBOUND_DELIVERY_COLUMNS)
    .eq('status', 'cms')
    .order('delivery_date', { ascending: false })

  // 2. COMPLETED follow-ups, where the item was actually taken off the client.
  //    Must be status 'delivered': a follow-up that is still pending/assigned,
  //    or that came back nwd, has collected nothing yet. Non-delivered rows of
  //    these types are handled by the CMS branch above via incomingToStore().
  const { data: returnTypeDeliveries } = await adminDb
    .from('deliveries')
    .select(INBOUND_DELIVERY_COLUMNS)
    .in('sales_type', INBOUND_FOLLOW_UP_TYPES as unknown as string[])
    .eq('status', 'delivered')
    .not('return_product', 'is', null)
    .order('delivery_date', { ascending: false })

  // Merge, dedupe, and drop rows that put nothing in the storekeeper's hands.
  // Filtering here (rather than only when building the groups) keeps the date
  // list and every total derived below consistent with what is on screen.
  const allReturns = [...(cmsStatusDeliveries || []), ...(returnTypeDeliveries || [])]
  const seenIds = new Set<string>()
  const deliveries = allReturns.filter((d: any) => {
    if (seenIds.has(d.id)) return false
    seenIds.add(d.id)
    return incomingToStore(d) !== null
  })

  const { data: returnCollections } = await adminDb
    .from('return_collections')
    .select(INBOUND_COLLECTION_COLUMNS)
    .order('collection_date', { ascending: false })

  const { data: riders } = await adminDb.from('riders').select('id, name, contractor_id')
  const { data: contractors } = await adminDb.from('contractors').select('id, name')
  const shortfallCaps = await fetchShortfallCaps(adminDb)

  const ctx: InboundContext = {
    riderMap: new Map((riders || []).map((r: any) => [r.id, r.name])),
    riderToContractor: new Map((riders || []).map((r: any) => [r.id, r.contractor_id])),
    contractorMap: new Map((contractors || []).map((c: any) => [c.id, c.name])),
  }

  const dates = [...new Set([
    ...deliveries.map((d: any) => d.delivery_date),
    ...(returnCollections || []).map((r: any) => r.collection_date),
  ])].filter(Boolean).sort().reverse() as string[]

  return { deliveries, returnCollections: returnCollections || [], ctx, dates, shortfallCaps }
}

/**
 * Groups inbound rows by contractor, resolving what physically arrives.
 *
 * `incomingToStore()` decides WHICH product and HOW MANY actually reach the
 * storekeeper's hands, and returns null for rows that deliver nothing - so a
 * refund the rider never got to hand over stops being listed as an item to
 * find. See lib/stock-direction.ts for the three cases.
 */
export function buildContractorData(
  deliveries: any[],
  returns: any[],
  ctx: InboundContext,
  shortfallInfo?: ShortfallInfo,
): InboundContractor[] {
  const { riderMap, riderToContractor, contractorMap } = ctx
  const groups = new Map<string, InboundContractor>()
  const shortfallCaps = shortfallInfo?.caps

  // Drop units that were never loaded onto the van before anything is counted.
  // Done here rather than inside incomingToStore() because the shortage lives
  // on contractor_daily_stock, keyed by van + day + product - a single
  // delivery row cannot see it. Only ADMIN-CONFIRMED shortages reach `caps`;
  // an unreviewed rider report is flagged below instead. See stock-shortfall.ts.
  if (shortfallCaps && shortfallCaps.size > 0) {
    const marked = (deliveries || []).map(d => {
      const leg = incomingToStore(d)
      return {
        row: d,
        qty: leg?.kind === 'cms' ? leg.qty : 0,
        isCms: leg?.kind === 'cms',
        contractorId: d.contractor_id,
        date: d.delivery_date,
        product: leg?.product ?? d.products,
      }
    })
    const { items: kept } = applyShortfallCaps(
      marked.filter(m => m.isCms),
      shortfallCaps,
    )
    // Survivors carry their (possibly reduced) qty back onto the row via
    // `qty`, which is what incomingToStore() reads for a CMS leg.
    const keptQty = new Map(kept.map(k => [k.row.id, k.qty]))
    deliveries = marked
      .filter(m => !m.isCms || keptQty.has(m.row.id))
      .map(m => (m.isCms ? { ...m.row, qty: keptQty.get(m.row.id) } : m.row))
  }

  const ensure = (id: string) => {
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        name: contractorMap.get(id) || 'Unknown',
        items: [], pendingQty: 0, verifiedQty: 0, vanReplacements: {},
      })
    }
    return groups.get(id)!
  }

  for (const d of deliveries || []) {
    // Recorded BEFORE the `!leg` skip: a completed exchange whose replacement
    // came off the van still consumes a unit even on rows that put nothing
    // new into the storekeeper's hands.
    const vanQty = vanReplacementQty(d)
    if (vanQty > 0 && d.contractor_id) {
      const g = ensure(d.contractor_id)
      const k = returnMergeKey(d.products || '')
      if (k) g.vanReplacements[k] = (g.vanReplacements[k] || 0) + vanQty
    }

    const leg = incomingToStore(d)
    if (!leg) continue

    const c = ensure(d.contractor_id)
    const qty = leg.qty
    // Only a plain CMS line can be affected by a load shortage - an item
    // collected off a client came from their house, not the warehouse shelf.
    const reported =
      leg.kind === 'cms'
        ? pendingShortfallFor(shortfallInfo, d.contractor_id, d.delivery_date, leg.product)
        : null
    c.items.push({
      id: d.id,
      product: leg.product || 'Unknown Product',
      qty,
      unconfirmedShortfall: reported?.units,
      date: d.delivery_date,
      riderName: riderMap.get(d.rider_id) || 'Unknown',
      verified: d.stock_verified || false,
      verifiedAt: d.stock_verified_at ?? null,
      verifiedBy: d.stock_verified_by ?? null,
      // A follow-up that came back unsold is physically a CMS return, so
      // label it that way rather than "trade in" - the storekeeper is
      // receiving the replacement, not the client's old item.
      salesType: leg.kind === 'collected' ? (d.sales_type ?? undefined) : 'cms',
      source: 'delivery',
      // Only meaningful on a completed follow-up: that item came off a named
      // client, so the storekeeper can query it against the right order.
      customerName: leg.kind === 'collected' ? (d.customer_name ?? undefined) : undefined,
    })
    if (d.stock_verified) c.verifiedQty += qty
    else c.pendingQty += qty
  }

  for (const r of returns || []) {
    const cId = riderToContractor.get(r.rider_id) || ''
    if (!cId) continue
    const c = ensure(cId)
    const qty = r.qty || 1
    c.items.push({
      id: r.id,
      product: r.product_name || 'Unknown Product',
      qty,
      date: r.collection_date,
      riderName: riderMap.get(r.rider_id) || 'Unknown',
      verified: r.verified || false,
      verifiedAt: r.verified_at ?? null,
      verifiedBy: r.verified_by ?? null,
      salesType: r.condition || 'return',
      source: 'return_collection',
    })
    if (r.verified) c.verifiedQty += qty
    else c.pendingQty += qty
  }

  // A replacement handed over from the van cancels a unit the screen is
  // already counting as coming back - but only one that was actually refused
  // and re-handed (a CMS unit of the same product). Capping at the pending
  // CMS qty keeps a replacement taken from a spare, which no row records,
  // from pushing the expected pile one too low.
  for (const c of groups.values()) {
    for (const [key, vanQty] of Object.entries(c.vanReplacements)) {
      const pendingCms = c.items
        .filter(i => !i.verified && i.salesType === 'cms' && returnMergeKey(i.product) === key)
        .reduce((s, i) => s + i.qty, 0)
      // The map keeps the RAW figure - the client re-caps it against whatever
      // is still unticked, so the deduction disappears by itself once the
      // refused row it cancels has been cleared.
      c.pendingQty -= deductibleVanReplacement(vanQty, pendingCms)
    }
  }

  return Array.from(groups.values()).filter(c => c.items.length > 0)
}
