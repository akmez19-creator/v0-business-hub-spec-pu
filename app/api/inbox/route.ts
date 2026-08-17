import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getInboxPage,
  getInboxPages,
  listAllConversations,
  listConversations,
  MessagingPermissionError,
} from '@/lib/facebook/messages'
import { isRateLimit, rateLimitResponse } from '@/lib/facebook/rate-limit-response'

/**
 * Messenger conversations.
 *
 * Defaults to every Page merged into one recency-sorted list, because five of
 * the six Pages carry live traffic and a single-Page default silently hides
 * the rest. `?pageId=<id>` narrows to one Page.
 *
 * The missing-permission case is returned as a 200 with `needsPermission`
 * rather than an error status: it is a setup state, not a fault, and the UI
 * renders instructions for it. Real failures still surface as 5xx.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const requested = new URL(request.url).searchParams.get('pageId') ?? 'all'
    const pages = await getInboxPages()
    // Never leak page access tokens to the client - only id and name.
    const pageRefs = pages.map((p) => ({ id: p.id, name: p.name }))

    if (pages.length === 0) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'no-page',
        error: 'No Facebook Page is reachable with the configured access token.',
      })
    }

    // ---- Combined view -----------------------------------------------------
    if (requested === 'all') {
      const { conversations, pageStats, allFailed } = await listAllConversations(pages)
      if (allFailed) {
        return NextResponse.json({
          success: false,
          needsPermission: true,
          reason: 'scope',
          pages: pageRefs,
          error: pageStats.find((p) => p.error)?.error ?? 'Every Page failed to load.',
        })
      }
      return NextResponse.json({
        success: true,
        scope: 'all',
        pages: pageRefs,
        pageStats,
        conversations,
      })
    }

    // ---- Single Page -------------------------------------------------------
    const page = await getInboxPage(requested)
    if (!page) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'no-page',
        error: 'No Facebook Page is reachable with the configured access token.',
      })
    }

    try {
      const conversations = await listConversations(page, 40)
      return NextResponse.json({
        success: true,
        scope: page.id,
        page: { id: page.id, name: page.name },
        pages: pageRefs,
        pageStats: [
          {
            id: page.id,
            name: page.name,
            unread: conversations.reduce((n, c) => n + c.unreadCount, 0),
            conversations: conversations.length,
          },
        ],
        conversations,
      })
    } catch (e) {
      if (e instanceof MessagingPermissionError) {
        return NextResponse.json({
          success: false,
          needsPermission: true,
          reason: 'scope',
          page: { id: page.id, name: page.name },
          pages: pageRefs,
          error: e.message,
        })
      }
      throw e
    }
  } catch (e) {
    // Throttling is transient and must never be reported as a token problem.
    if (isRateLimit(e)) return rateLimitResponse(e)
    const message = e instanceof Error ? e.message : 'Failed to load conversations'
    console.log('[v0] inbox list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
