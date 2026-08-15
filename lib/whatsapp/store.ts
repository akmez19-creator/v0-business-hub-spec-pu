import { createAdminClient } from '@/lib/supabase/server'

/**
 * WhatsApp inbox storage.
 *
 * The Cloud API has NO endpoint for listing past conversations - unlike
 * Messenger, which let us pull 67 unread messages retroactively. WhatsApp
 * messages exist only as webhook deliveries, so anything not written to
 * Postgres the moment it arrives is gone permanently. That is why this channel
 * is database-backed rather than a live Graph read, and why it necessarily
 * starts empty and fills going forward.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** WhatsApp's free-form reply window, same 24h rule as Messenger. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export type WaContact = {
  waId: string
  profileName: string | null
  phoneNumberId: string
  displayPhone: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastSnippet: string | null
  unreadCount: number
  /** True when the 24h free-form window has closed. */
  outsideWindow: boolean
}

export type WaMessage = {
  id: string
  waId: string
  direction: 'in' | 'out'
  type: string
  body: string | null
  mediaId: string | null
  mediaMime: string | null
  status: string | null
  error: string | null
  createdAt: string
}

export function whatsappToken(): string | undefined {
  // A dedicated token is preferred, but the Page token carries the WhatsApp
  // scopes too once they are granted, so fall back rather than hard-fail.
  return process.env.WHATSAPP_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN
}

export function whatsappPhoneNumberId(): string | undefined {
  return process.env.WHATSAPP_PHONE_NUMBER_ID
}

/** True when this deployment can actually send WhatsApp messages. */
export function hasWhatsAppConfig(): boolean {
  return Boolean(whatsappToken() && whatsappPhoneNumberId())
}

type ContactRow = {
  wa_id: string
  profile_name: string | null
  phone_number_id: string
  display_phone: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  last_snippet: string | null
  unread_count: number
}

function toContact(r: ContactRow): WaContact {
  const inbound = r.last_inbound_at ? new Date(r.last_inbound_at).getTime() : 0
  return {
    waId: r.wa_id,
    profileName: r.profile_name,
    phoneNumberId: r.phone_number_id,
    displayPhone: r.display_phone,
    lastMessageAt: r.last_message_at,
    lastInboundAt: r.last_inbound_at,
    lastSnippet: r.last_snippet,
    unreadCount: r.unread_count ?? 0,
    outsideWindow: !inbound || Date.now() - inbound > WA_WINDOW_MS,
  }
}

export async function listContacts(limit = 100): Promise<WaContact[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('whatsapp_contacts')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toContact(r as ContactRow))
}

export async function listMessages(waId: string, limit = 100): Promise<WaMessage[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('whatsapp_messages')
    .select('id,wa_id,direction,type,body,media_id,media_mime,status,error,created_at')
    .eq('wa_id', waId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)

  // Query newest-first so the LIMIT keeps recent messages, then flip for display.
  return (data ?? [])
    .map((r) => ({
      id: r.id as string,
      waId: r.wa_id as string,
      direction: r.direction as 'in' | 'out',
      type: r.type as string,
      body: r.body as string | null,
      mediaId: r.media_id as string | null,
      mediaMime: r.media_mime as string | null,
      status: r.status as string | null,
      error: r.error as string | null,
      createdAt: r.created_at as string,
    }))
    .reverse()
}

export async function markRead(waId: string) {
  const db = createAdminClient()
  await db.from('whatsapp_contacts').update({ unread_count: 0 }).eq('wa_id', waId)
}

type IncomingArgs = {
  waId: string
  profileName?: string | null
  phoneNumberId: string
  displayPhone?: string | null
  messageId: string
  type: string
  body: string | null
  mediaId?: string | null
  mediaMime?: string | null
  timestamp: string
  raw: unknown
}

/**
 * Persist an inbound message. Idempotent on Meta's wamid, because Meta retries
 * webhook delivery until it gets a 200 and a duplicate must not double-count
 * unread or reorder the thread.
 */
export async function saveIncoming(a: IncomingArgs): Promise<{ inserted: boolean }> {
  const db = createAdminClient()

  const { data: existing } = await db.from('whatsapp_messages').select('id').eq('id', a.messageId).maybeSingle()
  if (existing) return { inserted: false }

  const { data: contact } = await db
    .from('whatsapp_contacts')
    .select('unread_count')
    .eq('wa_id', a.waId)
    .maybeSingle()

  await db.from('whatsapp_contacts').upsert(
    {
      wa_id: a.waId,
      profile_name: a.profileName ?? null,
      phone_number_id: a.phoneNumberId,
      display_phone: a.displayPhone ?? null,
      last_message_at: a.timestamp,
      last_inbound_at: a.timestamp,
      last_snippet: a.body?.slice(0, 200) ?? `[${a.type}]`,
      unread_count: ((contact?.unread_count as number | undefined) ?? 0) + 1,
    },
    { onConflict: 'wa_id' },
  )

  const { error } = await db.from('whatsapp_messages').insert({
    id: a.messageId,
    wa_id: a.waId,
    phone_number_id: a.phoneNumberId,
    direction: 'in',
    type: a.type,
    body: a.body,
    media_id: a.mediaId ?? null,
    media_mime: a.mediaMime ?? null,
    created_at: a.timestamp,
    raw: a.raw as never,
  })
  if (error) throw new Error(error.message)
  return { inserted: true }
}

/** Record a delivery/read receipt for an outbound message. */
export async function updateStatus(messageId: string, status: string, error?: string) {
  const db = createAdminClient()
  await db
    .from('whatsapp_messages')
    .update({ status, ...(error ? { error } : {}) })
    .eq('id', messageId)
}

/** Send a free-form text message and record it locally. */
export async function sendText(waId: string, body: string): Promise<{ id: string }> {
  const token = whatsappToken()
  const phoneNumberId = whatsappPhoneNumberId()
  if (!token || !phoneNumberId) throw new Error('WhatsApp is not configured on this deployment.')

  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waId,
      type: 'text',
      text: { preview_url: false, body },
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[]
    error?: { message?: string }
  }
  if (!res.ok || json.error) throw new Error(json.error?.message || 'WhatsApp send failed')

  const id = json.messages?.[0]?.id ?? `local-${Date.now()}`
  const db = createAdminClient()
  const now = new Date().toISOString()
  await db.from('whatsapp_messages').insert({
    id,
    wa_id: waId,
    phone_number_id: phoneNumberId,
    direction: 'out',
    type: 'text',
    body,
    status: 'sent',
    created_at: now,
  })
  // Outbound activity reorders the thread but never reopens the 24h window -
  // only a customer message does that, so last_inbound_at is left untouched.
  await db
    .from('whatsapp_contacts')
    .update({ last_message_at: now, last_snippet: body.slice(0, 200), unread_count: 0 })
    .eq('wa_id', waId)

  return { id }
}
