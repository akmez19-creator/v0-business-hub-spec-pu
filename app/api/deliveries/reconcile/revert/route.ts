import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Undo a reconciliation batch.
 *
 * Three things happened on commit and each is reversed:
 *  1. rows inserted with import_batch_id = <batch>  -> deleted
 *  2. rows updated, snapshotted as 'pre-update snapshot' -> restored
 *  3. rows removed, snapshotted as 'removed - ...'  -> re-inserted
 *
 * This is why every update archives the previous row BEFORE writing. Without
 * the snapshot an update would be irreversible.
 */

export const maxDuration = 300

export async function POST(request: Request) {
  let importId: string | undefined
  try {
    const body = (await request.json()) as { importId?: string }
    importId = body.importId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!importId) return NextResponse.json({ error: 'importId is required' }, { status: 400 })

  const auth = await createClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Your session has expired. Please sign in again.', reason: 'session' }, { status: 401 })
  }
  const { data: profile } = await auth.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'owner', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only a manager, owner or admin can revert an import.' }, { status: 403 })
  }

  const db = createAdminClient()
  const { data: log, error: logError } = await db.from('delivery_imports').select('*').eq('id', importId).single()
  if (logError || !log) return NextResponse.json({ error: 'That import batch was not found.' }, { status: 404 })
  if (log.reverted_at) {
    return NextResponse.json({ error: 'That batch has already been reverted.' }, { status: 409 })
  }

  const errors: string[] = []
  let deleted = 0
  let restored = 0
  let reinserted = 0

  // 1. drop the rows this batch created
  const { data: inserted, error: insErr } = await db
    .from('deliveries')
    .delete()
    .eq('import_batch_id', importId)
    .select('id')
  if (insErr) errors.push(`removing inserted rows: ${insErr.message}`)
  else deleted = inserted?.length ?? 0

  // 2. restore the pre-update snapshots
  const { data: snaps, error: snapErr } = await db
    .from('delivery_archive')
    .select('id,delivery_id,reason,snapshot')
    .eq('import_id', importId)
    .is('restored_at', null)
  if (snapErr) {
    errors.push(`reading snapshots: ${snapErr.message}`)
  } else {
    for (const snap of snaps ?? []) {
      const row = snap.snapshot as Record<string, unknown>
      if (snap.reason === 'pre-update snapshot') {
        const { id: _ignored, ...rest } = row
        const { error } = await db.from('deliveries').update(rest).eq('id', snap.delivery_id)
        if (error) {
          errors.push(`restoring ${snap.delivery_id}: ${error.message}`)
          continue
        }
        restored++
      } else {
        // removed row - put it back exactly as it was, id included
        const { error } = await db.from('deliveries').insert(row)
        if (error) {
          errors.push(`re-inserting ${snap.delivery_id}: ${error.message}`)
          continue
        }
        reinserted++
      }
      await db.from('delivery_archive').update({ restored_at: new Date().toISOString() }).eq('id', snap.id)
    }
  }

  const { error: closeError } = await db
    .from('delivery_imports')
    .update({
      reverted_at: new Date().toISOString(),
      reverted_by: user.id,
      status: errors.length ? 'reverted_with_errors' : 'reverted',
    })
    .eq('id', importId)
  if (closeError) errors.push(`marking batch reverted: ${closeError.message}`)

  return NextResponse.json({ importId, deleted, restored, reinserted, errors: errors.slice(0, 25) })
}
