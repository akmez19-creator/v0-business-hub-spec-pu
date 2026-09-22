import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getInboxPages } from '@/lib/facebook/messages'
import { fbGet } from '@/lib/facebook/graph'
import { connectInboxDatabase } from '@/lib/messenger/pg'

export const dynamic = 'force-dynamic'

type PageSummary = { id: string; name: string; lastMessageAt: string | null; conversationCount: number }

// One grouped query instead of downloading every conversation row: the old
// 1000-row pagination read the whole table on each check, which is costly
// while the database is under load. Falls back to paging if the direct
// connection is unavailable. No customer names or message text are read.
async function pageSummaries(): Promise<Map<string, PageSummary>> {
  const known = new Map<string, PageSummary>()
  try {
    const client = await connectInboxDatabase()
    try {
      const { rows } = await client.query<{
        page_id: string; name: string; last_message_at: string | null; conversations: string
      }>(`SELECT page_id, COALESCE(MAX(NULLIF(page_name, '')), page_id) AS name,
          MAX(last_message_at) AS last_message_at, COUNT(*)::text AS conversations
          FROM messenger_conversations GROUP BY page_id ORDER BY page_id`)
      for (const row of rows)
        known.set(row.page_id, { id: row.page_id, name: row.name,
          lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
          conversationCount: Number(row.conversations) })
      return known
    } finally {
      await client.end().catch(() => {})
    }
  } catch {
    // Fall through to the REST path below.
  }
  const db = createAdminClient()
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from('messenger_conversations').select('page_id,page_name,last_message_at')
      .order('id').range(offset, offset + 999)
    if (result.error) throw new Error('Message history is temporarily unavailable')
    for (const row of result.data ?? []) {
      const page = known.get(row.page_id) ?? { id: row.page_id, name: row.page_name || row.page_id, lastMessageAt: null, conversationCount: 0 }
      page.conversationCount++
      if (row.page_name) page.name = row.page_name
      if (row.last_message_at && (!page.lastMessageAt || row.last_message_at > page.lastMessageAt)) page.lastMessageAt = row.last_message_at
      known.set(row.page_id, page)
    }
    if ((result.data?.length ?? 0) < 1000) break
  }
  return known
}

// Ordinary checks read stored delivery evidence only. A Page with cached
// history is not necessarily subscribed to receive new messages.
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers })
    const db = createAdminClient()
    const verify = new URL(request.url).searchParams.get('verify') === '1'
    if (verify) {
      const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
      if (!profile || !['admin', 'manager'].includes(profile.role))
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers })
    }
    const state = await db.from('inbox_sync_state').select('key,last_run_at,last_ok_at,last_error')
      .or('key.eq.messenger,key.like.messenger:sync:%,key.like.messenger:webhook:%').limit(100)
    if (state.error) throw new Error('Connection history is temporarily unavailable')
    const known = await pageSummaries()
    const states = new Map((state.data ?? []).map(row => [row.key, row]))
    const configuredPages = verify ? await getInboxPages() : []
    for (const page of configuredPages) if (!known.has(page.id)) known.set(page.id, { id: page.id, name: page.name, lastMessageAt: null, conversationCount: 0 })
    const pages = await Promise.all(Array.from(known.values()).map(async page => {
      const webhook = states.get(`messenger:webhook:${page.id}`)
      const sync = states.get(`messenger:sync:${page.id}`)
      const result: Record<string, unknown> = { ...page, lastWebhookAt: webhook?.last_ok_at ?? null,
        lastWebhookError: webhook?.last_error ? 'A message delivery could not be saved; retry pending' : null,
        lastSyncAt: sync?.last_ok_at ?? null, lastSyncError: sync?.last_error ? 'Facebook sync needs attention' : null }
      const configured = configuredPages.find(item => item.id === page.id)
      if (configured) {
        try {
          const response = await fbGet<{ data?: { id: string; name?: string; subscribed_fields?: string[] }[] }>(
            `https://graph.facebook.com/v21.0/${page.id}/subscribed_apps?${new URLSearchParams({ access_token: configured.access_token, fields: 'id,name,subscribed_fields' })}`, { cacheTtl: 0, staleWhenLimited: false })
          result.subscriptions = (response.data ?? []).map(app => ({ id: app.id, name: app.name, fields: app.subscribed_fields ?? [] }))
        } catch { result.subscriptionError = 'Facebook subscription check unavailable; review Page permissions in Meta' }
      }
      return result
    }))
    const messenger = states.get('messenger')
    return NextResponse.json({ success: true, pages, messenger: { lastSyncAt: messenger?.last_ok_at ?? null,
      lastError: messenger?.last_error ? 'Facebook sync needs attention. Cached conversations remain available.' : null },
      checkedAt: new Date().toISOString() }, { headers })
  } catch {
    return NextResponse.json({ success: false, error: 'Inbox connection details could not load. Please retry.' }, { status: 503, headers })
  }
}
