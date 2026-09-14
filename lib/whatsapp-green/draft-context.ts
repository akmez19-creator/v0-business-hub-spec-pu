import 'server-only'
import { createHash } from 'node:crypto'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { requireWhatsAppInboxUser, requireWhatsAppNumber, validateWhatsAppScope } from '@/lib/whatsapp/number-scope'
import { getGreenReadiness } from './store'
import { buildWhatsAppDraftTranscript, WhatsAppDraftBlocked, type DraftMessage } from './draft-policy'

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
    const rows = (await db.query(
      `SELECT id,direction,type,body,media_id FROM whatsapp_messages
       WHERE wa_id=$1 AND phone_number_id=$2 ORDER BY created_at DESC,id DESC LIMIT 101`, [waId, phone],
    )).rows as (DraftMessage & { id: string })[]
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
