import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mergeProducts, MergeBlockedError } from '@/lib/products/merge-tx'
import { connect } from '@/lib/products/pg'

/**
 * Throw away any prepared candidate list that mentions these products.
 *
 * Runs AFTER the merge transaction commits, deliberately outside it: this is
 * only a cache, and a cleanup failure must never roll back a merge that
 * actually succeeded. A stale list costs one recomputation; a rolled-back
 * merge costs the reviewer's decision.
 */
async function dropPreparedMentioning(ids: string[]) {
  let client
  try {
    client = await connect()
    await client.query(`set statement_timeout='30s'`)
    await client.query(
      `delete from product_candidates
       where product_id = any($1::uuid[])
          or exists (
            select 1 from jsonb_array_elements(payload->'candidates') c
            where c->>'id' = any($1::text[])
          )`,
      [ids],
    )
  } catch (error) {
    console.error('[v0] Could not clear prepared candidates after merge:', (error as Error).message)
  } finally {
    await client?.end().catch(() => {})
  }
}

/**
 * Fold a duplicate product into the one that is physically on a shelf.
 *
 * POST { winnerId, loserId }
 *
 * The caller names the winner explicitly - this route never infers it. Zone
 * decides it in the UI, and where zone cannot, a person does.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const winnerId = typeof body?.winnerId === 'string' ? body.winnerId : ''
    const loserId = typeof body?.loserId === 'string' ? body.loserId : ''
    if (!winnerId || !loserId) {
      return NextResponse.json({ success: false, error: 'Both products must be supplied' }, { status: 400 })
    }

    // Optional: the surviving row keeps its data but takes the other spelling.
    const finalName = typeof body?.finalName === 'string' ? body.finalName.trim() : undefined

    const result = await mergeProducts(winnerId, loserId, finalName || undefined)

    // The loser row is gone. Its own prepared candidates disappear with it (FK
    // cascade), but it is also sitting inside OTHER products' prepared lists,
    // which were computed before this merge - leaving those would offer the
    // reviewer a candidate that no longer exists and fail when they clicked
    // merge. Drop every prepared list that mentions either side; they are a
    // cache, so the only cost of dropping one is recomputing it.
    await dropPreparedMentioning([winnerId, loserId])

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = (error as Error).message
    if (error instanceof MergeBlockedError) {
      console.log('[v0] Merge refused:', message)
      return NextResponse.json({ success: false, error: `${message} Nothing was changed.` }, { status: 409 })
    }
    // Everything ran in one transaction, so a failure here means the database
    // is exactly as it was. Say so - a half-finished merge is the fear.
    console.error('[v0] Product merge rolled back:', message)
    const structural = /violates (foreign key|unique|check) constraint/i.test(message)
    return NextResponse.json(
      {
        success: false,
        error: structural
          ? 'The database refused part of this merge, so it was rolled back completely. Nothing was changed.'
          : `${message}. The merge was rolled back and nothing was changed.`,
      },
      { status: 500 },
    )
  }
}
