import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, sendReply, MessagingPermissionError } from '@/lib/facebook/messages'
import { recordMessengerMessage } from '@/lib/messenger/store'

/** Send a reply to a customer on Messenger. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { recipientId, text, pageId } = (await request.json()) as {
      recipientId?: string
      text?: string
      pageId?: string
    }
    const body = (text ?? '').trim()
    if (!recipientId || !body) {
      return NextResponse.json({ success: false, error: 'recipientId and text are required' }, { status: 400 })
    }
    // Messenger rejects oversized payloads; fail here with a clear reason.
    if (body.length > 2000) {
      return NextResponse.json({ success: false, error: 'Message exceeds 2000 characters' }, { status: 400 })
    }

    // The reply must be sent as the same Page that received the message.
    const page = await getInboxPage(pageId)
    if (!page) return NextResponse.json({ success: false, error: 'No Page available' }, { status: 400 })

    try {
      const result = await sendReply(page, recipientId, body)

      // Write through so the reply appears instantly and the thread stops
      // being flagged as awaiting us. Stored under Meta's own message id, so
      // the echo that follows collides on the primary key and is ignored
      // rather than duplicating the message.
      await recordMessengerMessage({
        pageId: page.id,
        psid: recipientId,
        mid: result.messageId ?? `local:${page.id}:${recipientId}:${Date.now()}`,
        direction: 'out',
        body,
        isEcho: false,
        createdAt: new Date().toISOString(),
      })

      return NextResponse.json({ success: true, usedHumanAgentTag: result.usedHumanAgentTag })
    } catch (e) {
      if (e instanceof MessagingPermissionError) {
        return NextResponse.json({ success: false, needsPermission: true, error: e.message })
      }
      throw e
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to send message'
    console.log('[v0] inbox send failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
