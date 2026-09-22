/**
 * Customer follow-up ladder: when WE spoke last and the customer stays silent,
 * one re-opening message at +30 min, +3 h, +6 h and +24 h after our message.
 * Pure rules only - no database, provider or model access - so every branch
 * can be pinned with real values in scripts/check-followup-ladder.ts.
 */
export type LadderChannel = 'messenger' | 'whatsapp'
export type LadderMessage = { id: string; direction: 'in' | 'out'; at: string; text: string | null; followup?: boolean; media?: boolean }
export type LadderLedgerRow = { anchorMessageId: string; step: number; state: string; providerMessageId?: string | null }
export type LadderInput = {
  channel: LadderChannel; messages: readonly LadderMessage[]; ledger: readonly LadderLedgerRow[]
  hasOrder: boolean; now: Date | number
  /** Business Suite "Done" marks are ignored by owner decision (15 Sep 2026); kept as an opt-in. */
  respectDone?: boolean; doneAt?: string | null
}
export type LadderDecision =
  | { action: 'send'; step: number; anchor: LadderMessage; dueAt: string; skipLower: number[] }
  | { action: 'wait'; until: string; step: number; anchor: LadderMessage }
  | { action: 'stop'; reason: LadderStopReason; anchor: LadderMessage | null }
export type LadderStopReason = 'no_anchor' | 'customer_replied' | 'order_exists' | 'done_in_business_suite' |
  'messenger_window_closed' | 'anchor_too_old' | 'ladder_complete'

const MINUTE = 60_000, HOUR = 60 * MINUTE
export const FOLLOWUP_STEPS: readonly number[] = Object.freeze([30 * MINUTE, 3 * HOUR, 6 * HOUR, 24 * HOUR])
export const FOLLOWUP_STEP_LABELS: readonly string[] = Object.freeze(['30 minutes', '3 hours', '6 hours', '1 day'])
export const FOLLOWUP_LAST_STEP = FOLLOWUP_STEPS.length
/** Mauritius is UTC+4 all year (no daylight saving), so local time is plain arithmetic. */
export const MAURITIUS_OFFSET_MS = 4 * HOUR
export const BUSINESS_OPEN_HOUR = 8
export const BUSINESS_CLOSE_HOUR = 23
/** The biggest night shift is 23:00 -> 08:00 (9 h); anything beyond the last step plus that has nothing left. */
export const LADDER_GRACE_MS = 10 * HOUR
/** Meta allows a free-form Messenger reply only within 24 h of the customer's last message. */
export const MESSENGER_WINDOW_MS = 24 * HOUR - 5 * MINUTE
const ACTIVE_STATES = new Set(['sending', 'sent', 'unknown'])

const time = (v: Date | number | string): number => v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
const localHour = (t: number) => (((t + MAURITIUS_OFFSET_MS) % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR) / HOUR
const startOfLocalDay = (t: number) => t - ((((t + MAURITIUS_OFFSET_MS) % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR))

/** A step falling in [23:00, 08:00) Mauritius waits for 08:00 that morning (or the next). */
export function shiftToBusinessHours(at: number): number {
  const hour = localHour(at)
  if (hour >= BUSINESS_OPEN_HOUR && hour < BUSINESS_CLOSE_HOUR) return at
  const dayStart = startOfLocalDay(at)
  const opening = dayStart + BUSINESS_OPEN_HOUR * HOUR
  return hour < BUSINESS_OPEN_HOUR ? opening : opening + 24 * HOUR
}

export function dueAt(anchorAt: string | number, step: number): number {
  if (!Number.isInteger(step) || step < 1 || step > FOLLOWUP_LAST_STEP) throw new RangeError('invalid follow-up step')
  return shiftToBusinessHours(time(anchorAt) + FOLLOWUP_STEPS[step - 1])
}

/** Our newest NON-follow-up outbound. Our own nudges never restart the clock. */
export function anchorFor(messages: readonly LadderMessage[], ledger: readonly LadderLedgerRow[]): LadderMessage | null {
  const nudges = new Set(ledger.map(r => r.providerMessageId).filter((v): v is string => typeof v === 'string' && v.length > 0))
  let anchor: LadderMessage | null = null
  for (const m of messages) {
    if (m.direction !== 'out' || m.followup || nudges.has(m.id) || !Number.isFinite(time(m.at))) continue
    if (!anchor || time(m.at) > time(anchor.at) || (time(m.at) === time(anchor.at) && m.id > anchor.id)) anchor = m
  }
  return anchor
}

export function ladderState(input: LadderInput): LadderDecision {
  const now = time(input.now)
  const anchor = anchorFor(input.messages, input.ledger)
  if (!anchor) return { action: 'stop', reason: 'no_anchor', anchor: null }
  const anchorAt = time(anchor.at)
  const inbound = input.messages.filter(m => m.direction === 'in' && Number.isFinite(time(m.at)))
  if (inbound.some(m => time(m.at) > anchorAt)) return { action: 'stop', reason: 'customer_replied', anchor }
  if (input.hasOrder) return { action: 'stop', reason: 'order_exists', anchor }
  if (input.respectDone && input.doneAt && Math.floor(time(input.doneAt) / 1000) >= Math.floor(anchorAt / 1000)) return { action: 'stop', reason: 'done_in_business_suite', anchor }
  if (now - anchorAt > FOLLOWUP_STEPS[FOLLOWUP_LAST_STEP - 1] + LADDER_GRACE_MS) return { action: 'stop', reason: 'anchor_too_old', anchor }
  const done = new Set(input.ledger.filter(r => r.anchorMessageId === anchor.id && (ACTIVE_STATES.has(r.state) || r.state === 'skipped')).map(r => r.step))
  const highestDone = Math.max(0, ...done)
  const due: number[] = [], pending: number[] = []
  for (let step = highestDone + 1; step <= FOLLOWUP_LAST_STEP; step++) (dueAt(anchorAt, step) <= now ? due : pending).push(step)
  if (!due.length) {
    if (!pending.length) return { action: 'stop', reason: 'ladder_complete', anchor }
    return { action: 'wait', until: new Date(dueAt(anchorAt, pending[0])).toISOString(), step: pending[0], anchor }
  }
  // A step that became due inside hours but was not sent (downtime, backlog at switch-on) must
  // still not go out at night: the SEND moment is held to 08:00, not only the due moment.
  const sendableAt = shiftToBusinessHours(now)
  if (sendableAt > now) return { action: 'wait', until: new Date(sendableAt).toISOString(), step: due[due.length - 1], anchor }
  if (input.channel === 'messenger') {
    const lastCustomerAt = Math.max(...inbound.map(m => time(m.at)))
    if (!Number.isFinite(lastCustomerAt) || now - lastCustomerAt >= MESSENGER_WINDOW_MS) return { action: 'stop', reason: 'messenger_window_closed', anchor }
  }
  const step = due[due.length - 1]
  return { action: 'send', step, anchor, dueAt: new Date(dueAt(anchorAt, step)).toISOString(), skipLower: due.slice(0, -1) }
}

/** Sorts newest-last and drops duplicate ids (a Meta send and its Green copy share the wamid). */
export function dedupeMessages(messages: readonly LadderMessage[]): LadderMessage[] {
  const byId = new Map<string, LadderMessage>()
  for (const m of messages) {
    const existing = byId.get(m.id)
    if (!existing || (m.followup && !existing.followup)) byId.set(m.id, existing ? { ...existing, followup: existing.followup || m.followup } : m)
  }
  return [...byId.values()].sort((a, b) => time(a.at) - time(b.at) || a.id.localeCompare(b.id))
}
