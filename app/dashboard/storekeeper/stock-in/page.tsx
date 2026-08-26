import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReturnsPage } from '@/components/storekeeper/returns-page'
import { incomingToStore } from '@/lib/stock-direction'
import { staysOnVan } from '@/lib/reschedule-stock'
import { pickActiveDate } from '@/lib/business-date'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StockInPage({ searchParams }: { searchParams: Promise<{ date?: string; contractor?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) redirect('/dashboard')

  // Get ALL return deliveries:
  // 1. CMS status deliveries (full returns)
  // `customer_name` and `replacement_from_van` are REQUIRED here. Supabase
  // silently omits a column that was not asked for, so the flag would read
  // `undefined` and the van deduction would never fire - no error, green build.
  const RETURN_COLS =
    // `rescheduled_to` is selected for DISPLAY only. The queries below stay on
    // `delivery_date` on purpose: returns are found by the day the goods
    // physically came back, and `incomingToStore()` needs status='cms' on that
    // original day. Switching these to `active_date` would make a rescheduled
    // order's returns disappear from the day they are actually sitting on the
    // shelf.
    'id, products, qty, delivery_date, rescheduled_to, reschedule_stock_mode, stock_verified, stock_verified_at, rider_id, contractor_id, status, return_product, sales_type, customer_name, replacement_from_van, van_confirmed_by'

  const { data: cmsStatusDeliveries } = await adminDb
    .from('deliveries')
    .select(RETURN_COLS)
    .eq('status', 'cms')
    .order('delivery_date', { ascending: false })

  // 2. Deliveries with sales_type in (exchange, trade_in, refund) that have return_product
  //
  // Deliberately NOT status-filtered: a follow-up the rider has not attempted
  // yet must still be visible, so the storekeeper can see it is coming rather
  // than have it appear out of nowhere tomorrow. `incomingToStore()` decides
  // whether it counts as physically back.
  const { data: returnTypeDeliveries } = await adminDb
    .from('deliveries')
    .select(RETURN_COLS)
    .in('sales_type', ['exchange', 'trade_in', 'refund'])
    .not('return_product', 'is', null)
    .order('delivery_date', { ascending: false })

  // Merge and dedupe
  const allReturns = [...(cmsStatusDeliveries || []), ...(returnTypeDeliveries || [])]
  const seenIds = new Set<string>()
  const cmsDeliveries = allReturns.filter(d => {
    if (seenIds.has(d.id)) return false
    seenIds.add(d.id)
    return true
  })

  // Get return_collections (submitted by contractors/riders)
  const { data: returnCollections } = await adminDb
    .from('return_collections')
    .select('id, rider_id, product_name, qty, collection_date, verified, verified_at, condition, notes')
    .order('collection_date', { ascending: false })

  // Get riders and contractors
  const { data: riders } = await adminDb.from('riders').select('id, name, contractor_id')
  const { data: contractors } = await adminDb.from('contractors').select('id, name')

  const riderMap = new Map((riders || []).map(r => [r.id, r.name]))
  const riderToContractor = new Map((riders || []).map(r => [r.id, r.contractor_id]))
  const contractorMap = new Map((contractors || []).map(c => [c.id, c.name]))

  // Get unique dates from both deliveries and return_collections
  const deliveryDates = (cmsDeliveries || []).map(d => d.delivery_date)
  const returnDates = (returnCollections || []).map(r => r.collection_date)
  const dates = [...new Set([...deliveryDates, ...returnDates])].filter(Boolean).sort().reverse()

  // NOT `dates[0]`. A date can exist with nothing countable on it: every 26 Aug
  // return row is still `assigned`, so `incomingToStore()` returns null for all
  // of them and the screen would open on a day showing zero rows to tick while
  // 120 real returns wait on 24 Aug. Open on the newest day that HAS work.
  const dateHasWork = (date: string) =>
    (cmsDeliveries || []).some(d => d.delivery_date === date && !d.stock_verified && incomingToStore(d)) ||
    (returnCollections || []).some(r => r.collection_date === date && !r.verified)

  const selectedDate = pickActiveDate(dates, dateHasWork, params.date)

  // Helper to build contractor data from both deliveries and return_collections
  function buildContractorData(deliveries: typeof cmsDeliveries, returns: typeof returnCollections) {
    const groups = new Map<string, {
      id: string
      name: string
      items: {
        id: string; product: string; qty: number; date: string; riderName: string
        verified: boolean; salesType?: string; source: 'delivery' | 'return_collection'
        incomingKind?: 'unsold' | 'collected' | 'cms'
        customerName?: string | null
        gaveProduct?: string | null
        fromVan?: boolean
        /** Display only - the pile stays on the day the goods came back. */
        rescheduledTo?: string | null
        /**
         * An agent ticked "rider kept it" on the reschedule. Advisory only -
         * set on 1 of 66 rescheduled rows, so it flags a likely gap on the
         * shelf without ever blocking the storekeeper's count.
         */
        vanHint?: boolean
      }[]
      /** Rows where nothing has physically moved. Shown, never counted. */
      awaiting: {
        id: string; product: string; qty: number; date: string; riderName: string
        salesType?: string | null; customerName?: string | null; reason: string
        rescheduledTo?: string | null
        /** On a rider's van, not merely un-dispatched. */
        onVan?: boolean
      }[]
      pendingQty: number
      verifiedQty: number
    }>()

    // Process deliveries (CMS/exchange/trade_in/refund)
    for (const d of deliveries || []) {
      const cId = d.contractor_id
      const cName = contractorMap.get(cId) || 'Unknown'
      if (!groups.has(cId)) {
        groups.set(cId, { id: cId, name: cName, items: [], awaiting: [], pendingQty: 0, verifiedQty: 0 })
      }
      const c = groups.get(cId)!

      // THE STATUS-AWARE RULE. The old line here was
      // `isReturnType ? return_product : products`, which ignored status and
      // was wrong on 9 live rows - 6 not yet out, 2 naming the client's old
      // item instead of the returned replacement, 1 pure phantom.
      const incoming = incomingToStore(d)

      // `reschedule_stock_mode = 'from_van'` USED TO HIDE THE ROW HERE, moving
      // it into the read-only `awaiting` list. That was wrong, and the owner
      // called it out: these rows are the same scenario as every other
      // rescheduled cms row.
      //
      // The evidence. Of 66 rescheduled orders, exactly ONE carries an explicit
      // mode; 38 went through the reschedule dialog and came out with nothing
      // recorded, and 28 were moved by day-closure, which never asks. So the
      // flag marks "somebody happened to tick a box", NOT "the goods are
      // elsewhere". JEFFREY had four identical rows on 24 Aug - same rider,
      // same evening, same 'cms' status, same 'sale' type, three even moving to
      // the same day - and only Nawfal's pen was hidden.
      //
      // A field the agent fills in 1 case out of 66 cannot be the authority on
      // where goods physically are. The storekeeper standing at the shelf is
      // the only person who can see, so the flag is now a HINT he can act on or
      // overrule (`vanHint`), never a verdict that removes his tick.

      if (!incoming) {
        // NOTHING HAS PHYSICALLY MOVED. Shown, but never counted - counting it
        // is what stopped these lists from ever reaching zero.
        // Only `pending`/`assigned` genuinely mean "still in the warehouse".
        // `nwd` (58 live rows) DID go out and was not wanted, so the old
        // catch-all "Not gone out yet" was a false statement about where the
        // goods physically are.
        const notOut = d.status === 'pending' || d.status === 'assigned'
        c.awaiting.push({
          id: d.id,
          product: (d.return_product || d.products || 'Unknown Product').trim(),
          qty: Number(d.qty) || 1,
          date: d.delivery_date,
          riderName: riderMap.get(d.rider_id) || 'Unknown',
          salesType: d.sales_type || null,
          customerName: d.customer_name || null,
          rescheduledTo: d.rescheduled_to || null,
          reason: notOut
            ? 'Not gone out yet'
            : d.status === 'nwd'
              ? 'Went out - not wanted, nothing collected'
              : 'Client missed - nothing was collected',
        })
        continue
      }

      const qty = incoming.qty
      c.items.push({
        id: d.id,
        product: incoming.product,
        qty,
        date: d.delivery_date,
        riderName: riderMap.get(d.rider_id) || 'Unknown',
        verified: d.stock_verified || false,
        salesType: d.sales_type || (d.status === 'cms' ? 'cms' : undefined),
        source: 'delivery',
        incomingKind: incoming.kind,
        customerName: d.customer_name || null,
        // What went OUT, so an exchange reads in both directions.
        gaveProduct: d.products || null,
        fromVan: !!d.replacement_from_van,
        // Display only - the pile stays on this day. Tells the storekeeper the
        // stock is going back out rather than sitting.
        rescheduledTo: d.rescheduled_to || null,
        // An agent ticked "rider kept it" when rescheduling. A HINT, not a
        // verdict: it is set on 1 of 66 rescheduled rows, so its absence proves
        // nothing. Surfaced so the storekeeper knows to expect a gap on the
        // shelf, and still tickable if the goods are in fact in front of him.
        vanHint: staysOnVan(d),
      })
      if (d.stock_verified) {
        c.verifiedQty += qty
      } else {
        c.pendingQty += qty
      }
    }

    // Process return_collections (submitted by riders)
    for (const r of returns || []) {
      const cId = riderToContractor.get(r.rider_id) || ''
      if (!cId) continue
      const cName = contractorMap.get(cId) || 'Unknown'
      if (!groups.has(cId)) {
        groups.set(cId, { id: cId, name: cName, items: [], awaiting: [], pendingQty: 0, verifiedQty: 0 })
      }
      const c = groups.get(cId)!
      const qty = r.qty || 1
      c.items.push({
        id: r.id,
        product: r.product_name || 'Unknown Product',
        qty,
        date: r.collection_date,
        riderName: riderMap.get(r.rider_id) || 'Unknown',
        verified: r.verified || false,
        salesType: r.condition || 'return',
        source: 'return_collection',
      })
      if (r.verified) {
        c.verifiedQty += qty
      } else {
        c.pendingQty += qty
      }
    }

    return Array.from(groups.values()).filter(c => c.items.length > 0)
  }

  // Build data for selected date
  const dayDeliveries = (cmsDeliveries || []).filter(d => d.delivery_date === selectedDate)
  const dayReturns = (returnCollections || []).filter(r => r.collection_date === selectedDate)
  const contractorsByDate = buildContractorData(dayDeliveries, dayReturns)

  // Build data for ALL pending (regardless of date)
  const allPendingDeliveries = (cmsDeliveries || []).filter(d => !d.stock_verified)
  const allPendingReturns = (returnCollections || []).filter(r => !r.verified)
  const allContractorsWithPending = buildContractorData(allPendingDeliveries, allPendingReturns)

  // Total pending across all dates
  const totalPendingAll = allPendingDeliveries.reduce((sum, d) => sum + (d.qty || 1), 0) + 
                          allPendingReturns.reduce((sum, r) => sum + (r.qty || 1), 0)

  return (
    <ReturnsPage
      userId={user.id}
      contractors={contractorsByDate}
      allContractors={allContractorsWithPending}
      selectedDate={selectedDate}
      availableDates={dates}
      totalPendingAll={totalPendingAll}
      selectedContractorId={params.contractor || null}
    />
  )
}
