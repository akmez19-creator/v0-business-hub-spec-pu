import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, listMessages, MessagingPermissionError } from '@/lib/facebook/messages'

/** Full transcript for one conversation, oldest message first. */
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

    // Must resolve the SAME Page the conversation was listed from, or the
    // page token will not match the thread.
    const page = await getInboxPage(searchParams.get('pageId') ?? undefined)
    if (!page) return NextResponse.json({ success: false, error: 'No Page available' }, { status: 400 })

    try {
      const messages = await listMessages(page, conversationId)
      return NextResponse.json({ success: true, messages })
    } catch (e) {
      if (e instanceof MessagingPermissionError) {
        return NextResponse.json({ success: false, needsPermission: true, error: e.message })
      }
      throw e
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load messages'
    console.log('[v0] inbox thread failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
