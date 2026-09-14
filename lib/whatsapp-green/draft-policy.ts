/** A manual draft may use readable stored context; this never authorizes a send. */
export const WHATSAPP_DRAFT_MAX_MESSAGES = 100
export const WHATSAPP_DRAFT_MAX_CHARACTERS = 30_000

export type DraftMessage = {
  direction: unknown
  type: unknown
  body: unknown
  media_id?: unknown
}

export class WhatsAppDraftBlocked extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message)
    this.name = 'WhatsAppDraftBlocked'
  }
}

export function buildWhatsAppDraftTranscript(rows: readonly DraftMessage[]): string {
  if (!rows.length) throw new WhatsAppDraftBlocked('EMPTY_CONTEXT', 'No conversation to read yet.')
  if (rows.length > WHATSAPP_DRAFT_MAX_MESSAGES) {
    throw new WhatsAppDraftBlocked('CONTEXT_TOO_LONG', 'This conversation needs a full human review before an AI draft. No messages were omitted.')
  }
  let characters = 0
  const turns: string[] = []
  for (const row of rows) {
    if (row.direction !== 'in' && row.direction !== 'out') {
      throw new WhatsAppDraftBlocked('INVALID_CONTEXT', 'The conversation direction could not be verified. Reply manually for now.')
    }
    if (typeof row.body !== 'string' || !row.body.trim()) {
      throw new WhatsAppDraftBlocked('MISSING_TEXT', 'This conversation contains missing message text. Review it and reply manually for now.')
    }
    if (row.type !== 'text' || row.media_id) {
      throw new WhatsAppDraftBlocked('UNREADABLE_CONTENT', 'This conversation includes an attachment or content the AI has not read. Review it and reply manually for now.')
    }
    characters += row.body.length
    if (characters > WHATSAPP_DRAFT_MAX_CHARACTERS) {
      throw new WhatsAppDraftBlocked('CONTEXT_TOO_LONG', 'This conversation needs a full human review before an AI draft. No message text was shortened.')
    }
    turns.push(`${row.direction === 'out' ? 'Business' : 'Customer'}: ${row.body.trim()}`)
  }
  return turns.join('\n')
}
