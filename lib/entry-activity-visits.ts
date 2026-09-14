/**
 * CLIENT IDENTITY AND VISIT GROUPING - pure, no server imports.
 *
 * This file exists SEPARATELY from `lib/entry-activity.ts` on purpose.
 * `entry-activity.ts` imports `lib/supabase/server`, which imports
 * `next/headers`, so a client component importing a VALUE from it (rather than a
 * type) crashes at runtime while `tsc` stays perfectly clean. The day drawer has
 * to group rows by client in the browser, so the grouping logic lives here and
 * both sides import the same copy - one definition, so the server totals and the
 * drawer can never disagree.
 *
 * Same split as `lib/shop/format.ts` vs `lib/shop/catalog.ts` in this codebase.
 */

/** A single hand-entered order, reduced to what the overview needs. */
export interface EntryRow {
  id: string
  agentId: string
  /** Mauritius calendar day, YYYY-MM-DD. */
  day: string
  /** Mauritius hour, 0-23. */
  hour: number
  /** Mauritius HH:MM, for the day drawer. */
  time: string
  /** Sort key within a day - the raw instant. */
  at: string
  amount: number
  status: string
  clientName: string
  /** Derived identity - see `clientKeyOf`. Never render this. */
  clientKey: string
  /** As typed, for display next to the name. */
  contact: string
  orderCode: string | null
  medium: string | null
}

/**
 * WHO IS ONE CLIENT - the identity this whole page counts by.
 *
 * `deliveries` has NO `client_id` column (checked all 100+ columns), so identity
 * has to be derived. It must NOT be the name:
 *   - MEASURED on the live month, 9 names cover TWO DIFFERENT PHONES ("ali",
 *     "preety", "ranjit ramtohul", ...). Grouping by name merges two real people
 *     into one client. My notes already record that 762 clients share a full
 *     name, so this only gets worse as the table grows.
 *   - And 8 phones are written under MORE THAN ONE SPELLING
 *     ("gérard baungaléa" / "gérard", "velen" / "velen canoussamy pillay").
 *     Grouping by name splits one real client into several.
 * The phone fixes both directions, and it is available: MEASURED every
 * hand-entered row in the live month carries a usable `contact_1` (929/929 at
 * time of writing), which is why the name is only ever a fallback.
 *
 * Digits only, last 8 kept, so "+230 5251 1213", "230 52511213" and "52511213"
 * are one person - Mauritius numbers are 8 digits and the country code is typed
 * inconsistently by hand.
 */
export function clientKeyOf(contact: unknown, name: unknown): string {
  const digits = String(contact ?? '').replace(/\D/g, '')
  const local = digits.length > 8 ? digits.slice(-8) : digits
  // 7 is the floor for a real local number; anything shorter is a typo or a
  // placeholder, so fall back to the name rather than collapsing every bad
  // phone into one giant "client".
  if (local.length >= 7) return 'p:' + local
  return 'n:' + String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * How long after a client's previous row a new row is still THE SAME visit.
 *
 * MEASURED on the same-client repeat pairs this live month: the MEDIAN GAP IS
 * 0 MINUTES and the great majority land inside this window - i.e. they are one
 * order being typed as several rows (several products), not the client coming
 * back. At 15 minutes, 929 rows collapse to 881 visits (48 rows absorbed).
 *
 * The window must NOT be unbounded. Some repeat pairs are hours apart and those
 * ARE a genuine second order; collapsing a 10:00 and a 15:00 order into one
 * "visit" would also swallow the five-hour quiet gap between them and hide real
 * idle time - the exact thing the shift bars exist to show.
 */
export const SAME_VISIT_MINUTES = 15

/**
 * One CLIENT VISIT - the unit of work this page counts.
 *
 * A visit is one client's consecutive rows within `SAME_VISIT_MINUTES`, so an
 * order typed as four product rows is one visit, while the same client phoning
 * back in the afternoon is a second.
 */
export interface ClientVisit {
  clientKey: string
  clientName: string
  contact: string
  /** Every delivery row that makes up this visit, earliest first. */
  rows: EntryRow[]
  /** Combined value of the visit. */
  amount: number
  startAt: string
  endAt: string
  startTime: string
  endTime: string
  /** Minutes past local midnight of the visit's first row. */
  startMin: number
  endMin: number
}

/** "14:02" -> 842. Local minute-of-day, for positioning on the 24h axis. */
export const minuteOfDay = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/**
 * Collapses a time-ordered list of rows into client visits.
 *
 * ONE definition, used by the agent days, the day cells and the drawer. My own
 * standing rule from this page: when a view gains a new unit, every derived
 * number must pass through the SAME derivation or two parts of the screen will
 * quietly disagree.
 *
 * Rows MUST already be sorted by the raw instant. Merging is only allowed with
 * the IMMEDIATELY PRECEDING visit, so another client in between correctly starts
 * a new visit rather than the two halves being stitched back together.
 */
export function buildVisits(sorted: EntryRow[]): ClientVisit[] {
  const visits: ClientVisit[] = []
  for (const r of sorted) {
    const prev = visits[visits.length - 1]
    const withinWindow =
      prev &&
      prev.clientKey === r.clientKey &&
      (new Date(r.at).getTime() - new Date(prev.endAt).getTime()) / 60000 <= SAME_VISIT_MINUTES
    if (withinWindow) {
      prev.rows.push(r)
      prev.amount += r.amount
      prev.endAt = r.at
      prev.endTime = r.time
      prev.endMin = minuteOfDay(r.time)
      // A later row may carry a fuller spelling of the same phone; prefer the
      // longer one so "gérard" does not label a visit that also says
      // "gérard baungaléa".
      if (r.clientName.length > prev.clientName.length) prev.clientName = r.clientName
      continue
    }
    visits.push({
      clientKey: r.clientKey,
      clientName: r.clientName,
      contact: r.contact,
      rows: [r],
      amount: r.amount,
      startAt: r.at,
      endAt: r.at,
      startTime: r.time,
      endTime: r.time,
      startMin: minuteOfDay(r.time),
      endMin: minuteOfDay(r.time),
    })
  }
  return visits
}
