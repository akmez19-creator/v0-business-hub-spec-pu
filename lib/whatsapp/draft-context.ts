import 'server-only'
import { createHash } from 'node:crypto'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { requireWhatsAppInboxUser, requireWhatsAppNumber, validateWhatsAppScope } from '@/lib/whatsapp/number-scope'
import { getDraftReadiness } from './draft-readiness'
import { buildWhatsAppDraftTranscript, WhatsAppDraftBlocked, type DraftMessage } from './draft-policy'

export type WhatsAppDraftContext = {
  waId: string
  phoneNumberId: string
  transcript: string
  fingerprint: string
  contextVersion: number
  /** Set when the transcript carries attachment markers the agent chose to draft over. */
  attachmentsReviewed: boolean
  attachmentCount: number
}

/** Read the actual stored conversation, never a browser-supplied selection of turns. */
export async function loadWhatsAppDraftContext(
  waId: unknown,
  phoneNumberId: unknown,
  expectedContextVersion: unknown,
  options: { attachmentsReviewed?: boolean } = {},
): Promise<WhatsAppDraftContext> {
  validateWhatsAppScope(waId, phoneNumberId)
  const phone = phoneNumberId as string
  await requireWhatsAppInboxUser()
  await requireWhatsAppNumber(phone)
  const readiness = await getDraftReadiness({ waId: waId as string, phoneNumberId: phone })
  const attachmentsReviewed = options.attachmentsReviewed === true
  // Without the agent's review every readiness reason blocks. With it ("Draft anyway")
  // nothing does: whatever the model cannot read is rendered as a marker in the
  // transcript instead, and the agent - who has the full thread on screen - owns the gap.
  if (!attachmentsReviewed && readiness.draftReasons.length) {
    throw new WhatsAppDraftBlocked('CONTEXT_INCOMPLETE', 'Some messages in this conversation cannot be read by the AI. Review them, then draft anyway or reply manually.')
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
      `SELECT id,wa_id,direction,type,body,media_id,created_at
       FROM whatsapp_messages
       WHERE wa_id=$1 AND phone_number_id=$2 ORDER BY created_at DESC,id DESC LIMIT 101`, [waId, phone],
    )).rows as { id: string; direction: string; type: string; body: string | null; media_id: string | null; created_at: string | Date }[]
    type Turn = DraftMessage & { id: string; at: number }
    const time = (value: string | Date) => (value instanceof Date ? value.getTime() : Date.parse(value))
    const rows: Turn[] = originals.map(row => ({
      id: row.id, direction: row.direction, type: row.type, body: row.body, media_id: row.media_id ?? null, at: time(row.created_at),
    }))
    rows.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
    const transcript = buildWhatsAppDraftTranscript(rows.slice().reverse(), { attachmentsReviewed })
    // Every turn the model reads as a marker rather than words: media, blanks and lost text.
    const attachmentCount = rows.filter((row) => row.media_id || !(typeof row.body === 'string' && row.body.trim())).length
    const fingerprint = createHash('sha256').update(JSON.stringify([contact.activity_version, rows])).digest('hex')
    await db.query('COMMIT')
    return { waId: waId as string, phoneNumberId: phone, transcript, fingerprint, contextVersion: readiness.contextVersion, attachmentsReviewed, attachmentCount }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await db.end().catch(() => {})
  }
}

/** Discard a draft if an agent/customer message arrived while the model was running. */
export async function assertWhatsAppDraftContextCurrent(context: WhatsAppDraftContext): Promise<void> {
  const latest = await loadWhatsAppDraftContext(context.waId, context.phoneNumberId, context.contextVersion, { attachmentsReviewed: context.attachmentsReviewed })
  if (latest.fingerprint !== context.fingerprint) {
    throw new WhatsAppDraftBlocked('CONTEXT_CHANGED', 'A new message changed this conversation. Refresh it before creating another AI draft.')
  }
}
