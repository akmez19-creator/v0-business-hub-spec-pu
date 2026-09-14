import { observeMetaOutgoing } from '@/lib/inbox-autopilot/handoff-runtime'
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { recordAdRef } from '@/lib/messenger/ad-refs'
import { recordMessengerMessage } from '@/lib/messenger/store'
import { markCommentDeleted, markCommentHidden, upsertComment } from '@/lib/facebook/comment-store'
import { createAdminClient } from '@/lib/supabase/server'
import { createAutopilotWake } from '@/lib/inbox-autopilot/wake'

/**
 * Messenger + Page feed webhook.
 *
 * Handles three things, all arriving on `object: 'page'`:
 *  - messages       -> stored, so the inbox can be read from Postgres
 *  - message_echoes -> replies WE sent from anywhere (Business Suite,
 *                      respond.io, the Page Inbox), which is what keeps
 *                      "awaiting reply" honest
 *  - feed           -> comments added / edited / removed / hidden
 *
 * Storing messages is what stops the inbox re-walking Graph on every load;
 * that crawl is what exhausted Meta's hourly cap. Ad attribution is still
 * recorded here too: `referral` / `ad_id` come back empty from /conversations
 * (verified across 1722 messages), so the click moment is the only chance to
 * capture it.
 *
 * Acknowledges only persisted events. A transient failure remains retryable;
 * the message ids make successfully stored events safe to receive again.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

/** GET is Meta's subscription handshake. Shares the WhatsApp verify token. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (!expected) {
    console.log('[v0] messenger webhook: WHATSAPP_VERIFY_TOKEN is not set')
    return new NextResponse('Not configured', { status: 500 })
  }

  if (mode === 'subscribe' && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.FACEBOOK_APP_SECRET
  if (!secret) return false
  if (!header?.startsWith('sha256=')) return false

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const got = header.slice('sha256='.length)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  // Length check first: timingSafeEqual throws on mismatched lengths.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Meta delivers the same attribution in three different shapes depending on
 * how the person arrived, so all three are handled:
 *
 *  - `referral`            - existing chat, clicked an ad again
 *  - `postback.referral`   - brand new thread, tapped Get Started
 *  - `message.referral`    - ad click that arrived attached to the first message
 */
type Referral = {
  ref?: string
  ad_id?: string
  source?: string
  type?: string
}

type MessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  referral?: Referral
  postback?: { referral?: Referral }
  message?: {
    mid?: string
    text?: string
    attachments?: unknown
    /** Set when Meta is echoing back a message the Page sent. */
    is_echo?: boolean
    app_id?: number | string
    referral?: Referral
  }
}

/**
 * Is this echo a "Offers and announcements" marketing blast rather than a
 * reply to a person?
 *
 * Subscribing `marketing_message_*` makes Meta echo every broadcast into
 * `entry.messaging` looking exactly like an outbound reply. Treating those as
 * conversation traffic is actively harmful in two ways:
 *  - a blast to someone who never messaged us invents a nameless thread
 *    ("Unknown customer / No preview"), because a recipient who only opted
 *    into notifications has no messaging profile to look up; and
 *  - a blast to a REAL lead bumps their thread and flags it answered, so it
 *    silently drops out of "to reply" while they are still waiting.
 * Recurring-notification templates are the reliable tell - a broadcast always
 * carries the re-optin marker, a human reply never does.
 */
function isMarketingBroadcast(message: MessagingEvent['message']): boolean {
  const attachments = message?.attachments
  if (!attachments) return false
  try {
    return JSON.stringify(attachments).includes('notification_messages_')
  } catch {
    return false
  }
}

/** A `feed` change. Only `item: 'comment'` is of interest here. */
type FeedChange = {
  field?: string
  value?: {
    item?: string
    verb?: string
    comment_id?: string
    post_id?: string
    parent_id?: string
    created_time?: number
    message?: string
    from?: { id?: string; name?: string }
  }
}

export async function POST(request: Request) {
  if (!process.env.FACEBOOK_APP_SECRET) {
    console.log('[v0] messenger webhook: signature verification is not configured')
    return NextResponse.json({ received: false, error: 'Webhook verification is not configured' }, { status: 503 })
  }
  const raw = await request.text()

  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    console.log('[v0] messenger webhook: bad signature, rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let body: {
    object?: string
    entry?: { id?: string; messaging?: MessagingEvent[]; standby?: MessagingEvent[]; changes?: FeedChange[] }[]
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  if (body.object !== 'page') return NextResponse.json({ received: true })

  const autopilotWake = createAutopilotWake()
  let failed = false
  for (const entry of body.entry ?? []) {
    // entry.id is the PAGE id: the same person messaging two of the six pages
    // is two separate attributions, so it is part of the key.
    const pageId = entry.id
    if (!pageId) continue
    let entryFailed = false
    let handled = false

    // Meta can deliver standby events when another connected tool controls
    // the conversation. Reading them does not take control or send a reply.
    for (const event of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) {
      const referral = event.referral ?? event.postback?.referral ?? event.message?.referral
      const senderId = event.sender?.id

      // Attribution first: it must still be captured even for an event that
      // carries no message body (a bare Get Started postback).
      if (referral && senderId) {
        handled = true
        try {
          await recordAdRef({
            pageId,
            senderId,
            adId: referral.ad_id ?? null,
            ref: referral.ref ?? null,
            source: referral.source ?? null,
            adType: referral.type ?? null,
          })
        } catch (error) {
          entryFailed = true
          console.log('[v0] messenger webhook: referral persistence failed')
        }
      }

      const message = event.message
      if (!message?.mid) continue

      if (isMarketingBroadcast(message)) {
        console.log(`[v0] messenger webhook: skipped marketing broadcast echo ${message.mid}`)
        continue
      }

      // An echo is the Page talking, so sender/recipient are reversed. Getting
      // this backwards would file our own replies under a customer psid of the
      // page id itself, creating a phantom thread per page.
      const isEcho = message.is_echo === true
      const psid = isEcho ? event.recipient?.id : event.sender?.id
      if (!psid || psid === pageId) continue
      handled = true

      try {
        if (isEcho)
          await observeMetaOutgoing('messenger', pageId, psid, message.mid, typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) && Math.abs(event.timestamp) <= 8.64e15 ? new Date(event.timestamp).toISOString() : '', event)
        await recordMessengerMessage({
          pageId,
          psid,
          mid: message.mid,
          direction: isEcho ? 'out' : 'in',
          body: message.text ?? null,
          attachments: message.attachments ?? null,
          isEcho,
          appId: message.app_id != null ? String(message.app_id) : null,
          createdAt: new Date(event.timestamp ?? Date.now()).toISOString(),
          raw: event,
        })
        if (!isEcho) autopilotWake.add('messenger', pageId)
      } catch (error) {
        entryFailed = true
        console.log('[v0] messenger webhook: message persistence failed')
      }
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== 'feed') continue
      const v = change.value
      if (v?.item !== 'comment' || !v.comment_id) continue
      handled = true

      try {
        if (v.verb === 'remove') {
          await markCommentDeleted(v.comment_id)
        } else if (v.verb === 'hide' || v.verb === 'unhide') {
          await markCommentHidden(v.comment_id, v.verb === 'hide')
        } else {
          await upsertComment({
            commentId: v.comment_id,
            postId: v.post_id ?? '',
            parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : null,
            pageId,
            authorId: v.from?.id ?? null,
            authorName: v.from?.name ?? null,
            message: v.message ?? null,
            createdTime: v.created_time ? new Date(v.created_time * 1000).toISOString() : null,
            raw: change,
          })
        }
      } catch (error) {
        entryFailed = true
        console.log('[v0] messenger webhook: comment persistence failed')
      }
    }
    failed ||= entryFailed
    if (handled) {
      const now = new Date().toISOString()
      try {
        const { error } = await createAdminClient().from('inbox_sync_state').upsert({
          key: `messenger:webhook:${pageId}`, last_run_at: now, updated_at: now,
          ...(entryFailed ? { last_error: 'Some webhook events could not be saved; retry requested' }
            : { last_ok_at: now, last_error: null }),
        }, { onConflict: 'key' })
        if (error) console.log('[v0] messenger webhook: receipt status could not be saved')
      } catch {
        console.log('[v0] messenger webhook: receipt status could not be saved')
      }
    }
  }

  if (failed) return NextResponse.json({ received: false, retryable: true }, { status: 503 })
  autopilotWake.schedule()
  return NextResponse.json({ received: true })
}
