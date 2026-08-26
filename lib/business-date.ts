/**
 * WHICH DAY DOES A WAREHOUSE SCREEN OPEN ON?
 *
 * Not `dates[0]` (= max date). A day can EXIST with nothing to do on it: on
 * 26 Aug all five return rows are still `assigned`, so nothing has physically
 * come back and the screen renders zero countable rows while 120 real returns
 * sit unticked on 24 Aug.
 *
 * Rule: an explicit choice always wins; otherwise the most recent day that
 * actually HAS work; otherwise the most recent day at all.
 */

/**
 * TODAY, IN MAURITIUS. Use this for every "what is happening today" query.
 *
 * `new Date().toISOString().split('T')[0]` is the UTC date, and the server runs
 * in UTC while the business runs in Mauritius (UTC+4). Every day between
 * 00:00 and 04:00 local time those two disagree, so a screen asking for
 * "today" was handed YESTERDAY and showed an empty or stale round - measured
 * live at 02:41 MU on 26 Aug, which UTC still called the 25th.
 *
 * Every `delivery_date` / `rescheduled_to` in the database is a Mauritius
 * business date, so it must be compared against a Mauritius date.
 *
 * `en-CA` is what makes this safe: it formats as YYYY-MM-DD, the same shape a
 * Postgres `date` renders as, so the string compares directly. Do NOT swap it
 * for another locale.
 */
export function muToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' })
}

export const MAURITIUS_TZ = 'Indian/Mauritius'

/**
 * Today in Mauritius, with an injectable clock.
 *
 * Same value as `muToday()`, kept as a separate export because screens that
 * derive a whole date range (placement, stock validation) need to pass a fixed
 * `now` so every date in one render comes from the SAME instant. Computing
 * `muToday()` twice either side of midnight yields two different days.
 */
export function todayInMauritius(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MAURITIUS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * The calendar day before `today`, in Mauritius.
 *
 * Shifts the already-localised `YYYY-MM-DD` instead of subtracting 24h from a
 * UTC instant, so it cannot slip a day during the UTC+4 evening window.
 */
export function yesterdayInMauritius(today: string = todayInMauritius()): string {
  const d = new Date(today + 'T12:00:00Z') // midday avoids any rounding edge
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The most recent date carrying work, else the most recent date.
 *
 * TWO CALLING SHAPES, both live, deliberately kept:
 *   pickActiveDate(dates, hasWork, explicit?)  - chevron screens (stock-in,
 *       stock-out): "explicit wins, else newest day with work".
 *   pickActiveDate(dates, today?)              - summary screens
 *       (stock-validation): "today if it has work, else newest day on or
 *       before today".
 * These are NOT interchangeable: the second argument is a callback in one and a
 * date string in the other, so collapsing them would silently pass a string
 * where a predicate is expected and quietly return the wrong day.
 */
export function pickActiveDate(
  dates: string[],
  hasWork: (date: string) => boolean,
  explicit?: string | null,
): string
export function pickActiveDate(dates: string[], today?: string): string
export function pickActiveDate(
  dates: string[],
  second?: ((date: string) => boolean) | string,
  explicit?: string | null,
): string {
  const sorted = [...new Set(dates.filter(Boolean))].sort().reverse()

  // Date-string form: prefer today, else the last round already worked.
  if (typeof second !== 'function') {
    const today = second ?? muToday()
    if (!sorted.length) return today
    if (sorted.includes(today)) return today
    return sorted.find((d) => d <= today) ?? sorted[sorted.length - 1] ?? today
  }

  // Predicate form. An explicit pick is honoured even when empty - the person
  // asked for it, and silently redirecting makes the date chevrons feel broken.
  if (explicit) return explicit
  if (!sorted.length) return muToday()

  return sorted.find(second) ?? sorted[0]
}

/** Step to the next/previous date that has work, so chevrons skip dead days. */
export function stepToDateWithWork(
  dates: string[],
  current: string,
  direction: 1 | -1,
  hasWork: (date: string) => boolean,
): string | null {
  const sorted = [...new Set(dates.filter(Boolean))].sort().reverse()
  const idx = sorted.indexOf(current)
  if (idx === -1) return null
  for (let i = idx + direction; i >= 0 && i < sorted.length; i += direction) {
    if (hasWork(sorted[i])) return sorted[i]
  }
  return null
}
