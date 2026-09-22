import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, sendAttachment, sendPrivateReply, sendReply, MessagingPermissionError, MessagingWindowClosedError } from '@/lib/facebook/messages'
import { findCommentOpener, recordMessengerMessage } from '@/lib/messenger/store'
import { replyToComment } from '@/lib/facebook/comments'

/** Posted publicly under the comment once the private message is delivered. */
const CHECK_INBOX_REPLY = 'Hello! We have sent you the details by private message - please check your inbox (Messenger) and message requests.'
import { pauseForHumanReply } from '@/lib/inbox-autopilot/runtime'
import { validOutboundMedia } from '@/lib/inbox/outbound-media'

/** Send a reply to a customer on Messenger, optionally with a photo or video first. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { recipientId, text, pageId, media } = (await request.json()) as {
      recipientId?: string
      text?: string
      pageId?: string
      media?: unknown
    }
    const body = (text ?? '').trim()
    const attachment = validOutboundMedia(media)
    if (media && !attachment) {
      return NextResponse.json({ success: false, error: 'The attachment is not one this inbox prepared.' }, { status: 400 })
    }
    if (!recipientId || (!body && !attachment)) {
      return NextResponse.json({ success: false, error: 'recipientId and text or an attachment are required' }, { status: 400 })
    }
    // Messenger rejects oversized payloads; fail here with a clear reason.
    if (body.length > 2000) {
      return NextResponse.json({ success: false, error: 'Message exceeds 2000 characters' }, { status: 400 })
    }

    // The reply must be sent as the same Page that received the message.
    const page = await getInboxPage(pageId)
    if (!page) return NextResponse.json({ success: false, error: 'No Page available' }, { status: 400 })
    await pauseForHumanReply(user.id,'messenger',page.id,recipientId)

    try {
      // Messenger has no captions: the photo/video goes first, the text follows
      // as its own message. If the text then fails, the photo has already been
      // delivered, so the error says exactly that instead of inviting a resend.
      let usedHumanAgentTag = false
      if (attachment) {
        let sent: Awaited<ReturnType<typeof sendAttachment>>
        try {
          sent = await sendAttachment(page, recipientId, attachment)
        } catch (e) {
          // A private reply (the only way through on a comment-opened thread) is text only.
          if (e instanceof MessagingWindowClosedError && await findCommentOpener(page.id, recipientId)) {
            throw new Error('This chat was opened from a comment, so only one text message can be sent until the customer replies. Remove the photo or video and send the text alone.')
          }
          throw e
        }
        usedHumanAgentTag = sent.usedHumanAgentTag
        await recordMessengerMessage({
          pageId: page.id,
          psid: recipientId,
          mid: sent.messageId ?? `local:${page.id}:${recipientId}:${Date.now()}`,
          direction: 'out',
          body: '',
          attachments: [{ type: attachment.kind, url: attachment.url, mime_type: attachment.mime }],
          isEcho: false,
          createdAt: new Date().toISOString(),
        })
      }

      if (body) {
        let result: { usedHumanAgentTag: boolean; messageId: string | null }
        let viaPrivateReply = false
        let publicReplyPosted = false
        try {
          result = await sendReply(page, recipientId, body)
        } catch (e) {
          if (attachment && e instanceof Error) {
            throw new Error(`The ${attachment.kind === 'image' ? 'photo' : 'video'} was delivered but the text was not: ${e.message}`)
          }
          // Facebook opens a thread when you press "Message" on a commenter,
          // but the commenter has never written to the Page, so there is no
          // 24-hour window and a normal send is refused. Business Suite gets
          // through with a private reply to the comment - so do we.
          const opener = e instanceof MessagingWindowClosedError ? await findCommentOpener(page.id, recipientId) : null
          if (!opener) throw e
          if (opener.alreadyReplied) {
            throw new Error('This chat was opened from a comment and its one allowed private reply has already been sent. The customer must message the Page before you can write again.')
          }
          const sent = await sendPrivateReply(page, opener.commentId, body)
          result = { usedHumanAgentTag: false, messageId: sent.messageId ?? `private_reply:${opener.commentId}` }
          viaPrivateReply = true
          // The team's habit: the details go by private message, and a short
          // public reply under the comment tells the customer to look there
          // (Messenger does not notify people about a chat they never opened).
          // Best effort - the private message is already delivered.
          try {
            await replyToComment(page, opener.commentId, CHECK_INBOX_REPLY)
            publicReplyPosted = true
          } catch (publicErr) {
            console.warn('[inbox-send] public "check your inbox" reply failed', { commentId: opener.commentId, error: publicErr instanceof Error ? publicErr.message : String(publicErr) })
          }
        }
        usedHumanAgentTag = usedHumanAgentTag || result.usedHumanAgentTag

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
          raw: viaPrivateReply ? { privateReply: true } : undefined,
        })
        if (viaPrivateReply) {
          return NextResponse.json({ success: true, usedHumanAgentTag, viaPrivateReply: true, publicReplyPosted,
            warning: publicReplyPosted
              ? 'Sent as a private message to the commenter, and "check your inbox" was posted under their comment. Meta allows one private message per comment; you can write again once they answer.'
              : 'Sent as a private message to the commenter. The public "check your inbox" reply under the comment could not be posted - add it from the Comments tab. Meta allows one private message per comment.' })
        }
      }

      return NextResponse.json({ success: true, usedHumanAgentTag })
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
