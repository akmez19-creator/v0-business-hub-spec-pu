import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Which clients arrived WITHOUT a usable ad id, broken down by product.
//
// The extension captures deliveries.ad_id silently from the Business Suite
// "ad_id.<digits>" label. Some chats genuinely carry no such label, and those
// orders are still worth taking - so they are saved unattributed rather than
// blocked. This route is how that gap stays visible instead of quietly
// distorting every cost-per-client number on the wall.
//
// IMPORTANT - ad_id is a shared column:
//   The CRM also writes plain labels into deliveries.ad_id ('AI transferred',
//   'messenger_ads', 'Qualified', ...). Those are NOT ads. Anything that is
//   not ^[0-9]{6,}$ is counted as unattributed, exactly like the ad-revenue
//   route does, so the two reconcile against each other.
//
// Optional ?entryDate=YYYY-MM-DD scopes to clients ENTERED that day, which is
// the same definition the wall's "today" Cl column uses (entry_date, not
// delivery date).
export const dynamic = 'force-dynamic'

const AD_ID_RE = /^[0-9]{6,}$/
const PAGE = 1000

export interface ProductGap {
  product: string
  total: number
  attributed: number
  missing: number
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const raw = url.searchParams.get('entryDate')
    const entryDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null

    const adminDb = createAdminClient()

    // Page through: Supabase caps a select at 1000 rows, and silently
    // truncating here would under-report the gap - the opposite of the point.
    type Row = { ad_id: string | null; products: string | null }
    const rows: Row[] = []
    for (let from = 0; ; from += PAGE) {
      let q = adminDb.from('deliveries').select('ad_id, products').range(from, from + PAGE - 1)
      if (entryDate) q = q.eq('entry_date', entryDate)
      const { data, error } = await q
      if (error) {
        console.error('[v0] attribution-gaps query error:', error)
        return NextResponse.json(
          { success: false, byProduct: [], error: error.message },
          { status: 500 },
        )
      }
      const batch = (data ?? []) as Row[]
      rows.push(...batch)
      if (batch.length < PAGE) break
    }

    const byProduct = new Map<string, ProductGap>()
    let total = 0
    let attributed = 0

    for (const r of rows) {
      const product = (r.products || '').trim() || 'Unspecified'
      const ok = AD_ID_RE.test((r.ad_id || '').trim())
      let entry = byProduct.get(product)
      if (!entry) {
        entry = { product, total: 0, attributed: 0, missing: 0 }
        byProduct.set(product, entry)
      }
      entry.total++
      total++
      if (ok) {
        entry.attributed++
        attributed++
      } else {
        entry.missing++
      }
    }

    // Worst offenders first - the wall only has room for the top few, and the
    // product losing the most attribution is the one worth fixing.
    const list = [...byProduct.values()]
      .filter((p) => p.missing > 0)
      .sort((a, b) => b.missing - a.missing)

    return NextResponse.json({
      success: true,
      entryDate,
      byProduct: list,
      totals: {
        total,
        attributed,
        missing: total - attributed,
        coverage: total > 0 ? attributed / total : 1,
      },
    })
  } catch (error) {
    console.error('[v0] attribution-gaps error:', error)
    return NextResponse.json(
      { success: false, byProduct: [], error: 'Failed to compute attribution gaps' },
      { status: 500 },
    )
  }
}
