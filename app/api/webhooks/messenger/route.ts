import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { recordAdRef } from '@/lib/messenger/ad-refs'

/**
 * Messenger (Facebook Page) webhook - ad attribution only.
 *
 * Unlike WhatsApp, Messenger message HISTORY is readable from the Graph API,
 * so this route deliberately does NOT store messages. What the API can never
 * give back is which ad a conversation started from: `referral` and `ad_id`
 * are accepted as fields on /conversations but come back empty on every
 * message (verified across 1722 of them). That signal exists only in the
 * moment of the click, delivered here.
 *
 * Always returns 200 once the payload parses, so Meta does not retry forever.
 */

export const dynamic = 'force-dynamic'

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
  if (!secret) return true // cannot verify without the secret; see log below
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
  referral?: Referral
  postback?: { referral?: Referral }
  message?: { referral?: Referral }
}

export async function POST(request: Request) {
  const raw = await request.text()

  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    console.log('[v0] messenger webhook: bad signature, rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (!process.env.FACEBOOK_APP_SECRET) {
    console.log('[v0] messenger webhook: FACEBOOK_APP_SECRET unset - payload accepted UNVERIFIED')
  }

  let body: { object?: string; entry?: { id?: string; messaging?: MessagingEvent[] }[] }
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  if (body.object !== 'page') return NextResponse.json({ received: true })

  for (const entry of body.entry ?? []) {
    // entry.id is the PAGE id: the same person messaging two of the six pages
    // is two separate attributions, so it is part of the key.
    const pageId = entry.id
    for (const event of entry.messaging ?? []) {
      const referral = event.referral ?? event.postback?.referral ?? event.message?.referral
      if (!referral || !pageId) continue

      const senderId = event.sender?.id
      if (!senderId) continue

      try {
        await recordAdRef({
          pageId,
          senderId,
          adId: referral.ad_id ?? null,
          ref: referral.ref ?? null,
          source: referral.source ?? null,
          adType: referral.type ?? null,
        })
        console.log(`[v0] messenger webhook: stored ad ref ${referral.ad_id ?? referral.ref} for ${senderId}`)
      } catch (error) {
        // Swallow: a failed attribution must not cause Meta to retry the event.
        console.log('[v0] messenger webhook: failed to store ad ref', error)
      }
    }
  }

  return NextResponse.json({ received: true })
}
