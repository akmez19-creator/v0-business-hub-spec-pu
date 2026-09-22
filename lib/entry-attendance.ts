/**
 * Attendance on top of Entry Activity.
 *
 * The order rows say when an agent TYPED an order. Since 17 Sep the inbox also
 * leaves footprints - a reply sent, a lead opened, a star, an order edit - so a
 * morning spent answering customers without closing a sale is no longer
 * invisible. Both feed one timeline per agent-day; this module is the pure
 * arithmetic over that timeline and has no IO, so the screen and a script get
 * the same numbers.
 */

export type FootprintKind = 'order' | 'inbox_reply' | 'inbox_open' | 'inbox_star' | 'order_change'

export interface Footprint {
  /** Raw instant, ISO. */
  at: string
  /** Minutes past Mauritius midnight. */
  min: number
  kind: FootprintKind
  /** Order footprints span a visit; inbox footprints are points. */
  endAt?: string
  endMin?: number
}

export interface Shift {
  label: string
  /** Minutes past midnight. */
  startMin: number
  endMin: number
  /** Minutes of grace before a start counts as late. */
  graceMin: number
  /** 0 = Sunday. Days the shift is expected. */
  workdays: number[]
}

/** Owner (16 Sep): Hanaa and Taysir work 08:00-16:30. Applied to every marketing agent. */
export const MARKETING_SHIFT: Shift = {
  label: '08:00-16:30',
  startMin: 8 * 60,
  endMin: 16 * 60 + 30,
  graceMin: 5,
  workdays: [1, 2, 3, 4, 5, 6],
}

export function shiftForRole(role: string): Shift | null {
  return role === 'marketing_agent' ? MARKETING_SHIFT : null
}

export interface ActivityCounts {
  replies: number
  opens: number
  stars: number
  orderChanges: number
}

export const EMPTY_ACTIVITY: ActivityCounts = { replies: 0, opens: 0, stars: 0, orderChanges: 0 }

export function countActivity(points: Footprint[]): ActivityCounts {
  const c = { ...EMPTY_ACTIVITY }
  for (const p of points) {
    if (p.kind === 'inbox_reply') c.replies++
    else if (p.kind === 'inbox_open') c.opens++
    else if (p.kind === 'inbox_star') c.stars++
    else if (p.kind === 'order_change') c.orderChanges++
  }
  return c
}

export function addActivity(a: ActivityCounts, b: ActivityCounts): ActivityCounts {
  return { replies: a.replies + b.replies, opens: a.opens + b.opens, stars: a.stars + b.stars, orderChanges: a.orderChanges + b.orderChanges }
}

export interface DayAttendance {
  /** Minutes after shift start + grace that the first footprint landed. 0 = on time. */
  lateMinutes: number
  /** Minutes before shift end that the last footprint landed. null while the day is still running. */
  earlyLeaveMinutes: number | null
  /** The day is a scheduled workday for this shift. */
  scheduled: boolean
}

/**
 * Lateness and early leave for one day, from the first/last footprint of ANY
 * kind. `isToday` suppresses the early-leave figure: the day is not over.
 * A start before the shift is never negative lateness - being early is 0.
 */
export function dayAttendance(shift: Shift, weekday: number, firstMin: number, lastMin: number, isToday: boolean): DayAttendance {
  const scheduled = shift.workdays.includes(weekday)
  const lateMinutes = Math.max(0, firstMin - (shift.startMin + shift.graceMin))
  const earlyLeaveMinutes = isToday ? null : Math.max(0, shift.endMin - lastMin)
  return { lateMinutes, earlyLeaveMinutes, scheduled }
}

export interface GapSpan {
  startMin: number
  minutes: number
}

/**
 * Quiet stretches between footprints of any kind. Order visits are intervals,
 * inbox events are points; a gap runs from the running "latest end so far" to
 * the next start, so overlapping visits never produce a phantom gap.
 */
export function footprintGaps(points: Footprint[], minTracked: number): GapSpan[] {
  const sorted = points.slice().sort((a, b) => a.at.localeCompare(b.at))
  const gaps: GapSpan[] = []
  let endAt: number | null = null
  let endMin = 0
  for (const p of sorted) {
    const start = Date.parse(p.at)
    if (endAt !== null) {
      const minutes = Math.round((start - endAt) / 60000)
      if (minutes >= minTracked) gaps.push({ startMin: endMin, minutes: Math.min(minutes, 1440 - endMin) })
    }
    const pEnd = Date.parse(p.endAt ?? p.at)
    if (endAt === null || pEnd > endAt) {
      endAt = pEnd
      endMin = p.endMin ?? p.min
    }
  }
  return gaps
}

export interface AttendanceSummary {
  shift: Shift
  /** Scheduled workdays in the month that are already over (or today if any footprint). */
  scheduledDays: number
  /** Scheduled days with at least one footprint. */
  presentDays: number
  /** Scheduled past days with no footprint at all - listed so the reader can check against leave. */
  missingDays: string[]
  onTimeDays: number
  lateDays: number
  lateMinutesTotal: number
  /** Worst single start. */
  latestStart: { date: string; time: string; lateMinutes: number } | null
  earlyDays: number
  earlyMinutesTotal: number
  /** Sum over scheduled present days of minutes inside the shift window that had a footprint bracket. */
  averageStart: string | null
  averageEnd: string | null
}
