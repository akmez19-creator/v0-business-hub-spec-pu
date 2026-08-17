import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getProductMatcher } from '@/lib/products/catalogue'
import { productFromAdName } from '@/lib/facebook/ad-product-name'
import { getInboxPage } from '@/lib/facebook/messages'

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
 * Idempotent: `mid` is the primary key, so Meta retrying a delivery (it retries
 * until it gets a 200) can never duplicate a message or double-count the
 * thread. The summary is only advanced when the message is genuinely newer
 * than what we already hold, because webhook delivery is not ordered.
 */
export async function recordMessengerMessage(msg: IncomingMessage): Promise<void> {
  const { pageId, psid, mid } = msg
  if (!pageId || !psid || !mid) return

  const db = createAdminClient()

  // Insert first. If this mid already exists the thread was already counted,
  // so bail out rather than inflating message_count on a retry.
  const { error: insertError } = await db.from('messenger_messages').insert({
    mid,
    page_id: pageId,
    psid,
    direction: msg.direction,
    body: msg.body,
    attachments: msg.attachments ?? null,
    is_echo: msg.isEcho ?? false,
    app_id: msg.appId ?? null,
    created_at: msg.createdAt,
    raw: msg.raw ?? null,
  })

  if (insertError) {
    // 23505 = unique violation = duplicate delivery. Expected, not an error.
    if (insertError.code === '23505') return
    console.log('[v0] messenger store: insert failed', insertError.message)
    return
  }

  const { data: existing } = await db
    .from('messenger_conversations')
    .select('id,last_message_at,message_count,unread_count,ad_id')
    .eq('page_id', pageId)
    .eq('psid', psid)
    .maybeSingle()

  const inbound = msg.direction === 'in'
  const isNewer = !existing?.last_message_at || msg.createdAt >= (existing.last_message_at as string)

  if (!existing) {
    // First time we have ever seen this person on this page. Attach whatever
    // ad attribution the referral webhook already captured, so a brand-new
    // lead shows its product immediately instead of waiting for a refresh.
    const attribution = await attributionFor(pageId, psid)
    const [pageName, customerName] = await Promise.all([
      pageNameFor(pageId),
      customerNameFor(pageId, psid),
    ])
    const { error } = await db.from('messenger_conversations').insert({
      page_id: pageId,
      psid,
      page_name: pageName,
      customer_name: customerName,
      last_message_at: msg.createdAt,
      last_snippet: snippetFor(msg),
      last_from_customer: inbound,
      message_count: 1,
      unread_count: inbound ? 1 : 0,
      ...attribution,
    })
    if (error) console.log('[v0] messenger store: conversation insert failed', error.message)
    return
  }

  const update: Record<string, unknown> = {
    message_count: (existing.message_count as number) + 1,
    updated_at: new Date().toISOString(),
  }
  if (isNewer) {
    update.last_message_at = msg.createdAt
    update.last_snippet = snippetFor(msg)
    // The whole point of subscribing message_echoes: a reply sent from
    // Business Suite or respond.io clears "awaiting" here too, so a thread you
    // already answered stops being flagged as needing attention.
    update.last_from_customer = inbound
  }
  if (inbound) update.unread_count = (existing.unread_count as number) + 1
  else update.unread_count = 0

  // Meta delivers `referral` and `message` as SEPARATE webhook events with no
  // guaranteed order, and the person may have messaged the page before ever
  // clicking the ad. So a thread frequently already exists by the time its ad
  // referral lands, and attaching attribution only on insert silently loses it
  // - the thread shows no product even though the ad id was captured.
  if (!existing.ad_id) Object.assign(update, await attributionFor(pageId, psid))

  const { error } = await db
    .from('messenger_conversations')
    .update(update)
    .eq('id', existing.id as string)
  if (error) console.log('[v0] messenger store: conversation update failed', error.message)
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
    const json = (await (await fetch(url)).json()) as {
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
export async function markMessengerRead(pageId: string, psid: string): Promise<void> {
  const db = createAdminClient()
  await db
    .from('messenger_conversations')
    .update({ unread_count: 0 })
    .eq('page_id', pageId)
    .eq('psid', psid)
}
