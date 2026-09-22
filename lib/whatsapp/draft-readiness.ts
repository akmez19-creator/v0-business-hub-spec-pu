import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { requireWhatsAppNumber, validateWhatsAppScope } from '@/lib/whatsapp/number-scope'

/**
 * What the AI can actually read in a stored WhatsApp thread.
 *
 * The Meta record is now the only record. A reply an agent types on the phone reaches us
 * as a status receipt with no text, so it is reported as UNSUPPORTED_CONTENT: a turn the
 * model cannot read, which the agent - who has the thread on screen - may waive with
 * "Draft anyway". It is deliberately not a hard block; that would stop drafting on every
 * thread an agent has ever answered from their phone.
 */
export type DraftBlockReason = 'UNSUPPORTED_CONTENT' | 'HISTORY_TRUNCATED' | 'NO_READABLE_CONTEXT'

export type DraftReadiness = {
  canDraft: boolean
  draftReasons: DraftBlockReason[]
  contextVersion: number
  unsupportedOriginalCount: number
  canonicalHasMore: boolean
  totalCount: number
}

type Db = { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

/** Matches the transcript window in draft-policy: older turns are not sent to the model. */
const MAX_READABLE_MESSAGES = 100

export async function readDraftReadiness(db: Db, phoneNumberId: string, waId: string): Promise<DraftReadiness> {
  validateWhatsAppScope(waId, phoneNumberId)
  const rows = (await db.query(
    `SELECT type,body,media_id FROM public.whatsapp_messages
     WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY created_at DESC,id DESC LIMIT 2000`,
    [phoneNumberId, waId],
  )).rows
  // Readable = the model can see words. Media it cannot open and receipts with no text cannot.
  const unsupportedOriginalCount = rows.filter(row => row.media_id || !String(row.body ?? '').trim()).length
  const version = (await db.query(
    `SELECT COALESCE((SELECT activity_version FROM public.whatsapp_conversations WHERE phone_number_id=$1 AND wa_id=$2),0) AS version`,
    [phoneNumberId, waId],
  )).rows[0]
  const draftReasons: DraftBlockReason[] = []
  if (unsupportedOriginalCount > 0) draftReasons.push('UNSUPPORTED_CONTENT')
  if (rows.length > MAX_READABLE_MESSAGES) draftReasons.push('HISTORY_TRUNCATED')
  if (!rows.length) draftReasons.push('NO_READABLE_CONTEXT')
  return {
    canDraft: draftReasons.length === 0,
    draftReasons,
    contextVersion: Number(version?.version ?? 0),
    unsupportedOriginalCount,
    canonicalHasMore: rows.length > MAX_READABLE_MESSAGES,
    totalCount: rows.length,
  }
}

export async function getDraftReadiness(scope: { phoneNumberId: string; waId: string }): Promise<DraftReadiness> {
  validateWhatsAppScope(scope.waId, scope.phoneNumberId)
  await requireWhatsAppNumber(scope.phoneNumberId)
  const db = await connectInboxDatabase()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const result = await readDraftReadiness(db, scope.phoneNumberId, scope.waId)
    await db.query('COMMIT')
    return result
  } finally {
    await db.end().catch(() => {})
  }
}
