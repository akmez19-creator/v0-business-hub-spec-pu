import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A star is "someone needs to look at this" - a problem the agent cannot solve
 * alone (payment dispute, angry customer, missing parcel...). It is NOT a mark:
 * marks describe the lead's state for the queue, a star is an escalation with a
 * written explanation, so the note is mandatory and kept with the author.
 */
export interface ThreadStar {
  threadKey: string
  note: string
  starredBy: string
  starredByName: string | null
  starredAt: string
}

const TABLE = 'inbox_thread_stars'

export function normaliseStarNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const note = raw.replace(/\s+/g, ' ').trim()
  if (note.length < 12) return null
  return note.slice(0, 1000)
}

export async function loadStars(db: SupabaseClient): Promise<Map<string, ThreadStar>> {
  const { data, error } = await db
    .from(TABLE)
    .select('thread_key, note, starred_by, starred_at')
    .order('starred_at', { ascending: false })
  if (error || !data) return new Map()
  const ids = [...new Set(data.map((r) => r.starred_by).filter(Boolean))]
  const { data: people } = ids.length
    ? await db.from('profiles').select('id, name').in('id', ids)
    : { data: [] as { id: string; name: string | null }[] }
  const names = new Map((people ?? []).map((p) => [p.id, p.name]))
  return new Map(
    data.map((r) => [
      r.thread_key,
      {
        threadKey: r.thread_key,
        note: r.note,
        starredBy: r.starred_by,
        starredByName: names.get(r.starred_by) ?? null,
        starredAt: r.starred_at,
      },
    ]),
  )
}

export async function setStar(
  db: SupabaseClient,
  threadKey: string,
  note: string,
  userId: string,
): Promise<{ error?: string }> {
  const { error } = await db.from(TABLE).upsert(
    { thread_key: threadKey, note, starred_by: userId, starred_at: new Date().toISOString() },
    { onConflict: 'thread_key' },
  )
  return error ? { error: error.message } : {}
}

export async function clearStar(db: SupabaseClient, threadKey: string): Promise<{ error?: string }> {
  const { error } = await db.from(TABLE).delete().eq('thread_key', threadKey)
  return error ? { error: error.message } : {}
}
