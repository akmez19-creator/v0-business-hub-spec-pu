import type { UnifiedThread } from '@/lib/inbox/unified'
import type { LeadMessage } from '@/lib/inbox/lead-actions'

export type QueueView = 'all' | 'needs-reply-24h' | 'needs-action' | 'unread'

export const NEEDS_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * A customer is waiting when they spoke last and nobody closed the chat:
 * not marked Done in Business Suite, not answered from the phone.
 */
export function isWaitingOnUs(row: Pick<UnifiedThread, 'stage' | 'done' | 'answeredByPhone'>): boolean {
  return (row.stage === 'awaiting' || row.stage === 'new') && !row.done && !row.answeredByPhone
}

/** Waiting, and their last message landed inside the reply window. */
export function needsReplyWithin(row: Pick<UnifiedThread, 'stage' | 'done' | 'answeredByPhone' | 'updatedAt'>, windowMs: number, now = Date.now()): boolean {
  const at = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN
  return isWaitingOnUs(row) && Number.isFinite(at) && now - at <= windowMs
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

/**
 * Views narrow the queue; its order follows newest activity, except the 24h
 * needs-reply view, which puts the customer who has waited LONGEST first.
 */
export function newestConversations<T extends Pick<UnifiedThread, 'key' | 'updatedAt' | 'stage' | 'unreadCount' | 'done' | 'answeredByPhone'>>(rows: T[], view: QueueView, now = Date.now()): T[] {
  const timestamp = (value: string | null) => {
    const parsed = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  const keep = (row: T) => {
    if (view === 'all') return true
    if (view === 'unread') return row.unreadCount > 0
    if (view === 'needs-reply-24h') return needsReplyWithin(row, NEEDS_REPLY_WINDOW_MS, now)
    return isWaitingOnUs(row)
  }
  return rows.filter(keep)
    .sort((a, b) => {
      const latest = timestamp(b.updatedAt) - timestamp(a.updatedAt)
      const ordered = view === 'needs-reply-24h' ? -latest : latest
      return Number.isNaN(ordered) || ordered === 0 ? a.key.localeCompare(b.key) : ordered
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
