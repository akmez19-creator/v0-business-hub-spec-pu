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

/**
 * Readiness reasons an agent may waive after looking at the thread themselves: a photo the
 * model cannot see, or a turn whose words never reached the app - including a reply the agent
 * typed on their own phone, which Meta reports as a receipt with no text. The agent has the
 * whole thread on screen, so they own that gap. An empty thread is never waivable: there
 * would be nothing at all to draft from.
 */
export const REVIEWABLE_DRAFT_REASONS: ReadonlySet<string> = new Set([
  'UNSUPPORTED_CONTENT', 'HISTORY_TRUNCATED',
])

export const ATTACHMENT_MARKER = '[photo or attachment - not seen by the AI, reviewed by the agent]'
export const UNAVAILABLE_MARKER = '[message unavailable from WhatsApp - a reaction, deleted or view-once message; it had no readable content]'
/** A text message whose words never reached us (a delivery receipt with no stored copy). */
export const MISSING_TEXT_MARKER = '[message text not available to the AI - the agent has read it in WhatsApp]'
/** Oldest turns dropped to fit the model window; the agent still sees them in the thread. */
export const TRUNCATED_MARKER = '[older messages omitted - the agent has read the full thread]'

export type DraftTranscriptOptions = {
  /**
   * The agent has looked at the whole thread and asked to draft anyway. With this set
   * the transcript is always built: anything the model cannot read becomes a marker
   * and an over-long history keeps its most recent turns.
   */
  attachmentsReviewed?: boolean
}

export function buildWhatsAppDraftTranscript(rows: readonly DraftMessage[], options: DraftTranscriptOptions = {}): string {
  if (!rows.length) throw new WhatsAppDraftBlocked('EMPTY_CONTEXT', 'No conversation to read yet.')
  const reviewed = options.attachmentsReviewed === true
  if (rows.length > WHATSAPP_DRAFT_MAX_MESSAGES && !reviewed) {
    throw new WhatsAppDraftBlocked('CONTEXT_TOO_LONG', 'This conversation needs a full human review before an AI draft. No messages were omitted.')
  }
  if (reviewed) {
    const kept = fitMostRecent(rows)
    return kept.length < rows.length ? [TRUNCATED_MARKER, ...renderTurns(kept, true)].join('\n') : renderTurns(kept, true).join('\n')
  }
  return renderTurns(rows, false).join('\n')
}

/** Newest turns that fit both the message and character windows (rows are oldest first). */
function fitMostRecent(rows: readonly DraftMessage[]): DraftMessage[] {
  const kept: DraftMessage[] = []
  let characters = 0
  for (let i = rows.length - 1; i >= 0 && kept.length < WHATSAPP_DRAFT_MAX_MESSAGES; i--) {
    const length = typeof rows[i].body === 'string' ? (rows[i].body as string).length : 0
    if (kept.length && characters + length > WHATSAPP_DRAFT_MAX_CHARACTERS) break
    characters += length
    kept.unshift(rows[i])
  }
  return kept
}

function renderTurns(rows: readonly DraftMessage[], reviewed: boolean): string[] {
  let characters = 0
  const turns: string[] = []
  for (const row of rows) {
    if (row.direction !== 'in' && row.direction !== 'out') {
      throw new WhatsAppDraftBlocked('INVALID_CONTEXT', 'The conversation direction could not be verified. Reply manually for now.')
    }
    const speaker = row.direction === 'out' ? 'Business' : 'Customer'
    const caption = typeof row.body === 'string' ? row.body.trim() : ''
    // A message with an attachment the AI cannot see blocks regardless of any caption -
    // unless the agent has reviewed the attachments, in which case the turn is kept with
    // an explicit marker so the model knows exactly where it is blind.
    if (row.media_id) {
      if (!reviewed) {
        throw new WhatsAppDraftBlocked('UNREADABLE_CONTENT', 'This conversation includes an attachment or content the AI has not read. Review it and reply manually for now.')
      }
      const text = caption ? `${ATTACHMENT_MARKER} ${caption}` : ATTACHMENT_MARKER
      characters += text.length
      turns.push(`${speaker}: ${text}`)
      continue
    }
    // Meta labels ad-click greetings ("Hello! Can I get more info on this?") and some
    // forwarded texts `unsupported` while still delivering the words. Readable text is
    // readable whatever the label; only a message with NO text is a blank.
    if (!caption) {
      if (row.type !== 'text') {
        if (reviewed) {
          // No media id and no words: Meta itself delivered nothing (error 131060 -
          // a reaction, deleted or view-once message). Say so, not "a photo".
          turns.push(`${speaker}: ${row.type === 'unsupported' ? UNAVAILABLE_MARKER : ATTACHMENT_MARKER}`)
          continue
        }
        throw new WhatsAppDraftBlocked('UNREADABLE_CONTENT', 'This conversation includes an attachment or content the AI has not read. Review it and reply manually for now.')
      }
      if (reviewed) {
        // A text message we only hold a receipt for: the agent read it on the phone.
        turns.push(`${speaker}: ${MISSING_TEXT_MARKER}`)
        continue
      }
      throw new WhatsAppDraftBlocked('MISSING_TEXT', 'This conversation contains missing message text. Review it and reply manually for now.')
    }
    const body = caption
    characters += body.length
    if (characters > WHATSAPP_DRAFT_MAX_CHARACTERS && !reviewed) {
      throw new WhatsAppDraftBlocked('CONTEXT_TOO_LONG', 'This conversation needs a full human review before an AI draft. No message text was shortened.')
    }
    turns.push(`${speaker}: ${body}`)
  }
  return turns
}
