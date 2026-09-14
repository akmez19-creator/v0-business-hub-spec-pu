import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getProductMatcher } from '@/lib/products/catalogue'
import { productFromAdName } from '@/lib/facebook/ad-product-name'
import { getInboxPage } from '@/lib/facebook/messages'
import { after } from 'next/server'
import { connectInboxDatabase } from './pg'
import { firstRecoveryWebhook, recoveredInboundIsUnread } from './recovery/webhook-state.mjs'

/**
 * Persistence for Messenger threads.
 *
 * The inbox used to re-walk the Graph API on every page load, which exhausted
 * Meta's app-wide hourly cap ("(#4) Application request limit reached"). These
 * writes are fed by the page webhook, so normal browsing costs no Graph calls
 * at all - mirroring how the WhatsApp channel has always worked.
 */

export type IncomingMessage = {
  pageId: string
  /** The CUSTOMER's page-scoped id, whichever direction the message travelled. */
  psid: string
  mid: string
  direction: 'in' | 'out'
  body: string | null
  attachments?: unknown
  /** True when Meta is echoing back something the Page sent. */
  isEcho?: boolean
  /** Which app sent an outbound message. Null for the Page Inbox. */
  appId?: string | null
  createdAt: string
  raw?: unknown
}

/**
 * Store one message and roll the thread summary forward.
 *
 * The message and its thread summary commit together. Locking the Page and
 * customer pair also serializes two simultaneous first messages. A retry can
 * repair a summary left incomplete by the former nontransactional writer.
 */
export async function recordMessengerMessage(msg: IncomingMessage): Promise<void> {
  const { pageId, psid, mid } = msg
  if (!pageId || !psid || !mid) return
  if (!Number.isFinite(Date.parse(msg.createdAt))) throw new Error('Invalid Messenger message timestamp')
  const client = await connectInboxDatabase()
  let createdConversation = false
  let needsAttribution = false
  let needsName = false
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([pageId, psid])])
    const created = await client.query(
      `INSERT INTO messenger_conversations (page_id, psid)
       VALUES ($1, $2) ON CONFLICT (page_id, psid) DO NOTHING RETURNING id`, [pageId, psid])
    createdConversation = Boolean(created.rowCount)
    const selected = await client.query<{
      id: string; last_message_at: Date | null; message_count: number;
      unread_count: number; ad_id: string | null
      page_name: string | null; customer_name: string | null
    }>(`SELECT id, last_message_at, message_count, unread_count, ad_id, page_name, customer_name
        FROM messenger_conversations WHERE page_id=$1 AND psid=$2 FOR UPDATE`, [pageId, psid])
    const existing = selected.rows[0]
    if (!existing) throw new Error('Messenger conversation could not be locked')
    needsAttribution = !existing.ad_id
    needsName = !existing.page_name || !existing.customer_name
    const inserted = await client.query(
      `INSERT INTO messenger_messages
       (mid,page_id,psid,direction,body,attachments,is_echo,app_id,created_at,raw)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz,$10::jsonb)
       ON CONFLICT (mid) DO NOTHING RETURNING mid`,
      [mid,pageId,psid,msg.direction,msg.body,JSON.stringify(msg.attachments ?? null),
        msg.isEcho ?? false,msg.appId ?? null,msg.createdAt,JSON.stringify(msg.raw ?? null)])
    const isNewMessage = Boolean(inserted.rowCount)
    let recovered: ReturnType<typeof firstRecoveryWebhook> = null
    if (!isNewMessage) {
      const saved = await client.query<{
        mid: string; page_id: string; psid: string; direction: string; body: string | null;
        attachments: unknown; created_at: Date; raw: unknown; is_echo: boolean; app_id: string | null
      }>('SELECT mid,page_id,psid,direction,body,attachments,created_at,raw,is_echo,app_id FROM messenger_messages WHERE mid=$1 FOR UPDATE', [mid])
      if (!saved.rows[0]) throw new Error('Messenger message could not be verified')
      recovered = firstRecoveryWebhook(saved.rows[0], msg, new Date().toISOString())
      if (recovered) await client.query(`UPDATE messenger_messages SET body=$2,attachments=$3::jsonb,created_at=$4::timestamptz,
        raw=$5::jsonb,is_echo=$6,app_id=$7 WHERE mid=$1`,
      [mid,recovered.body,JSON.stringify(recovered.attachments ?? null),recovered.createdAt,JSON.stringify(recovered.raw),recovered.isEcho,recovered.appId])
    }
    const latest = await client.query<{
      mid: string; direction: 'in' | 'out'; body: string | null; attachments: unknown; created_at: Date
    }>(`SELECT mid,direction,body,attachments,created_at FROM messenger_messages
        WHERE page_id=$1 AND psid=$2 ORDER BY created_at DESC,mid DESC LIMIT 1`, [pageId,psid])
    const newest = latest.rows[0]
    if (!newest) throw new Error('Messenger message could not be verified')
    const latestTime = new Date(newest.created_at).getTime()
    const previousTime = existing.last_message_at ? new Date(existing.last_message_at).getTime() : -Infinity
    const advances = latestTime > previousTime ||
      ((isNewMessage || Boolean(recovered)) && newest.mid === mid && latestTime === previousTime)
    let count = existing.message_count + (isNewMessage ? 1 : 0)
    if (!isNewMessage || createdConversation) {
      const actual = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM messenger_messages WHERE page_id=$1 AND psid=$2', [pageId,psid])
      count = Math.max(count, Number(actual.rows[0]?.count ?? 0))
    }
    let unread = existing.unread_count
    if (advances) {
      if (newest.direction === 'out') unread = 0
      else unread = isNewMessage ? unread + 1 : Math.max(unread, 1)
    }
    if (recovered && msg.direction === 'in') {
      const readState = await client.query<{ cursor: string | null }>('SELECT cursor FROM inbox_sync_state WHERE key=$1', [`messenger:read:${pageId}:${psid}`])
      const outgoing = await client.query<{ at: Date | null }>("SELECT max(created_at) AS at FROM messenger_messages WHERE page_id=$1 AND psid=$2 AND direction='out'", [pageId,psid])
      const isUnread = recoveredInboundIsUnread(recovered.recoveredCreatedAt, readState.rows[0]?.cursor ?? null, outgoing.rows[0]?.at ?? null)
      if (isUnread) unread = existing.unread_count + 1
      else if (newest.direction === 'in') unread = existing.unread_count
    }
    const preview = snippetFor({ ...msg, body: newest.body, attachments: newest.attachments })
    await client.query(
      `UPDATE messenger_conversations SET message_count=$2, unread_count=$3,
       last_message_at=CASE WHEN $4 THEN $5::timestamptz ELSE last_message_at END,
       last_snippet=CASE WHEN $4 THEN $6 ELSE last_snippet END,
       last_from_customer=CASE WHEN $4 THEN $7 ELSE last_from_customer END,
       updated_at=clock_timestamp() WHERE id=$1`,
      [existing.id,count,unread,advances,new Date(newest.created_at).toISOString(),preview,newest.direction === 'in'])
    await client.query('COMMIT')
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    throw new Error('Could not persist Messenger message and conversation')
  } finally {
    await client.end().catch(() => {})
  }
  // Customer naming and ad enrichment retain the existing behavior without
  // placing external Graph requests before the durable delivery acknowledgment.
  if (createdConversation || needsAttribution || needsName) after(async () => {
    try {
      const db = createAdminClient()
      if (createdConversation || needsName) {
        const [pageName, customerName] = await Promise.all([pageNameFor(pageId),customerNameFor(pageId,psid)])
        if (pageName) await db.from('messenger_conversations').update({page_name:pageName})
          .eq('page_id',pageId).eq('psid',psid).is('page_name',null)
        if (customerName) await db.from('messenger_conversations').update({customer_name:customerName})
          .eq('page_id',pageId).eq('psid',psid).is('customer_name',null)
      }
      if (needsAttribution) {
        const attribution = await attributionFor(pageId,psid)
        if (Object.keys(attribution).length) await db.from('messenger_conversations').update(attribution)
          .eq('page_id',pageId).eq('psid',psid).is('ad_id',null)
      }
    } catch { console.log('[v0] messenger: optional conversation enrichment deferred') }
  })
}

/**
 * The customer's display name for a thread we have never seen before.
 *
 * Only ever called when a conversation is FIRST created, so this is one Graph
 * call per new person - not per message - and a failure just leaves the name
 * for the next sync to fill.
 *
 * Note the endpoint: /{page}/conversations?user_id= works, while the obvious
 * /{psid}?fields=name returns "Object does not exist, cannot be loaded due to
 * missing permissions" for these ids. Do not swap it for the direct lookup.
 */
async function customerNameFor(pageId: string, psid: string): Promise<string | null> {
  try {
    const page = await getInboxPage(pageId)
    if (!page || page.id !== pageId) return null

    const url =
      `https://graph.facebook.com/v21.0/${pageId}/conversations` +
      `?user_id=${encodeURIComponent(psid)}&fields=participants` +
      `&access_token=${encodeURIComponent(page.access_token)}`
    const json = (await (await fetch(url, {signal:AbortSignal.timeout(5000)})).json()) as {
      data?: { participants?: { data?: { id?: string; name?: string }[] } }[]
    }
    const participants = json.data?.[0]?.participants?.data ?? []
    return participants.find((p) => p.id !== pageId)?.name ?? null
  } catch {
    // A name is decoration - never fail a message write for it.
    return null
  }
}

/**
 * A human-readable one-line preview.
 *
 * A photo or voice note has no text, and storing '' for it rendered as
 * "No preview" while also wiping the previous line - so a thread could look
 * empty even though the customer had just sent something.
 */
function snippetFor(msg: IncomingMessage): string {
  const text = msg.body?.trim()
  if (text) return text

  const list = Array.isArray(msg.attachments) ? (msg.attachments as { type?: string }[]) : []
  const type = list[0]?.type
  if (type === 'image') return '[Photo]'
  if (type === 'video') return '[Video]'
  if (type === 'audio') return '[Voice message]'
  if (type === 'file') return '[File]'
  return list.length > 0 ? '[Attachment]' : ''
}

/**
 * The Page's display name, read from a thread we already hold for that Page.
 *
 * Deliberately NOT a Graph lookup: page discovery costs 10+ calls and a
 * webhook can arrive on a cold start, so resolving it that way would fan out
 * requests on exactly the path that must stay cheap (error #4 is app-wide).
 * Every Page already has hundreds of rows, so Postgres always knows the name.
 */
async function pageNameFor(pageId: string): Promise<string | null> {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('messenger_conversations')
      .select('page_name')
      .eq('page_id', pageId)
      .not('page_name', 'is', null)
      .limit(1)
      .maybeSingle()
    return (data?.page_name as string | null) ?? null
  } catch {
    return null
  }
}

/** Copy ad attribution captured by the referral webhook onto a new thread. */
async function attributionFor(pageId: string, psid: string) {
  try {
    const db = createAdminClient()
    const { data } = await db
      .from('messenger_ad_refs')
      .select('ad_id,ad_name')
      .eq('page_id', pageId)
      .eq('sender_id', psid)
      .maybeSingle()
    if (!data?.ad_name) return {}

    const product = productFromAdName(data.ad_name as string)
    const match = product ? (await getProductMatcher())(product) : null
    return {
      ad_id: (data.ad_id as string | null) ?? null,
      ad_name: data.ad_name as string,
      product,
      product_id: match?.productId ?? null,
    }
  } catch {
    // Attribution is decoration - never fail a message write for it.
    return {}
  }
}

/** Clear the unread badge when a thread is opened in the dashboard. */
export async function markMessengerRead(pageId: string, psid: string, seenThrough?: string): Promise<void> {
  const through = seenThrough ?? new Date().toISOString()
  if (!pageId || !psid || !Number.isFinite(Date.parse(through))) throw new Error('Invalid Messenger read state')
  const client = await connectInboxDatabase()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '10s'")
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([pageId,psid])])
    await client.query(`UPDATE messenger_conversations SET unread_count=0,updated_at=clock_timestamp()
      WHERE page_id=$1 AND psid=$2 AND ($4::boolean OR last_message_at <= $3::timestamptz)`, [pageId,psid,through,!seenThrough])
    await client.query(`INSERT INTO inbox_sync_state(key,cursor,last_ok_at,updated_at)
      VALUES($1,$2,clock_timestamp(),clock_timestamp()) ON CONFLICT(key) DO UPDATE SET
      cursor=GREATEST(inbox_sync_state.cursor::timestamptz,EXCLUDED.cursor::timestamptz)::text,last_ok_at=clock_timestamp(),updated_at=clock_timestamp()`,
    [`messenger:read:${pageId}:${psid}`,through])
    await client.query('COMMIT')
  } catch {
    await client.query('ROLLBACK').catch(() => {})
    throw new Error('Could not update Messenger read state')
  } finally { await client.end().catch(() => {}) }
}
