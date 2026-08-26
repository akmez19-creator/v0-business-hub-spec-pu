import { redirect } from 'next/navigation'
import { muToday, pickActiveDate } from '@/lib/business-date'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { StockDispatchContent } from '@/components/storekeeper/stock-dispatch-content'
import { needsReissue, hasStaleStockOut } from '@/lib/reschedule-stock'
import { LOADED_STATUSES } from '@/lib/stock-outgoing'

// Force dynamic rendering - no caching - v5 unified header
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  searchParams: Promise<{ date?: string }>
}

export default async function StockOutPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/auth/login')

  const adminDb = createAdminClient()
  
  // Get profile with role
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .single()

  // Allow admin, manager, and storekeeper roles
  const allowedRoles = ['admin', 'manager', 'storekeeper']
  if (!profile || !allowedRoles.includes(profile.role || '')) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const today = muToday()

  // Every day that actually HAS a round, so the chevrons can skip straight over
  // off-days instead of landing the storekeeper on an empty screen.
  const { data: dateRows, error: dateRowsError } = await adminDb
    .from('deliveries')
    .select('active_date')
    .in('status', LOADED_STATUSES as unknown as string[])
    .or('sales_type.is.null,sales_type.neq.refund')

  // A failed read must never render as "no work". Without this the page would
  // fall back to today and quietly claim an empty round.
  if (dateRowsError) throw new Error(`Could not load working days: ${dateRowsError.message}`)

  const availableDates = Array.from(
    new Set((dateRows || []).map(r => r.active_date as string).filter(Boolean)),
  ).sort()

  // Prefer today, else the most recent working day on or before today. Never a
  // plain `|| today`: on an off-day that stranded him on an empty screen even
  // though yesterday's round still had unticked rows.
  const selectedDate = params.date || pickActiveDate(availableDates, today)

  // Run all queries in parallel for faster loading
  const [deliveriesResult, contractorsResult, sessionsResult, productsResult] = await Promise.all([
    // Fetch all deliveries for selected date (assigned or not) to show opening stock
    adminDb
      .from('deliveries')
      .select('id, delivery_date, active_date, rescheduled_to, reschedule_stock_mode, contractor_id, product_id, products, qty, status, stock_out, stock_out_at, sales_type')
      // Due-day basis: this screen decides what physically goes ONTO the van
      // today, so a re-attempt scheduled for today has to be issued today.
      // Keying on `delivery_date` meant 35 rescheduled open orders were never
      // put back on a van at all.
      .eq('active_date', selectedDate)
      // NOT pending/assigned only. Once a round is delivered every row moves to
      // delivered/nwd/cms, so that filter made the finished work disappear: on
      // 24 Aug it showed 1 row out of 315 with 264 already ticked out. The ticks
      // were saved all along - the page simply could not see the rows any more,
      // which reads exactly like "it did not save".
      //
      // `cms`/`nwd` also catch RE-ATTEMPTS, whose status still records the
      // attempt that failed - a reschedule cannot clear it without erasing the
      // original day's returns. Narrowed to genuine re-issues just below; an
      // ordinary `cms` row that was never rescheduled must NOT appear.
      .in('status', LOADED_STATUSES as unknown as string[])
      // Refunds are EXCLUDED: the goods come BACK from the client, so there is
      // nothing to hand out. Written as an OR, not .neq(): in SQL
      // `NULL <> 'refund'` is NULL, so a plain neq would silently drop every
      // row with no sales type instead of keeping it.
      .or('sales_type.is.null,sales_type.neq.refund')
      .order('contractor_id'),
    // Fetch contractors with photos
    adminDb
      .from('contractors')
      .select('id, name, photo_url')
      .order('name'),
    // Fetch existing dispatch sessions for this date
    adminDb
      .from('stock_dispatch_sessions')
      .select(`
        id,
        contractor_id,
        dispatch_date,
        dispatched_by,
        total_items,
        total_products,
        status,
        created_at
      `)
      .eq('dispatch_date', selectedDate)
      .eq('status', 'dispatched'),
    // Fetch products with images
    adminDb
      .from('products')
      .select('id, name, image_url')
  ])

  const deliveries = deliveriesResult.data
  const contractors = contractorsResult.data
  const sessions = sessionsResult.data || []
  const products = productsResult.data || []

  // Build product image map
  const productImageMap = new Map(products.map(p => [p.name, p.image_url]))

  // Build contractor name map
  const contractorMap = new Map((contractors || []).map(c => [c.id, c.name]))

  // Map deliveries with contractor names and product images
  const deliveryList = (deliveries || [])
    // Keep ordinary open work, ALREADY-DELIVERED rows from this round, plus
    // rescheduled orders that genuinely need handing out again.
    //
    // `delivered` belongs here: those are the rows he already ticked out. Drop
    // them and a finished round renders almost empty, which is what made saved
    // work look lost. `needsReissue()` still excludes `from_van` rows - the
    // rider kept those overnight, so issuing one would push a SECOND unit out
    // of the store for a single sale.
    .filter(d =>
      d.status === 'pending' ||
      d.status === 'assigned' ||
      d.status === 'delivered' ||
      needsReissue(d)
    )
    .map(d => ({
      id: d.id,
      delivery_date: d.delivery_date,
      contractor_id: d.contractor_id || '',
      contractor_name: d.contractor_id ? (contractorMap.get(d.contractor_id) || 'Unknown') : 'Unassigned',
      product_id: d.product_id,
      products: d.products || 'Unknown Product',
      product_image: productImageMap.get(d.products || '') || null,
      qty: d.qty || 1,
      status: d.status || 'pending',
      // A STALE FLAG IS NOT AN ISSUE. `stock_out` is one undated boolean, so a
      // re-attempt carries the `true` from the van load that has since come
      // back - Nawfal's pen reads `stock_out = true` with a `stock_out_at` of
      // 23 Aug against a due date of 26 Aug. Left as-is it would show today's
      // re-issue as already handed over and it would never be loaded.
      stock_out: hasStaleStockOut(d, selectedDate) ? false : (d.stock_out ?? false),
    }))

  return (
    <div className="max-w-4xl mx-auto px-3 space-y-4">
      <StockDispatchContent
        userId={profile.id}
        today={today}
        selectedDate={selectedDate}
        availableDates={availableDates}
        deliveries={deliveryList}
        contractors={contractors || []}
        sessions={sessions}
      />
    </div>
  )
}
