import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Money booked against a single Facebook AD, keyed by deliveries.ad_id.
//
// This is the per-ad counterpart to /api/product-client-stats (which works at
// product level). The wall uses it to show, for every ad id, how much revenue
// that exact ad brought in next to what it cost to run.
//
// IMPORTANT - what this number is:
//   `deliveries.amount` is the ORDER value. Every row in this database is
//   status pending/assigned and payment_status 'unpaid', so nothing here is
//   "cash in the bank" - it is revenue booked from orders the ad generated.
//
// IMPORTANT - ad_id is a shared column:
//   The CRM also writes labels into deliveries.ad_id ('AI transferred',
//   'messenger_ads', 'AI responding', 'Qualified', ...). Those are not ads and
//   they are big - they carry ~Rs 600k. The SQL function only counts ad_ids
//   matching ^[0-9]{6,}$, and the leftovers come back in `unattributed` so the
//   per-ad figures never silently fail to reconcile with the business total.
//
// Query param `entryDate=YYYY-MM-DD` scopes to orders entered on that day
// (what the wall passes in "today only" mode); omit it for all-time.
export const dynamic = 'force-dynamic'

export interface AdRevenueStat {
  revenue: number
  orders: number
  clients: number
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const raw = url.searchParams.get('entryDate')
    const entryDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null

    const adminDb = createAdminClient()
    const [perAd, leftover] = await Promise.all([
      adminDb.rpc('get_ad_revenue_stats', { p_entry_date: entryDate }),
      adminDb.rpc('get_ad_revenue_unattributed', { p_entry_date: entryDate }),
    ])

    if (perAd.error) {
      console.error('[v0] ad-revenue RPC error:', perAd.error)
      return NextResponse.json({ success: false, byAd: {}, error: perAd.error.message }, { status: 500 })
    }

    const byAd: Record<string, AdRevenueStat> = {}
    let attributedRevenue = 0
    let attributedOrders = 0
    for (const row of perAd.data || []) {
      const revenue = Number(row.revenue) || 0
      const orders = Number(row.orders) || 0
      byAd[String(row.ad_id)] = { revenue, orders, clients: Number(row.clients) || 0 }
      attributedRevenue += revenue
      attributedOrders += orders
    }

    // Non-fatal: the per-ad numbers are still usable without the reconciliation
    const l = leftover.error ? null : (leftover.data || [])[0]
    if (leftover.error) console.error('[v0] ad-revenue unattributed RPC error:', leftover.error)

    const unattributed = {
      // Orders whose ad_id holds a CRM label instead of an ad id
      labelledOrders: Number(l?.labelled_orders) || 0,
      labelledRevenue: Number(l?.labelled_revenue) || 0,
      // Orders with no ad_id at all
      missingOrders: Number(l?.missing_orders) || 0,
      missingRevenue: Number(l?.missing_revenue) || 0,
    }

    return NextResponse.json({
      success: true,
      entryDate,
      byAd,
      attributedRevenue,
      attributedOrders,
      unattributed,
    })
  } catch (error) {
    console.error('[v0] ad-revenue error:', error)
    return NextResponse.json({ success: false, byAd: {}, error: 'Failed to fetch ad revenue' }, { status: 500 })
  }
}
