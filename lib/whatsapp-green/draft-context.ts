import 'server-only'
import { createHash } from 'node:crypto'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { requireWhatsAppInboxUser, requireWhatsAppNumber, validateWhatsAppScope } from '@/lib/whatsapp/number-scope'
import { getGreenReadiness } from './store'
import { buildWhatsAppDraftTranscript, WhatsAppDraftBlocked, type DraftMessage } from './draft-policy'
import { alignReceiptsWithCopies, copyTime, historyCopyId, type CopyRow, type ReceiptRow } from './receipt-match'

export type WhatsAppDraftContext = {
  waId: string
  phoneNumberId: string
  transcript: string
  fingerprint: string
  contextVersion: number
}

/** Read the actual stored conversation, never a browser-supplied selection of turns. */
export async function loadWhatsAppDraftContext(
  waId: unknown,
  phoneNumberId: unknown,
  expectedContextVersion: unknown,
): Promise<WhatsAppDraftContext> {
  validateWhatsAppScope(waId, phoneNumberId)
  const phone = phoneNumberId as string
  await requireWhatsAppInboxUser()
  await requireWhatsAppNumber(phone)
  const readiness = await getGreenReadiness({ waId, phoneNumberId: phone })
  if (!readiness.canDraft) {
    throw new WhatsAppDraftBlocked('CONTEXT_INCOMPLETE', 'Some conversation context is missing or cannot yet be matched. Review the available messages and reply manually for now.')
  }
  if (!Number.isSafeInteger(expectedContextVersion) || expectedContextVersion !== readiness.contextVersion) {
    throw new WhatsAppDraftBlocked('CONTEXT_CHANGED', 'The conversation changed. Refresh it before creating an AI draft.')
  }
  const db = await connectInboxDatabase()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const contact = (await db.query(
      'SELECT activity_version FROM whatsapp_conversations WHERE wa_id=$1 AND phone_number_id=$2', [waId, phone],
    )).rows[0]
    if (!contact) throw new WhatsAppDraftBlocked('NO_CONVERSATION', 'No conversation was found on this business number.', 404)
    const originals = (await db.query(
      `SELECT id,wa_id,direction,type,body,media_id,created_at,
              (type='external' OR COALESCE(raw #>> '{_inbox,receiptOnly}','false')='true') AS receipt_only
       FROM whatsapp_messages
       WHERE wa_id=$1 AND phone_number_id=$2 ORDER BY created_at DESC,id DESC LIMIT 101`, [waId, phone],
    )).rows as (ReceiptRow & { receipt_only: boolean })[]
    const copies = (await db.query(
      `SELECT provider_message_id,wa_id,direction,kind,body,provider_accepted_at,deleted_observed,conflicted
       FROM whatsapp_green_messages WHERE wa_id=$1 AND phone_number_id=$2`, [waId, phone],
    )).rows as CopyRow[]
    // A status-only receipt reads as its verified GREEN-API copy; anything unverified stays blank and blocks below.
    // Copies with no Meta row (history imports) are folded in as their own turns - the same rows the thread shows.
    const { fills, historyOnlyCopies } = alignReceiptsWithCopies(originals.map(row => ({ ...row, receiptOnly: row.receipt_only === true })), copies)
    type Turn = DraftMessage & { id: string; filledFrom?: string; at: number }
    const time = (value: string | Date) => (value instanceof Date ? value.getTime() : Date.parse(value))
    const rows: Turn[] = originals.map(row => {
      const fill = fills.get(row.id)
      return fill
        ? { id: row.id, direction: row.direction, type: 'text', body: fill.body, media_id: null, filledFrom: fill.providerMessageId, at: time(row.created_at) }
        : { id: row.id, direction: row.direction, type: row.type, body: row.body, media_id: row.media_id ?? null, at: time(row.created_at) }
    })
    const oldestOriginal = originals.length ? Math.min(...rows.map(row => row.at)) : Number.NEGATIVE_INFINITY
    for (const copy of historyOnlyCopies) {
      const at = copyTime(copy.provider_accepted_at)
      // Beyond the 101-row window older originals are not loaded either, so keep the same horizon.
      if (!Number.isFinite(at) || (originals.length > 100 && at < oldestOriginal)) continue
      rows.push({ id: historyCopyId(copy.provider_message_id), direction: copy.direction, type: 'text', body: copy.body!.trim(), media_id: null, filledFrom: copy.provider_message_id, at })
    }
    rows.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    const transcript = buildWhatsAppDraftTranscript(rows.slice().reverse())
    const fingerprint = createHash('sha256').update(JSON.stringify([contact.activity_version, rows])).digest('hex')
    await db.query('COMMIT')
    return { waId, phoneNumberId: phone, transcript, fingerprint, contextVersion: readiness.contextVersion }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.end().catch(() => {})
  }
}

/** Discard a draft if an agent/customer message arrived while the model was running. */
export async function assertWhatsAppDraftContextCurrent(context: WhatsAppDraftContext): Promise<void> {
  const latest = await loadWhatsAppDraftContext(context.waId, context.phoneNumberId, context.contextVersion)
  if (latest.fingerprint !== context.fingerprint) {
    throw new WhatsAppDraftBlocked('CONTEXT_CHANGED', 'A new message changed this conversation. Refresh it before creating another AI draft.')
  }
}
