import type { UnifiedThread } from '@/lib/inbox/unified'
import type { LeadMessage } from '@/lib/inbox/lead-actions'

export type QueueView = 'all' | 'needs-reply-24h' | 'client-silent-24h' | 'needs-action' | 'client-silent' | 'closed' | 'unread' | 'starred'

type Outcome = Pick<UnifiedThread, 'done' | 'closingAck' | 'mark'>

/**
 * The exchange is over for now: Done in Business Suite, an agent marked it
 * (order confirmed / not interested / no reply needed), or the customer just
 * said "Okay"/"Thank you". None of these are waiting on anyone.
 */
export function isClosed(row: Outcome): boolean {
  return Boolean(row.done || row.mark || row.closingAck)
}

export const NEEDS_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * A customer is waiting when they spoke last and nobody closed the chat:
 * not marked Done in Business Suite, not answered from the phone.
 */
export function isWaitingOnUs(row: Pick<UnifiedThread, 'stage' | 'answeredByPhone'> & Outcome): boolean {
  return (row.stage === 'awaiting' || row.stage === 'new') && !isClosed(row) && !row.answeredByPhone
}

/**
 * The opposite side of the same question: WE spoke last (from the app, Business
 * Suite or the phone) and the customer has not come back. Done chats are closed
 * on purpose and dormant ones are too old to chase.
 */
export function isAwaitingCustomer(row: Pick<UnifiedThread, 'stage' | 'answeredByPhone'> & Outcome): boolean {
  if (isClosed(row) || row.stage === 'dormant') return false
  return row.stage === 'active' || row.answeredByPhone === true
}

function within(row: Pick<UnifiedThread, 'updatedAt'>, windowMs: number, now: number): boolean {
  const at = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN
  return Number.isFinite(at) && now - at <= windowMs
}

/** Waiting, and their last message landed inside the reply window. */
export function needsReplyWithin(row: Pick<UnifiedThread, 'stage' | 'answeredByPhone' | 'updatedAt'> & Outcome, windowMs: number, now = Date.now()): boolean {
  return isWaitingOnUs(row) && within(row, windowMs, now)
}

/** We replied inside the window and the customer has stayed silent since. */
export function clientSilentWithin(row: Pick<UnifiedThread, 'stage' | 'answeredByPhone' | 'updatedAt'> & Outcome, windowMs: number, now = Date.now()): boolean {
  return isAwaitingCustomer(row) && within(row, windowMs, now)
}
export type PresentedLeadMessage = LeadMessage & { status?: string | null; receiptOnly?: boolean; fromCopy?: boolean }

/** An event refreshes its current queue and visible transcript, never other customers. */
export function inboxInvalidationKeys(channels: ('messenger' | 'whatsapp')[], messengerListKey: string, visibleTranscriptKey: string | null): string[] {
  const keys = new Set<string>()
  if (channels.includes('messenger')) {
    keys.add(messengerListKey)
    if (visibleTranscriptKey?.startsWith('/api/inbox/messages?')) keys.add(visibleTranscriptKey)
  }
  if (channels.includes('whatsapp')) {
    keys.add('/api/inbox/whatsapp')
    if (visibleTranscriptKey?.startsWith('/api/inbox/whatsapp?waId=')) keys.add(visibleTranscriptKey)
  }
  return [...keys]
}

export function whatsappAcceptedWarning(result: { success: boolean; savedLocally?: boolean; warning?: string }): string | null {
  if (!result.success || (result.savedLocally !== false && !result.warning)) return null
  return result.warning?.trim() || 'WhatsApp accepted this message, but its local copy could not be saved yet. Do not resend; refresh the conversation shortly.'
}

export function latestActivityAt(timestamps: (string | null | undefined)[]): string | null {
  let latest: string | null = null
  let latestTime = Number.NEGATIVE_INFINITY
  for (const value of timestamps) {
    const timestamp = value ? Date.parse(value) : Number.NaN
    if (Number.isFinite(timestamp) && timestamp > latestTime) { latest = value!; latestTime = timestamp }
  }
  return latest
}

/** Views narrow the queue; every view lists the most recent activity first (owner's call, 15 Sep). */
export function newestConversations<T extends Pick<UnifiedThread, 'key' | 'updatedAt' | 'stage' | 'unreadCount' | 'answeredByPhone' | 'star'> & Outcome>(rows: T[], view: QueueView, now = Date.now()): T[] {
  // Starred = escalated by a person; newest star first, regardless of chat activity.
  if (view === 'starred') {
    return rows.filter((r) => r.star).sort((a, b) => Date.parse(b.star!.starredAt) - Date.parse(a.star!.starredAt))
  }
  const timestamp = (value: string | null) => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  const keep = (row: T) => {
    if (view === 'all') return true
    // Unread follows the same 24h window as needs-reply. History recovery back-fills months of
    // messages nobody ever read, and an unread pile that deep is not a list an agent can work.
    // "Needs reply - any age" stays unwindowed as the way back to the older ones.
    if (view === 'unread') return row.unreadCount > 0 && within(row, NEEDS_REPLY_WINDOW_MS, now)
    if (view === 'needs-reply-24h') return needsReplyWithin(row, NEEDS_REPLY_WINDOW_MS, now)
    if (view === 'client-silent-24h') return clientSilentWithin(row, NEEDS_REPLY_WINDOW_MS, now)
    if (view === 'client-silent') return isAwaitingCustomer(row)
    if (view === 'closed') return isClosed(row)
    return isWaitingOnUs(row)
  }
  return rows.filter(keep)
    .sort((a, b) => {
      const latest = timestamp(b.updatedAt) - timestamp(a.updatedAt)
      return Number.isNaN(latest) || latest === 0 ? a.key.localeCompare(b.key) : latest
    })
}

/** Keep actual message text. Status-only records cannot establish its origin. */
export function presentTranscript(messages: LeadMessage[], metadata: { id: string; type?: string; status?: string | null; copySource?: string | null }[] = []): PresentedLeadMessage[] {
  const byId = new Map(metadata.map((row) => [row.id, row]))
  const time = (value: string | null) => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
  }
  return messages.map((message) => {
    const raw = byId.get(message.id)
    const text = raw?.type === 'external' && message.text === 'Replied from another app' ? '' : message.text
    return { ...message, status: raw?.status, text: text.trim() ? text : '',
      fromCopy: raw?.copySource === 'green-api' && Boolean(text.trim()),
      receiptOnly: raw?.type === 'external' && message.fromBusiness && !text.trim() && !message.attachments.length }
  }).sort((a, b) => {
    const difference = time(a.createdAt) - time(b.createdAt)
    return Number.isNaN(difference) || difference === 0 ? 0 : difference
  })
}
