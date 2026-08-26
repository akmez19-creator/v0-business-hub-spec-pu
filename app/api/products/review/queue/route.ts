import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connect } from '@/lib/products/pg'

export const maxDuration = 60

/**
 * The review queue: every active product, ordered so the ones most likely to
 * have a duplicate come first.
 *
 * The ordering score is name-similarity only, which is deliberately NOT the
 * same as the per-product candidate search. This runs across all 862 products
 * at once, so it has to stay cheap; the expensive multi-channel recall happens
 * when a product is actually opened. A product whose duplicate is only findable
 * by shared photo therefore sorts low here - it is still IN the queue and still
 * gets the full search when reached, it just is not promoted to the front.
 */
const QUEUE_SQL = `
with active as (
  select id, name from products where is_active is not false
),
best as (
  select a.id, a.name, max(similarity(a.name, b.name)) top_score
  from active a join active b on a.id <> b.id
  group by a.id, a.name
)
select
  b.id, b.name, coalesce(b.top_score, 0) top_score,
  r.status, r.reviewed_at,
  p.quantity, p.zone, p.shelf_code, p.image_url
from best b
join products p on p.id = b.id
left join product_review r on r.product_id = b.id
order by
  -- Unreviewed first, then skipped (deferred, so they come back at the end of
  -- the unreviewed run), then everything already decided.
  case when r.status is null then 0 when r.status = 'skip' then 1 else 2 end,
  b.top_score desc,
  b.name asc
`

export async function GET() {
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    client = await connect()
    await client.query(`set statement_timeout='45s'`)
    const rows = (await client.query(QUEUE_SQL)).rows

    return NextResponse.json({
      success: true,
      queue: rows.map(r => ({
        id: r.id,
        name: r.name,
        topScore: Number(r.top_score),
        status: r.status as 'clear' | 'merged' | 'skip' | null,
        reviewedAt: r.reviewed_at,
        quantity: r.quantity,
        zone: r.zone,
        shelfCode: r.shelf_code,
        imageUrl: r.image_url,
      })),
    })
  } catch (error) {
    console.error('[v0] Review queue error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}
