export const THREAD_MARK_KINDS = ['confirmed', 'not-interested', 'no-reply'] as const
export type ThreadMarkKind = (typeof THREAD_MARK_KINDS)[number]

export type ThreadMark = { key: string; kind: ThreadMarkKind; at: string; by?: string | null }

export const THREAD_MARK_LABELS: Record<ThreadMarkKind, string> = {
  confirmed: 'Order confirmed',
  'not-interested': 'Not interested',
  'no-reply': 'No reply needed',
}

export const THREAD_MARK_DESCRIPTIONS: Record<ThreadMarkKind, string> = {
  confirmed: 'The order is placed and the customer has what they need',
  'not-interested': 'They declined or went cold; stop chasing',
  'no-reply': 'Their last message closes the exchange',
}

/**
 * Like Business Suite Done: a mark holds only until the customer writes again.
 * Compared at whole seconds so a millisecond of clock drift cannot reopen it.
 */
export function effectiveMark(mark: ThreadMark | undefined, updatedAt: string | null): ThreadMark | null {
  if (!mark) return null
  const markAt = Date.parse(mark.at)
  if (!Number.isFinite(markAt)) return null
  const activity = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (!Number.isFinite(activity)) return mark
  return Math.floor(markAt / 1000) >= Math.floor(activity / 1000) ? mark : null
}
