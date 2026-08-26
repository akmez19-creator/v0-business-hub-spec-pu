/**
 * Trade-in / exchange / refund raised against a DELIVERED order.
 *
 * The three are not variations of one form - they differ in exactly one thing,
 * how the item coming back is valued, and that is what this module encodes.
 * The rules below were read off the live rows, not assumed:
 *
 *   exchange (42 rows)  - every single one is amount 0. A swap is a swap; if
 *                         money moves it was never an exchange.
 *   trade_in (21 rows)  - credit is WHAT THE CLIENT PAID for the item coming
 *                         back, read off the original order. Not typed.
 *   refund   (22 rows)  - always stored NEGATIVE, and delivery_contribution()
 *                         now relies on that sign. 7 of the 9 traceable ones
 *                         return the full paid sum, but 2 were deliberately
 *                         partial - so it is pre-filled, not fixed.
 *
 * A CORRECTION LIVES HERE. This file used to claim the trade-in allowance was
 * negotiated, citing "wildly different allowances: Juicer Blender 100,
 * Electric Grinder 675, Oil Film Remover 600". Those three numbers are the
 * `amount` column - the SETTLEMENT paid at the door - not the allowance. The
 * credit was never stored on those rows at all. A settlement of 100 on a swap
 * is what you get when the credit exactly cancels most of the outgoing price,
 * which is the derived rule, not evidence against it.
 *
 * Be careful re-deriving any rule from those 21 legacy rows: 19 of 21 have a
 * NULL `return_product` (the returned item survives only in free-text notes
 * like "IN: Juicer Blender") and NONE has a `source_delivery_id`. They cannot
 * confirm this rule either - they simply cannot refute it. The rule is the
 * business rule the owner stated; the legacy rows are consistent with it
 * (13 of 21 settle at exactly 0, which is an equal-value swap).
 */

export const FOLLOW_UP_KINDS = ['exchange', 'trade_in', 'refund'] as const
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

export const FOLLOW_UP_LABELS: Record<FollowUpKind, string> = {
  exchange: 'Exchange',
  trade_in: 'Trade-in',
  refund: 'Refund',
}

export const FOLLOW_UP_HELP: Record<FollowUpKind, string> = {
  exchange:
    'Faulty or wrong item swapped for the same thing. No money changes hands.',
  trade_in:
    'Client hands back an item and takes something else, paying the difference. The old item is credited at what they paid for it.',
  refund: 'Item comes back and the client gets their money. Nothing goes out.',
}

/**
 * True when a stored sales_type is a follow-up on an earlier order, so its
 * money is a settlement rather than a plain sale. Deliberately excludes
 * `drop_off`, which is an ordinary outgoing sale with a different handover.
 */
export function isFollowUpType(value: string | null | undefined): value is FollowUpKind {
  return FOLLOW_UP_KINDS.includes(String(value || '') as FollowUpKind)
}

/** True when the kind sends a replacement product out to the client. */
export function sendsProductOut(kind: FollowUpKind): boolean {
  return kind !== 'refund'
}

/**
 * The kinds an admin may convert an existing follow-up between.
 *
 * All three are raised against a delivered order and take an item back, so any
 * of them can be picked wrongly and need correcting. A normal sale is
 * deliberately absent: it has no return leg, so converting to it would drop the
 * item coming back.
 *
 * Lives here rather than beside the server action because a 'use server' module
 * may only export async functions.
 */
export const CONVERTIBLE_KINDS: FollowUpKind[] = ['refund', 'exchange', 'trade_in']

export const KIND_LABEL: Record<string, string> = {
  refund: 'Refund',
  exchange: 'Exchange',
  trade_in: 'Trade-in',
}

/**
 * What ONE unit of the original order actually cost the client.
 *
 * Pro-rating matters: 432 delivered orders have qty > 1 and `amount` is the
 * line total, so refunding one of three at the full order value would pay out
 * triple.
 */
export function unitPaid(orderAmount: number | null, orderQty: number | null): number {
  const amount = Number(orderAmount ?? 0)
  const qty = Math.max(1, Number(orderQty ?? 1))
  return amount / qty
}

export interface SettlementInput {
  kind: FollowUpKind
  /** Line total the client originally paid. */
  orderAmount: number | null
  /** Units on the original order. */
  orderQty: number | null
  /** Units of the original coming back. */
  returnQty: number
  /** Catalogue value of the replacement going out. Ignored for a refund. */
  outValue: number
  /**
   * REFUND ONLY: how much of the paid amount is being given back. Defaults to
   * all of it; 2 of the 9 traceable refunds were partial, so it stays settable.
   * Ignored by exchange and trade-in, which both derive their credit from what
   * the client originally paid.
   */
  allowance: number
}

export interface Settlement {
  /** Value credited to the client for the goods coming back. */
  credit: number
  /** Value of what goes out. Always 0 for a refund. */
  outValue: number
  /** Signed money at the door: >0 client pays us, <0 we pay the client. */
  amount: number
  /** Plain direction, so no caller has to interpret the sign itself. */
  direction: 'collect' | 'payout' | 'nothing'
  /** What the client paid for the units being returned. */
  paidBack: number
}

/**
 * The single source of truth for the money. The server recomputes this and
 * ignores whatever the browser posted, so a tampered or stale form cannot
 * decide what a rider collects at the door.
 */
export function settle(input: SettlementInput): Settlement {
  const { kind } = input
  const returnQty = Math.max(1, Math.floor(Number(input.returnQty) || 1))
  const paidBack = round2(unitPaid(input.orderAmount, input.orderQty) * returnQty)

  let credit: number
  let outValue: number

  if (kind === 'exchange') {
    // Settled at whatever they already paid, whatever the catalogue says
    // today - otherwise a price rise since the sale would bill the client for
    // our own faulty goods. This is why all 42 existing exchanges are zero.
    credit = paidBack
    outValue = paidBack
  } else if (kind === 'trade_in') {
    // Derived, never typed. What the item coming back is worth to the client
    // is what the client paid us for it - `allowance` is deliberately ignored
    // here so a stale or hand-edited form cannot invent a different figure.
    // The settlement can legitimately land negative when they trade down; that
    // is a real payout, so it is not clamped.
    credit = paidBack
    outValue = Math.max(0, Number(input.outValue) || 0)
  } else {
    // Refund: nothing goes out, and the payout can never exceed what was paid.
    credit = Math.min(Math.max(0, Number(input.allowance) || 0), paidBack)
    outValue = 0
  }

  const amount = round2(outValue - credit)
  return {
    credit: round2(credit),
    outValue: round2(outValue),
    amount,
    direction: amount > 0 ? 'collect' : amount < 0 ? 'payout' : 'nothing',
    paidBack,
  }
}

/** Money here is whole rupees in practice, but never trust float drift. */
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

/**
 * The outgoing item written in the same wire format the rest of the system
 * already speaks: "Name - Variant - B1G1 x2".
 *
 * This is not cosmetic. 959 delivered rows carry a " - variant" suffix and 724
 * carry "B1G1", and parseOrderLines() reads that text back to work out what a
 * rider actually puts in the box. A follow-up that stored only a bare product
 * name would hand over the wrong colour, or drop the free unit.
 */
export function composeOutLine(opts: {
  productName: string
  variantValue?: string | null
  isB1g1?: boolean | null
  qty: number
}): string {
  let name = opts.productName.trim()
  if (opts.variantValue) name += ` - ${opts.variantValue}`
  if (opts.isB1g1) name += ' - B1G1'
  return opts.qty > 1 ? `${name} x${opts.qty}` : name
}

/**
 * What comes back, with its count. The return count cannot live in the `qty`
 * column because that column describes what the rider CARRIES OUT, so on a
 * trade-in the two are different numbers.
 */
export function composeReturnLine(productText: string, returnQty: number): string {
  const base = (productText || '').trim() || 'Item from original order'
  return returnQty > 1 ? `${base} x${returnQty}` : base
}
