import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getProductMatcher } from '@/lib/products/catalogue'
import { productFromAdName } from '@/lib/facebook/ad-product-name'

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
    const { error } = await db.from('messenger_conversations').insert({
      page_id: pageId,
      psid,
      last_message_at: msg.createdAt,
      last_snippet: msg.body ?? '',
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
    update.last_snippet = msg.body ?? ''
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
