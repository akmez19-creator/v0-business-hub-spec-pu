/**
 * Rules for what happens to the MONEY when a delivery's status changes.
 *
 * The money on a delivery lives in `payment_juice` / `payment_cash` /
 * `payment_bank` - `payment_method` is only a label. Every collection and
 * counting screen reads the columns, so a status change that leaves them
 * populated keeps the order showing up as money to collect even though nothing
 * was ever collected.
 */

/** Money-bearing columns, cleared together or not at all. */
export const CLEARED_PAYMENT_FIELDS = {
  payment_method: null,
  payment_cash: 0,
  payment_juice: 0,
  payment_bank: 0,
  payment_status: 'unpaid',
  payment_proof_url: null,
  // The old proof describes a payment that no longer exists. Leaving these
  // behind would show a verified reference against an order with no money.
  payment_ref: null,
  payment_ref_confirmed: false,
  payment_ref_source: null,
  payment_proof_amount: null,
  payment_proof_status: null,
  payment_proof_checked_at: null,
} as const

/**
 * Statuses that mean "no money was collected".
 *
 * CMS (goods back under CS care), NWD (not delivered, will be re-attempted)
 * and cancelled all describe an order where the client never paid. Leaving
 * Delivered for any of these must blank the payment.
 *
 * Note this is a subset of a wider truth: reverting to `pending`/`assigned`
 * also means the money is not real yet, and the bulk path already clears those
 * too. `leavingDeliveredClearsMoney()` below is the single rule both paths use.
 */
export const NO_MONEY_STATUSES = ['cms', 'nwd', 'cancelled'] as const

/**
 * Money is only real while the order is delivered. Any move off `delivered`
 * clears it - the three statuses above are simply the cases that happen in
 * practice.
 */
export function leavingDeliveredClearsMoney(from: string | null, to: string): boolean {
  return from === 'delivered' && to !== 'delivered'
}

/** The settlement flags that make an order's money already-accounted-for. */
export type SettlementFlags = {
  contractor_cash_counted_at: string | null
  contractor_juice_counted_at: string | null
  juice_transferred_at: string | null
  cash_collected: boolean | null
  juice_collected: boolean | null
}

/**
 * Has this order's money already been counted, collected or transferred?
 *
 * If it has, the cash physically changed hands and someone downstream has
 * written down a total that includes it. Blanking the payment would leave that
 * total disagreeing with the sum of the rows behind it, with nothing on screen
 * explaining the gap - so the status change is refused until the count or
 * transfer is undone.
 *
 * Returns the human reasons, so the message can name what to undo rather than
 * just saying "not allowed".
 */
export function settlementReasons(d: SettlementFlags): string[] {
  const out: string[] = []
  if (d.contractor_cash_counted_at) out.push('the cash has been counted for that day')
  if (d.contractor_juice_counted_at) out.push('the juice has been counted for that day')
  if (d.juice_transferred_at) out.push('it is part of a juice transfer')
  if (d.cash_collected) out.push('the cash has been collected')
  if (d.juice_collected) out.push('the juice has been collected')
  return out
}

/** Joins reasons into one sentence: "a, b and c". */
export function joinReasons(reasons: string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? ''
  return `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`
}
