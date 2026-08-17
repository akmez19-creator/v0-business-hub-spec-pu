import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { MessagingPermissionError } from '@/lib/facebook/messages'
import { isRateLimit, rateLimitResponse } from '@/lib/facebook/rate-limit-response'
import { listCachedMessages, resolveThread } from '@/lib/messenger/cache'
import { hydrateThread } from '@/lib/messenger/sync'
import { markMessengerRead } from '@/lib/messenger/store'

/**
 * Full transcript for one conversation, oldest message first.
 *
 * Served from Postgres. Graph is called only on a genuine cache miss - a
 * thread that predates the webhook and has never been opened - and the result
 * is stored, so the second open is free. Message ids come from Meta either
 * way, so the webhook and this path can never duplicate a message.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('id')
    if (!conversationId) {
      return NextResponse.json({ success: false, error: 'Missing conversation id' }, { status: 400 })
    }

    const thread = await resolveThread(conversationId, searchParams.get('pageId') ?? undefined)
    if (!thread) return NextResponse.json({ success: false, error: 'Unknown conversation' }, { status: 404 })

    let messages = await listCachedMessages(thread.pageId, thread.psid)

    if (messages.length === 0 && !conversationId.startsWith('psid:')) {
      try {
        // Miss: a pre-webhook thread being read for the first time.
        await hydrateThread(thread.pageId, thread.psid, conversationId)
        messages = await listCachedMessages(thread.pageId, thread.psid)
      } catch (e) {
        if (isRateLimit(e)) return rateLimitResponse(e)
        if (e instanceof MessagingPermissionError) {
          return NextResponse.json({ success: false, needsPermission: true, error: e.message })
        }
        throw e
      }
    }

    // Opening a thread clears its badge.
    await markMessengerRead(thread.pageId, thread.psid)

    return NextResponse.json({ success: true, source: 'cache', messages })
  } catch (e) {
    if (isRateLimit(e)) return rateLimitResponse(e)
    const message = e instanceof Error ? e.message : 'Failed to load messages'
    console.log('[v0] inbox thread failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
