/**
 * When may a new item ride with an order that is already open on the same
 * phone (one drop, one rider, one total)?
 *
 * Only when that order is still AHEAD: its delivery day is today or later in
 * Mauritius. A pending order dated in the past was missed or is being
 * rescheduled; promising "delivered together" on it would be a false promise
 * (Kamla, 15 Sep: pending orders of 4 and 12 Sept offered as the drop for a
 * new 16 Sept order).
 *
 * And only within the same business: MBM and DBM run separate vans and
 * separate totals, so an MBM order is never the drop for a DBM item.
 *
 * Pure; every caller (Quick order panel, AI prompt, order-creation server)
 * must use this one rule so they cannot disagree.
 */
export type RideCandidate = {
  deliveryDate: string | null
  business?: string | null
  parentDeliveryId?: string | null
}

export function normalizeBusiness(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

/**
 * @param today   'YYYY-MM-DD' in Mauritius (see lib/business-date todayInMauritius)
 * @param business the business the new item is for; when unknown the business
 *                 check is skipped and only the date decides.
 */
export function canRideWith(order: RideCandidate, today: string, business?: string | null): boolean {
  const day = order.deliveryDate?.slice(0, 10)
  if (!day || day < today) return false
  const wanted = normalizeBusiness(business)
  if (wanted && normalizeBusiness(order.business) && normalizeBusiness(order.business) !== wanted) return false
  return true
}

/** Orders a new item may ride with, roots first (add-ons all point at one root). */
export function rideableOrders<T extends RideCandidate>(orders: readonly T[] | undefined, today: string, business?: string | null): T[] {
  return (orders ?? []).filter((o) => canRideWith(o, today, business))
}
