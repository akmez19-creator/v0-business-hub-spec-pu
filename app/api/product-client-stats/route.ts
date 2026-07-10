import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Returns distinct client counts per product name so the Ads Manager can show
// how many clients each product has acquired and the ad cost per client (CAC).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const names: string[] = Array.isArray(body?.names)
      ? body.names.filter((n: unknown) => typeof n === 'string' && n.trim().length > 0)
      : []

    if (names.length === 0) {
      return NextResponse.json({ stats: {} })
    }

    const adminDb = createAdminClient()
    const { data, error } = await adminDb.rpc('get_product_client_stats', { p_names: names })

    if (error) {
      console.error('[v0] product-client-stats RPC error:', error)
      return NextResponse.json({ stats: {}, error: error.message }, { status: 500 })
    }

    // Map by product name for easy lookup on the client
    const stats: Record<string, { clientCount: number; deliveredClientCount: number; orderCount: number }> = {}
    for (const row of data || []) {
      stats[row.product_name] = {
        clientCount: Number(row.client_count) || 0,
        deliveredClientCount: Number(row.delivered_client_count) || 0,
        orderCount: Number(row.order_count) || 0,
      }
    }

    return NextResponse.json({ stats })
  } catch (error) {
    console.error('[v0] product-client-stats error:', error)
    return NextResponse.json({ stats: {}, error: 'Failed to fetch product client stats' }, { status: 500 })
  }
}
