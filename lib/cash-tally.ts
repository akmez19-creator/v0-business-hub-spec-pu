/**
 * Splitting a contractor's cash round into sales, refunds paid out, and the net
 * he actually hands in.
 *
 * Contractors pay refunds out of the day's cash takings, so a refund row carries
 * a NEGATIVE `payment_cash`. Summing only the positives asks a contractor to
 * hand in money he no longer holds - KUNAL's sheet read Rs 7,699 when he was
 * physically carrying Rs 7,124.
 *
 * Both figures are shown separately rather than netted into one, because a
 * contractor being asked for a number needs to see WHY it dropped.
 */

export interface CashRow {
  payment_cash?: number | string | null
}

export interface CashTally {
  /** Cash taken from clients. Always >= 0. */
  sales: number
  /** Cash handed back to clients, as a POSITIVE figure for display. */
  paidOut: number
  /** sales - paidOut: what should physically be in his hands. May be negative. */
  net: number
  /** True when refunds exceeded takings, so the store owes the contractor. */
  storeOwes: boolean
  salesCount: number
  paidOutCount: number
}

export function tallyCash(rows: readonly CashRow[]): CashTally {
  let sales = 0
  let paidOut = 0
  let salesCount = 0
  let paidOutCount = 0

  for (const r of rows) {
    const cash = Number(r.payment_cash || 0)
    if (cash > 0) {
      sales += cash
      salesCount++
    } else if (cash < 0) {
      // Held as a positive so the UI can render "- Rs 575" without double negatives.
      paidOut += -cash
      paidOutCount++
    }
    // Exactly zero means the order was settled some other way; it is not a
    // cash event at all and must not inflate either count.
  }

  const net = sales - paidOut
  return { sales, paidOut, net, storeOwes: net < 0, salesCount, paidOutCount }
}
