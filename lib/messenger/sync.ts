import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getInboxPage, getInboxPages, listAllConversations, listMessages, conversationForCustomer, type InboxConversation, type PageStat } from '@/lib/facebook/messages'
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
  const { error } = await db.from('inbox_sync_state').upsert(
    { key, updated_at: new Date().toISOString(), ...patch },
    { onConflict: 'key' },
  )
  if (error) console.log('[v0] messenger sync: status could not be recorded')
}

export type SyncResult = {
  ok: boolean
  conversations: number
  rateLimited: boolean
  error?: string
  pageStats?: PageStat[]
  partial?: boolean
}

async function storeGraphConversation(c: InboxConversation): Promise<void> {
  const psid = c.customer?.id
  if (!psid) return
  const db = createAdminClient()
  // Compare-and-set prevents a Graph response overwriting a webhook that
  // advanced the conversation while the refresh was being stored.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: existing, error: readError } = await db
      .from('messenger_conversations')
      .select('id,last_message_at,message_count,updated_at')
      .eq('page_id', c.pageId).eq('psid', psid).maybeSingle()
    if (readError) throw new Error('Could not read Messenger summary during refresh')
    const row: Record<string, unknown> = {
      page_id: c.pageId, psid, page_name: c.pageName,
      updated_at: new Date().toISOString(),
    }
    if (!c.id.startsWith('psid:')) row.conversation_id = c.id
    if (c.customer?.name) row.customer_name = c.customer.name
    const graphIsNewer = !existing?.last_message_at ||
      Date.parse(c.updatedTime) > Date.parse(existing.last_message_at as string)
    if (graphIsNewer) {
      row.last_message_at = c.updatedTime
      row.last_snippet = c.snippet
      row.unread_count = c.unreadCount
      row.message_count = Math.max(c.messageCount, existing?.message_count ?? 0)
      if (typeof c.lastFromCustomer === 'boolean') row.last_from_customer = c.lastFromCustomer
    }
    if (c.adId) row.ad_id = c.adId
    if (c.adName) row.ad_name = c.adName
    if (c.product) row.product = c.product
    if (c.productId) row.product_id = c.productId
    if (c.campaignId) row.campaign_id = c.campaignId
    if (c.campaignName) row.campaign_name = c.campaignName
    if (!existing) {
      const { error } = await db.from('messenger_conversations').insert(row)
      if (!error) return
      if (error.code === '23505') continue
      throw new Error('Could not store Messenger summary during refresh')
    }
    let update = db.from('messenger_conversations').update(row).eq('id', existing.id)
    update = existing.last_message_at
      ? update.eq('last_message_at', existing.last_message_at)
      : update.is('last_message_at', null)
    if (existing.updated_at) update = update.eq('updated_at', existing.updated_at)
    const { data, error } = await update.select('id')
    if (error) throw new Error('Could not update Messenger summary during refresh')
    if (data?.length) return
  }
  throw new Error('Messenger conversation changed during refresh; retry shortly')
}

/**
 * Refresh the thread list for every Page.
 *
 * Upserts rather than replaces, and never lowers `last_message_at`, so a
 * webhook message that arrived a moment ago is not overwritten by a slightly
 * staler Graph snapshot.
 */
export async function syncConversations(): Promise<SyncResult> {
  await noteSync('messenger', { last_run_at: new Date().toISOString() })

  try {
    const pages = await getInboxPages()
    if (pages.length === 0) {
      return { ok: false, conversations: 0, rateLimited: false, error: 'No Page reachable' }
    }

    const { conversations, pageStats } = await listAllConversations(pages)
    let written = 0

    for (const c of conversations) {
      if (!c.customer?.id) continue
      try {
        await storeGraphConversation(c)
        written++
      } catch {
        const stat = pageStats.find((p) => p.id === c.pageId)
        if (stat) stat.error = 'Some Messenger conversations could not be saved. Please retry.'
      }
    }

    const now = new Date().toISOString()
    for (const stat of pageStats) {
      await noteSync(`messenger:sync:${stat.id}`, {
        last_run_at: now,
        ...(stat.error ? { last_error: 'Page refresh did not complete' } : { last_ok_at: now, last_error: null }),
      })
    }
    const failures = pageStats.filter((p) => p.error)
    const rateLimited = failures.some((p) => p.rateLimited)
    const error = failures.length
      ? `${failures.length} of ${pages.length} Facebook Pages could not be refreshed. Saved messages remain available.`
      : undefined
    await noteSync('messenger', error ? { last_error: error } : { last_ok_at: now, last_error: null })
    return { ok: !error, conversations: written, rateLimited, error, pageStats,
      partial: failures.length > 0 && failures.length < pages.length }
  } catch (e) {
    const rateLimited = isRateLimit(e)
    const error = rateLimited ? 'Facebook is limiting refreshes. Saved messages remain available.'
      : 'Could not refresh Messenger. Saved messages remain available.'
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
  options: { explicitRefresh?: boolean } = {},
): Promise<number> {
  const db = createAdminClient()
  // A failed or empty first hydration must not call Graph on each foreground
  // poll. This lease is shared across serverless instances and browser tabs.
  const key = `messenger:hydrate:${pageId}:${psid}`
  const now = new Date().toISOString()
  const threshold = new Date(Date.now() - (options.explicitRefresh ? 15_000 : 120_000)).toISOString()
  const { error: leaseInsertError } = await db.from('inbox_sync_state').insert({
    key, last_run_at: now, updated_at: now,
  })
  if (leaseInsertError) {
    if (leaseInsertError.code !== '23505') throw new Error('Could not schedule Messenger history refresh')
    const { data: lease, error } = await db.from('inbox_sync_state')
      .update({ last_run_at: now, updated_at: now })
      .eq('key', key).lt('last_run_at', threshold).select('key')
    if (error) throw new Error('Could not schedule Messenger history refresh')
    if (!lease?.length) {
      const { data: previous, error: statusError } = await db.from('inbox_sync_state')
        .select('last_error,last_ok_at').eq('key',key).maybeSingle()
      if (statusError || previous?.last_error) throw new Error('Messenger history refresh is waiting to retry')
      if (!previous?.last_ok_at) throw new Error('Messenger history is being refreshed; please wait')
      return 0
    }
  }
  try {
  const page = await getInboxPage(pageId)
  if (!page) throw new Error('The selected Facebook Page is not available')

  // The selected lead may predate the newest 40 conversations, or the list
  // refresh may still be running. Resolve its PSID directly on its own Page.
  let resolvedId = conversationId
  if (!resolvedId || options.explicitRefresh) {
    resolvedId = await conversationForCustomer(page, psid)
    if (!resolvedId) throw new Error('The selected conversation could not be found on its Facebook Page')
    if (resolvedId !== conversationId) {
      const { error } = await db.from('messenger_conversations').update({ conversation_id: resolvedId })
        .eq('page_id',pageId).eq('psid',psid)
      if (error) throw new Error('Could not save the Facebook conversation reference')
    }
  }
  const messages = await listMessages(page, resolvedId, 40, { fresh: options.explicitRefresh })
  if (messages.length === 0) {
    await noteSync(key, { last_ok_at: new Date().toISOString(), last_error: null })
    return 0
  }

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
    throw new Error('Could not save the refreshed Messenger transcript')
  }
  await noteSync(key, { last_ok_at: new Date().toISOString(), last_error: null })
  return rows.length
  } catch (e) {
    await noteSync(key, { last_error: 'Messenger history could not be refreshed' })
    throw e
  }
}
