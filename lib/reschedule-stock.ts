/**
 * WHERE THE GOODS PHYSICALLY ARE while an order waits for its new day.
 *
 * A reschedule leaves the stock in one of exactly two places, and the database
 * already says which. `deliveries.reschedule_stock_mode` carries the owner's
 * own words (read off the live column comment, 26 Aug 2026):
 *
 *   reissue   = came back to store, re-issue on the new day
 *               (default, returns unchanged)
 *   from_van  = rider kept it overnight
 *
 * NOTHING IN THE APP READ THAT COLUMN. It was written once - Nawfal's Make Up
 * Pen, 59845727 - and then ignored, so the pen was counted as store stock the
 * storekeeper had to find while it was actually riding around on JEFFREY's van.
 * This module is the single place that interprets the column, so the
 * storekeeper and rider screens cannot drift apart again.
 *
 * NULL MEANS `reissue`, not "unknown". That is the documented default and it is
 * what the other 482 rows rely on: they came back to the store the ordinary
 * way, and their behaviour must not change.
 */

import { returnMergeKey, pickDisplayLabel } from '@/lib/returns-merge'

/** `reissue` came back to the store. `from_van` never left the rider. */
export type RescheduleStockMode = 'reissue' | 'from_van'

export interface RescheduleStockRow {
  status?: string | null
  delivery_date?: string | null
  rescheduled_to?: string | null
  reschedule_stock_mode?: string | null
  stock_out?: boolean | null
  stock_out_at?: string | null
  /** Set once a storekeeper confirmed AT THE SHELF that goods never returned. */
  van_confirmed_by?: string | null
  /** TRUE once a storekeeper counted these goods back IN at the shelf. */
  stock_verified?: boolean | null
}

/**
 * Did a storekeeper standing at the shelf confirm these goods never came back?
 *
 * This is the ONLY trustworthy statement that stock is not in the building,
 * because he is the only person who can actually look. `reschedule_stock_mode`
 * is an agent's advisory tick made hours earlier and set on 1 of 66 rescheduled
 * rows - see `staysOnVan` for why that cannot be treated as a verdict.
 */
export function vanConfirmed(row: RescheduleStockRow): boolean {
  return !!row.van_confirmed_by
}

/**
 * Was this order actually moved to a different day?
 *
 * `rescheduled_to` is sometimes set to the SAME value as `delivery_date` (a
 * reschedule that was undone, or one entered onto the current day). That is not
 * a move, and treating it as one would drag ordinary same-day orders into the
 * re-issue path.
 */
export function isRescheduled(row: RescheduleStockRow): boolean {
  const to = row.rescheduled_to
  return !!to && to !== row.delivery_date
}

/**
 * Which of the two places the goods are sitting.
 *
 * Answers `reissue` for orders that were never rescheduled too, which is
 * correct and deliberate: an ordinary order is issued from the store.
 */
export function rescheduleStockMode(row: RescheduleStockRow): RescheduleStockMode {
  return row.reschedule_stock_mode === 'from_van' ? 'from_van' : 'reissue'
}

/**
 * Is there any indication the rider kept these goods overnight?
 *
 * TRUE for an agent's advisory tick OR a storekeeper's shelf confirmation, so
 * the rider's own screen reflects either. Use `vanConfirmed()` when the answer
 * has to be RELIABLE.
 *
 * WHY THIS IS NOT A VERDICT. Of 66 rescheduled orders exactly one carries an
 * explicit mode: 38 went through the reschedule dialog and recorded nothing,
 * and 28 were moved by day-closure, which never asks. JEFFREY had four
 * identical rows on 24 Aug - same rider, same evening, same 'cms' status, same
 * 'sale' type, three moving to the same day - and only Nawfal's pen carried the
 * flag. So its ABSENCE proves nothing at all, and this must never be used to
 * remove the storekeeper's ability to count something that is on his shelf.
 */
export function staysOnVan(row: RescheduleStockRow): boolean {
  if (vanConfirmed(row)) return true
  if (isRescheduled(row) && rescheduleStockMode(row) === 'from_van') return true

  // OWNER'S RULE: when a rescheduled order's goods ALREADY WENT OUT, the rider
  // simply keeps them for the next attempt. That is the normal case, not the
  // exception.
  //
  // The old code inferred the opposite from an absent flag, and the flag is
  // absent almost always: of the 28 rescheduled rows whose goods physically
  // went out, exactly ONE is marked `from_van`, because the reschedule dialog
  // never asks and day-closure never asks. So 27 rows claimed the goods were
  // back in the store and needed re-issuing, when the rider had them all along.
  //
  // `stock_verified` is the counter-evidence and it OUTRANKS this inference: if
  // a storekeeper actually counted the item back in at the shelf, it really is
  // in the building and must be re-issued from there.
  //
  // Safe against the warning above - this does NOT cost the storekeeper his
  // count. Stock In lists returns off `delivery_date` + status 'cms' and no
  // longer hides `from_van` rows, so the goods stay countable on his screen
  // either way; only the re-issue instruction on the NEW day changes.
  if (isRescheduled(row) && row.stock_out === true && row.stock_verified !== true) {
    return true
  }

  return false
}

/**
 * Statuses that record how the PREVIOUS attempt ended.
 *
 * A reschedule deliberately does NOT reset `status` - it cannot, because
 * `incomingToStore()` only returns the CMS leg while status is exactly 'cms',
 * so clearing it would erase the original day's returns from the storekeeper's
 * screen. The cost is that on the NEW day the row still reads 'cms', which is
 * the outcome of a day that is over.
 */
const SPENT_ATTEMPT = new Set(['cms', 'nwd'])

/**
 * Is this order waiting to be attempted again?
 *
 * TRUE for a rescheduled row whose status is a spent attempt. Those 32 live
 * rows are real work: the client was missed or refused on the old day and the
 * order was moved forward, so today it is outstanding - not finished.
 *
 * The rider's stock screen was reading the bare status and struck these
 * through as done with "0 remaining", which is how JEFFREY's Make Up Pen,
 * Mirror Film and Grinding Head looked complete on a day he still had to
 * deliver them.
 */
export function isPendingReattempt(row: RescheduleStockRow): boolean {
  return isRescheduled(row) && SPENT_ATTEMPT.has((row.status || '').toLowerCase())
}

/**
 * Must the storekeeper hand these goods over again on the new day?
 *
 * Only when the stock actually came back to him. A `from_van` order is already
 * with the rider, so re-issuing it would push a second unit out of the store
 * for a single sale.
 */
export function needsReissue(row: RescheduleStockRow): boolean {
  return isPendingReattempt(row) && !staysOnVan(row)
}

/**
 * Is the `stock_out` flag STALE - set for an attempt that is already over?
 *
 * `stock_out` is one undated boolean per row, so it cannot distinguish "issued
 * for today" from "issued for the attempt that failed last week". Nawfal's pen
 * carries `stock_out = true` with `stock_out_at` of 23 Aug against an active
 * date of 26 Aug: the flag is about a van load that has since come back.
 *
 * `stock_out_at` is compared as a DATE PREFIX. It is a timestamptz stored in
 * UTC while `active_date` is a Mauritius business date, so the two are only
 * safely comparable at day granularity, and a UTC timestamp early in the
 * morning belongs to the previous UTC day - which is why this treats "same
 * string or later" as fresh rather than doing arithmetic on it.
 */
export function hasStaleStockOut(row: RescheduleStockRow, activeDate: string): boolean {
  if (!row.stock_out) return false
  if (!isRescheduled(row)) return false
  const at = (row.stock_out_at || '').slice(0, 10)
  // No timestamp at all: the flag predates dated tracking, so it cannot be
  // trusted to describe today.
  if (!at) return true
  return at < activeDate
}

/**
 * Does the storekeeper still owe the rider these goods today?
 *
 * Used to decide whether a re-issue belongs on the stock-out list. A row whose
 * `stock_out` flag is stale is NOT issued for today, no matter what the boolean
 * says.
 */
export function awaitingIssue(row: RescheduleStockRow, activeDate: string): boolean {
  if (!needsReissue(row)) return false
  return !row.stock_out || hasStaleStockOut(row, activeDate)
}

/**
 * One line per product for the rider's "rescheduled stock" panel.
 *
 * Merged with the SAME `returnMergeKey` the storekeeper's pile view uses, so
 * "1x Make Up Pen" and "Make Up Pen - Set of 3" collapse identically on both
 * screens. Keeping a private copy of that rule is how these views drifted apart
 * before.
 */
export interface ReschedulePile {
  key: string
  /** A spelling that exists verbatim in the data - never invented. */
  label: string
  qty: number
  /** Clients waiting on this product, so the rider can say who it is for. */
  customers: string[]
  /** The original day(s) the goods first went out on, oldest first. */
  fromDates: string[]
  orderCount: number
}

export interface ReschedulePileRow {
  product?: string | null
  qty?: number | null
  customerName?: string | null
  deliveryDate?: string | null
}

/** Merge rows into one pile per product. */
export function buildReschedulePiles(rows: ReschedulePileRow[]): ReschedulePile[] {
  const piles = new Map<string, {
    labels: string[]; qty: number; customers: string[]; dates: string[]; n: number
  }>()

  for (const r of rows) {
    const key = returnMergeKey(r.product)
    if (!key) continue
    if (!piles.has(key)) piles.set(key, { labels: [], qty: 0, customers: [], dates: [], n: 0 })
    const p = piles.get(key)!
    p.labels.push((r.product || '').trim())
    // Floor at 1, matching `incomingToStore()`: a row that exists represents at
    // least one physical item.
    p.qty += Math.max(1, Number(r.qty) || 0)
    if (r.customerName) p.customers.push(r.customerName.trim())
    if (r.deliveryDate) p.dates.push(r.deliveryDate)
    p.n += 1
  }

  return [...piles.entries()]
    .map(([key, p]) => ({
      key,
      label: pickDisplayLabel(p.labels),
      qty: p.qty,
      customers: [...new Set(p.customers)],
      fromDates: [...new Set(p.dates)].sort(),
      orderCount: p.n,
    }))
    // Oldest original day first: stock that has been waiting longest is the
    // most urgent, so it must not be buried under today's reschedules.
    .sort((a, b) => {
      const ao = a.fromDates[0] || ''
      const bo = b.fromDates[0] || ''
      if (ao !== bo) return ao.localeCompare(bo)
      if (b.qty !== a.qty) return b.qty - a.qty
      return a.label.localeCompare(b.label)
    })
}

/** `2026-08-24` -> `24 Aug`. Empty string in, empty string out. */
export function shortDay(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
