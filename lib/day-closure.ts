/**
 * Shared vocabulary for closing a delivery day.
 *
 * Split out of day-closure-actions.ts because a 'use server' module may only
 * export async functions - a plain const there is a build error, and the
 * dialog needs these on the client.
 */

/**
 * Statuses that MOVE when a day is closed.
 *
 * `cancelled` is deliberately absent: a cancelled order is dead, and carrying
 * it forward would resurrect it as tomorrow's work. `delivered` and `cms` are
 * absent in reverse - they already happened, and a day that "did not run"
 * cannot retroactively un-deliver them.
 */
export const MOVABLE_STATUSES = ['pending', 'assigned'] as const

/** Whole-day closure reasons. Free text stays available for anything else. */
export const CLOSURE_REASONS = [
  { code: 'cyclone', label: 'Cyclone warning' },
  { code: 'heavy_rain', label: 'Heavy rain / flooding' },
  { code: 'public_holiday', label: 'Public holiday' },
  { code: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { code: 'no_stock', label: 'Stock not ready' },
  { code: 'staff_unavailable', label: 'Staff unavailable' },
  { code: 'other', label: 'Other' },
] as const

export type ClosureReasonCode = (typeof CLOSURE_REASONS)[number]['code']

export type ClosurePreview = {
  ok: boolean
  error?: string
  /** Orders that would move, by status. */
  movable: { pending: number; assigned: number; total: number; units: number }
  /** Rows deliberately LEFT on the day, so the count on screen is honest. */
  staying: { status: string; rows: number }[]
  /** Suggested target - next working day, skipping Sundays and closures. */
  suggested: string
  /** How many orders the suggested day already carries. */
  suggestedExisting: number
  /** Set when the day already has a validated van load. */
  stockWarning: string | null
  alreadyClosed: boolean
}

export type CloseDayInput = {
  date: string
  targetDate: string
  reasonCode: string
  note?: string
  /** Also write the day into the shared closure list. */
  blockNewOrders: boolean
}
