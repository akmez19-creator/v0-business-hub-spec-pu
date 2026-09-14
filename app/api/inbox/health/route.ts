import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getInboxPages } from '@/lib/facebook/messages'
import { fbGet } from '@/lib/facebook/graph'

export const dynamic = 'force-dynamic'

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
    // Paginate summaries rather than silently losing Pages beyond the REST
    // default row cap. No customer names, text or identifiers leave this route.
    const summaries: { page_id: string; page_name: string | null; last_message_at: string | null }[] = []
    for (let offset = 0; ; offset += 1000) {
      const result = await db.from('messenger_conversations').select('page_id,page_name,last_message_at')
        .order('id').range(offset, offset + 999)
      if (result.error) throw new Error('Message history is temporarily unavailable')
      summaries.push(...(result.data ?? []))
      if ((result.data?.length ?? 0) < 1000) break
    }
    const known = new Map<string, { id: string; name: string; lastMessageAt: string | null; conversationCount: number }>()
    for (const row of summaries) {
      const page = known.get(row.page_id) ?? { id: row.page_id, name: row.page_name || row.page_id, lastMessageAt: null, conversationCount: 0 }
      page.conversationCount++
      if (row.page_name) page.name = row.page_name
      if (row.last_message_at && (!page.lastMessageAt || row.last_message_at > page.lastMessageAt)) page.lastMessageAt = row.last_message_at
      known.set(row.page_id, page)
    }
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
