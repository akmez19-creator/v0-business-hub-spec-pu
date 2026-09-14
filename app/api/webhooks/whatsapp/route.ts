import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { saveIncoming, updateStatus } from '@/lib/whatsapp/store'
import { createWhatsAppWebhookTrace } from '@/lib/whatsapp/webhook-trace'
import { createAutopilotWake } from '@/lib/inbox-autopilot/wake'

/** WhatsApp webhook. Acknowledge only after durable message/receipt writes.
 * Each item is idempotent so a transient failure can safely retry the batch. */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

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
  if (!secret) return false
  if (!header?.startsWith('sha256=')) return false

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const got = header.slice('sha256='.length)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(got, 'utf8')
  // Length check first: timingSafeEqual throws on mismatched lengths.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

type WaMessagePayload = {
  id: string
  from: string
  /** Present on echoes: the customer the agent replied TO. */
  to?: string
  timestamp: string
  type: string
  text?: { body?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
  video?: { id?: string; mime_type?: string; caption?: string }
  audio?: { id?: string; mime_type?: string }
  document?: { id?: string; mime_type?: string; filename?: string }
  button?: { text?: string }
  interactive?: { list_reply?: { title?: string }; button_reply?: { title?: string } }
}

type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string }
  contacts?: { wa_id?: string; profile?: { name?: string } }[]
  messages?: WaMessagePayload[]
  /**
   * Optional outgoing content events. Availability depends on the number's
   * supported integration; ordinary status receipts never contain a body.
   */
  message_echoes?: WaMessagePayload[]
  smb_message_echoes?: WaMessagePayload[]
  /**
   * Coexistence history sync: up to 180 days of past 1:1 chats, delivered in
   * chunks after a number is onboarded from the WhatsApp Business phone app.
   * Shape differs from `messages` - threads are batched, and each message
   * carries both `from` and `to` so direction has to be derived.
   */
  history?: {
    metadata?: { phase?: string; chunk_order?: number; progress?: number }
    threads?: { id?: string; messages?: WaMessagePayload[] }[]
  }[]
  /**
   * Receipts carry recipient identity and delivery timestamps, but no body.
   * They cannot identify which application or person sent the message.
   */
  statuses?: {
    id: string
    status: string
    recipient_id?: string
    timestamp?: string
    errors?: { title?: string; message?: string }[]
  }[]
}

/** Pull a human-readable body out of whichever message shape arrived. */
function readBody(m: WaMessagePayload): string | null {
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

function readMedia(m: WaMessagePayload) {
  const media = m.image ?? m.video ?? m.audio ?? m.document
  return { mediaId: media?.id ?? null, mediaMime: media?.mime_type ?? null }
}

export async function POST(request: Request) {
  if (!process.env.FACEBOOK_APP_SECRET) return new NextResponse('Webhook signature verification is not configured', { status: 503 })
  const raw = await request.text()

  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'))) {
    console.log('[v0] whatsapp webhook: bad signature, rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let payload: { object?: string; entry?: { changes?: { field?: string; value?: WaValue }[] }[] }
  try {
    payload = JSON.parse(raw)
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entry)) return new NextResponse('Bad request', { status: 400 })
  const trace = createWhatsAppWebhookTrace(payload)
  const autopilotWake = createAutopilotWake()
  let outcome: 'accepted' | 'retryable' | 'exception' | 'ignored-object' = 'exception'
  let saved = 0
  let failed = 0
  try {
  if (payload.object && payload.object !== 'whatsapp_business_account') {
    outcome = 'ignored-object'
    return NextResponse.json({ received:true })
  }
  for (const entry of payload.entry ?? []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change.value
      if (!value) continue

      const phoneNumberId = value.metadata?.phone_number_id
      const displayPhone = value.metadata?.display_phone_number ?? null

      // Preserve existing incoming, optional outgoing and supported history paths.
      const batches: { items: WaMessagePayload[]; direction: 'in' | 'out'; historical?: boolean }[] = [
        { items: value.messages ?? [], direction: change.field === 'message_echoes' || change.field === 'smb_message_echoes' ? 'out' : 'in' },
        { items: value.message_echoes ?? [], direction: 'out' },
        { items: value.smb_message_echoes ?? [], direction: 'out' },
      ]

      // Coexistence history arrives as batched threads rather than a flat
      // list. Each message carries `from` and `to`, so direction is derived
      // by comparing against our own number: anything not sent by the
      // customer is a past agent reply.
      const ownNumber = displayPhone?.replace(/\D/g, '') ?? null
      for (const chunk of value.history ?? []) {
        for (const thread of chunk.threads ?? []) {
          const customer = thread.id?.replace(/\D/g, '')
          if (!customer) continue
          for (const m of thread.messages ?? []) {
            const fromDigits = m.from?.replace(/\D/g, '')
            batches.push({
              items: [{ ...m, from: customer, to: customer }],
              // A history message from anyone other than the customer is one
              // of ours. Falling back to `in` keeps an unknown sender visible
              // rather than silently mislabelling it as an agent reply.
              direction: fromDigits && fromDigits !== customer && fromDigits === ownNumber ? 'out' : 'in',
              historical: true,
            })
          }
        }

      }

      for (const { items, direction, historical } of batches) {
        for (const m of items) {
          if (!phoneNumberId) { failed++; continue }
          // On an echo `from` is our own business number, so the thread is
          // keyed by `to` - the customer. Using `from` would file every
          // agent reply under a single thread named after the business.
          const waId = direction === 'out' ? m.to : m.from
          if (!waId || !m.id || !m.timestamp || !m.type) { failed++; continue }

          const { mediaId, mediaMime } = readMedia(m)
          try {
            const { inserted } = await saveIncoming({
              waId,
              profileName: value.contacts?.find(contact => contact.wa_id === waId)?.profile?.name ?? null,
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
              direction,
              historical,
            })
            if (inserted) saved++
            if (direction === 'in' && !historical) autopilotWake.add('whatsapp', phoneNumberId)
          } catch (e) {
            failed++
            console.log('[inbox] WhatsApp message persistence failed; batch will retry')
          }
        }
      }

      for (const s of value.statuses ?? []) {
        try {
          await updateStatus(s.id, s.status, s.errors?.[0]?.message, {
            waId: s.recipient_id ?? '',
            phoneNumberId: value.metadata?.phone_number_id ?? null,
            // Meta sends unix seconds; the column is a timestamptz.
            at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null,
          })
        } catch (e) {
          failed++
          console.log('[inbox] WhatsApp status persistence failed; batch will retry')
        }
      }
    }
  }

  if (saved > 0) console.log('[v0] whatsapp webhook: stored', saved, 'message(s)')
  if (failed) {
    outcome = 'retryable'
    return NextResponse.json({ received:false, retryable:true }, { status:503 })
  }
  outcome = 'accepted'
  autopilotWake.schedule()
  return NextResponse.json({ received: true })
  } finally {
    trace.finish({ outcome, saved, failed })
  }
}
