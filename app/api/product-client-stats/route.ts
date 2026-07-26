import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Returns distinct client counts per product name so the Ads Manager can show
// how many clients each product has acquired and the ad cost per client (CAC).
// Also returns per-page attribution (deliveries.medium is the page the client
// came from, auto-captured by the extension): clients per product per page and
// page totals, powering "clients per page" + "avg cost/client per page".
//
// Optional body.entryDate (YYYY-MM-DD): count only clients whose delivery was
// ENTERED on that date - the wall passes today so counts pair with today's ad
// spend. (The Riders panel is different by design: it groups by delivery date.)
// Omit for all-time counts.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const names: string[] = Array.isArray(body?.names)
      ? body.names.filter((n: unknown) => typeof n === 'string' && n.trim().length > 0)
      : []
    const entryDate: string | null =
      typeof body?.entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate)
        ? body.entryDate
        : null

    if (names.length === 0) {
      return NextResponse.json({ stats: {}, productPages: {}, pageTotals: {} })
    }

    const adminDb = createAdminClient()
    const [main, pages] = await Promise.all([
      adminDb.rpc('get_product_client_stats', { p_names: names, p_entry_date: entryDate }),
      adminDb.rpc('get_product_page_client_stats', { p_names: names, p_entry_date: entryDate }),
    ])

    if (main.error) {
      console.error('[v0] product-client-stats RPC error:', main.error)
      return NextResponse.json({ stats: {}, productPages: {}, pageTotals: {}, error: main.error.message }, { status: 500 })
    }

    // Map by product name for easy lookup on the client
    const stats: Record<string, { clientCount: number; deliveredClientCount: number; orderCount: number }> = {}
    for (const row of main.data || []) {
      stats[row.product_name] = {
        clientCount: Number(row.client_count) || 0,
        deliveredClientCount: Number(row.delivered_client_count) || 0,
        orderCount: Number(row.order_count) || 0,
      }
    }

    // productPages: { [productName]: { [page]: clients } }
    // pageTotals:   { [page]: clients } (distinct per product-page, summed)
    const productPages: Record<string, Record<string, number>> = {}
    const pageTotals: Record<string, number> = {}
    if (pages.error) {
      // Non-fatal: page attribution is an enhancement on top of core stats
      console.error('[v0] product-page-client-stats RPC error:', pages.error)
    } else {
      for (const row of pages.data || []) {
        const count = Number(row.client_count) || 0
        if (count <= 0) continue
        const product = row.product_name as string
        const page = (row.medium as string) || 'Unknown'
        if (!productPages[product]) productPages[product] = {}
        productPages[product][page] = count
        pageTotals[page] = (pageTotals[page] || 0) + count
      }
    }

    return NextResponse.json({ stats, productPages, pageTotals })
  } catch (error) {
    console.error('[v0] product-client-stats error:', error)
    return NextResponse.json({ stats: {}, productPages: {}, pageTotals: {}, error: 'Failed to fetch product client stats' }, { status: 500 })
  }
}
