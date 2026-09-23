import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { MESSAGING_WINDOW_MS, type InboxConversation, type InboxMessage } from '@/lib/facebook/messages'
import { connectInboxDatabase } from './pg'

/**
 * Cache-backed reads for the Messenger inbox.
 *
 * Returns exactly the same shapes the Graph-backed reader does, so the UI is
 * unchanged and the two can be swapped freely. The point is that a normal page
 * load - list AND transcript - costs zero Graph calls, which is what stops
 * routine browsing from exhausting Meta's app-wide hourly cap.
 */

/**
 * Threads have two possible identities. A thread seeded by the backfill knows
 * its Graph `t_<id>`; a thread that arrived by webhook only knows the psid,
 * because Meta never sends a conversation id. Synthesising `psid:<id>` for the
 * latter keeps one id space, and `resolveThread` maps either back to a row.
 */
export function threadId(conversationId: string | null, psid: string): string {
  return conversationId ?? `psid:${psid}`
}

type ConversationRow = {
  psid: string
  conversation_id: string | null
  page_id: string
  page_name: string | null
  customer_name: string | null
  last_message_at: string | null
  last_snippet: string | null
  last_from_customer: boolean
  message_count: number
  unread_count: number
  ad_id: string | null
  ad_name: string | null
  product: string | null
  product_id: string | null
  campaign_id: string | null
  campaign_name: string | null
  done_at?: string | null
}

function toConversation(row: ConversationRow): InboxConversation {
  const updatedTime = row.last_message_at ?? new Date(0).toISOString()
  return {
    id: threadId(row.conversation_id, row.psid),
    snippet: row.last_snippet ?? '',
    updatedTime,
    unreadCount: row.unread_count,
    messageCount: row.message_count,
    customer: { id: row.psid, name: row.customer_name ?? undefined },
    outsideWindow: Date.now() - new Date(updatedTime).getTime() > MESSAGING_WINDOW_MS,
    pageId: row.page_id,
    pageName: row.page_name ?? '',
    adId: row.ad_id,
    adName: row.ad_name,
    product: row.product,
    // Only an ad click proves the product; anything else would overstate it.
    productSource: row.ad_id ? 'ad-click' : null,
    productId: row.product_id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    lastFromCustomer: row.last_from_customer,
    doneAt: row.done_at ?? null,
  }
}

const COLUMNS =
  'psid,conversation_id,page_id,page_name,customer_name,last_message_at,last_snippet,last_from_customer,message_count,unread_count,ad_id,ad_name,product,product_id,campaign_id,campaign_name,done_at'

/** How far back a customer-waiting thread stays in the list regardless of the recency cap. */
export const WAITING_WINDOW_DAYS = 7
const WAITING_LIMIT = 600

/**
 * Conversation rows for every starred Messenger thread.
 *
 * Returns [] on any failure: a star that cannot be resolved must not stop the
 * inbox from rendering. Keys are written as `messenger:<pageId>:<psid>`; the
 * psid itself never contains ':', so splitting on the first two separators is
 * safe. WhatsApp stars are ignored here - that channel loads its own threads.
 */
async function starredMessengerRows(
  db: ReturnType<typeof createAdminClient>,
  scoped: <T extends { eq: (column: string, value: string) => T }>(q: T) => T,
): Promise<ConversationRow[]> {
  try {
    const { data: stars } = await db.from('inbox_thread_stars').select('thread_key')
    const pairs = (stars ?? [])
      .map((s) => String(s.thread_key ?? '').split(':'))
      .filter((p) => p[0] === 'messenger' && p[1] && p[2])
      .map((p) => ({ pageId: p[1], psid: p[2] }))
    if (!pairs.length) return []

    // One request for all of them. PostgREST needs the commas inside and(...)
    // escaped by quoting each value, or a psid would be read as a new filter.
    const filter = pairs.map((p) => `and(page_id.eq."${p.pageId}",psid.eq."${p.psid}")`).join(',')
    const { data, error } = await scoped(db.from('messenger_conversations').select(COLUMNS).or(filter))
    if (error || !data) return []
    return data as unknown as ConversationRow[]
  } catch {
    return []
  }
}

export async function listCachedConversations(options: {
  pageId?: string
  limit?: number
}): Promise<InboxConversation[]> {
  const db = createAdminClient()
  const scoped = <T extends { eq: (column: string, value: string) => T }>(q: T) =>
    options.pageId && options.pageId !== 'all' ? q.eq('page_id', options.pageId) : q

  // Two reads instead of one. The recency cap alone hid every thread that fell
  // below the newest N: with both Pages selected that was anything older than
  // the same morning, and 184 threads where the customer had spoken last in the
  // past week were not in the list at all, so no queue filter could show them.
  const newest = scoped(
    db
      .from('messenger_conversations')
      .select(COLUMNS)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(options.limit ?? 200),
  )
  const waitingSince = new Date(Date.now() - WAITING_WINDOW_DAYS * 86_400_000).toISOString()
  const waiting = scoped(
    db
      .from('messenger_conversations')
      .select(COLUMNS)
      .eq('last_from_customer', true)
      .is('done_at', null)
      .gt('last_message_at', waitingSince)
      .order('last_message_at', { ascending: false })
      .limit(WAITING_LIMIT),
  )

  // Third read: starred threads, at any age and outside every cap. A star is a
  // person escalating a problem, so the thread has to stay reachable until the
  // star is cleared - and because we reply to escalations, the thread usually
  // has US speaking last, which excludes it from the waiting read above. All
  // three stars on 23 Sep sat at rank 733/1122/1345, so the Starred filter
  // counted 5 and could only show the 2 WhatsApp ones.
  const starred = starredMessengerRows(db, scoped)

  const [newestResult, waitingResult, starredRows] = await Promise.all([newest, waiting, starred])
  if (newestResult.error) {
    throw new Error('Could not read cached Messenger conversations')
  }
  // The waiting and starred reads are wideners, never gates: if either fails the
  // newest list still renders.
  const rows = [
    ...(newestResult.data as unknown as ConversationRow[]),
    ...((waitingResult.error ? [] : waitingResult.data) as unknown as ConversationRow[]),
    ...starredRows,
  ]
  const byThread = new Map<string, ConversationRow>()
  for (const row of rows) byThread.set(`${row.page_id}:${row.psid}`, row)
  return [...byThread.values()]
    .sort((a, b) => (Date.parse(b.last_message_at ?? '') || 0) - (Date.parse(a.last_message_at ?? '') || 0))
    .map(toConversation)
}

/** Per-page counts for the channel rail, computed from the cache. */
export async function cachedPageStats(): Promise<
  { id: string; name: string; unread: number; conversations: number }[]
> {
  // Aggregate in the database: returning six Page totals is cheaper and more
  // accurate than downloading a capped set of thousands of conversation rows.
  try {
    const client = await connectInboxDatabase()
    try {
      const { rows } = await client.query<{
        page_id: string; name: string; unread: string; conversations: string
      }>(`SELECT page_id, COALESCE(MAX(NULLIF(page_name, '')), page_id) AS name,
          COALESCE(SUM(unread_count), 0)::text AS unread, COUNT(*)::text AS conversations
          FROM messenger_conversations GROUP BY page_id ORDER BY page_id`)
      return rows.map((row) => ({
        id: row.page_id, name: row.name, unread: Number(row.unread), conversations: Number(row.conversations),
      }))
    } finally {
      await client.end().catch(() => {})
    }
  } catch {
    // Cached browsing can still work through Supabase if its direct Postgres
    // connection is temporarily unavailable. Page every row in a stable order.
  }
  const db = createAdminClient()
  const byPage = new Map<string, { id: string; name: string; unread: number; conversations: number }>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('messenger_conversations')
      .select('page_id,page_name,unread_count').order('id').range(offset, offset + 999)
    if (error) throw new Error('Could not read Messenger page counts')
    for (const row of (data ?? []) as { page_id: string; page_name: string | null; unread_count: number }[]) {
      const entry = byPage.get(row.page_id) ?? {
        id: row.page_id, name: row.page_name || row.page_id, unread: 0, conversations: 0,
      }
      // Match the deterministic nonempty-name choice of the grouped query.
      if (row.page_name && (entry.name === row.page_id || row.page_name > entry.name)) entry.name = row.page_name
      entry.unread += row.unread_count ?? 0
      entry.conversations += 1
      byPage.set(row.page_id, entry)
    }
    if ((data?.length ?? 0) < 1000) break
  }
  return [...byPage.values()].sort((a,b) => a.id.localeCompare(b.id))
}

/** Resolve either id form back to the (page_id, psid) the messages table uses. */
export async function resolveThread(
  id: string,
  pageId?: string,
): Promise<{ pageId: string; psid: string; conversationId: string | null } | null> {
  if (!id || id.length > 512 || /[,()]/.test(id)) return null
  const db = createAdminClient()
  let query = db
    .from('messenger_conversations')
    .select('page_id,psid,conversation_id')
  query = id.startsWith('psid:')
    ? query.eq('psid', id.slice('psid:'.length))
    : query.eq('conversation_id', id)
  if (pageId) query = query.eq('page_id', pageId)
  const { data, error } = await query.limit(2)
  if (error) throw new Error('Could not resolve Messenger conversation')
  // Ambiguous customer ids must never select the first business arbitrarily.
  if (!data || data.length !== 1) return null
  const row = data[0]
  return { pageId: row.page_id as string, psid: row.psid as string,
    conversationId: (row.conversation_id as string | null) ?? null }
}

/** Transcript for one thread, oldest first, straight from Postgres. */
export async function listCachedMessages(pageId: string, psid: string): Promise<InboxMessage[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('messenger_messages')
    .select('mid,direction,body,attachments,created_at')
    .eq('page_id', pageId)
    .eq('psid', psid)
    .order('created_at', { ascending: false })
    .order('mid', { ascending: false })
    .limit(500)

  if (error) {
    throw new Error('Could not read cached Messenger messages')
  }

  return (data ?? []).reverse().map((row) => {
    const r = row as {
      mid: string
      direction: string
      body: string | null
      attachments: unknown
      created_at: string
    }
    return {
      id: r.mid,
      text: r.body ?? '',
      createdTime: r.created_at,
      fromPage: r.direction === 'out',
      fromName: r.direction === 'out' ? 'Page' : '',
      attachments: normaliseAttachments(r.attachments),
    }
  })
}

export function normaliseAttachments(value: unknown): { type: string; url: string | null; title: string | null }[] {
  // Webhook shape is { data: [...] }; the Graph shape is a bare array.
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { data?: unknown[] })?.data)
      ? (value as { data: unknown[] }).data
      : []
  return list.filter((a) => a && typeof a === 'object').map((a) => {
    const att = a as { type?: string; mime_type?: string; url?: string; file_url?: string; title?: string; name?: string;
      payload?: { url?: string; title?: string }; image_data?: { url?: string } }
    // A shared reel/post carries its caption as `payload.title`: that text names
    // the product the customer is pointing at, so the AI must see it.
    const title = att.payload?.title ?? att.title ?? att.name ?? null
    return {
      type: att.type ?? att.mime_type ?? 'file',
      url: att.url ?? att.payload?.url ?? att.image_data?.url ?? att.file_url ?? null,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 1000) : null,
    }
  })
}

/** True when the cache has never been populated, so a backfill is still owed. */
export async function cacheIsEmpty(): Promise<boolean> {
  const db = createAdminClient()
  const { count, error } = await db.from('messenger_conversations').select('*', { count: 'exact', head: true })
  if (error) throw new Error('Could not check Messenger cache')
  return (count ?? 0) === 0
}
