import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { MESSAGING_WINDOW_MS, type InboxConversation, type InboxMessage } from '@/lib/facebook/messages'

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
  }
}

const COLUMNS =
  'psid,conversation_id,page_id,page_name,customer_name,last_message_at,last_snippet,last_from_customer,message_count,unread_count,ad_id,ad_name,product,product_id,campaign_id,campaign_name'

export async function listCachedConversations(options: {
  pageId?: string
  limit?: number
}): Promise<InboxConversation[]> {
  const db = createAdminClient()
  let q = db
    .from('messenger_conversations')
    .select(COLUMNS)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 200)

  if (options.pageId && options.pageId !== 'all') q = q.eq('page_id', options.pageId)

  const { data, error } = await q
  if (error) {
    console.log('[v0] messenger cache: list failed', error.message)
    return []
  }
  return (data as unknown as ConversationRow[]).map(toConversation)
}

/** Per-page counts for the channel rail, computed from the cache. */
export async function cachedPageStats(): Promise<
  { id: string; name: string; unread: number; conversations: number }[]
> {
  const db = createAdminClient()
  const { data } = await db.from('messenger_conversations').select('page_id,page_name,unread_count')
  const byPage = new Map<string, { id: string; name: string; unread: number; conversations: number }>()
  for (const row of (data ?? []) as { page_id: string; page_name: string | null; unread_count: number }[]) {
    const entry = byPage.get(row.page_id) ?? {
      id: row.page_id,
      name: row.page_name ?? '',
      unread: 0,
      conversations: 0,
    }
    entry.unread += row.unread_count
    entry.conversations += 1
    byPage.set(row.page_id, entry)
  }
  return [...byPage.values()]
}

/** Resolve either id form back to the (page_id, psid) the messages table uses. */
export async function resolveThread(
  id: string,
  pageId?: string,
): Promise<{ pageId: string; psid: string } | null> {
  if (id.startsWith('psid:')) {
    const psid = id.slice('psid:'.length)
    if (pageId) return { pageId, psid }
  }
  const db = createAdminClient()
  const { data } = await db
    .from('messenger_conversations')
    .select('page_id,psid')
    .or(`conversation_id.eq.${id},psid.eq.${id.replace(/^psid:/, '')}`)
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { pageId: data.page_id as string, psid: data.psid as string }
}

/** Transcript for one thread, oldest first, straight from Postgres. */
export async function listCachedMessages(pageId: string, psid: string): Promise<InboxMessage[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('messenger_messages')
    .select('mid,direction,body,attachments,created_at')
    .eq('page_id', pageId)
    .eq('psid', psid)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) {
    console.log('[v0] messenger cache: transcript failed', error.message)
    return []
  }

  return (data ?? []).map((row) => {
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

function normaliseAttachments(value: unknown): { type: string; url: string | null }[] {
  // Webhook shape is { data: [...] }; the Graph shape is a bare array.
  const list = Array.isArray(value)
    ? value
    : Array.isArray((value as { data?: unknown[] })?.data)
      ? (value as { data: unknown[] }).data
      : []
  return list.map((a) => {
    const att = a as { type?: string; payload?: { url?: string }; image_data?: { url?: string } }
    return {
      type: att.type ?? 'file',
      url: att.payload?.url ?? att.image_data?.url ?? null,
    }
  })
}

/** True when the cache has never been populated, so a backfill is still owed. */
export async function cacheIsEmpty(): Promise<boolean> {
  const db = createAdminClient()
  const { count } = await db.from('messenger_conversations').select('*', { count: 'exact', head: true })
  return (count ?? 0) === 0
}
