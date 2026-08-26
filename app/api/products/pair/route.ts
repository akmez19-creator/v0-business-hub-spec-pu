import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Facts for exactly two hand-picked products, for the manual Combine dialog.
 *
 * GET ?a=<id>&b=<id>
 *
 * The duplicate scanner already returns these numbers, but only for pairs its
 * name comparison happened to find. Combining two products chosen by hand
 * needs the same evidence, so it is fetched here for just those two rows.
 *
 * Admin client, matching the duplicates route: purchase_orders and
 * product_images are not readable by the browser client, and a silent zero
 * would misdescribe which side actually holds the history - which is the one
 * thing this dialog exists to show.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const url = new URL(request.url)
    const ids = [url.searchParams.get('a') || '', url.searchParams.get('b') || ''].filter(Boolean)
    if (ids.length !== 2) {
      return NextResponse.json({ success: false, error: 'Two product ids are required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const [products, pos, imgs, variants] = await Promise.all([
      admin
        .from('products')
        .select('id, name, quantity, zone, shelf_code, last_counted_at, sold_out, is_active, category, price')
        .in('id', ids),
      admin.from('purchase_orders').select('product_id').in('product_id', ids),
      admin.from('product_images').select('product_id').in('product_id', ids),
      admin.from('product_variants').select('product_id').in('product_id', ids),
    ])

    if (products.error) throw new Error(products.error.message)
    if ((products.data || []).length !== 2) {
      return NextResponse.json({ success: false, error: 'One of those products no longer exists' }, { status: 404 })
    }

    const tally = (rows: { product_id: string | null }[] | null | undefined) => {
      const m = new Map<string, number>()
      for (const r of rows || []) if (r.product_id) m.set(r.product_id, (m.get(r.product_id) || 0) + 1)
      return m
    }
    const poCount = tally(pos.data as { product_id: string | null }[] | null)
    const imgCount = tally(imgs.data as { product_id: string | null }[] | null)
    const varCount = tally(variants.data as { product_id: string | null }[] | null)

    const sides = (products.data || []).map(p => ({
      ...p,
      po_count: poCount.get(p.id) || 0,
      image_count: imgCount.get(p.id) || 0,
      variant_count: varCount.get(p.id) || 0,
    }))

    // Returned in the order asked for, so the caller's A/B columns do not swap
    // under it when Postgres returns the rows the other way round.
    return NextResponse.json({
      success: true,
      a: sides.find(s => s.id === ids[0]),
      b: sides.find(s => s.id === ids[1]),
    })
  } catch (error) {
    console.error('[v0] Pair facts failed:', (error as Error).message)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}
