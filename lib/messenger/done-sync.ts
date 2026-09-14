import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { fbGet } from '@/lib/facebook/graph'
import { getInboxPages } from '@/lib/facebook/messages'
import type { FbPage } from '@/lib/facebook/pages'
import { connectInboxDatabase } from './pg'

/**
 * Mirror the Meta Business Suite "Done" folder.
 *
 * Business Suite lets an agent move a chat to Done from the phone or the
 * desktop app. Nothing about that reaches the webhook, so without this the
 * inbox kept showing those customers as "waiting" and the 24h needs-reply
 * count was wrong. One Graph call per Page (`folder=page_done`) returns the
 * conversations currently in Done with their participants, and we record the
 * folder's `updated_time` as `done_at`.
 *
 * Reopening needs no write: a customer message after `done_at` advances
 * `last_message_at` past it, and the UI treats the thread as open again.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const SYNC_KEY = 'messenger:done'
const MIN_INTERVAL_MS = 5 * 60 * 1000
const MAX_FOLDER_PAGES = 3

type DoneConversation = { id: string; updated_time?: string; participants?: { data?: { id: string }[] } }

export type DoneSyncResult = {
  ok: boolean
  pages: { id: string; name: string; seen: number; matched: number; error?: string }[]
  skipped?: 'recent' | 'unconfigured'
}

/**
 * Newest-first pages of the Done folder, stopping as soon as a page falls
 * outside the lookback: a Page that closed nothing this month costs one call,
 * the two busy Pages (100+ Done chats a month, measured) cost up to three.
 */
async function readDoneFolder(page: FbPage): Promise<{ rows: DoneConversation[]; complete: boolean }> {
  const cutoff = Date.now() - LOOKBACK_MS
  let url: string | null = `${GRAPH}/${page.id}/conversations?platform=messenger&folder=page_done&fields=id,updated_time,participants&limit=100&access_token=${encodeURIComponent(page.access_token)}`
  const rows: DoneConversation[] = []
  for (let calls = 0; url && calls < MAX_FOLDER_PAGES; calls++) {
    const json: { data?: DoneConversation[]; paging?: { next?: string } } = await fbGet(url, { cacheTtl: 60_000 })
    const batch = json.data ?? []
    rows.push(...batch.filter((row) => row.updated_time && Date.parse(row.updated_time) >= cutoff))
    const exhausted = batch.length === 0 || batch.some((row) => !row.updated_time || Date.parse(row.updated_time) < cutoff)
    if (exhausted || !json.paging?.next) return { rows, complete: true }
    url = json.paging.next
  }
  return { rows, complete: false }
}

/** Sync every reachable Page. `force` bypasses the 5 minute spacing used by routine list loads. */
export async function syncDoneConversations(options: { force?: boolean } = {}): Promise<DoneSyncResult> {
  if (!process.env.FACEBOOK_ACCESS_TOKEN) return { ok: false, pages: [], skipped: 'unconfigured' }
  const admin = createAdminClient()
  if (!options.force) {
    const { data } = await admin.from('inbox_sync_state').select('last_run_at').eq('key', SYNC_KEY).maybeSingle()
    const lastRun = data?.last_run_at ? Date.parse(data.last_run_at as string) : 0
    if (Date.now() - lastRun < MIN_INTERVAL_MS) return { ok: true, pages: [], skipped: 'recent' }
  }
  const startedAt = new Date().toISOString()
  await admin.from('inbox_sync_state').upsert({ key: SYNC_KEY, last_run_at: startedAt, updated_at: startedAt }, { onConflict: 'key' })

  const pages = await getInboxPages()
  const result: DoneSyncResult = { ok: true, pages: [] }
  const records: { page_id: string; psid: string; conversation_id: string; done_at: string }[] = []
  // Below this point a Page's folder was not fully read, so absence proves nothing.
  const verifiedFloor: { page_id: string; floor: string }[] = []
  for (const page of pages) {
    try {
      const { rows, complete } = await readDoneFolder(page)
      const oldestSeen = rows.reduce((min, row) => Math.min(min, Date.parse(row.updated_time!)), Number.POSITIVE_INFINITY)
      verifiedFloor.push({ page_id: page.id, floor: new Date(!complete && Number.isFinite(oldestSeen) ? oldestSeen : Date.now() - LOOKBACK_MS).toISOString() })
      let matched = 0
      for (const row of rows) {
        const customer = row.participants?.data?.find((p) => p.id !== page.id)
        if (!customer?.id || !row.updated_time) continue
        records.push({ page_id: page.id, psid: customer.id, conversation_id: row.id, done_at: new Date(row.updated_time).toISOString() })
        matched++
      }
      result.pages.push({ id: page.id, name: page.name, seen: rows.length, matched })
    } catch (error) {
      result.ok = false
      result.pages.push({ id: page.id, name: page.name, seen: 0, matched: 0, error: error instanceof Error ? error.message : 'Done folder unavailable' })
    }
  }

  const checkedAt = new Date().toISOString()
  const db = await connectInboxDatabase()
  try {
    // Only rows we already know about are touched: a Done chat that never
    // reached this inbox has nothing to display.
    if (records.length) {
      await db.query(
        `update public.messenger_conversations m
            set done_at = greatest(m.done_at, d.done_at::timestamptz),
                done_checked_at = $2::timestamptz,
                conversation_id = coalesce(m.conversation_id, d.conversation_id)
           from jsonb_to_recordset($1::jsonb) as d(page_id text, psid text, conversation_id text, done_at text)
          where m.page_id = d.page_id and m.psid = d.psid`,
        [JSON.stringify(records), checkedAt],
      )
    }
    // Pages that answered are fully verified: anything still flagged done but
    // absent from their folder was reopened or archived on Meta's side.
    if (verifiedFloor.length) {
      await db.query(
        `update public.messenger_conversations m
            set done_at = null, done_checked_at = $2::timestamptz
           from jsonb_to_recordset($1::jsonb) as v(page_id text, floor text)
          where m.page_id = v.page_id and m.done_at is not null and m.done_at >= v.floor::timestamptz
            and not exists (select 1 from jsonb_to_recordset($3::jsonb) as d(page_id text, psid text)
                             where d.page_id = m.page_id and d.psid = m.psid)`,
        [JSON.stringify(verifiedFloor), checkedAt, JSON.stringify(records.map((r) => ({ page_id: r.page_id, psid: r.psid })))],
      )
    }
  } finally {
    await db.end().catch(() => {})
  }
  await admin.from('inbox_sync_state').upsert({
    key: SYNC_KEY, updated_at: checkedAt,
    ...(result.ok ? { last_ok_at: checkedAt, last_error: null } : { last_error: `${result.pages.filter((p) => p.error).length} of ${pages.length} Pages could not report their Done folder` }),
  }, { onConflict: 'key' })
  return result
}
