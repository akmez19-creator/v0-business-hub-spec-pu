import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { saveIncoming, updateStatus } from '@/lib/whatsapp/store'

/**
 * WhatsApp Cloud API webhook.
 *
 * This route is the ONLY way WhatsApp messages ever reach the app - the Cloud
 * API has no history endpoint - so it must accept and persist every delivery.
 *
 * Meta retries until it receives a 200, so this always returns 200 once the
 * payload is understood, even if a single message fails to store. Returning
 * 500 for a permanently-bad message would make Meta retry it forever and
 * queue up everything behind it.
 */

export const dynamic = 'force-dynamic'

/** GET is Meta's subscription handshake. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (!expected) {
    console.log('[v0] whatsapp webhook: WHATSAPP_VERIFY_TOKEN is not set')
    return new NextResponse('Not configured', { status: 500 })
  }

  if (mode === 'subscribe' && token === expected && challenge) {
    // Meta requires the raw challenge echoed back as plain text.
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

/**
 * Verify Meta's SHA-256 body signature. Without this anyone who learns the URL
 * can inject fake customer messages into the inbox.
 */
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

type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string }
  contacts?: { wa_id?: string; profile?: { name?: string } }[]
  messages?: {
    id: string
    from: string
    timestamp: string
    type: string
    text?: { body?: string }
    image?: { id?: string; mime_type?: string; caption?: string }
    video?: { id?: string; mime_type?: string; caption?: string }
    audio?: { id?: string; mime_type?: string }
    document?: { id?: string; mime_type?: string; filename?: string }
    button?: { text?: string }
    interactive?: { list_reply?: { title?: string }; button_reply?: { title?: string } }
  }[]
  statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[]
  /**
   * Calling API events. Only delivered when the "calls" webhook field is
   * subscribed, which is separate from "messages".
   */
  calls?: {
    id: string
    to?: string
    from?: string
    event?: string
    timestamp?: string
    direction?: string
    status?: string
    duration?: number
    start_time?: string
    end_time?: string
  }[]
}

type WaCall = NonNullable<WaValue['calls']>[number]

/**
 * Reduce a call event to a direction and an outcome.
 *
 * Meta's field names here vary by event and are documented loosely, so this
 * reads defensively: an unrecognised status falls back to a neutral outcome
 * rather than silently labelling a real call "missed".
 */
function readCall(c: WaCall, businessNumber: string | null) {
  const dir = (c.direction ?? '').toUpperCase()
  const direction: 'in' | 'out' =
    dir.includes('BUSINESS') ? 'out' : dir.includes('USER') ? 'in' : c.from && c.from === businessNumber ? 'out' : 'in'

  // The customer is whichever side is not the business number.
  const waId = (direction === 'in' ? c.from : c.to) ?? c.from ?? c.to ?? null

  const event = (c.event ?? '').toLowerCase()
  const status = (c.status ?? '').toUpperCase()
  const duration = typeof c.duration === 'number' ? c.duration : null

  let outcome: 'ringing' | 'missed' | 'completed' | 'rejected' | 'failed'
  if (event === 'connect' && !status) outcome = 'ringing'
  else if (status === 'COMPLETED' || status === 'ACCEPTED') outcome = duration === 0 ? 'missed' : 'completed'
  else if (status === 'REJECTED' || status === 'DECLINED') outcome = 'rejected'
  else if (status === 'MISSED' || status === 'NO_ANSWER' || status === 'UNANSWERED') outcome = 'missed'
  else if (status === 'FAILED' || status === 'ERROR') outcome = 'failed'
  else if (event === 'terminate') outcome = duration && duration > 0 ? 'completed' : 'missed'
  else outcome = 'ringing'

  return { waId, direction, outcome, duration }
}

/** Pull a human-readable body out of whichever message shape arrived. */
function readBody(m: NonNullable<WaValue['messages']>[number]): string | null {
  return (
    m.text?.body ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.filename ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    null
  )
}

function readMedia(m: NonNullable<WaValue['messages']>[number]) {
  const media = m.image ?? m.video ?? m.audio ?? m.document
  return { mediaId: media?.id ?? null, mediaMime: media?.mime_type ?? null }
}

export async function POST(request: Request) {
  const raw = await request.text()

  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    console.log('[v0] whatsapp webhook: bad signature, rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }
  if (!process.env.FACEBOOK_APP_SECRET) {
    console.log('[v0] whatsapp webhook: FACEBOOK_APP_SECRET unset - payload accepted UNVERIFIED')
  }

  let payload: { entry?: { changes?: { value?: WaValue }[] }[] }
  try {
    payload = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  let saved = 0
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue

      const phoneNumberId = value.metadata?.phone_number_id
      const displayPhone = value.metadata?.display_phone_number ?? null
      const profileName = value.contacts?.[0]?.profile?.name ?? null

      for (const m of value.messages ?? []) {
        if (!phoneNumberId) continue
        const { mediaId, mediaMime } = readMedia(m)
        try {
          const { inserted } = await saveIncoming({
            waId: m.from,
            profileName,
            phoneNumberId,
            displayPhone,
            messageId: m.id,
            type: m.type,
            body: readBody(m),
            mediaId,
            mediaMime,
            // Meta sends Unix seconds as a string.
            timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
            raw: m,
          })
          if (inserted) saved++
        } catch (e) {
          // Swallow per-message so one bad row cannot block the whole batch
          // and trigger endless Meta retries.
          console.log('[v0] whatsapp webhook: save failed', m.id, e instanceof Error ? e.message : e)
        }
      }

      for (const c of value.calls ?? []) {
        if (!phoneNumberId) continue
        const { waId, direction, outcome, duration } = readCall(c, displayPhone?.replace(/\D/g, '') ?? null)
        if (!waId) continue
        try {
          const { stored } = await saveCall({
            callId: c.id,
            waId,
            profileName,
            phoneNumberId,
            displayPhone,
            direction,
            outcome,
            durationSec: duration,
            timestamp: c.timestamp
              ? new Date(Number(c.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            raw: c,
          })
          if (stored) calls++
        } catch (e) {
          console.log('[v0] whatsapp webhook: call save failed', c.id, e instanceof Error ? e.message : e)
        }
      }

      for (const s of value.statuses ?? []) {
        try {
          await updateStatus(s.id, s.status, s.errors?.[0]?.message)
        } catch (e) {
          console.log('[v0] whatsapp webhook: status failed', s.id, e instanceof Error ? e.message : e)
        }
      }
    }
  }

  if (saved > 0) console.log('[v0] whatsapp webhook: stored', saved, 'message(s)')
  return NextResponse.json({ received: true })
}
