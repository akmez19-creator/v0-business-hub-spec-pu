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
    let syncError: string | undefined
    let rateLimited = false

    // A normal foreground poll only reads our database. A deliberate refresh
    // can repair a partially cached transcript without crawling every thread.
    const wantsRefresh = searchParams.get('refresh') === '1'
    if (messages.length === 0 || wantsRefresh) {
      try {
        await hydrateThread(thread.pageId, thread.psid, thread.conversationId, { explicitRefresh: wantsRefresh })
        messages = await listCachedMessages(thread.pageId, thread.psid)
      } catch (e) {
        rateLimited = isRateLimit(e)
        if (messages.length > 0) {
          syncError = rateLimited
            ? 'Facebook is limiting refreshes. Showing saved messages.'
            : 'Could not refresh from Facebook. Showing saved messages.'
        } else {
          if (rateLimited) return rateLimitResponse(e)
          if (e instanceof MessagingPermissionError) {
            return NextResponse.json({ success: false, needsPermission: true, error: e.message })
          }
          throw e
        }
      }
    }

    // Do not mark a message that arrived after this transcript was read.
    const seenThrough = messages.at(-1)?.createdTime
    if (seenThrough) await markMessengerRead(thread.pageId, thread.psid, seenThrough)

    return NextResponse.json({ success: true, source: 'cache', messages, rateLimited, syncError })
  } catch (e) {
    if (isRateLimit(e)) return rateLimitResponse(e)
    const message = e instanceof Error ? e.message : 'Failed to load messages'
    console.log('[v0] inbox thread failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
