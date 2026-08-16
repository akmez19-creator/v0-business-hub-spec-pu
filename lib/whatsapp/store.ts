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

/**
 * Optional pinned number. The business has four live Cloud API numbers, so the
 * sending number is normally taken from the contact - it must be the number
 * the customer actually messaged, or the reply arrives from a stranger.
 */
export function whatsappPhoneNumberId(): string | undefined {
  return process.env.WHATSAPP_PHONE_NUMBER_ID
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

/**
 * Most recently active contacts.
 *
 * `search` is applied in Postgres rather than in the browser: once the list
 * runs past the limit, filtering only what was already downloaded would
 * silently fail to find any older customer, which is exactly when search
 * matters most.
 */
export async function listContacts(limit = 100, search?: string): Promise<WaContact[]> {
  const db = createAdminClient()
  let q = db.from('whatsapp_contacts').select('*')

  const term = search?.trim()
  if (term) {
    // Escape PostgREST's or() delimiters so a stray comma or paren in a name
    // cannot break out of the filter expression.
    const safe = term.replace(/[,()\\]/g, ' ').trim()
    if (safe) q = q.or(`profile_name.ilike.%${safe}%,wa_id.ilike.%${safe}%`)
  }

  const { data, error } = await q
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => toContact(r as ContactRow))
}

/**
 * One page of a thread, newest first, then flipped for display.
 *
 * `before` is the created_at of the oldest message already on screen, so a
 * long-running customer thread can be walked backwards a page at a time
 * rather than loading thousands of rows into the browser at once.
 */
export async function listMessages(waId: string, limit = 100, before?: string): Promise<WaMessage[]> {
  const db = createAdminClient()
  let q = db
    .from('whatsapp_messages')
    .select('id,wa_id,direction,type,body,media_id,media_mime,status,error,created_at')
    .eq('wa_id', waId)
  if (before) q = q.lt('created_at', before)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
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
  /**
   * 'out' marks an ECHO - a reply an agent sent from Business Suite,
   * respond.io or the phone app, which Meta mirrors back to us. Defaults
   * to 'in' so existing inbound callers are unaffected.
   */
  direction?: 'in' | 'out'
}

/** The `referral` object Meta attaches to a Click-to-WhatsApp message. */
type WaReferral = {
  source_id?: string
  source_type?: string
  source_url?: string
  headline?: string
  media_type?: string
  image_url?: string
  video_url?: string
  ctwa_clid?: string
}

/**
 * Lift Click-to-WhatsApp ad attribution out of the raw webhook payload.
 *
 * Meta attaches `referral` only to the message that immediately follows an ad
 * click, so this is the single moment the ad is knowable - if it is not
 * captured here, which ad produced the customer is lost for good.
 */
export function readReferral(raw: unknown) {
  const ref = (raw as { referral?: WaReferral } | null)?.referral
  if (!ref?.source_id) return null
  return {
    ad_id: ref.source_id,
    ad_headline: ref.headline ?? null,
    ad_source_url: ref.source_url ?? null,
    ad_source_type: ref.source_type ?? null,
    ad_media_type: ref.media_type ?? null,
    ad_thumbnail_url: ref.image_url ?? ref.video_url ?? null,
    ctwa_clid: ref.ctwa_clid ?? null,
  }
}

/**
 * Persist a message delivered by webhook. Idempotent on Meta's wamid, because
 * Meta retries delivery until it gets a 200 and a duplicate must not
 * double-count unread or reorder the thread.
 *
 * Handles both directions: inbound customer messages, and echoes of replies
 * sent from other tools.
 */
export async function saveIncoming(a: IncomingArgs): Promise<{ inserted: boolean }> {
  const db = createAdminClient()
  const outbound = a.direction === 'out'

  const { data: existing } = await db.from('whatsapp_messages').select('id').eq('id', a.messageId).maybeSingle()
  if (existing) return { inserted: false }

  const { data: contact } = await db
    .from('whatsapp_contacts')
    .select('unread_count, profile_name, first_ad_id')
    .eq('wa_id', a.waId)
    .maybeSingle()

  // Only an inbound message can carry an ad click - an echo of our own reply
  // never does.
  const ad = outbound ? null : readReferral(a.raw)

  // First-touch only: once a contact has an acquiring ad, a later click must
  // not rewrite it, or the record of who originally won the customer is lost.
  const firstTouch =
    ad && !contact?.first_ad_id
      ? {
          first_ad_id: ad.ad_id,
          first_ad_headline: ad.ad_headline,
          first_ad_source_url: ad.ad_source_url,
          first_ad_at: a.timestamp,
        }
      : {}

  await db.from('whatsapp_contacts').upsert(
    {
      wa_id: a.waId,
      // An echo carries OUR profile name, not the customer's, so writing it
      // would rename the thread after the business. Keep the known name.
      profile_name: outbound
        ? ((contact?.profile_name as string | null | undefined) ?? null)
        : (a.profileName ?? null),
      phone_number_id: a.phoneNumberId,
      display_phone: a.displayPhone ?? null,
      last_message_at: a.timestamp,
      // last_inbound_at drives the 24h free-form reply window, so only a real
      // customer message may move it - never one of our own replies.
      ...(outbound ? {} : { last_inbound_at: a.timestamp }),
      last_snippet: a.body?.slice(0, 200) ?? `[${a.type}]`,
      // An agent already handled this thread elsewhere, so an echo clears the
      // unread badge instead of raising it.
      unread_count: outbound ? 0 : ((contact?.unread_count as number | undefined) ?? 0) + 1,
      ...firstTouch,
    },
    { onConflict: 'wa_id' },
  )

  const { error } = await db.from('whatsapp_messages').insert({
    id: a.messageId,
    wa_id: a.waId,
    phone_number_id: a.phoneNumberId,
    direction: outbound ? 'out' : 'in',
    type: a.type,
    body: a.body,
    media_id: a.mediaId ?? null,
    media_mime: a.mediaMime ?? null,
    created_at: a.timestamp,
    raw: a.raw as never,
    // Null on organic messages, which is exactly how ad-sourced leads are
    // told apart from people who messaged on their own.
    ...(ad ?? {}),
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
  if (!token) throw new Error('WhatsApp is not configured on this deployment.')

  // Reply from the number the customer messaged. Falling back to a global
  // default would answer a Buildeco customer from the Made By Moris number.
  const db0 = createAdminClient()
  const { data: contact } = await db0
    .from('whatsapp_contacts')
    .select('phone_number_id')
    .eq('wa_id', waId)
    .maybeSingle()
  const phoneNumberId = (contact?.phone_number_id as string | undefined) ?? whatsappPhoneNumberId()
  if (!phoneNumberId) throw new Error('No WhatsApp number is associated with this conversation.')

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
