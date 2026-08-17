import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getInboxPage, getInboxPages, listAllConversations, listMessages } from '@/lib/facebook/messages'
import { isRateLimit } from '@/lib/facebook/rate-limit-response'

/**
 * Graph -> Postgres synchronisation.
 *
 * Deliberately cheap. Seeding the thread LIST costs one Graph call per Page
 * (six total) because /conversations already returns snippet, unread count and
 * message count - everything the list view renders. Transcripts are NOT
 * bulk-fetched; they are hydrated lazily the first time a thread is opened, so
 * the expensive per-thread call is only ever paid for threads someone actually
 * reads. Bulk-fetching them is precisely what exhausted the hourly cap before.
 */

async function noteSync(key: string, patch: Record<string, unknown>) {
  const db = createAdminClient()
  await db.from('inbox_sync_state').upsert(
    { key, updated_at: new Date().toISOString(), ...patch },
    { onConflict: 'key' },
  )
}

export type SyncResult = {
  ok: boolean
  conversations: number
  rateLimited: boolean
  error?: string
}

/**
 * Refresh the thread list for every Page.
 *
 * Upserts rather than replaces, and never lowers `last_message_at`, so a
 * webhook message that arrived a moment ago is not overwritten by a slightly
 * staler Graph snapshot.
 */
export async function syncConversations(): Promise<SyncResult> {
  const db = createAdminClient()
  await noteSync('messenger', { last_run_at: new Date().toISOString() })

  try {
    const pages = await getInboxPages()
    if (pages.length === 0) {
      return { ok: false, conversations: 0, rateLimited: false, error: 'No Page reachable' }
    }

    const { conversations } = await listAllConversations(pages)
    let written = 0

    for (const c of conversations) {
      const psid = c.customer?.id
      if (!psid) continue

      const { data: existing } = await db
        .from('messenger_conversations')
        .select('id,last_message_at')
        .eq('page_id', c.pageId)
        .eq('psid', psid)
        .maybeSingle()

      // The webhook is the more current source; only let Graph move the
      // summary forward, never backward.
      const graphIsNewer =
        !existing?.last_message_at || c.updatedTime > (existing.last_message_at as string)

      const row: Record<string, unknown> = {
        page_id: c.pageId,
        psid,
        conversation_id: c.id.startsWith('psid:') ? null : c.id,
        page_name: c.pageName,
        customer_name: c.customer?.name ?? null,
        updated_at: new Date().toISOString(),
      }
      if (graphIsNewer) {
        row.last_message_at = c.updatedTime
        row.last_snippet = c.snippet
        row.unread_count = c.unreadCount
        row.message_count = c.messageCount
        if (typeof c.lastFromCustomer === 'boolean') row.last_from_customer = c.lastFromCustomer
      }
      // Attribution is only ever additive - never blank out a stored value.
      if (c.adId) row.ad_id = c.adId
      if (c.adName) row.ad_name = c.adName
      if (c.product) row.product = c.product
      if (c.productId) row.product_id = c.productId
      if (c.campaignId) row.campaign_id = c.campaignId
      if (c.campaignName) row.campaign_name = c.campaignName

      const { error } = await db
        .from('messenger_conversations')
        .upsert(row, { onConflict: 'page_id,psid' })
      if (!error) written += 1
      else console.log('[v0] messenger sync: upsert failed', error.message)
    }

    await noteSync('messenger', { last_ok_at: new Date().toISOString(), last_error: null })
    return { ok: true, conversations: written, rateLimited: false }
  } catch (e) {
    const rateLimited = isRateLimit(e)
    const error = e instanceof Error ? e.message : 'sync failed'
    await noteSync('messenger', { last_error: error })
    // A throttle is transient. Report it as such so the UI can say "your token
    // is fine, wait" instead of blaming the token.
    return { ok: false, conversations: 0, rateLimited, error }
  }
}

/**
 * Fetch and store one thread's transcript. Called on a cache miss only.
 *
 * Message ids are Meta's own, and the webhook stores the same ids, so a
 * message can be written by both paths without ever duplicating.
 */
export async function hydrateThread(
  pageId: string,
  psid: string,
  conversationId: string | null,
): Promise<number> {
  if (!conversationId) return 0
  const page = await getInboxPage(pageId)
  if (!page) return 0

  const messages = await listMessages(page, conversationId)
  if (messages.length === 0) return 0

  const db = createAdminClient()
  const rows = messages.map((m) => ({
    mid: m.id,
    page_id: pageId,
    psid,
    direction: m.fromPage ? 'out' : 'in',
    body: m.text,
    attachments: m.attachments,
    is_echo: false,
    created_at: m.createdTime,
  }))

  // ignoreDuplicates: anything the webhook already delivered stays as it is,
  // since that copy carries the richer payload.
  const { error } = await db
    .from('messenger_messages')
    .upsert(rows, { onConflict: 'mid', ignoreDuplicates: true })
  if (error) {
    console.log('[v0] messenger sync: transcript store failed', error.message)
    return 0
  }
  return rows.length
}
