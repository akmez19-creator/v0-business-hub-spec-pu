// Which pile a conversation belongs in.
//
// Derived on read from data Meta already gives us, never stored. A stored
// stage would need a write on every inbound webhook and would silently go
// stale the moment someone replies from Business Suite or respond.io - which
// happens daily here, and which our webhook does not even receive (outbound
// echoes are blocked). Deriving keeps it honest.

export type LeadStage = 'awaiting' | 'new' | 'active' | 'dormant'

export const STAGE_LABELS: Record<LeadStage, string> = {
  awaiting: 'Awaiting reply',
  new: 'New enquiry',
  active: 'In conversation',
  dormant: 'Dormant',
}

export const STAGE_DESCRIPTIONS: Record<LeadStage, string> = {
  awaiting: 'They spoke last and are still waiting on you',
  new: 'First contact, never replied to',
  active: 'Live conversation, you replied last',
  dormant: 'No activity in over 30 days',
}

const DORMANT_DAYS = 30

export type StageInput = {
  messageCount: number
  /** True when the most recent message came from the customer, not the page. */
  lastFromCustomer: boolean
  lastMessageAt: string | null
}

export function deriveStage(input: StageInput): LeadStage {
  const { messageCount, lastFromCustomer, lastMessageAt } = input

  const ageDays = lastMessageAt
    ? (Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY

  // Dormant wins over everything: a year-old unanswered message is not
  // something to action today, and letting it sit in "awaiting" is what
  // buries the 188 that genuinely need a reply.
  if (ageDays > DORMANT_DAYS) return 'dormant'

  // Never answered - and only one inbound message.
  if (lastFromCustomer && messageCount <= 1) return 'new'

  if (lastFromCustomer) return 'awaiting'

  return 'active'
}

/** Sort order for triage: what needs a human first. */
export const STAGE_PRIORITY: Record<LeadStage, number> = {
  awaiting: 0,
  new: 1,
  active: 2,
  dormant: 3,
}
