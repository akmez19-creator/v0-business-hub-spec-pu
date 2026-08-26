/**
 * Rescheduling a delivery WITHOUT moving `delivery_date`.
 *
 * `delivery_date` is the day the van physically carried the goods. 225
 * `contractor_daily_stock` rows, cash collection, stock validation and the
 * storekeeper's Stock In page all key off it, so moving it makes real returns
 * disappear from the day the goods are actually sitting in the warehouse.
 *
 * `rescheduled_to` holds the new day instead, and the generated column
 * `active_date = coalesce(rescheduled_to, delivery_date)` is what
 * forward-looking screens read. History keeps reading `delivery_date`.
 *
 * Plain constants live here rather than in the `'use server'` file, which may
 * only export async functions.
 */

/** Why a delivery moved to another day. */
export const RESCHEDULE_REASONS = [
  { code: 'customer_request', label: 'Customer asked for another day' },
  { code: 'customer_absent', label: 'Nobody home' },
  { code: 'customer_unreachable', label: 'Could not reach customer' },
  { code: 'address_issue', label: 'Address wrong / not found' },
  { code: 'no_cash', label: 'Customer had no money ready' },
  { code: 'out_of_time', label: 'Ran out of time on the round' },
  { code: 'vehicle_issue', label: 'Vehicle problem' },
  { code: 'weather', label: 'Weather' },
  { code: 'other', label: 'Other' },
] as const

export type RescheduleReasonCode = (typeof RESCHEDULE_REASONS)[number]['code']

/**
 * Where the goods come from on the re-attempt day.
 *
 * `reissue` is the default so the RETURNS BEHAVIOUR IS UNCHANGED: the unit came
 * back to the store on the original day and shows in that day's Stock In
 * exactly as it does now, then gets issued again for the new day.
 *
 * `from_van` is the explicit exception - the rider kept it overnight. It reuses
 * the existing `replacement_from_van` flag so `outgoingQty()` returns 0 and the
 * new day's validated load is not double-counted into a phantom shortage. It
 * must ALSO be excluded from the original day's returns, or the storekeeper is
 * told to expect a pile that was never handed back.
 */
export const STOCK_MODES = [
  {
    code: 'reissue',
    label: 'Came back to the store',
    hint: 'Counted in on the original day as normal, then issued again for the new day.',
  },
  {
    code: 'from_van',
    label: 'Rider kept it on the van',
    hint: 'Not expected back at the store, and not re-issued - it is already loaded.',
  },
] as const

export type StockMode = (typeof STOCK_MODES)[number]['code']

/** Statuses a reschedule can act on. Delivered and cancelled work is finished. */
export const RESCHEDULABLE_STATUSES = ['pending', 'assigned', 'cms', 'nwd'] as const

export function reasonLabel(code: string): string {
  return RESCHEDULE_REASONS.find(r => r.code === code)?.label || code
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Formats `2026-08-26` as `26 Aug 2026`.
 *
 * NOT cosmetic. The `cms_postponed_date()` DB function and the admin CMS page
 * both parse the postponed day back out of the note text with a `DD Mon YYYY`
 * pattern. Verified live: `'Postponed to 2026-08-26'` parses to NULL, while
 * `'Postponed to 26 Aug 2026'` parses correctly, and all 31 pre-existing rows
 * use the long form. Writing ISO here would silently produce notes that the
 * existing readers cannot understand.
 */
export function formatPostponeDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export type ReschedulePreview = {
  ok: boolean
  error?: string
  deliveryDate: string | null
  currentActive: string | null
  suggested: string
  /** How many orders the suggested day already carries. */
  suggestedExisting: number
  status: string | null
  customer: string | null
  /** A rider proposal waiting on an agent, if any. */
  requested: string | null
  alreadyRescheduled: string | null
}
