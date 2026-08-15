import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, getInboxPages, listConversations, MessagingPermissionError } from '@/lib/facebook/messages'

/**
 * Messenger conversations for the business Page.
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

    const requestedPageId = new URL(request.url).searchParams.get('pageId') ?? undefined
    // Never leak page access tokens to the client - only id and name.
    const pages = (await getInboxPages()).map((p) => ({ id: p.id, name: p.name }))
    const page = await getInboxPage(requestedPageId)
    if (!page) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'no-page',
        error: 'No Facebook Page is reachable with the configured access token.',
      })
    }

    try {
      const conversations = await listConversations(page)
      return NextResponse.json({
        success: true,
        page: { id: page.id, name: page.name },
        pages,
        conversations,
      })
    } catch (e) {
      if (e instanceof MessagingPermissionError) {
        return NextResponse.json({
          success: false,
          needsPermission: true,
          reason: 'scope',
          page: { id: page.id, name: page.name },
          pages,
          error: e.message,
        })
      }
      throw e
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load conversations'
    console.log('[v0] inbox list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
