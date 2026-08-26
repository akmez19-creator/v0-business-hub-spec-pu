/**
 * Payment method: the label AND the money that has to move with it.
 *
 * The money does not live in `payment_method` - it lives in three separate
 * columns (`payment_juice` / `payment_cash` / `payment_bank`), and every
 * collections, juice and cash-counting screen reads THOSE columns, not the
 * label. So changing the label alone leaves the row contradicting itself: it
 * reads "Cash" while Rs 475 still sits in the juice column, which means the
 * order keeps showing up in juice collection and stays invisible to cash
 * counting. Anything that changes the method must move the money too, which is
 * what `splitForMethod()` below exists for.
 */

export type PaymentMethod =
  | 'cash'
  | 'juice'
  | 'bank'
  | 'already_paid'
  | 'none'

/** What the admin can pick, in the order it should be offered. */
export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'juice', label: 'Juice' },
  { value: 'bank', label: 'Bank' },
  { value: 'already_paid', label: 'Pre-paid' },
  { value: 'none', label: 'None' },
]

/**
 * Stored data is not uniform. The live rows use 'cash', 'juice', 'none' and a
 * single legacy 'paid', while the code elsewhere also emits 'already_paid' and
 * 'juice_to_rider'. Canonicalising on read means the dropdown shows the right
 * option instead of falling through to raw text, without rewriting old rows.
 */
export function canonicalMethod(raw: string | null | undefined): PaymentMethod | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (v === 'paid' || v === 'already_paid' || v === 'prepaid' || v === 'pre-paid') return 'already_paid'
  // Juice handed straight to the rider is still juice money.
  if (v === 'juice' || v === 'juice_to_rider') return 'juice'
  if (v === 'cash') return 'cash'
  if (v === 'bank') return 'bank'
  if (v === 'none') return 'none'
  return null
}

/** Display label for any stored value, including ones we do not recognise. */
export function methodLabel(raw: string | null | undefined): string {
  const c = canonicalMethod(raw)
  if (c) return PAYMENT_METHOD_OPTIONS.find(o => o.value === c)!.label
  // 'juice_to_rider' canonicalises to juice above; anything genuinely unknown
  // is shown as-is rather than hidden behind a wrong label.
  return raw?.trim() ? raw : '-'
}

export interface PaymentSplit {
  payment_juice: number
  payment_cash: number
  payment_bank: number
  payment_status: string
}

/**
 * Move the whole order value into the column the new method implies.
 *
 * `amount` is passed through rather than clamped. Refunds legitimately store a
 * NEGATIVE amount (a trade-down pays the client out), so forcing a floor of 0
 * here would quietly turn a payout into nothing.
 */
export function splitForMethod(method: PaymentMethod, amount: number): PaymentSplit {
  const amt = Number.isFinite(amount) ? Number(amount) : 0

  switch (method) {
    case 'juice':
      return { payment_juice: amt, payment_cash: 0, payment_bank: 0, payment_status: settled(amt) }
    case 'cash':
      return { payment_juice: 0, payment_cash: amt, payment_bank: 0, payment_status: settled(amt) }
    case 'bank':
      return { payment_juice: 0, payment_cash: 0, payment_bank: amt, payment_status: settled(amt) }
    case 'already_paid':
      // Pre-paid money was collected before delivery, so the contractor is not
      // carrying it. Leaving a figure in any of the three columns would put the
      // order back into a collection screen for cash nobody is holding.
      return { payment_juice: 0, payment_cash: 0, payment_bank: 0, payment_status: 'paid' }
    case 'none':
      return { payment_juice: 0, payment_cash: 0, payment_bank: 0, payment_status: 'unpaid' }
  }
}

/**
 * Mirrors the rule collections-overview already applies when an admin edits a
 * split by hand: the full amount is now sitting in one column, so the order is
 * paid when there was something to pay. Deliberately NOT reinvented here - two
 * different definitions of "paid" across two screens is its own bug.
 */
function settled(amt: number): string {
  return amt > 0 ? 'paid' : 'unpaid'
}

/**
 * The key the Payment Confirmation page groups transfers by. Kept here so the
 * lock check and the confirmation page cannot drift apart - a mismatch would
 * silently stop the lock from ever matching.
 */
export function transferKeyFor(
  contractorId: string | null | undefined,
  transferredAt: string,
): string {
  return `${contractorId ?? 'none'}|${transferredAt}`
}
