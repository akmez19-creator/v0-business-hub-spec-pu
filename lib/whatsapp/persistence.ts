import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { validateWhatsAppScope, WhatsAppScopeError } from './number-scope'
import { isReceiptOnly, mergeReceiptRaw, mergeWhatsAppStatus, objectValue, timestampMillis, validateMessageIdentity } from './message-state'

export type WhatsAppWrite = {
  waId: string; phoneNumberId: string; messageId: string; type: string; body: string | null
  timestamp: string; raw: unknown; direction?: 'in' | 'out'; historical?: boolean
  profileName?: string | null; displayPhone?: string | null; mediaId?: string | null; mediaMime?: string | null
  status?: string; source?: 'send' | 'webhook' | 'import'
  ad?: { ad_id: string; ad_headline: string | null; ad_source_url: string | null;
    ad_source_type: string | null; ad_media_type: string | null; ad_thumbnail_url: string | null; ctwa_clid: string | null } | null
}

type Db = Awaited<ReturnType<typeof connectInboxDatabase>>

async function transaction<T>(messageId: string, waId: string, phoneNumberId: string, fn: (db: Db) => Promise<T>, connection?:Db): Promise<T> {
  const db = connection ?? await connectInboxDatabase()
  try {
    await db.query('BEGIN')
    await db.query("SET LOCAL statement_timeout = '10s'")
    // Same ordering for every writer: serialize the ID, then the customer.
    // This also serializes first-contact inserts where no row exists to lock.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`whatsapp:message:${messageId}`])
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`whatsapp:customer:${waId}`])
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(['whatsapp:conversation',phoneNumberId,waId])])
    const result = await fn(db)
    await db.query('COMMIT')
    return result
  } catch (cause) {
    await db.query('ROLLBACK').catch(() => {})
    throw cause
  } finally { if(!connection) await db.end().catch(() => {}) }
}

function validArgs(a: { messageId: string; waId: string; phoneNumberId: string; timestamp: string }) {
  validateWhatsAppScope(a.waId,a.phoneNumberId)
  if (!a.messageId || !a.waId || !a.phoneNumberId || !timestampMillis(a.timestamp))
    throw new Error('WhatsApp event is missing a valid message identity or timestamp')
}

/** Actual content updates only the business number/customer pair. Receipts are not activity. */
async function updateSummary(db: Db, a: WhatsAppWrite, previous: any, contact: any, newContent: boolean) {
  const best = (await db.query(`SELECT id,direction,type,body,created_at FROM whatsapp_messages
    WHERE wa_id=$1 AND phone_number_id=$2 AND type<>'external'
      AND NOT(direction='out' AND COALESCE(status,'')='failed')
    ORDER BY created_at DESC,(direction='in') DESC,id DESC LIMIT 1`,[a.waId,a.phoneNumberId])).rows[0]
  const marker=timestampMillis(contact.last_message_at)
  const changingMarkedMessage=previous && marker===timestampMillis(previous.created_at)
  const useBest=best && (changingMarkedMessage || timestampMillis(best.created_at)>=marker)
  const latestAt=useBest?best.created_at:changingMarkedMessage?contact.last_inbound_at:contact.last_message_at
  const snippet=useBest?(best.body?.slice(0,200)||`[${best.type}]`):changingMarkedMessage?null:contact.last_snippet
  // Unverified CSV history must not reopen the customer-service reply window.
  const inboundAt=(await db.query(`SELECT max(created_at) AS at FROM whatsapp_messages
    WHERE wa_id=$1 AND phone_number_id=$2 AND direction='in' AND type<>'external'
      AND COALESCE(raw->>'imported','false')<>'true'`,[a.waId,a.phoneNumberId])).rows[0]?.at??null
  let unread=contact.unread_count??0
  if(newContent && !a.historical) {
    if(a.direction!=='out' && timestampMillis(a.timestamp)>=marker) unread++
    else if(a.direction==='out' && best?.id===a.messageId && useBest) unread=0
  }
  await db.query(`UPDATE whatsapp_conversations SET last_message_at=$3,last_inbound_at=$4,last_snippet=$5,
    unread_count=$6,profile_name=COALESCE($7,profile_name),display_phone=COALESCE($8,display_phone),
    activity_version=activity_version+$9,updated_at=clock_timestamp(),
    first_ad_id=COALESCE(first_ad_id,$10),
    first_ad_headline=CASE WHEN first_ad_id IS NULL THEN $11 ELSE first_ad_headline END,
    first_ad_source_url=CASE WHEN first_ad_id IS NULL THEN $12 ELSE first_ad_source_url END,
    first_ad_at=CASE WHEN first_ad_id IS NULL AND $10::text IS NOT NULL THEN $13 ELSE first_ad_at END
    WHERE wa_id=$1 AND phone_number_id=$2`,[a.waId,a.phoneNumberId,latestAt??null,inboundAt??null,snippet??null,unread,
    a.direction==='out'?null:a.profileName||null,a.displayPhone??null,newContent?1:0,
    a.ad?.ad_id??null,a.ad?.ad_headline??null,a.ad?.ad_source_url??null,a.timestamp])
}

/** Unknown but signed webhook numbers remain stored/readable; this never grants permission to send. */
async function ensureConversation(db: Db, a: { waId:string;phoneNumberId:string;profileName?:string|null;displayPhone?:string|null }) {
  await db.query(`INSERT INTO whatsapp_contacts(wa_id,phone_number_id,profile_name,display_phone,unread_count)
    VALUES($1,$2,$3,$4,0) ON CONFLICT(wa_id) DO NOTHING`,[a.waId,a.phoneNumberId,a.profileName??null,a.displayPhone??null])
  await db.query(`INSERT INTO whatsapp_inbox_numbers(phone_number_id,display_phone)
    VALUES($1,$2) ON CONFLICT(phone_number_id) DO NOTHING`,[a.phoneNumberId,a.displayPhone??null])
  await db.query(`INSERT INTO whatsapp_conversations(phone_number_id,wa_id,profile_name,display_phone)
    VALUES($1,$2,$3,$4) ON CONFLICT(phone_number_id,wa_id) DO NOTHING`,[a.phoneNumberId,a.waId,a.profileName??null,a.displayPhone??null])
  return (await db.query('SELECT * FROM whatsapp_conversations WHERE wa_id=$1 AND phone_number_id=$2 FOR UPDATE',[a.waId,a.phoneNumberId])).rows[0]
}

/** Same-ID content enrichment, insertion and contact state commit together. */
export async function persistWhatsAppMessage(a: WhatsAppWrite, connection?:Db): Promise<{ inserted: boolean; enriched: boolean }> {
  validArgs(a)
  const direction = a.direction ?? 'in'
  return transaction(a.messageId, a.waId, a.phoneNumberId, async db => {
    const previous = (await db.query('SELECT * FROM whatsapp_messages WHERE id=$1 FOR UPDATE', [a.messageId])).rows[0]
    if (previous) validateMessageIdentity(previous, a.waId, a.phoneNumberId, direction)
    if(a.source==='import' && previous && !isReceiptOnly(previous)) {
      // This check belongs under the message lock: a real webhook may have arrived after import preflight.
      // An import must never downgrade verified content/provenance or close a genuine reply window.
      if(previous.body!==a.body || timestampMillis(previous.created_at)!==timestampMillis(a.timestamp) || previous.type!==a.type)
        throw new WhatsAppScopeError('Imported content conflicts with the saved WhatsApp message',409)
      return {inserted:false,enriched:false}
    }
    const contact = await ensureConversation(db,{...a,profileName:direction==='in'?a.profileName:null})
    const placeholder = isReceiptOnly(previous)
    const oldRaw = objectValue(previous?.raw)
    const oldMeta = objectValue(oldRaw._inbox)
    const authoritativeContent=oldMeta.contentSource==='import' && a.source==='webhook'
    const realTimestamp = !previous || placeholder || authoritativeContent || (oldMeta.provisionalTimestamp && a.source !== 'send')
    const at = realTimestamp ? a.timestamp : previous.created_at
    const body = placeholder || authoritativeContent || !previous?.body ? a.body : previous.body
    const mediaId = previous?.media_id ?? a.mediaId ?? null
    const mediaMime = previous?.media_mime ?? a.mediaMime ?? null
    const type = !previous || placeholder || authoritativeContent ? a.type : previous.type
    const status = direction === 'out' ? mergeWhatsAppStatus(previous?.status, a.status ?? 'sent') : previous?.status ?? null
    const error = status === 'delivered' || status === 'read' ? null : previous?.error ?? null
    const raw = { ...oldRaw, ...objectValue(a.raw), ...(authoritativeContent?{imported:false}:{}), _inbox: { ...oldMeta,
      ...(authoritativeContent?{importObservation:{body:previous.body,createdAt:previous.created_at,type:previous.type}}:{}),
      contentSource: a.source === 'send' ? oldMeta.contentSource ?? 'send' : a.source ?? 'webhook',
      provisionalTimestamp: a.source === 'send' ? oldMeta.provisionalTimestamp ?? (!previous || placeholder) : false,
      receiptOnly: false,
    } }
    const ad = direction === 'in' ? a.ad : null
    const stored = await db.query(`INSERT INTO whatsapp_messages
      (id,wa_id,phone_number_id,direction,type,body,media_id,media_mime,status,error,created_at,raw,
       ad_id,ad_headline,ad_source_url,ad_source_type,ad_media_type,ad_thumbnail_url,ctwa_clid)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO UPDATE SET phone_number_id=EXCLUDED.phone_number_id,
        type=EXCLUDED.type,body=EXCLUDED.body,media_id=EXCLUDED.media_id,media_mime=EXCLUDED.media_mime,
        status=EXCLUDED.status,error=EXCLUDED.error,created_at=EXCLUDED.created_at,raw=EXCLUDED.raw,
        ad_id=COALESCE(whatsapp_messages.ad_id,EXCLUDED.ad_id),
        ad_headline=COALESCE(whatsapp_messages.ad_headline,EXCLUDED.ad_headline),
        ad_source_url=COALESCE(whatsapp_messages.ad_source_url,EXCLUDED.ad_source_url),
        ad_source_type=COALESCE(whatsapp_messages.ad_source_type,EXCLUDED.ad_source_type),
        ad_media_type=COALESCE(whatsapp_messages.ad_media_type,EXCLUDED.ad_media_type),
        ad_thumbnail_url=COALESCE(whatsapp_messages.ad_thumbnail_url,EXCLUDED.ad_thumbnail_url),
        ctwa_clid=COALESCE(whatsapp_messages.ctwa_clid,EXCLUDED.ctwa_clid)
      WHERE whatsapp_messages.wa_id=EXCLUDED.wa_id
        AND whatsapp_messages.phone_number_id=EXCLUDED.phone_number_id
        AND whatsapp_messages.direction=EXCLUDED.direction RETURNING id`,
      [a.messageId,a.waId,a.phoneNumberId,direction,type,body,mediaId,mediaMime,status,error,at,JSON.stringify(raw),
      ad?.ad_id??null,ad?.ad_headline??null,ad?.ad_source_url??null,ad?.ad_source_type??null,
      ad?.ad_media_type??null,ad?.ad_thumbnail_url??null,ad?.ctwa_clid??null])
    if (!stored.rowCount) throw new Error('WhatsApp message ownership changed during persistence')
    await updateSummary(db, { ...a, direction, timestamp: new Date(at).toISOString(), ad }, previous, contact, !previous || placeholder)
    return { inserted: !previous, enriched: placeholder }
  },connection)
}

/** Status-only records stay visible, but never claim a message was answered. */
export async function persistWhatsAppStatus(a: {
  messageId: string; waId: string; phoneNumberId: string; timestamp: string; status: string; error?: string
}) {
  validArgs(a)
  if (!a.status) throw new Error('WhatsApp receipt is missing its status')
  return transaction(a.messageId, a.waId, a.phoneNumberId, async db => {
    const previous = (await db.query('SELECT * FROM whatsapp_messages WHERE id=$1 FOR UPDATE', [a.messageId])).rows[0]
    if (previous) validateMessageIdentity(previous, a.waId, a.phoneNumberId, 'out')
    const status = mergeWhatsAppStatus(previous?.status, a.status)
    const raw = mergeReceiptRaw(previous?.raw, a.status, a.timestamp, a.error)
    if (!previous) raw._inbox = { ...raw._inbox, receiptOnly: true }
    const error = status === 'delivered' || status === 'read' ? null
      : status === 'failed' ? a.status === 'failed' ? a.error ?? previous?.error ?? null : previous?.error ?? null : null
    // A first receipt can arrive before the contact. Do not invent activity.
    await ensureConversation(db,a)
    const stored = await db.query(`INSERT INTO whatsapp_messages
      (id,wa_id,phone_number_id,direction,type,body,status,error,created_at,raw)
      VALUES ($1,$2,$3,'out','external',NULL,$4,$5,$6,$7::jsonb)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,error=EXCLUDED.error,raw=EXCLUDED.raw
      WHERE whatsapp_messages.wa_id=EXCLUDED.wa_id
        AND whatsapp_messages.phone_number_id=EXCLUDED.phone_number_id
        AND whatsapp_messages.direction=EXCLUDED.direction RETURNING id`,
      [a.messageId,a.waId,a.phoneNumberId,status,error,a.timestamp,JSON.stringify(raw)])
    if (!stored.rowCount) throw new Error('WhatsApp message ownership changed during persistence')
    // A confirmed failed send cannot count as the last successful response.
    // Recovery to delivered/read uses its saved send timestamp, never receipt time.
    if (previous && (isReceiptOnly(previous) || (previous.status === 'failed') !== (status === 'failed'))) {
      const contact = (await db.query('SELECT * FROM whatsapp_conversations WHERE wa_id=$1 AND phone_number_id=$2 FOR UPDATE', [a.waId,a.phoneNumberId])).rows[0]
      // Repair an old release's receipt-derived marker only when this exact
      // placeholder is what advanced it. Ordinary receipts remain inert.
      if (!isReceiptOnly(previous) || timestampMillis(contact.last_message_at) === timestampMillis(previous.created_at)) {
        await updateSummary(db, { waId:a.waId,phoneNumberId:a.phoneNumberId,messageId:a.messageId,
          type:previous.type,body:previous.body,timestamp:new Date(previous.created_at).toISOString(),
          direction:'out',raw:previous.raw,historical:true }, previous,contact,false)
      }
    }
  })
}
