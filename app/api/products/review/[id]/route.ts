import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connect } from '@/lib/products/pg'
import { findCandidates } from '@/lib/products/candidates'
import { rankCandidates, refineWithPhotos } from '@/lib/products/candidate-ai'

export const maxDuration = 60

/** Candidates for one product, plus the AI's ranking of them. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    client = await connect()
    await client.query(`set statement_timeout='30s'`)

    // Prepared ahead of time by the batch run, which is the normal case once a
    // batch has been processed. Recomputing here would throw away ~10s of model
    // work that has already been paid for and make the page feel broken.
    if (!new URL(req.url).searchParams.get('fresh')) {
      const cached = await client.query(
        `select payload, looked_at_photos, ai_ok from product_candidates where product_id = $1`,
        [id],
      )
      if (cached.rowCount) {
        const row = cached.rows[0]
        return NextResponse.json({
          ...row.payload,
          success: true,
          prepared: true,
          lookedAtPhotos: row.looked_at_photos,
          aiError: row.ai_ok
            ? undefined
            : 'The AI ranking could not run for this product. Every candidate the search found is still listed below, ordered by name similarity.',
        })
      }
    }

    const { target, candidates } = await findCandidates(client, id)

    if (!candidates.length) {
      return NextResponse.json({ success: true, target, candidates: [], verdicts: [] })
    }

    try {
      const ranked = await rankCandidates(target, candidates)
      const { verdicts, lookedAtPhotos } = await refineWithPhotos(target, candidates, ranked)
      const payload = {
        target,
        candidates,
        verdicts: candidates.map((_, i) => verdicts.get(i) ?? null),
      }
      // Store it so this product is never computed twice, whether it was
      // reached ahead of the batch or the batch has not got here yet.
      await client
        .query(
          `insert into product_candidates
             (product_id, payload, candidate_count, looked_at_photos, ai_ok, prepared_at)
           values ($1, $2, $3, $4, true, now())
           on conflict (product_id) do update
             set payload = excluded.payload, candidate_count = excluded.candidate_count,
                 looked_at_photos = excluded.looked_at_photos, ai_ok = true, prepared_at = now()`,
          [id, JSON.stringify(payload), candidates.length, lookedAtPhotos],
        )
        .catch(error => console.error('[v0] candidate cache write failed:', error.message))
      return NextResponse.json({ success: true, ...payload, prepared: false, lookedAtPhotos })
    } catch (error) {
      // The candidates are the safety net; the ranking is a convenience. Losing
      // the model must never look like "no duplicates found", so the list is
      // returned in database order with an explicit note.
      console.error('[v0] Candidate ranking failed:', error)
      return NextResponse.json({
        success: true,
        target,
        candidates,
        verdicts: candidates.map(() => null),
        aiError:
          'The AI ranking could not run just now. Every candidate the search found is still listed below, ordered by name similarity.',
      })
    }
  } catch (error) {
    console.error('[v0] Candidate search error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}

/** Record a decision: reviewed-clear, deferred, or (after a merge) merged. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const status = body?.status
    if (!['clear', 'merged', 'skip'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Unknown review status' }, { status: 400 })
    }

    client = await connect()
    await client.query(
      `insert into product_review (product_id, status, note, reviewed_by, reviewed_at)
       values ($1, $2, $3, $4, now())
       on conflict (product_id) do update
         set status = excluded.status, note = excluded.note,
             reviewed_by = excluded.reviewed_by, reviewed_at = now()`,
      [id, status, typeof body?.note === 'string' ? body.note.slice(0, 500) : null, user.id],
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[v0] Review save error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}
