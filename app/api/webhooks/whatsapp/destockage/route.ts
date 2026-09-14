import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { POST as ingestWhatsApp } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

// This callback accepts only the separately authorized Destockage account.
// Sending permissions and every database write remain in the existing handler.
const WABA = '1241189547377134'
const PHONE = '968962882975955'
const BUSINESS_NUMBER = '23052500684'
const MAX_BYTES = 8 * 1024 * 1024
const MAX_ENTRIES = 32
const MAX_CHANGES = 256
const MAX_BODY_SAMPLES = 128
const MAX_STANDBY_EVENTS = 512
const FIELDS = ['messages', 'message_echoes', 'smb_message_echoes', 'history', 'smb_app_state_sync', 'account_update', 'standby', 'other'] as const
const ACCOUNT_EVENTS = ['ACCOUNT_OFFBOARDED', 'ACCOUNT_RECONNECTED', 'PARTNER_REMOVED', 'other'] as const
type JsonObject = Record<string, unknown>
type Outcome = 'accepted' | 'retryable' | 'delegate_rejected' | 'invalid_signature' | 'scope_rejected' | 'malformed' | 'unconfigured' | 'exception' | 'oversize'

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8'), right = Buffer.from(b, 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}
function configuration() {
  const appSecret = process.env.DESTOCKAGE_WHATSAPP_APP_SECRET
  const verifyToken = process.env.DESTOCKAGE_WHATSAPP_VERIFY_TOKEN
  const existingSecret = process.env.FACEBOOK_APP_SECRET
  return appSecret && verifyToken && existingSecret ? { appSecret, verifyToken, existingSecret } : null
}
function record(data: Record<string, unknown>) {
  try { console.log(JSON.stringify({ event: 'destockage_callback', schema: 1, ...data })) } catch { /* Observability must not change acknowledgements. */ }
}
function answer(body: string, status: number) {
  return new NextResponse(body, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(request: Request) {
  const config = configuration()
  if (!config) { record({ method: 'GET', outcome: 'unconfigured', status: 503 }); return answer('Not configured', 503) }
  const query = new URL(request.url).searchParams
  const token = query.get('hub.verify_token'), challenge = query.get('hub.challenge')
  if (query.getAll('hub.mode').length !== 1 || query.getAll('hub.verify_token').length !== 1 || query.getAll('hub.challenge').length !== 1 ||
      query.get('hub.mode') !== 'subscribe' || !token || token.length > 1024 || !sameSecret(token, config.verifyToken) || !challenge || challenge.length > 1024) {
    record({ method: 'GET', outcome: 'invalid_verification', status: 403 })
    return answer('Forbidden', 403)
  }
  record({ method: 'GET', outcome: 'verified', status: 200 })
  return answer(challenge, 200)
}

class CallbackError extends Error {
  constructor(public outcome: Outcome, public status: number) { super(outcome) }
}
function providerIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(value)
}
function customerIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,20}$/.test(value) && value !== BUSINESS_NUMBER
}
function eventTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,12}$/.test(value) && Number(value) > 0 && Number.isFinite(new Date(Number(value) * 1000).getTime())
}
/** Normalize only Meta's documented standby wrapper after the owning scope and
 * new-app signature are validated. Original provider identity/time remain authoritative. */
function normalizeStandby(value: JsonObject, take: (count: number) => void): JsonObject {
  const standby = object(value.standby)
  if (!standby) throw new CallbackError('malformed', 400)
  if (value.messaging_product !== undefined && value.messaging_product !== 'whatsapp') throw new CallbackError('malformed', 400)
  // Do not combine an undocumented flat-plus-nested shape or infer its direction.
  for (const key of ['messages', 'message_echoes', 'smb_message_echoes', 'statuses', 'history'])
    if (value[key] !== undefined) throw new CallbackError('malformed', 400)
  const nestedPhone = object(standby.metadata)?.phone_number_id
  if (nestedPhone !== undefined && nestedPhone !== PHONE) throw new CallbackError('scope_rejected', 403)
  const read = (key: string): JsonObject[] => {
    const items = standby[key]
    if (items === undefined) return []
    if (!Array.isArray(items)) throw new CallbackError('malformed', 400)
    take(items.length)
    return items.map(item => {
      const row = object(item)
      if (!row || !providerIdentity(row.id) || !eventTimestamp(row.timestamp)) throw new CallbackError('malformed', 400)
      return row
    })
  }
  const provenance = (row: JsonObject) => ({ version: 1, field: 'standby', original: row })
  if (value.contacts !== undefined && standby.contacts !== undefined) throw new CallbackError('malformed', 400)
  const contacts = standby.contacts ?? value.contacts
  if (contacts !== undefined && (!Array.isArray(contacts) || contacts.length > MAX_STANDBY_EVENTS || contacts.some(contact => !object(contact))))
    throw new CallbackError('malformed', 400)
  const messages = read('messages').map(row => {
    if (!customerIdentity(row.from) || typeof row.type !== 'string' || !row.type) throw new CallbackError('malformed', 400)
    return { ...row, _akmez_standby: provenance(row) }
  })
  const messageEchoes = read('message_echoes').map(row => {
    const message = object(row.message)
    if (!message || message.messaging_product !== 'whatsapp' || !customerIdentity(message.to) ||
        typeof message.type !== 'string' || !message.type || (message.recipient_type !== undefined && message.recipient_type !== 'individual'))
      throw new CallbackError('malformed', 400)
    if ((message.id !== undefined && message.id !== row.id) || (message.timestamp !== undefined && message.timestamp !== row.timestamp))
      throw new CallbackError('malformed', 400)
    if (message.type === 'text' && typeof object(message.text)?.body !== 'string') throw new CallbackError('malformed', 400)
    const interactiveBody = object(object(message.interactive)?.body)?.text
    // Keep templates/link-based media intact in provenance; the existing parser
    // decides which content it can display. Never invent template text or media IDs.
    return { ...message, ...(message.type === 'interactive' && message.text === undefined && typeof interactiveBody === 'string' ? { text: { body: interactiveBody } } : {}),
      id: row.id, timestamp: row.timestamp, from: BUSINESS_NUMBER,
      _akmez_standby: provenance(row) }
  })
  const statuses = read('statuses').map(row => {
    if (!customerIdentity(row.recipient_id) || typeof row.status !== 'string' || !row.status) throw new CallbackError('malformed', 400)
    return row
  })
  // Only these normalized containers enter the unchanged durable handler.
  return { metadata: value.metadata, contacts, messages, message_echoes: messageEchoes, statuses }
}
async function boundedBody(request: Request): Promise<Buffer> {
  const declared = request.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BYTES) throw new CallbackError('oversize', 413)
  if (!request.body) throw new CallbackError('malformed', 400)
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new CallbackError('oversize', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

export async function POST(request: Request) {
  let outcome: Outcome = 'exception', status = 503, signatureVerified = false, scopeVerified = false
  const counts = { entries: 0, changes: 0, delegatedChanges: 0, accountUpdates: 0, messages: 0, echoes: 0, statuses: 0, historyChunks: 0,
    standbyChanges: 0, standbyEvents: 0, bodySamples: 0, textBodyPresent: 0, samplesCapped: false }
  const fields = Object.fromEntries(FIELDS.map(field => [field, 0])) as Record<typeof FIELDS[number], number>
  const accountEvents = Object.fromEntries(ACCOUNT_EVENTS.map(event => [event, 0])) as Record<typeof ACCOUNT_EVENTS[number], number>
  record({ method: 'POST', phase: 'started' })
  try {
    const config = configuration()
    if (!config) throw new CallbackError('unconfigured', 503)
    const bytes = await boundedBody(request)
    const signature = request.headers.get('x-hub-signature-256')
    if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) throw new CallbackError('invalid_signature', 403)
    const expected = crypto.createHmac('sha256', config.appSecret).update(bytes).digest()
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new CallbackError('invalid_signature', 403)
    signatureVerified = true
    let payload: JsonObject | null
    try { payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) }
    catch { throw new CallbackError('malformed', 400) }
    if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry) || !payload.entry.length)
      throw new CallbackError('malformed', 400)
    if (payload.entry.length > MAX_ENTRIES) throw new CallbackError('oversize', 413)
    const delegatedEntries: { id: string; changes: JsonObject[] }[] = []
    const boundedCount = (n: number) => Math.min(10000, n)
    const observeBody = (items: unknown[]) => {
      for (const value of items) {
        if (counts.bodySamples >= MAX_BODY_SAMPLES) { counts.samplesCapped = true; break }
        counts.bodySamples++
        const body = object(object(value)?.text)?.body
        if (typeof body === 'string' && body.length) counts.textBodyPresent++
      }
    }
    // Validate every owning scope before calling the existing handler once.
    // A mixed-business request therefore cannot partially persist Destockage.
    for (const entryValue of payload.entry) {
      const entry = object(entryValue)
      if (!entry || entry.id !== WABA) throw new CallbackError('scope_rejected', 403)
      if (!Array.isArray(entry.changes) || !entry.changes.length) throw new CallbackError('malformed', 400)
      counts.entries++
      const delegatedChanges: JsonObject[] = []
      for (const changeValue of entry.changes) {
        if (++counts.changes > MAX_CHANGES) throw new CallbackError('oversize', 413)
        const change = object(changeValue)
        let value = object(change?.value)
        if (!change || !value || typeof change.field !== 'string' || !change.field) throw new CallbackError('malformed', 400)
        const field = FIELDS.includes(change.field as typeof FIELDS[number]) ? change.field as typeof FIELDS[number] : 'other'
        fields[field]++
        const phone = object(value.metadata)?.phone_number_id
        if (field === 'account_update') {
          if (phone !== undefined && phone !== null && phone !== PHONE) throw new CallbackError('scope_rejected', 403)
          // Account lifecycle notifications are WABA-scoped. Never forward
          // their values (including any unexpected body containers) to storage.
          counts.accountUpdates++
          const event = typeof value.event === 'string' && ACCOUNT_EVENTS.includes(value.event as typeof ACCOUNT_EVENTS[number])
            ? value.event as typeof ACCOUNT_EVENTS[number] : 'other'
          accountEvents[event]++
          continue
        }
        if (phone !== PHONE) throw new CallbackError('scope_rejected', 403)
        if (field === 'standby') {
          counts.standbyChanges++
          value = normalizeStandby(value, count => {
            counts.standbyEvents += count
            if (counts.standbyEvents > MAX_STANDBY_EVENTS) throw new CallbackError('oversize', 413)
          })
        }
        for (const key of ['messages', 'message_echoes', 'smb_message_echoes', 'statuses', 'history'] as const) {
          if (value[key] !== undefined && !Array.isArray(value[key])) throw new CallbackError('malformed', 400)
          const items = (value[key] ?? []) as unknown[]
          if (key === 'messages') counts.messages = boundedCount(counts.messages + items.length)
          else if (key === 'statuses') counts.statuses = boundedCount(counts.statuses + items.length)
          else if (key === 'history') counts.historyChunks = boundedCount(counts.historyChunks + items.length)
          else counts.echoes = boundedCount(counts.echoes + items.length)
          if (key === 'messages' || key === 'message_echoes' || key === 'smb_message_echoes') observeBody(items)
        }
        delegatedChanges.push(field === 'standby' ? { ...change, value } : change)
        counts.delegatedChanges++
      }
      if (delegatedChanges.length) delegatedEntries.push({ id: WABA, changes: delegatedChanges })
    }
    scopeVerified = true
    if (!delegatedEntries.length) {
      outcome = 'accepted'; status = 200
      return NextResponse.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const delegatedBody = JSON.stringify({ object: 'whatsapp_business_account', entry: delegatedEntries })
    // Internal function call, not an HTTP fetch. The existing secret never
    // crosses a network boundary. No caller headers, URL, cookies or token are forwarded.
    const internalSignature = crypto.createHmac('sha256', config.existingSecret).update(delegatedBody).digest('hex')
    const result = await ingestWhatsApp(new Request('https://www.akmez.tech/api/webhooks/whatsapp', {
      method: 'POST', body: delegatedBody,
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${internalSignature}` },
    }))
    status = result.status
    outcome = result.ok ? 'accepted' : result.status >= 500 ? 'retryable' : 'delegate_rejected'
    return result
  } catch (error) {
    if (error instanceof CallbackError) { outcome = error.outcome; status = error.status }
    return answer(status === 503 ? 'Temporarily unavailable' : status === 403 ? 'Forbidden' : status === 413 ? 'Payload too large' : 'Bad request', status)
  } finally {
    record({ method: 'POST', phase: 'finished', outcome, status, signatureVerified, scopeVerified, counts, fields, accountEvents })
  }
}
