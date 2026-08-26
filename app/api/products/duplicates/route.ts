import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { findDuplicatePairs, type DuplicateProduct } from '@/lib/products/duplicates'
import { reviewDuplicatePairs } from '@/lib/products/duplicate-ai'

// The AI pass reads a dozen short names, but it is still a paid/rate-limited
// call on this account, so it never runs as part of the scan.
export const maxDuration = 60

async function loadCandidates() {
  const admin = createAdminClient()
  // Admin, not the browser client: the photo and order counts come from tables
  // the browser cannot read, and a silent zero there would misdescribe which
  // side of a pair holds the history.
  const { data, error } = await admin
    .from('products')
    .select('id, name, quantity, zone, shelf_code, last_counted_at, is_active')
    .neq('is_active', false)
  if (error) throw new Error(error.message)

  const products = (data || []) as (DuplicateProduct & { is_active: boolean | null })[]
  const pairs = findDuplicatePairs(products)

  // Only the products actually in a pair need their counts fetched.
  const ids = [...new Set(pairs.flatMap(p => [p.a.id, p.b.id]))]
  if (ids.length) {
    const counts = await Promise.all([
      admin.from('purchase_orders').select('product_id').in('product_id', ids),
      admin.from('product_images').select('product_id').in('product_id', ids),
    ])
    const tally = (rows: { product_id: string | null }[] | null) => {
      const m = new Map<string, number>()
      for (const r of rows || []) if (r.product_id) m.set(r.product_id, (m.get(r.product_id) || 0) + 1)
      return m
    }
    const pos = tally(counts[0].data as { product_id: string | null }[] | null)
    const imgs = tally(counts[1].data as { product_id: string | null }[] | null)
    for (const p of pairs) {
      for (const side of [p.a, p.b]) {
        side.po_count = pos.get(side.id) || 0
        side.image_count = imgs.get(side.id) || 0
      }
    }
  }

  return pairs
}

/** Scan only. Cheap, deterministic, no model call. */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    return NextResponse.json({ success: true, pairs: await loadCandidates() })
  } catch (error) {
    console.error('[v0] Duplicate scan error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

/** Scan, then ask the model which pairs are genuinely the same product. */
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const pairs = await loadCandidates()
    if (!pairs.length) return NextResponse.json({ success: true, pairs: [], verdicts: [] })

    try {
      const verdicts = await reviewDuplicatePairs(pairs)
      return NextResponse.json({
        success: true,
        pairs,
        verdicts: pairs.map((_, i) => verdicts.get(i) ?? null),
      })
    } catch (error) {
      // The pairs are still perfectly usable without a verdict, so return them
      // with an honest note rather than failing the whole screen. Absence of an
      // AI opinion must never read as "no duplicates found".
      console.error('[v0] Duplicate AI review failed:', error)
      return NextResponse.json({
        success: true,
        pairs,
        verdicts: pairs.map(() => null),
        aiError: 'The AI review could not run just now. The matches below are from name comparison only.',
      })
    }
  } catch (error) {
    console.error('[v0] Duplicate review error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}
