import { createAdminClient } from '@/lib/supabase/server'
import { MAURITIUS_TZ, todayInMauritius } from '@/lib/business-date'
// Imported for use INSIDE this file. `export ... from` below only re-exports;
// it does not put the names in local scope.
import { buildVisits, clientKeyOf, minuteOfDay, type EntryRow } from './entry-activity-visits'
import {
  addActivity, countActivity, dayAttendance, EMPTY_ACTIVITY, footprintGaps, shiftForRole,
  type ActivityCounts, type AttendanceSummary, type DayAttendance, type Footprint,
} from './entry-attendance'
import { loadAgentActivity } from './agent-activity'

export { MARKETING_SHIFT, type Shift, type ActivityCounts, type AttendanceSummary, type DayAttendance } from './entry-attendance'

/**
 * ENTRY ACTIVITY - who typed what into the system, and when.
 *
 * This measures AGENT WORK, not sales. That distinction decides every rule
 * below, and it is why the numbers here will never tie back to the finance
 * screens: those count what was sold, this counts what was entered.
 *
 * WHAT COUNTS (measured on the live table, 1186 rows):
 *   - Only rows with `import_batch_id IS NULL`. 337 of 1186 rows arrived by CSV
 *     import and share ONE timestamp - 329 of them stamped 18:56 on 23 Aug.
 *     Those are not a person working at 18:56, they are one paste. Including
 *     them would invent a spike that never happened and credit it to whoever
 *     ran the import. The owner's rule: "as for import or does not have time
 *     does not consider, as it is per agent that enters".
 *   - That leaves 849 genuine hand-entered rows, and their times ARE real:
 *     730 distinct minutes across 849 rows (busiest single minute = 3), and an
 *     hour-of-day curve that looks like a working day (8h-22h, peaking 11-13h
 *     and again at 21h). That is typing, not a batch.
 *
 * WHICH DATE IS THE DAY - `entry_date`, and the distinction is load-bearing:
 *   `entry_date` is a plain date with no time; `created_at` carries the clock.
 *   They agree in UTC on all 849 rows, so I first used `created_at` for both.
 *   MEASURED: in MAURITIUS they disagree on 17 rows. Those 17 were typed at
 *   01:52-01:59 local, and the system stamped them `entry_date` = the PREVIOUS
 *   day - the shop counts a late-night session as still belonging to the day
 *   being worked. Deriving the day from `created_at` moved them to the 24th and
 *   made 23 Aug disappear from the calendar entirely: a whole working day gone.
 *   So the day comes from `entry_date` (the business date, and the field the
 *   owner actually names) and only the TIME comes from `created_at`. The 02:00
 *   entries still show as 02:00, which is true and worth seeing.
 *
 * TIMEZONE IS NOT COSMETIC HERE:
 *   The server is UTC, the shop is Mauritius (UTC+4). Reading the hour straight
 *   off the UTC timestamp shifts every entry back four hours, which moves the
 *   late-evening peak (21h local) into the afternoon and pushes anything
 *   entered before 04:00 local onto the previous day - the exact bug
 *   `lib/business-date.ts` documents for delivery dates. Every day and hour in
 *   this file is derived through `Indian/Mauritius`.
 */

/*
 * Client identity and visit grouping live in `entry-activity-visits.ts`, NOT
 * here, because this file imports `lib/supabase/server` -> `next/headers`. The
 * day drawer is a client component and has to group rows by client in the
 * browser, so importing `buildVisits` from THIS file would crash at runtime
 * while `tsc` stayed clean. Re-exported so existing importers keep working and
 * there is still exactly ONE definition of a visit.
 */
export {
  clientKeyOf,
  buildVisits,
  minuteOfDay,
  SAME_VISIT_MINUTES,
  type EntryRow,
  type ClientVisit,
} from './entry-activity-visits'

/**
 * One worked day for one agent - the shift as the system can see it.
 *
 * `spanMinutes` is first-entry-to-last-entry, which is NOT hours worked and must
 * never be labelled as such. It is a floor on presence: the agent was certainly
 * at the system at both ends. It cannot see a shift that started an hour before
 * the first order or continued after the last one, and it collapses on a thin
 * day - MEASURED: Gunga Akmez's only day is 3 entries inside 14 minutes, and
 * Munsah has a 7-entry day spanning 7 minutes. Reporting those as "worked 0.1h"
 * would be a lie about a person's day, so `thin` marks them and the UI says so.
 */
/**
 * A stretch inside a worked day with NO entries between two consecutive ones.
 *
 * MEASURED before choosing any threshold, because the answer changes the design:
 * across 775 consecutive-entry gaps the MEDIAN IS 4 MINUTES, and gaps of >=10min
 * are 228 of them (29.4%), >=20min 116 (15.0%), >=30min 60 (7.7%). So a
 * ten-minute gap is the NORMAL rhythm of typing orders, not idling - flagging it
 * red would mark ordinary work as a problem about ten times per agent-day. Only
 * >=30min is rare enough to mean "away from the system".
 *
 * Everything >= GAP_MIN_TRACKED is therefore stored and the UI grades it by
 * severity, so the threshold can be changed without a refetch and without the
 * server deciding what counts as bad.
 */
export interface EntryGap {
  /** Minutes past local midnight of the entry BEFORE the gap. */
  startMin: number
  minutes: number
}

/** Smallest gap kept. Below this is indistinguishable from typing rhythm. */
export const GAP_MIN_TRACKED = 10

export interface AgentDay {
  date: string
  /** CLIENTS served - the unit this page counts by. */
  clients: number
  /** Delivery rows typed. Kept as the secondary detail, never the headline. */
  entries: number
  firstTime: string
  lastTime: string
  /** Minutes past local midnight, for positioning a bar on a 24h axis. */
  firstMin: number
  lastMin: number
  spanMinutes: number
  /** Too few clients for the span to describe a shift. */
  thin: boolean
  /** Quiet stretches >= GAP_MIN_TRACKED, in order. */
  gaps: EntryGap[]
  /** Inbox footprints on this day (replies sent, leads opened, stars, order edits). */
  activity: ActivityCounts
  /** Lateness / early leave against the agent's shift; null when no shift applies. */
  attendance: DayAttendance | null
}

export interface AgentSummary {
  id: string
  name: string
  role: string
  /**
   * CLIENTS SERVED - distinct clients per day, summed over the agent's days.
   *
   * This, not the distinct-people count, is the unit of WORK, and it is the one
   * the calendar cells add up to. A client who orders on the 4th and again on
   * the 19th was served twice and cost the agent two conversations; counting
   * them once would credit less work than was done.
   */
  clients: number
  /**
   * Distinct PEOPLE, deduplicated across the whole month.
   *
   * Deliberately a separate field from `clients` so the two can never be shown
   * under one label. CAUTION: these do NOT sum to the month figure either -
   * MEASURED: 28 clients were served by more than one agent (per-agent 861 vs
   * month 833). Both are correct, so the UI states the overlap instead of
   * leaving the reader to assume an arithmetic bug.
   */
  uniqueClients: number
  /** Delivery rows typed - the secondary detail. */
  entries: number
  /** Client visits, i.e. distinct trips to the system. >= clients. */
  visits: number
  revenue: number
  /** Distinct days this agent entered anything. */
  activeDays: number
  /** Busiest single day, counted in CLIENTS. */
  bestDay: number
  firstHour: number | null
  lastHour: number | null
  /** Every worked day, oldest first - the month breakdown. */
  days: AgentDay[]
  /**
   * MEDIAN, not mean, for the typical start and end. Munsah's month contains a
   * 01:52 night session and a 16:20 seven-minute day; averaging those drags his
   * typical start two hours off where he actually shows up, while the median
   * lands on 14:02 and correctly describes an evening shift.
   */
  medianStart: string | null
  medianEnd: string | null
  medianSpanMinutes: number
  /** Sum of daily spans - the closest honest figure to "time at the system". */
  totalSpanMinutes: number
  earliest: { date: string; time: string } | null
  latest: { date: string; time: string } | null
  /** Inbox footprints summed over the month. */
  activity: ActivityCounts
  /** Only for roles with a fixed shift (marketing agents, 08:00-16:30). */
  attendance: AttendanceSummary | null
}

export interface DaySummary {
  date: string
  /** 0 = Sunday, matching Date.getUTCDay(). */
  weekday: number
  /** CLIENTS served on this day - what the calendar cell shows. */
  clients: number
  entries: number
  revenue: number
  /** Per-agent counts for this day, biggest first, in CLIENTS. */
  byAgent: { id: string; name: string; clients: number; entries: number }[]
  firstTime: string | null
  lastTime: string | null
  /** Hour histogram for the day, 24 slots. */
  hours: number[]
}

export interface EntryActivity {
  /** YYYY-MM of the month shown. */
  month: string
  monthLabel: string
  /** Every day cell of the month, including empty ones. */
  days: DaySummary[]
  /** Leading blank cells so day 1 lands on the right weekday. */
  leadingBlanks: number
  agents: AgentSummary[]
  totals: {
    /** Clients served (per-day distinct, summed) - the headline figure. */
    clients: number
    /** Distinct people in the month. Always labelled separately. */
    uniqueClients: number
    entries: number
    visits: number
    /**
     * Clients served by more than one agent. Printed so the per-agent numbers
     * summing higher than `clients` reads as a fact, not a bug.
     */
    sharedClients: number
    revenue: number
    activeDays: number
    daysInMonth: number
    busiestDay: { date: string; clients: number } | null
    peakHour: number | null
    /** Clients per active day. */
    avgPerActiveDay: number
  }
  /** Month-wide hour histogram, 24 slots. */
  hours: number[]
  /** Rows for the day drawer, keyed by day. */
  rowsByDay: Record<string, EntryRow[]>
  /** Excluded CSV-import rows, so the screen can say so out loud. */
  excludedImports: number
  /** Months that actually contain hand-entered rows, newest first. */
  availableMonths: string[]
  scope: 'all' | 'self'
  /**
   * First day (Mauritius) with an inbox footprint anywhere, or null before any
   * exist. Days before it show orders only, and the screen must say so rather
   * than let an August day read as "never opened the inbox".
   */
  activityTrackedFrom: string | null
  /** Today in Mauritius, so the client can tell a finished day from a running one. */
  today: string
}

/** Mauritius day + hour + HH:MM from a UTC timestamp, in one pass. */
function inMauritius(iso: string): { day: string; hour: number; time: string } {
  const d = new Date(iso)
  // `en-CA` gives YYYY-MM-DD, the same shape as a Postgres date, so it compares
  // directly as a string. Do not swap the locale.
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: MAURITIUS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  // hour12:false alone can render midnight as "24", which breaks an array
  // index. hourCycle h23 pins it to 0-23.
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: MAURITIUS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d)
  return { day, hour: Number(time.slice(0, 2)), time }
}

const MONTH_LABEL = (month: string) =>
  new Date(month + '-01T12:00:00Z').toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

/**
 * Builds the month overview.
 *
 * @param month  YYYY-MM. Defaults to the current Mauritius month.
 * @param viewer The signed-in profile. A marketing agent is silently scoped to
 *               their own entries - the scoping happens HERE, server-side, not
 *               as a filter the client could drop.
 */
export async function getEntryActivity(
  month: string | undefined,
  viewer: { id: string; role: string },
): Promise<EntryActivity> {
  const db = createAdminClient()
  const seeAll = viewer.role === 'admin' || viewer.role === 'manager'
  const scope: 'all' | 'self' = seeAll ? 'all' : 'self'

  /*
   * `profiles.name` - NOT `full_name`. Selecting a column that does not exist
   * makes PostgREST fail the WHOLE select, so every agent silently renders as
   * "Unknown" while the query looks fine. I hit exactly that while measuring
   * this table.
   */
  const { data: profiles } = await db.from('profiles').select('id,name,email,role')
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.id as string, ((p.name as string) || (p.email as string) || '').trim()]),
  )
  const roleOf = new Map((profiles ?? []).map((p) => [p.id as string, (p.role as string) || '']))

  /*
   * Paged deliberately. Supabase caps a select at 1000 rows and returns the
   * first page without complaint, so a plain select would quietly stop counting
   * at 1000 and under-report every total on this page as the table grows.
   */
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    let q = db
      .from('deliveries')
      // `customer_name` - NOT `client_name`, which does not exist on this table.
      // Same family of bug as profiles.name: PostgREST fails the ENTIRE select on
      // one unknown column, so the page renders as "no entries this month"
      // rather than as an error. That is why the throw below matters.
      // `contact_1` is the client identity (there is no client_id column) and
      // `order_code` is the number said out loud - both needed now that the page
      // counts clients rather than rows.
      .select(
        'id,created_by,created_at,entry_date,import_batch_id,amount,status,customer_name,contact_1,order_code,medium',
      )
      .is('import_batch_id', null)
      .not('created_at', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (!seeAll) q = q.eq('created_by', viewer.id)

    const { data, error } = await q
    /*
     * Throw rather than `break`. Swallowing this is how a broken query becomes
     * an empty calendar: I shipped `client_name` here, every page returned an
     * error, the loop broke on the first one and the screen said "no entries" -
     * indistinguishable from a quiet month. A wrong column is a bug and must
     * look like one.
     */
    if (error) throw new Error(`Entry activity query failed: ${error.message}`)
    if (!data) break
    rows.push(...data)
    if (data.length < 1000) break
  }

  // How many CSV rows were set aside, so the UI can be honest about it rather
  // than appearing to have lost orders.
  let importQ = db
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .not('import_batch_id', 'is', null)
  if (!seeAll) importQ = importQ.eq('created_by', viewer.id)
  const { count: excludedImports } = await importQ

  const parsed: EntryRow[] = rows.map((r) => {
    const { day: clockDay, hour, time } = inMauritius(String(r.created_at))
    return {
      id: String(r.id),
      agentId: String(r.created_by ?? ''),
      // Business date wins; the localised clock day is only a fallback for a
      // row that somehow has no entry_date.
      day: String(r.entry_date ?? '').slice(0, 10) || clockDay,
      hour,
      time,
      at: String(r.created_at),
      amount: Number(r.amount) || 0,
      status: String(r.status ?? ''),
      clientName: String(r.customer_name ?? '').trim() || 'No name',
      clientKey: clientKeyOf(r.contact_1, r.customer_name),
      contact: String(r.contact_1 ?? '').trim(),
      orderCode: (r.order_code as string) ?? null,
      medium: (r.medium as string) ?? null,
    }
  })

  const availableMonths = [...new Set(parsed.map((p) => p.day.slice(0, 7)))].sort().reverse()
  // Default to the newest month that HAS entries, not to today's month: a fresh
  // month opens empty and looks broken, and this data currently stops in August.
  const target = month && /^\d{4}-\d{2}$/.test(month) ? month : availableMonths[0] ?? todayInMauritius().slice(0, 7)
  const inMonth = parsed.filter((p) => p.day.startsWith(target))
  const today = todayInMauritius()

  // --- day cells: every day of the month, empty ones included ---
  const [y, m] = target.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()

  /*
   * Inbox footprints for the same month. The UTC window is padded by a day on
   * each side and then filtered on the MAURITIUS day, the same way order rows
   * are, so a reply sent at 01:00 local lands on the right calendar day.
   */
  const eventRows = await loadAgentActivity(
    new Date(Date.UTC(y, m - 1, 1) - 86400000).toISOString(),
    new Date(Date.UTC(y, m, 1) + 86400000).toISOString(),
    seeAll ? undefined : [viewer.id],
  )
  const eventsByAgentDay = new Map<string, Map<string, Footprint[]>>()
  for (const e of eventRows) {
    const { day, time } = inMauritius(e.created_at)
    if (!day.startsWith(target)) continue
    const kind = e.kind === 'inbox_reply' || e.kind === 'inbox_open' || e.kind === 'inbox_star' || e.kind === 'order_change' ? e.kind : null
    if (!kind) continue
    let perDay = eventsByAgentDay.get(e.user_id)
    if (!perDay) eventsByAgentDay.set(e.user_id, (perDay = new Map()))
    const list = perDay.get(day)
    const point: Footprint = { at: e.created_at, min: minuteOfDay(time), kind }
    if (list) list.push(point)
    else perDay.set(day, [point])
  }
  const { data: firstEvent } = await db
    .from('agent_activity_events')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const activityTrackedFrom = firstEvent?.created_at ? inMauritius(String(firstEvent.created_at)).day : null
  const rowsByDay: Record<string, EntryRow[]> = {}
  for (const r of inMonth) (rowsByDay[r.day] ??= []).push(r)

  const days: DaySummary[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${target}-${String(d).padStart(2, '0')}`
    const list = (rowsByDay[date] ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))
    /*
     * Clients per agent AND per day.
     *
     * Counted as DISTINCT KEYS, not as visits: a client who orders twice in a
     * day is one client on the calendar. The hour histogram still counts rows,
     * because it answers "when was the typing happening".
     */
    const perAgent = new Map<string, { clients: Set<string>; entries: number }>()
    const dayClients = new Set<string>()
    const hours = new Array(24).fill(0) as number[]
    let revenue = 0
    for (const r of list) {
      let slot = perAgent.get(r.agentId)
      if (!slot) perAgent.set(r.agentId, (slot = { clients: new Set(), entries: 0 }))
      slot.clients.add(r.clientKey)
      slot.entries += 1
      dayClients.add(r.clientKey)
      hours[r.hour] += 1
      revenue += r.amount
    }
    days.push({
      date,
      weekday: new Date(date + 'T12:00:00Z').getUTCDay(),
      clients: dayClients.size,
      entries: list.length,
      revenue,
      byAgent: [...perAgent.entries()]
        .map(([id, v]) => ({
          id,
          name: nameOf.get(id) || 'Unknown agent',
          clients: v.clients.size,
          entries: v.entries,
        }))
        .sort((a, b) => b.clients - a.clients),
      firstTime: list[0]?.time ?? null,
      lastTime: list.length ? list[list.length - 1].time : null,
      hours,
    })
  }

  // --- agent summaries ---
  const agentMap = new Map<string, EntryRow[]>()
  for (const r of inMonth) {
    const list = agentMap.get(r.agentId)
    if (list) list.push(r)
    else agentMap.set(r.agentId, [r])
  }
  // An agent who only answered the inbox this month has no order rows but is
  // still working; the union keeps them on the board.
  const agentIds = new Set<string>([...agentMap.keys(), ...eventsByAgentDay.keys()])
  const agents: AgentSummary[] = [...agentIds]
    .map((id) => {
      const list = agentMap.get(id) ?? []
      const perDay = new Map<string, EntryRow[]>()
      for (const r of list) {
        const dayRows = perDay.get(r.day)
        if (dayRows) dayRows.push(r)
        else perDay.set(r.day, [r])
      }
      const eventDays = eventsByAgentDay.get(id) ?? new Map<string, Footprint[]>()
      const shift = shiftForRole(roleOf.get(id) || '')
      const dayKeys = [...new Set([...perDay.keys(), ...eventDays.keys()])].sort()

      /*
       * Day windows are built from each agent's OWN rows, sorted by the raw
       * instant. Sorting by the "HH:MM" string would be wrong the moment a day
       * crosses midnight, which this data does - Munsah's 23 Aug session runs
       * 01:52-02:02 under the previous business date.
       */
      const agentDays: AgentDay[] = dayKeys
        .map((date) => {
          const s = (perDay.get(date) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))
          const visits = buildVisits(s)
          const events = eventDays.get(date) ?? []

          /*
           * One timeline per day: order visits as intervals, inbox footprints
           * as points. First/last/gaps come from the union, so an agent who
           * opened the inbox at 08:02 and typed the first order at 09:40 is on
           * time, not 1h40 late, and the 08:02-09:40 stretch is a quiet gap
           * only if nothing else happened in it.
           */
          const points: Footprint[] = [
            ...visits.map((v) => ({ at: v.startAt, min: v.startMin, kind: 'order' as const, endAt: v.endAt, endMin: v.endMin })),
            ...events,
          ].sort((a, b) => a.at.localeCompare(b.at))
          const first = points[0]
          const lastEnd = points.reduce((mx, p) => {
            const end = p.endAt ?? p.at
            return end > mx.at ? { at: end, min: p.endMin ?? p.min } : mx
          }, { at: first.endAt ?? first.at, min: first.endMin ?? first.min })
          const firstMin = first.min
          const lastMin = lastEnd.min
          const hmOf = (mm: number) => `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`

          /*
           * Quiet stretches measured BETWEEN FOOTPRINTS, not between rows: a
           * four-row order typed in one burst is one visit, and a reply sent
           * in the middle of a lull closes that lull. Lengths come from the
           * REAL INSTANTS so a midnight-crossing day cannot go negative.
           */
          const gaps: EntryGap[] = footprintGaps(points, GAP_MIN_TRACKED)

          const clients = new Set(s.map((r) => r.clientKey)).size
          const activity = countActivity(events)
          const weekday = new Date(date + 'T12:00:00Z').getUTCDay()

          return {
            date,
            clients,
            entries: s.length,
            firstTime: hmOf(firstMin),
            lastTime: hmOf(lastMin),
            firstMin,
            lastMin,
            // Clamped at 0: a midnight-crossing day would otherwise go negative
            // and render as a bar pointing backwards.
            spanMinutes: Math.max(0, lastMin - firstMin),
            // A day is readable as a shift once it has enough footprints of
            // any kind - 5 clients, or 10 inbox actions - and lasts 30 minutes.
            thin: (clients < 5 && events.length < 10) || lastMin - firstMin < 30,
            gaps,
            activity,
            attendance: shift ? dayAttendance(shift, weekday, firstMin, lastMin, date === today) : null,
          }
        })

      /*
       * Attendance against the shift. Only scheduled days that are OVER count
       * as missing; today is still running. Before footprints existed
       * (activityTrackedFrom) a missing day can only mean "no order typed",
       * which is weaker evidence - the UI prints the tracking start for that.
       */
      let attendance: AttendanceSummary | null = null
      if (shift) {
        const present = agentDays.filter((d) => d.attendance?.scheduled)
        const missingDays: string[] = []
        let scheduledDays = 0
        for (let d = 1; d <= daysInMonth; d++) {
          const date = `${target}-${String(d).padStart(2, '0')}`
          if (date >= today) break
          const wd = new Date(date + 'T12:00:00Z').getUTCDay()
          if (!shift.workdays.includes(wd)) continue
          scheduledDays++
          if (!present.some((p) => p.date === date)) missingDays.push(date)
        }
        if (present.some((p) => p.date === today)) scheduledDays++
        const late = present.filter((d) => (d.attendance?.lateMinutes ?? 0) > 0)
        const early = present.filter((d) => (d.attendance?.earlyLeaveMinutes ?? 0) > 0)
        const worst = late.slice().sort((a, b) => (b.attendance!.lateMinutes) - (a.attendance!.lateMinutes))[0]
        const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : null)
        const hmOf = (mm: number) => `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`
        const avgStart = avg(present.map((d) => d.firstMin))
        const avgEnd = avg(present.filter((d) => d.date !== today).map((d) => d.lastMin))
        attendance = {
          shift,
          scheduledDays,
          presentDays: present.length,
          missingDays,
          onTimeDays: present.length - late.length,
          lateDays: late.length,
          lateMinutesTotal: late.reduce((s, d) => s + d.attendance!.lateMinutes, 0),
          latestStart: worst ? { date: worst.date, time: worst.firstTime, lateMinutes: worst.attendance!.lateMinutes } : null,
          earlyDays: early.length,
          earlyMinutesTotal: early.reduce((s, d) => s + (d.attendance!.earlyLeaveMinutes ?? 0), 0),
          averageStart: avgStart === null ? null : hmOf(avgStart),
          averageEnd: avgEnd === null ? null : hmOf(avgEnd),
        }
      }

      // Median over SUBSTANTIAL days only where possible: a 7-minute day would
      // otherwise drag the typical window toward a session that never happened.
      const solid = agentDays.filter((d) => !d.thin)
      const basis = solid.length ? solid : agentDays
      const median = (nums: number[]) => nums.slice().sort((a, b) => a - b)[Math.floor(nums.length / 2)]
      const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const medStart = basis.length ? median(basis.map((d) => d.firstMin)) : null
      const medEnd = basis.length ? median(basis.map((d) => d.lastMin)) : null

      const byFirst = agentDays.slice().sort((a, b) => a.firstMin - b.firstMin)
      const byLast = agentDays.slice().sort((a, b) => b.lastMin - a.lastMin)
      const hoursUsed = list.map((r) => r.hour)

      return {
        id,
        name: nameOf.get(id) || 'Unknown agent',
        role: roleOf.get(id) || '',
        // Summed per day, so this agrees with the calendar cells by construction.
        clients: agentDays.reduce((s, d) => s + d.clients, 0),
        uniqueClients: new Set(list.map((r) => r.clientKey)).size,
        entries: list.length,
        visits: agentDays.reduce(
          (s, d) => s + buildVisits((perDay.get(d.date) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))).length,
          0,
        ),
        revenue: list.reduce((s, r) => s + r.amount, 0),
        activeDays: agentDays.length,
        bestDay: Math.max(0, ...agentDays.map((d) => d.clients)),
        firstHour: hoursUsed.length ? Math.min(...hoursUsed) : null,
        lastHour: hoursUsed.length ? Math.max(...hoursUsed) : null,
        days: agentDays,
        medianStart: medStart === null ? null : hm(medStart),
        medianEnd: medEnd === null ? null : hm(medEnd),
        medianSpanMinutes: basis.length ? median(basis.map((d) => d.spanMinutes)) : 0,
        totalSpanMinutes: agentDays.reduce((s, d) => s + d.spanMinutes, 0),
        earliest: byFirst[0] ? { date: byFirst[0].date, time: byFirst[0].firstTime } : null,
        latest: byLast[0] ? { date: byLast[0].date, time: byLast[0].lastTime } : null,
        activity: agentDays.reduce((s, d) => addActivity(s, d.activity), EMPTY_ACTIVITY),
        attendance,
      }
    })
    // Ranked by CLIENTS, so the order matches the headline number.
    .sort((a, b) => b.clients - a.clients)

  const hours = new Array(24).fill(0) as number[]
  for (const r of inMonth) hours[r.hour] += 1
  const activeDays = days.filter((d) => d.entries > 0)
  const busiest = activeDays.slice().sort((a, b) => b.clients - a.clients)[0]

  /*
   * Month-wide client identity, and the overlap between agents.
   *
   * `sharedClients` exists because the per-agent counts CANNOT sum to this
   * total - MEASURED: 28 clients this month were served by two agents (861 vs
   * 833). Publishing the total without publishing the overlap invites the
   * reader to conclude the page is broken.
   */
  const monthClients = new Set(inMonth.map((r) => r.clientKey))
  const agentsPerClient = new Map<string, Set<string>>()
  for (const r of inMonth) {
    let set = agentsPerClient.get(r.clientKey)
    if (!set) agentsPerClient.set(r.clientKey, (set = new Set()))
    set.add(r.agentId)
  }
  const sharedClients = [...agentsPerClient.values()].filter((s) => s.size > 1).length
  const peak = hours.some((h) => h > 0) ? hours.indexOf(Math.max(...hours)) : null

  return {
    month: target,
    monthLabel: MONTH_LABEL(target),
    days,
    // `getUTCDay()` is 0=Sunday, but the grid starts on Monday, so Sunday needs
    // to sit at the end of the week rather than the start.
    leadingBlanks: (new Date(`${target}-01T12:00:00Z`).getUTCDay() + 6) % 7,
    agents,
    totals: {
      clients: days.reduce((s, d) => s + d.clients, 0),
      uniqueClients: monthClients.size,
      entries: inMonth.length,
      visits: agents.reduce((s, a) => s + a.visits, 0),
      sharedClients,
      revenue: inMonth.reduce((s, r) => s + r.amount, 0),
      activeDays: activeDays.length,
      daysInMonth,
      busiestDay: busiest ? { date: busiest.date, clients: busiest.clients } : null,
      peakHour: peak,
      // Clients per active day - the average now matches the headline unit.
      avgPerActiveDay: activeDays.length
        ? days.reduce((s, d) => s + d.clients, 0) / activeDays.length
        : 0,
    },
    hours,
    rowsByDay,
    excludedImports: excludedImports ?? 0,
    availableMonths,
    scope,
    activityTrackedFrom,
    today,
  }
}
