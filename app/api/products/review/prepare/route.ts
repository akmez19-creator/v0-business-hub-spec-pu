import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connect } from '@/lib/products/pg'
import { findCandidates } from '@/lib/products/candidates'
import { rankCandidates, refineWithPhotos, type CandidateVerdict } from '@/lib/products/candidate-ai'

export const maxDuration = 60

/**
 * Works ahead of the reviewer so opening a product is instant.
 *
 * The reviewer's batch is 20 products, but ONE request never tries to do all
 * 20: a product costs roughly 10 seconds of model time and the platform caps a
 * request at 60, so a 20-product request would be killed halfway through with
 * nothing to show for it. Instead each call takes a small chunk, commits what
 * it finished, and reports progress; the page calls it repeatedly until the
 * batch is done. That also means a cancelled batch loses at most one chunk -
 * everything already prepared stays prepared.
 */
const CHUNK_CAP = 6
/** Parallel model calls. Above ~4 the free-tier account starts rate-limiting. */
const CONCURRENCY = 3

/** Products still needing preparation, likeliest duplicates first. */
const NEXT_SQL = `
select p.id
from products p
left join product_review r on r.product_id = p.id
left join product_candidates c on c.product_id = p.id
where p.is_active is not false
  and c.product_id is null
  and (r.status is null or r.status = 'skip')
order by (
  select max(similarity(p.name, o.name))
  from products o
  where o.id <> p.id and o.is_active is not false
) desc nulls last, p.name asc
limit $1
`

const COUNTS_SQL = `
select
  (select count(*) from products where is_active is not false) total,
  (select count(*) from product_candidates c
     join products p on p.id = c.product_id and p.is_active is not false) prepared,
  (select count(*) from product_review r
     join products p on p.id = r.product_id and p.is_active is not false
   where r.status in ('clear','merged')) reviewed
`

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await fn(items[i])
      }
    }),
  )
}

export async function GET() {
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    client = await connect()
    await client.query(`set statement_timeout='30s'`)
    const counts = (await client.query(COUNTS_SQL)).rows[0]
    return NextResponse.json({
      success: true,
      total: Number(counts.total),
      prepared: Number(counts.prepared),
      reviewed: Number(counts.reviewed),
    })
  } catch (error) {
    console.error('[v0] Prepare counts error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}

export async function POST(req: Request) {
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const size = Math.max(1, Math.min(CHUNK_CAP, Number(body?.size) || CHUNK_CAP))

    client = await connect()
    await client.query(`set statement_timeout='30s'`)
    const ids: string[] = (await client.query(NEXT_SQL, [size])).rows.map(r => r.id)

    let done = 0
    let failed = 0
    let withPhotos = 0

    await pool(ids, CONCURRENCY, async id => {
      try {
        const { target, candidates } = await findCandidates(client!, id)

        let verdicts = new Map<number, CandidateVerdict>()
        let aiOk = true
        let lookedAtPhotos = false

        if (candidates.length) {
          try {
            verdicts = await rankCandidates(target, candidates)
            const refined = await refineWithPhotos(target, candidates, verdicts)
            verdicts = refined.verdicts
            lookedAtPhotos = refined.lookedAtPhotos
          } catch (error) {
            // Storing the candidates without a ranking is far better than
            // storing nothing: the reviewer still sees every candidate, and
            // ai_ok records that the ordering is name-similarity only rather
            // than letting it pass as a judged result.
            console.error('[v0] prepare: ranking failed for', id, (error as Error).message)
            aiOk = false
          }
        }

        const payload = {
          target,
          candidates,
          verdicts: candidates.map((_, i) => verdicts.get(i) ?? null),
        }
        await client!.query(
          `insert into product_candidates
             (product_id, payload, candidate_count, looked_at_photos, ai_ok, prepared_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (product_id) do update
             set payload = excluded.payload, candidate_count = excluded.candidate_count,
                 looked_at_photos = excluded.looked_at_photos, ai_ok = excluded.ai_ok,
                 prepared_at = now()`,
          [id, JSON.stringify(payload), candidates.length, lookedAtPhotos, aiOk],
        )
        done++
        if (lookedAtPhotos) withPhotos++
      } catch (error) {
        failed++
        console.error('[v0] prepare: failed for', id, (error as Error).message)
      }
    })

    const counts = (await client.query(COUNTS_SQL)).rows[0]
    return NextResponse.json({
      success: true,
      done,
      failed,
      withPhotos,
      exhausted: ids.length === 0,
      total: Number(counts.total),
      prepared: Number(counts.prepared),
      reviewed: Number(counts.reviewed),
    })
  } catch (error) {
    console.error('[v0] Prepare error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}
