import { createAdminClient } from '@/lib/supabase/server'
import { after } from 'next/server'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { validateWhatsAppScope, requireWhatsAppNumber, decodeWhatsAppCursor, encodeWhatsAppCursor, WhatsAppScopeError } from './number-scope'
import { persistWhatsAppMessage, persistWhatsAppStatus } from './persistence'
import { createProductMatcher } from '@/lib/products/match'
import { productFromAdName } from '@/lib/facebook/ad-product-name'

/** First ad per contact, with the referral's ad name for ads the post cache lacks. */
function adNamesById(rows: { first_ad_id: string | null; first_ad_name: string | null }[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const r of rows) if (r.first_ad_id && (!out.has(r.first_ad_id) || !out.get(r.first_ad_id))) out.set(r.first_ad_id, r.first_ad_name ?? null)
  return out
}

/** WhatsApp content is persisted from webhooks, supported history imports and local sends.
 * Status webhooks contain delivery state, not the message body. */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** WhatsApp's free-form reply window, same 24h rule as Messenger. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export type WaContact = {
  waId: string
  profileName: string | null
  phoneNumberId: string
  businessName: string
  pageId: string | null
  canSend: boolean
  unreadStateKnown: boolean
  displayPhone: string | null
  lastMessageAt: string | null
  lastInboundAt: string | null
  lastSnippet: string | null
  unreadCount: number
  /** True when the 24h free-form window has closed. */
  outsideWindow: boolean
  /**
   * True when the customer spoke last and is still waiting on a reply.
   *
   * Derived by comparing the two markers this table already keeps: an
   * outbound message advances last_message_at but deliberately leaves
   * last_inbound_at alone, so the two being equal means the newest message
   * came from the customer. Lead staging depends on this - without it every
   * WhatsApp thread claims "you replied last".
   */
  lastFromCustomer: boolean
  /**
   * Stored messages in the thread, which separates a first-ever enquiry from
   * an ongoing conversation.
   */
  messageCount: number
  /**
   * First-touch Click-to-WhatsApp attribution: the ad that originally brought
   * this customer in. Null means they messaged organically.
   */
  firstAdId: string | null
  /** Real ad name, e.g. "MBM - Mini Massager - 1". Preferred for display. */
  firstAdName: string | null
  /** Meta's referral headline - the page name, so a weak fallback only. */
  firstAdHeadline: string | null
  firstAdSourceUrl: string | null
  firstAdAt: string | null
  /**
   * Product the customer arrived for, resolved from the click-to-WhatsApp ad.
   *
   * WhatsApp stores no product of its own, but `page_post_ads` already maps
   * every ad to a catalogue product for the comments channel - so the same
   * cache answers it here rather than adding a column or a Graph call.
   */
  product: string | null
  productId: string | null
}

export type WaMessage = {
  id: string
  waId: string
  phoneNumberId: string
  cursor: string
  direction: 'in' | 'out'
  type: string
  body: string | null
  mediaId: string | null
  mediaMime: string | null
  /** Our own public link for a photo/video WE sent by link (Meta gives those no media id). */
  mediaUrl?: string | null
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
  business_name: string
  page_id: string | null
  can_send: boolean
  unread_state_known: boolean
  message_count?: number
  display_phone: string | null
  last_message_at: string | null
  last_inbound_at: string | null
  last_snippet: string | null
  unread_count: number
  first_ad_id: string | null
  first_ad_name: string | null
  first_ad_headline: string | null
  first_ad_source_url: string | null
  first_ad_at: string | null
}

function toContact(
  r: ContactRow,
  messageCount = 0,
  product: { product: string | null; productId: string | null } | null = null,
): WaContact {
  const inbound = r.last_inbound_at ? new Date(r.last_inbound_at).getTime() : 0
  const latest = r.last_message_at ? new Date(r.last_message_at).getTime() : 0
  return {
    waId: r.wa_id,
    profileName: r.profile_name,
    phoneNumberId: r.phone_number_id,
    businessName: r.business_name || 'Unmapped WhatsApp number',
    pageId: r.page_id ?? null,
    canSend: r.can_send === true,
    unreadStateKnown: r.unread_state_known === true,
    displayPhone: r.display_phone,
    lastMessageAt: r.last_message_at,
    lastInboundAt: r.last_inbound_at,
    lastSnippet: r.last_snippet,
    unreadCount: r.unread_count ?? 0,
    outsideWindow: !inbound || Date.now() - inbound > WA_WINDOW_MS,
    // Tolerate equal-or-newer rather than strict equality: the two columns are
    // written from the same webhook timestamp, and a stray millisecond of
    // clock skew must not flip a waiting customer into "already answered".
    lastFromCustomer: inbound > 0 && inbound >= latest,
    messageCount,
    firstAdId: r.first_ad_id ?? null,
    firstAdName: r.first_ad_name ?? null,
    firstAdHeadline: r.first_ad_headline ?? null,
    firstAdSourceUrl: r.first_ad_source_url ?? null,
    firstAdAt: r.first_ad_at ?? null,
    product: product?.product ?? null,
    productId: product?.productId ?? null,
  }
}

/**
 * Products for the click-to-WhatsApp ads on this page of contacts.
 *
 * Reuses `page_post_ads`, the same ad->product cache the comments channel
 * relies on, so WhatsApp gains attribution without a new column, a backfill,
 * or a Graph call. Resolves ~199 of 265 contacts; the rest either arrived
 * organically (no ad) or clicked an ad that predates the cache.
 */
async function adProducts(
  db: ReturnType<typeof createAdminClient>,
  adNames: Map<string, string | null>,
): Promise<Map<string, { product: string | null; productId: string | null }>> {
  const out = new Map<string, { product: string | null; productId: string | null }>()
  const adIds = [...adNames.keys()]
  if (!adIds.length) return out

  const { data, error } = await db
    .from('page_post_ads')
    .select('ad_id,product,product_id')
    .in('ad_id', adIds)
  // Attribution is a nice-to-have next to the message itself, so a failure
  // here degrades the label rather than failing the whole inbox load.
  if (error) {
    console.log('[v0] whatsapp ad->product lookup failed:', error.message)
    return out
  }

  for (const row of data ?? []) {
    // One ad can appear on several posts; first non-null wins, and they all
    // point at the same product anyway.
    if (out.has(row.ad_id as string)) continue
    out.set(row.ad_id as string, {
      product: (row.product as string | null) ?? null,
      productId: (row.product_id as string | null) ?? null,
    })
  }

  // page_post_ads is keyed by page POST, and a Click-to-WhatsApp ad often has
  // none - so its id never appears there (16 Sep: "MBM - EMS Foot Massager - 3"
  // sent three customers whose threads showed no ad and whose drafts asked
  // "which product?"). Meta's referral carries the ad NAME, which follows the
  // house convention, so read the product off that with the same parser and
  // catalogue matcher the ad sync uses.
  const unresolved = [...adNames.entries()].filter(([id, name]) => !out.get(id)?.product && productFromAdName(name))
  if (unresolved.length) {
    const [{ data: products }, { data: aliases }] = await Promise.all([
      db.from('products').select('id, name, category'),
      db.from('product_aliases').select('alias_name, product_id'),
    ])
    const matchProduct = createProductMatcher(products ?? [], aliases ?? [])
    for (const [id, name] of unresolved) {
      const label = productFromAdName(name)
      const match = matchProduct(label)
      out.set(id, { product: match?.productName ?? label, productId: match?.productId ?? null })
    }
  }
  return out
}

/**
 * Messages per contact, for the page of contacts being listed.
 *
 * Scoped with `.in()` rather than scanning the whole table so the cost tracks
 * the page size, not the lifetime message volume. Counted in memory because
 * PostgREST cannot GROUP BY; only the wa_id column is fetched, so the rows are
 * tiny. If this thread history ever grows large enough to matter, replace it
 * with a Postgres view rather than paging it here.
 */
/** Recent conversations retain the explicit business number as part of their identity. */
export async function listContacts(limit = 100, search?: string, phoneNumberId?: string): Promise<WaContact[]> {
  if(phoneNumberId) await requireWhatsAppNumber(phoneNumberId)
  const db=await connectInboxDatabase()
  let rows:ContactRow[]
  try {
    rows=(await db.query(`SELECT c.*,n.business_name,n.page_id,n.can_send,
      COALESCE(n.display_phone,c.display_phone) AS display_phone,
      (SELECT count(*)::integer FROM whatsapp_messages m WHERE m.wa_id=c.wa_id AND m.phone_number_id=c.phone_number_id) AS message_count
      FROM whatsapp_conversations c JOIN whatsapp_inbox_numbers n USING(phone_number_id)
      WHERE n.can_read AND ($1::text IS NULL OR c.phone_number_id=$1)
        AND ($2::text IS NULL OR c.profile_name ILIKE $2 OR c.wa_id ILIKE $2)
      ORDER BY c.last_message_at DESC NULLS LAST,c.phone_number_id,c.wa_id LIMIT $3`,
      [phoneNumberId??null,search?.trim()?`%${search.trim()}%`:null,Math.min(200,Math.max(1,limit))])).rows
  } finally { await db.end().catch(()=>{}) }
  const products=await adProducts(createAdminClient(),adNamesById(rows))
  return rows.map(r=>toContact(r,r.message_count??0,r.first_ad_id?products.get(r.first_ad_id)??null:null))
}

/** Hydrate exact canonical pairs discovered through additional providers without losing stored read/send/ad state. */
export async function listContactsForScopes(scopes: { phoneNumberId: string; waId: string }[]): Promise<WaContact[]> {
  if (scopes.length > 200) throw new WhatsAppScopeError('Too many WhatsApp conversation scopes.')
  for (const scope of scopes) validateWhatsAppScope(scope.waId, scope.phoneNumberId)
  const pairs = [...new Map(scopes.map(scope => [JSON.stringify([scope.phoneNumberId, scope.waId]), scope])).values()]
  if (!pairs.length) return []
  const db = await connectInboxDatabase()
  let rows: ContactRow[]
  try {
    rows = (await db.query(`SELECT c.*,n.business_name,n.page_id,n.can_send,
      COALESCE(n.display_phone,c.display_phone) AS display_phone,
      (SELECT count(*)::integer FROM whatsapp_messages m WHERE m.wa_id=c.wa_id AND m.phone_number_id=c.phone_number_id) AS message_count
      FROM whatsapp_conversations c JOIN whatsapp_inbox_numbers n USING(phone_number_id)
      JOIN jsonb_to_recordset($1::jsonb) AS requested(phone_number_id text,wa_id text)
        ON requested.phone_number_id=c.phone_number_id AND requested.wa_id=c.wa_id
      WHERE n.can_read`, [JSON.stringify(pairs.map(scope => ({ phone_number_id: scope.phoneNumberId, wa_id: scope.waId })))])).rows
  } finally { await db.end().catch(() => {}) }
  const products = await adProducts(createAdminClient(), adNamesById(rows))
  return rows.map(row => toContact(row, row.message_count ?? 0, row.first_ad_id ? products.get(row.first_ad_id) ?? null : null))
}

/** The revision and transcript share a read-only snapshot; read acknowledgement cannot erase a later arrival. */
export async function listMessages(waId:string,phoneNumberId:string,limit=100,before?:string):Promise<{messages:WaMessage[];readVersion:string;hasMore:boolean;nextCursor:string|null}> {
  validateWhatsAppScope(waId,phoneNumberId)
  await requireWhatsAppNumber(phoneNumberId)
  const cursor=decodeWhatsAppCursor(before)
  const pageSize=Math.min(100,Math.max(1,limit))
  const db=await connectInboxDatabase()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const contact=(await db.query('SELECT activity_version FROM whatsapp_conversations WHERE wa_id=$1 AND phone_number_id=$2',[waId,phoneNumberId])).rows[0]
    if(!contact) throw new WhatsAppScopeError('This customer has no conversation on the selected business number.',404)
    const rows=(await db.query(`SELECT id,wa_id,phone_number_id,direction,type,body,media_id,media_mime,status,error,created_at,
      CASE WHEN direction='out' THEN raw->>'mediaUrl' END AS media_url,
      (type='external' OR COALESCE(raw #>> '{_inbox,receiptOnly}','false')='true') AS receipt_only,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM whatsapp_messages WHERE wa_id=$1 AND phone_number_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text))
      ORDER BY created_at DESC,id DESC LIMIT $5`,[waId,phoneNumberId,cursor?.[0]??null,cursor?.[1]??null,pageSize])).rows
    await db.query('COMMIT')
    const hasMore=rows.length===pageSize
    const oldest=rows.at(-1)
    const nextCursor=hasMore&&oldest?encodeWhatsAppCursor({createdAt:oldest.cursor_time,id:oldest.id}):null
    // Replies an agent typed on their own phone arrive from Meta as receipts with no text.
    // Those recovered before this business left GREEN-API carry their words in `body`.
    const messages:WaMessage[]=rows.map(r=>({
      id:r.id,waId:r.wa_id,phoneNumberId:r.phone_number_id,direction:r.direction,type:r.type,body:r.body,
      mediaId:r.media_id,mediaMime:r.media_mime,mediaUrl:r.media_url??null,status:r.status,error:r.error,createdAt:new Date(r.created_at).toISOString(),
      cursor:encodeWhatsAppCursor({createdAt:r.cursor_time,id:r.id}),
    })).reverse()
    return {readVersion:String(contact.activity_version),messages,hasMore,nextCursor}
  } catch(error) { await db.query('ROLLBACK').catch(()=>{});throw error }
  finally { await db.end().catch(()=>{}) }
}

export async function markRead(waId:string,phoneNumberId:string,readVersion:string) {
  validateWhatsAppScope(waId,phoneNumberId)
  if(!/^\d+$/.test(readVersion)) throw new WhatsAppScopeError('The conversation read revision is invalid.')
  const db=await connectInboxDatabase()
  try {
    await db.query('BEGIN')
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`whatsapp:customer:${waId}`])
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['whatsapp:conversation',phoneNumberId,waId])])
    await db.query(`UPDATE whatsapp_conversations SET unread_count=0,unread_state_known=true,
      last_read_at=GREATEST(COALESCE(last_read_at,'-infinity'::timestamptz),clock_timestamp()),updated_at=clock_timestamp()
      WHERE wa_id=$1 AND phone_number_id=$2 AND activity_version=$3::bigint`,[waId,phoneNumberId,readVersion])
    await db.query('COMMIT')
  } catch(error) { await db.query('ROLLBACK').catch(()=>{});throw error }
  finally { await db.end().catch(()=>{}) }
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
   * 'out' marks an outgoing content event when the connected integration
   * actually delivers one. A status receipt alone has no body. Defaults
   * to 'in' so existing inbound callers are unaffected.
   */
  direction?: 'in' | 'out'
  /**
   * Backfill of an already-seen conversation (Coexistence history sync).
   * Must not raise the unread badge: importing 180 days of chats would
   * otherwise flag every thread as hundreds of unread messages, and must not
   * move last_message_at either, or old threads would jump to the top of the
   * list as if they were fresh.
   */
  historical?: boolean
}

/**
 * Resolve a Click-to-WhatsApp ad id to its real ad name, cached in Postgres.
 *
 * The `headline` on the referral payload is the PAGE name ("Made By Moris")
 * on every single ad, so it cannot tell two products apart. The useful name
 * ("MBM - Mini Massager - 1") lives on the ad object in the Marketing API.
 * Cached permanently: ad names effectively never change, and this must not
 * add a Graph call to the inbox poll.
 */
async function resolveAdName(adId: string): Promise<string | null> {
  const db = createAdminClient()
  const { data: hit } = await db.from('whatsapp_ad_names').select('ad_name').eq('ad_id', adId).maybeSingle()
  if (hit) return (hit.ad_name as string | null) ?? null

  const token = whatsappToken()
  if (!token) return null
  try {
    const res = await fetch(`${GRAPH}/${adId}?fields=name,campaign{name},adset{name}&access_token=${token}`, { signal: AbortSignal.timeout(6000) })
    const j = (await res.json()) as {
      name?: string
      campaign?: { name?: string }
      adset?: { name?: string }
      error?: unknown
    }
    if (!res.ok || j.error || !j.name) return null
    await db.from('whatsapp_ad_names').upsert(
      {
        ad_id: adId,
        ad_name: j.name,
        campaign_name: j.campaign?.name ?? null,
        adset_name: j.adset?.name ?? null,
      },
      { onConflict: 'ad_id' },
    )
    return j.name
  } catch {
    // Never let ad naming break message storage - the message matters more.
    return null
  }
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
export async function saveIncoming(a: IncomingArgs): Promise<{ inserted: boolean; enriched: boolean }> {
  const ad = a.direction === 'out' ? null : readReferral(a.raw)
  const result = await persistWhatsAppMessage({ ...a, ad, source: 'webhook' })
  if (ad && (result.inserted || result.enriched)) {
    // Commit the message before a decorative Marketing API lookup. This
    // existing first-touch enrichment never blocks webhook acknowledgement.
    after(async () => {
      try {
        const db = createAdminClient()
        const { data: contact, error } = await db.from('whatsapp_conversations')
          .select('first_ad_id,first_ad_name').eq('wa_id', a.waId).eq('phone_number_id',a.phoneNumberId).maybeSingle()
        if (error || !contact || contact.first_ad_id !== ad.ad_id || contact.first_ad_name) return
        const name = await resolveAdName(ad.ad_id)
        if (name) await db.from('whatsapp_conversations')
          .update({ first_ad_name: name }).eq('wa_id', a.waId).eq('phone_number_id',a.phoneNumberId)
          .eq('first_ad_id', ad.ad_id).is('first_ad_name', null)
      } catch { console.log('[inbox] WhatsApp ad label enrichment failed') }
    })
  }
  return result
}

/** Save receipts without treating their timestamps as message activity. */
export async function updateStatus(
  messageId: string,
  status: string,
  error?: string,
  external?: { waId: string; phoneNumberId: string | null; at: string | null },
) {
  // Every webhook receipt is scoped by both recipient and owning number.
  // Missing scope must not update an arbitrary row using wamid alone.
  if (!external?.waId || !external.phoneNumberId) throw new Error('WhatsApp status is missing its recipient or owning number')
  await persistWhatsAppStatus({ messageId, status, error,
    waId: external.waId, phoneNumberId: external.phoneNumberId,
    timestamp: external.at ?? new Date().toISOString(),
  })
}

/** Send a free-form text message and record it locally. */
export type OutboundWaMedia = { url: string; kind: 'image' | 'video'; mime: string }

export async function sendText(waId: string, phoneNumberId:string, body: string): Promise<{ id: string; savedLocally: boolean; warning?: string }> {
  return sendOutbound(waId, phoneNumberId, body, null)
}

/**
 * A photo or video (public link) with the text as its caption - one bubble on
 * the customer's phone. The link must be publicly fetchable by Meta; callers
 * stage it through lib/inbox/outbound-media first.
 */
export async function sendMedia(waId: string, phoneNumberId:string, media: OutboundWaMedia, caption: string): Promise<{ id: string; savedLocally: boolean; warning?: string }> {
  return sendOutbound(waId, phoneNumberId, caption, media)
}

async function sendOutbound(waId: string, phoneNumberId:string, body: string, media: OutboundWaMedia | null): Promise<{ id: string; savedLocally: boolean; warning?: string }> {
  const token = whatsappToken()
  if (!token) throw new Error('WhatsApp is not configured on this deployment.')

  validateWhatsAppScope(waId,phoneNumberId)
  await requireWhatsAppNumber(phoneNumberId,true)
  const db=await connectInboxDatabase()
  try {
    const conversation=(await db.query(`SELECT (SELECT max(created_at) FROM whatsapp_messages m
      WHERE m.wa_id=c.wa_id AND m.phone_number_id=c.phone_number_id AND m.direction='in' AND m.type<>'external'
        AND COALESCE(m.raw->>'imported','false')<>'true') AS last_inbound_at
      FROM whatsapp_conversations c WHERE c.wa_id=$1 AND c.phone_number_id=$2`,[waId,phoneNumberId])).rows[0]
    if(!conversation) throw new WhatsAppScopeError('The customer has no conversation on this business number.',404)
    const inbound=conversation.last_inbound_at?new Date(conversation.last_inbound_at).getTime():0
    if(!inbound || Date.now()-inbound>WA_WINDOW_MS) throw new WhatsAppScopeError('The free-form reply window for this business number has closed.',409)
  } finally { await db.end().catch(()=>{}) }

  // WhatsApp caps captions at 1024 characters; a longer text is refused here
  // rather than silently truncated by Meta.
  if (media && body.length > 1024) throw new Error('A caption must be 1024 characters or fewer. Shorten the text or send it separately.')
  const payload = media
    ? { type: media.kind, [media.kind]: { link: media.url, ...(body ? { caption: body } : {}) } }
    : { type: 'text', text: { preview_url: false, body } }

  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waId,
      ...payload,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[]
    error?: { message?: string }
  }
  if (!res.ok || json.error) throw new Error(json.error?.message || 'WhatsApp send failed')

  const id = json.messages?.[0]?.id ?? `local-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  // Only retry the idempotent local write, never the accepted Meta send.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await persistWhatsAppMessage({ messageId:id, waId, phoneNumberId,
        direction:'out', type: media?.kind ?? 'text', body: body || null, mediaMime: media?.mime ?? null,
        status:'sent', timestamp:now,
        // The sent file is our own public link, kept so the thread can show it
        // without the media-id proxy (Meta assigns no media id to link sends).
        source:'send', raw:{ localSend:true, ...(media ? { mediaUrl: media.url } : {}) } })
      return { id, savedLocally:true }
    } catch { console.log('[inbox] Accepted WhatsApp send could not yet be stored locally') }
  }
  return { id, savedLocally:false,
    warning:'WhatsApp accepted this message, but its local copy could not be saved yet. Do not resend; refresh the conversation shortly.' }
}
