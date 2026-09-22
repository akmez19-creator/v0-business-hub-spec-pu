'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronLeft, ChevronRight, Clock, Info, Users, Sunrise, Moon } from 'lucide-react'
import type { AgentSummary, EntryActivity, EntryRow } from '@/lib/entry-activity'
import { AgentAttendance } from './agent-attendance'
/*
 * VALUE import, so it MUST come from the pure module, not from
 * '@/lib/entry-activity' - that file imports lib/supabase/server ->
 * next/headers, which crashes a client component at runtime while tsc stays
 * clean. The `import type` above is erased at build time, so it is safe.
 */
import { buildVisits, SAME_VISIT_MINUTES } from '@/lib/entry-activity-visits'

/**
 * Colours are assigned by the agent's RANK for the month, not by hashing the
 * name: a hash gives two agents near-identical hues often enough to make the
 * stacked bars unreadable, and the palette is deliberately drawn from the
 * project's existing chart tokens rather than inventing new ones.
 */
const AGENT_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--muted-foreground)',
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const rs = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-US')

/** Compact hour label: 14 -> "2p", 9 -> "9a". Keeps the ribbon narrow. */
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)

/** Selectable quiet-gap thresholds, in minutes. */
const GAP_STEPS = [10, 20, 30] as const

/**
 * Severity of a quiet stretch, GRADED rather than all-red.
 *
 * RE-MEASURED on the visit basis now that gaps run client-to-client rather than
 * row-to-row: 858 gaps, median 3 minutes, >=10min 26.6% (>=20min 13.4%, >=30min
 * 7.2%). A ten-minute pause is therefore the normal rhythm of serving clients,
 * so painting it the same red as a two-hour absence would cry wolf on ordinary
 * work 9.9 times per agent-day (measured) and train the owner to ignore the
 * colour. Red is reserved for >=30min, which at 2.7 per agent-day is rare
 * enough to actually mean away from the system.
 *
 * Drawn as a HOLE, not a block. A solid red slab implies something happened in
 * that stretch when the whole point is that NOTHING did - and on a day like
 * Ouwais's 25th, where 7h26 of an 8h22 span is one gap, a solid fill swallowed
 * the shift colour entirely and read as "red day" rather than "two short
 * clusters far apart". So the fill is mostly page background (absence) with a
 * coloured outline (the flag).
 */
function gapTone(minutes: number): { fill: string; edge: string; swatch: string; label: string } {
  if (minutes >= 30)
    return {
      fill: 'color-mix(in oklab, var(--destructive) 18%, var(--background))',
      edge: 'var(--destructive)',
      swatch: 'var(--destructive)',
      label: 'away',
    }
  if (minutes >= 20)
    return {
      fill: 'color-mix(in oklab, var(--chart-4) 16%, var(--background))',
      edge: 'var(--chart-4)',
      swatch: 'var(--chart-4)',
      label: 'long pause',
    }
  return {
    fill: 'var(--background)',
    edge: 'color-mix(in oklab, var(--muted-foreground) 60%, transparent)',
    swatch: 'var(--muted-foreground)',
    label: 'pause',
  }
}

export function EntryActivityCalendar({ data }: { data: EntryActivity }) {
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [focusAgent, setFocusAgent] = useState<string | null>(null)
  /*
   * Defaults to 30, the only tier the data says is genuinely unusual (7.7% of
   * gaps vs 29.4% at 10min). Opening on 10 would greet the owner with a wall of
   * flags on entirely normal days.
   */
  const [gapMin, setGapMin] = useState<number>(30)

  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    data.agents.forEach((a, i) => m.set(a.id, AGENT_COLORS[i] ?? AGENT_COLORS[AGENT_COLORS.length - 1]))
    return m
  }, [data.agents])

  /*
   * The heatmap is scaled to the busiest day, not to a fixed number. A fixed
   * ceiling would render this month (peak 201) almost solid and a quiet month
   * almost blank, so the grid would stop being readable the moment volume
   * changed.
   */
  /** Days filtered by the agent chip, so the whole month re-reads per person. */
  const shown = useMemo(() => {
    if (!focusAgent) return data.days
    return data.days.map((d) => {
      const mine = d.byAgent.find((a) => a.id === focusAgent)
      /*
       * revenue / firstTime / lastTime have to be recomputed from this agent's
       * OWN rows. Spreading `...d` and overriding only the count left each cell
       * showing the day's whole-team money and the team's first-to-last window
       * beside one person's count - so a filtered cell read as if that agent had
       * booked everyone's takings.
       */
      const rows = (data.rowsByDay[d.date] ?? []).filter((r) => r.agentId === focusAgent)
      const sorted = rows.slice().sort((a, b) => a.at.localeCompare(b.at))
      return {
        ...d,
        clients: mine?.clients ?? 0,
        entries: mine?.entries ?? 0,
        byAgent: mine ? [mine] : [],
        revenue: rows.reduce((s, r) => s + r.amount, 0),
        firstTime: sorted[0]?.time ?? d.firstTime,
        lastTime: sorted[sorted.length - 1]?.time ?? d.lastTime,
      }
    })
  }, [data.days, data.rowsByDay, focusAgent])

  /*
   * Everything below counts CLIENTS, not rows. The heatmap is scaled to the
   * busiest day rather than a fixed ceiling: a fixed one renders a busy month
   * almost solid and a quiet month almost blank, so the grid would stop being
   * readable the moment volume changed.
   */
  const shownPeak = Math.max(1, ...shown.map((d) => d.clients))
  const shownTotal = shown.reduce((s, d) => s + d.clients, 0)
  const shownEntries = shown.reduce((s, d) => s + d.entries, 0)

  /*
   * Every stat is derived from `shown`, so selecting an agent re-reads the whole
   * strip. Busiest day and Order value used to come straight off `data.totals`
   * while the count and Days came off `shown`: picking Munsah showed his own
   * total next to the month's Rs 556,324 and a busiest day that was not his.
   * Half-filtered stats are worse than unfiltered ones - they invite you to read
   * one agent's count against everyone's money.
   */
  const shownStats = useMemo(() => {
    const worked = shown.filter((d) => d.entries > 0)
    const best = worked.reduce<(typeof worked)[number] | null>((b, d) => (!b || d.clients > b.clients ? d : b), null)
    const hours = focusAgent ? hoursFor(data, focusAgent) : data.hours
    const peakHour = hours.some((n) => n > 0) ? hours.indexOf(Math.max(...hours)) : null
    /*
     * The typical window. For one agent it comes from the server's median,
     * which already drops thin days. For the team there is no single shift -
     * Taysir starts 07:46 and Munsah finishes 22:23 - so this is the median of
     * each day's team-wide first and last entry: "on a normal day the system is
     * in use from X to Y", which is the honest team-level reading.
     */
    const agent = focusAgent ? data.agents.find((a) => a.id === focusAgent) : null
    let window: string | null = null
    if (agent) {
      window = agent.medianStart && agent.medianEnd ? `${agent.medianStart}-${agent.medianEnd}` : null
    } else if (worked.length) {
      const mid = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const firsts = worked.filter((d) => d.firstTime).map((d) => toMin(d.firstTime!))
      const lasts = worked.filter((d) => d.lastTime).map((d) => toMin(d.lastTime!))
      if (firsts.length && lasts.length) window = `${hm(mid(firsts))}-${hm(mid(lasts))}`
    }

    return { daysWorked: worked.length, best, peakHour, window }
  }, [shown, data, focusAgent])

  const dayRows: EntryRow[] = openDay
    ? (data.rowsByDay[openDay] ?? [])
        .filter((r) => !focusAgent || r.agentId === focusAgent)
        .slice()
        .sort((a, b) => a.at.localeCompare(b.at))
    : []

  /*
   * The drawer's real subject: CLIENTS, not rows.
   *
   * This is what the owner was looking at - "Suresh Bhaugeerothee" twice at
   * 10:47, "Simrita Dhondea" twice at 10:51, "Cecile Poilly" twice at 10:58.
   * Those repeats are extra product lines on ONE order, so the old list made
   * the same conversation look like two pieces of work three times on one
   * screen. Grouped, each client is one entry with its lines nested inside.
   *
   * Built with the SAME `buildVisits` the server totals use, so the drawer count
   * and the calendar cell can never disagree.
   */
  const dayVisits = useMemo(() => buildVisits(dayRows), [dayRows])
  /** Distinct people, for the header - a client who ordered twice is one person. */
  const dayClients = useMemo(() => new Set(dayRows.map((r) => r.clientKey)).size, [dayRows])

  const monthIdx = data.availableMonths.indexOf(data.month)
  const prevMonth = monthIdx >= 0 ? data.availableMonths[monthIdx + 1] : undefined
  const nextMonth = monthIdx > 0 ? data.availableMonths[monthIdx - 1] : undefined

  const nameOf = (id: string) => data.agents.find((a) => a.id === id)?.name ?? 'Unknown agent'

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- header ---------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl leading-none tracking-tight text-balance">Entry Activity</h1>
            <Badge variant="outline" className="border-border/60 text-muted-foreground">
              {data.scope === 'all' ? (
                <>
                  <Users className="mr-1 h-3 w-3" />
                  All agents
                </>
              ) : (
                'Your clients'
              )}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Every client served, by whom and at what time.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!prevMonth} asChild={!!prevMonth}>
            {prevMonth ? (
              <Link href={`?month=${prevMonth}`} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
          <span className="min-w-[9.5rem] text-center font-serif text-lg">{data.monthLabel}</span>
          <Button variant="ghost" size="icon" className="h-9 w-9" disabled={!nextMonth} asChild={!!nextMonth}>
            {nextMonth ? (
              <Link href={`?month=${nextMonth}`} aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

      {/* ---------- month totals ---------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Clients served"
          value={shownTotal.toLocaleString('en-US')}
          /*
           * The hint carries the ORDER count, because clients and orders differ
           * and hiding that invites the "but I typed more than that" question.
           * MEASURED this month: 925 rows for 833 people - 74 rows are a second
           * line on an order already counted.
           */
          hint={`${shownEntries.toLocaleString('en-US')} orders typed`}
        />
        <Stat
          label="Days worked"
          value={`${shownStats.daysWorked}`}
          hint={`of ${data.totals.daysInMonth} in month`}
        />
        <Stat
          label="Busiest day"
          value={shownStats.best ? String(shownStats.best.clients) : '0'}
          hint={
            shownStats.best
              ? new Date(shownStats.best.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })
              : '-'
          }
        />
        <Stat
          label="Peak hour"
          value={shownStats.peakHour === null ? '-' : hourLabel(shownStats.peakHour)}
          hint="busiest typing hour"
        />
        <Stat
          label="Typical day"
          value={shownStats.window ?? '-'}
          hint={focusAgent ? `median, ${nameOf(focusAgent)}` : 'median first to last'}
        />
      </div>

      {/* ---------- agent chips ---------- */}
      {data.agents.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Agents</span>
          {data.agents.map((a) => {
            const on = focusAgent === a.id
            return (
              <button
                key={a.id}
                onClick={() => setFocusAgent(on ? null : a.id)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
                  on ? 'border-transparent text-background' : 'border-border/60 text-foreground/80 hover:bg-muted/50'
                }`}
                style={on ? { background: colorOf.get(a.id) } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: on ? 'var(--background)' : colorOf.get(a.id) }}
                />
                {a.name}
                <span className="font-mono opacity-70">{a.clients}</span>
              </button>
            )
          })}
          {focusAgent && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFocusAgent(null)}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* ---------- calendar ---------- */}
      <Card className="overflow-hidden border-border/60 bg-card/40 p-4">
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              {w}
            </div>
          ))}

          {Array.from({ length: data.leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} className="min-h-[44px]" aria-hidden />
          ))}

          {shown.map((d) => {
            const dayNum = Number(d.date.slice(-2))
            const intensity = d.clients === 0 ? 0 : 0.08 + (d.clients / shownPeak) * 0.34
            const isPeak = d.clients === shownPeak && d.clients > 0
            return (
              <button
                key={d.date}
                onClick={() => d.clients > 0 && setOpenDay(d.date)}
                disabled={d.clients === 0}
                /*
                 * Worked days are tall; empty days are a thin placeholder. In a
                 * month with 8 active days out of 31, giving all 31 cells the
                 * same height pushed every real number below the fold and made
                 * the page read as mostly nothing - measured in the browser.
                 * The grid stays a true calendar (all 31 cells, correct
                 * weekday columns) but spends its height where the work is.
                 */
                className={`group relative flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-all ${
                  d.clients === 0
                    ? 'min-h-[44px] cursor-default border-border/25 bg-transparent'
                    : 'min-h-[104px] border-border/60 hover:border-primary/60 hover:shadow-[0_0_24px_var(--glow-primary)]'
                } ${isPeak ? 'ring-1 ring-primary/40' : ''}`}
                style={d.clients ? { background: `color-mix(in oklab, var(--primary) ${intensity * 100}%, transparent)` } : undefined}
              >
                <div className="flex items-baseline justify-between">
                  <span className={`font-mono text-xs ${d.clients ? 'text-foreground/70' : 'text-muted-foreground/40'}`}>
                    {String(dayNum).padStart(2, '0')}
                  </span>
                  {d.clients > 0 && (
                    <span className="font-serif text-2xl leading-none tabular-nums">{d.clients}</span>
                  )}
                </div>

                {d.clients > 0 ? (
                  <>
                    {/* Per-agent split. This is the point of the cell: it shows
                        WHO worked, not just how much happened. Widths are in
                        CLIENTS so the bar matches the number printed above it -
                        splitting by rows would draw one agent wider purely
                        because his orders had more product lines. */}
                    <div className="flex h-1.5 gap-px overflow-hidden rounded-full">
                      {d.byAgent.map((a) => (
                        <span
                          key={a.id}
                          title={`${a.name}: ${a.clients} clients`}
                          style={{ background: colorOf.get(a.id), flexGrow: a.clients }}
                        />
                      ))}
                    </div>
                    {/* Money deliberately absent: this page measures WORK, and
                        the owner's point is that the times are what matter. */}
                    <span className="mt-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {d.firstTime}-{d.lastTime}
                    </span>
                  </>
                ) : null /* An empty cell says nothing: the blank IS the message,
                            and 23 repetitions of "no clients" was just noise. */}
              </button>
            )
          })}
        </div>
      </Card>

      {/* ---------- hour ribbon ---------- */}
      <Card className="border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg">When the work happens</h2>
          <span className="text-xs text-muted-foreground">Mauritius time, whole month</span>
        </div>
        <HourRibbon hours={focusAgent ? hoursFor(data, focusAgent) : data.hours} />
      </Card>

      {/* ---------- agent table ---------- */}
      {data.agents.length > 0 && (
        <Card className="border-border/60 bg-card/40 p-4">
          <h2 className="mb-3 font-serif text-lg">Per agent, {data.monthLabel}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 font-normal">Agent</th>
                  <th className="pb-2 text-right font-normal">Clients</th>
                  <th className="pb-2 text-right font-normal">Orders</th>
                  <th className="pb-2 text-right font-normal">Days</th>
                  <th className="pb-2 text-right font-normal">Avg/day</th>
                  <th className="pb-2 text-right font-normal">Best day</th>
                  {/* Typical start/end live in the Shift profile above, drawn
                      against a clock. Repeating them here as bare numbers made
                      a 10-column table that could not be read across a wide
                      monitor; the range (earliest/latest) is what the bars
                      cannot state precisely, so only that is kept. */}
                  <th className="pb-2 text-right font-normal">Earliest</th>
                  <th className="pb-2 text-right font-normal">Latest</th>
                  <th className="pb-2 text-right font-normal">Time at system</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-b border-border/30 last:border-0 ${focusAgent === a.id ? 'bg-muted/30' : ''}`}
                  >
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(a.id) }} />
                        {a.name}
                        {a.role && a.role !== 'marketing_agent' && (
                          <Badge variant="outline" className="border-border/60 px-1.5 py-0 text-[10px] text-muted-foreground">
                            {a.role.replace('_', ' ')}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{a.clients}</td>
                    {/* Orders sit next to clients, quieter. Keeping both stops the
                        obvious "I typed more than that" objection dead, and the
                        difference is itself worth seeing: a wide gap means many
                        multi-line orders. */}
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{a.entries}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{a.activeDays}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {a.activeDays ? (a.clients / a.activeDays).toFixed(0) : '-'}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{a.bestDay}</td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {a.earliest?.time ?? '-'}
                    </td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {a.latest?.time ?? '-'}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{dur(a.totalSpanMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------- attendance against the fixed shift ---------- */}
      <AgentAttendance data={data} colorOf={colorOf} />

      {/* ---------- per-agent working time, day by day ---------- */}
      {data.agents.length > 0 && (
        <Card className="border-border/60 bg-card/40 p-4">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg">Shift profile</h2>
            <span className="text-xs text-muted-foreground">Mauritius time · midnight to midnight</span>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <p className="max-w-2xl text-xs text-muted-foreground">
              The solid bar is the typical day, first order to last. That is a{' '}
              <strong className="font-normal text-foreground/80">floor on time at the system</strong>, not hours worked -
              it cannot see a shift that began before the first order or carried on after the last.
            </p>
            {/* Swatches are drawn in a real chart colour, not `bg-foreground`,
                which at 70% on a dark card was invisible in the screenshot. */}
            <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-6 rounded" style={{ background: 'var(--chart-1)' }} />
                typical day
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-6 rounded opacity-25" style={{ background: 'var(--chart-1)' }} />
                full range
              </span>
            </span>
          </div>

          {/* ---------- quiet-gap controls ---------- */}
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/40 bg-muted/10 p-2.5">
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Flag quiet gaps of</span>
              <span className="flex overflow-hidden rounded-md border border-border/60">
                {GAP_STEPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGapMin(m)}
                    aria-pressed={gapMin === m}
                    className={`px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                      gapMin === m
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </span>
              <span className="text-muted-foreground">or more</span>
            </span>

            <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {[
                { t: 10, l: '10-20m pause' },
                { t: 20, l: '20-30m long' },
                { t: 30, l: '30m+ away' },
              ]
                .filter((s) => s.t >= gapMin)
                .map((s) => (
                  <span key={s.t} className="flex items-center gap-1.5">
                    {/* Legend swatch mirrors the mark exactly - tinted hole plus
                        outline - so the key matches what is on the bars. */}
                    <span
                      className="h-3 w-4 rounded-sm"
                      style={{
                        background: gapTone(s.t).fill,
                        boxShadow: `inset 0 0 0 1px ${gapTone(s.t).edge}`,
                      }}
                    />
                    {s.l}
                  </span>
                ))}
            </span>

            {/*
             * Said out loud, because the measurement contradicts the instinct:
             * a 10-minute gap is the NORMAL rhythm of serving clients (median
             * gap 3 minutes, >=10min covers 27% of them). Without this line the
             * 10m setting looks like 10 problems a day.
             *
             * All three numbers RE-MEASURED after gaps moved to the visit basis.
             * They were 4 minutes / 1-in-7 / 1-in-13 on the old row basis; stale
             * copy that states a figure is worse than no copy at all.
             */}
            <span className="text-[11px] text-muted-foreground/70">
              {gapMin === 10
                ? 'Typical gap between clients is 3 minutes, so 10m marks are normal rhythm, not idle time.'
                : gapMin === 20
                  ? 'About 1 gap in 7 reaches 20 minutes.'
                  : 'Only 1 gap in 14 reaches 30 minutes - these are the ones that mean away from the system.'}
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {data.agents
              .filter((a) => !focusAgent || a.id === focusAgent)
              .map((a) => (
                <AgentShifts
                  key={a.id}
                  agent={a}
                  color={colorOf.get(a.id) ?? 'var(--muted-foreground)'}
                  gapMin={gapMin}
                />
              ))}
          </div>

          <HourAxis />
        </Card>
      )}

      {/* ---------- honesty note ---------- */}
      {data.excludedImports > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {data.excludedImports.toLocaleString('en-US')} imported orders are not shown. A CSV import writes one
            timestamp for the whole file, so it is not a record of an agent working and would show up as a spike that
            never happened. This page counts only orders typed into the system.
          </span>
        </p>
      )}

      {/* ---------- day drawer ---------- */}
      <Sheet open={!!openDay} onOpenChange={(o) => !o && setOpenDay(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-xl">
          {/* shrink-0 so a long title can never steal height from the list. */}
          <SheetHeader className="shrink-0 border-b border-border/60 pb-3">
            <SheetTitle className="font-serif text-xl">
              {openDay &&
                new Date(openDay + 'T12:00:00Z').toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'UTC',
                })}
            </SheetTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {/* Clients lead; orders follow only when the two differ, so the
                  header does not carry a redundant "152 clients · 152 orders". */}
              <span className="font-mono text-foreground/80">{dayClients} clients</span>
              {dayRows.length !== dayClients && (
                <span className="font-mono">{dayRows.length} orders</span>
              )}
              <span className="font-mono">{rs(dayRows.reduce((s, r) => s + r.amount, 0))}</span>
              {dayRows.length > 0 && (
                <span className="flex items-center gap-1 font-mono">
                  <Sunrise className="h-3 w-3" />
                  {dayRows[0].time}
                  <Moon className="ml-1 h-3 w-3" />
                  {dayRows[dayRows.length - 1].time}
                </span>
              )}
            </div>
          </SheetHeader>

          {/*
           * CRITICAL: `min-h-0` is what makes this scroll at all.
           *
           * `SheetContent` is a `flex flex-col` with a definite `h-full`, so
           * `flex-1` looks sufficient - but a flex item's `min-height` defaults
           * to `auto`, meaning it REFUSES to shrink below its content height.
           * With 152 rows that content is ~8000px tall, so the ScrollArea grew
           * past the bottom of the viewport and the list was simply cut off
           * with no scrollbar, instead of overflowing internally.
           *
           * Same family of bug as the `height: X%` inside a content-height
           * flex-col on the hour chart: tsc is clean either way, only the
           * browser shows it.
           */}
          <ScrollArea className="min-h-0 flex-1">
            {/* pb so the final entry does not sit flush against the window edge,
                which reads as "cut off" even when it is the true last row. */}
            <ol className="divide-y divide-border/40 pb-4">
              {dayVisits.map((v) => {
                // A visit can span two agents if both typed for the same client
                // inside the window. Rare, but showing one name would be wrong.
                const agents = [...new Set(v.rows.map((r) => r.agentId))]
                const multi = v.rows.length > 1
                return (
                  <li key={v.rows[0].id} className="flex items-start gap-3 px-1 py-2.5">
                    <span className="w-11 shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
                      {v.startTime}
                    </span>
                    {/* One stripe per agent involved, so a shared visit is visible. */}
                    <span className="flex shrink-0 flex-col gap-px pt-0.5">
                      {agents.map((id) => (
                        <span
                          key={id}
                          className="h-5 w-0.5 rounded-full"
                          style={{ background: colorOf.get(id) ?? 'var(--muted-foreground)' }}
                        />
                      ))}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm">{v.clientName}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {agents.map(nameOf).join(' + ')}
                        {v.contact ? ` · ${v.contact}` : ''}
                      </span>
                      {/*
                       * The order lines, only when there is more than one. This
                       * is the whole point of grouping: the repeat is still
                       * visible as detail, but it no longer reads as a second
                       * client. Times are shown because they prove the lines
                       * belong to one sitting.
                       */}
                      {multi && (
                        <span className="mt-0.5 flex flex-col gap-0.5 border-l border-border/40 pl-2">
                          {v.rows.map((r) => (
                            <span
                              key={r.id}
                              className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="truncate">
                                <span className="font-mono tabular-nums">{r.time}</span>
                                {r.orderCode ? ` · ${r.orderCode}` : ''}
                                {r.medium ? ` · ${r.medium}` : ''}
                              </span>
                              <span className="shrink-0 font-mono tabular-nums">{rs(r.amount)}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-right font-mono text-xs tabular-nums">{rs(v.amount)}</span>
                      {multi && (
                        <span className="font-mono text-[10px] text-muted-foreground">{v.rows.length} lines</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}

/** Minutes -> "9h04". Compact enough for a table cell, unambiguous. */
const dur = (mins: number) => `${Math.floor(mins / 60)}h${String(Math.round(mins % 60)).padStart(2, '0')}`

const DAY_MINUTES = 1440
/** Left offset / width as a % of a midnight-to-midnight track. */
const pct = (m: number) => (m / DAY_MINUTES) * 100

/**
 * Minutes past midnight -> "14:02", for gap tooltips.
 *
 * Wraps with % DAY_MINUTES so a gap running past midnight reads as 00:20 rather
 * than the impossible "24:20".
 */
const hm = (m: number) =>
  `${String(Math.floor((m % DAY_MINUTES) / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`

/**
 * Shift label from the median start - the answer to "which shift is this?".
 *
 * A single day cannot establish a pattern, so one worked day is "one day" and
 * never a shift name: Gunga Akmez's lone 14-minute session was being labelled
 * "evening", which claimed a routine from a single data point.
 */
function shiftName(medianStart: string | null, medianEnd: string | null, activeDays: number): string {
  if (!medianStart || activeDays < 2) return activeDays === 1 ? 'one day' : 'irregular'
  const h = Number(medianStart.slice(0, 2))
  const endH = medianEnd ? Number(medianEnd.slice(0, 2)) : h
  if (h < 6) return 'night'
  if (h < 11) return 'morning'
  /*
   * The END decides between afternoon and evening, because the start alone gets
   * it wrong at both edges: Munsah starts 14:02 but works to 22:23, which is an
   * evening shift, while a 16:45-16:59 session is not. Working past 20:00 is
   * what makes a shift an evening one.
   */
  if (endH >= 20) return 'evening'
  if (h < 14) return 'midday'
  return 'afternoon'
}

/**
 * One agent's month as a SHIFT PROFILE rather than 26 near-identical rows.
 *
 * The question this page answers is "what shift does this person work, and how
 * consistent are they?" - so the headline is one thick bar for the typical
 * shift, drawn inside the paler full range of every day they worked. Zoomed out,
 * a stack of per-day hairlines answered nothing: every row looked the same and
 * the shape only emerged if you read 26 of them. The daily rows still exist,
 * one click away, because that is the audit trail.
 *
 * The 24h axis stays SHARED across agents - that is what makes Taysir's morning
 * and Munsah's evening read as different shifts at a glance.
 */
function AgentShifts({ agent, color, gapMin }: { agent: AgentSummary; color: string; gapMin: number }) {
  const [open, setOpen] = useState(false)

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const solid = agent.days.filter((d) => !d.thin)
  const rangeStart = agent.earliest ? toMin(agent.earliest.time) : 0
  const rangeEnd = agent.latest ? toMin(agent.latest.time) : 0
  const medStart = agent.medianStart ? toMin(agent.medianStart) : null
  const medEnd = agent.medianEnd ? toMin(agent.medianEnd) : null

  /*
   * Gap totals for the whole month at the chosen threshold. Computed from the
   * SAME `d.gaps` the bars draw, so the headline count can never disagree with
   * the marks below it - a filter that changes one derived number must change
   * every one of them.
   */
  const flagged = agent.days.flatMap((d) => d.gaps.filter((g) => g.minutes >= gapMin))
  const idleMinutes = flagged.reduce((s, g) => s + g.minutes, 0)
  const longest = flagged.reduce((mx, g) => Math.max(mx, g.minutes), 0)

  return (
    <section className="rounded-xl border border-border/50 bg-background/40 p-3 transition-colors hover:border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="font-medium">{agent.name}</span>
          <Badge variant="outline" className="border-border/60 px-1.5 py-0 text-[10px] text-muted-foreground">
            {shiftName(agent.medianStart, agent.medianEnd, agent.activeDays)}
          </Badge>
        </span>
        {/*
         * The client count belongs here, next to the shift: the times say WHEN
         * someone was at the system and the count says HOW MUCH came out of it,
         * and one without the other is misleading in both directions - a long
         * shift with few clients and a short shift with many read identically
         * otherwise. Shown as a rate too, since a raw total silently rewards
         * whoever happened to work the most days.
         */}
        <span className="flex items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground/90">
            {agent.medianStart ?? '--:--'} - {agent.medianEnd ?? '--:--'}
          </span>
          <span className="text-border/80" aria-hidden>
            |
          </span>
          <span className="font-mono tabular-nums text-foreground/90">{agent.clients}</span>
          <span>clients</span>
          <span className="font-mono tabular-nums">
            {Math.round(agent.clients / Math.max(1, agent.activeDays))}/day
          </span>
          <span className="text-border/80" aria-hidden>
            |
          </span>
          <span>
            {agent.activeDays} {agent.activeDays === 1 ? 'day' : 'days'}
          </span>
          <span className="font-mono tabular-nums">{dur(agent.totalSpanMinutes)}</span>
          <span className="text-border/80" aria-hidden>
            |
          </span>
          {/*
           * Quiet time is stated in words as well as drawn, because a reader
           * cannot add up thin slivers across eight bars by eye. "none" is
           * printed rather than hidden, so a clean month reads as a measured
           * result instead of a missing feature.
           */}
          {flagged.length ? (
            <span
              className="flex items-baseline gap-1.5"
              title={`${flagged.length} gaps of ${gapMin}min or more · longest ${dur(longest)}`}
            >
              <span
                className="mb-px inline-block h-2 w-2 shrink-0 self-center rounded-full"
                style={{ background: gapTone(longest).swatch }}
                aria-hidden
              />
              <span className="font-mono tabular-nums text-foreground/90">{flagged.length}</span>
              <span>quiet</span>
              <span className="font-mono tabular-nums">{dur(idleMinutes)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/50">no quiet gaps</span>
          )}
        </span>
      </div>

      {/* Typical shift inside the full range. */}
      <div className="relative mt-2.5 h-7 overflow-hidden rounded-lg bg-muted/20">
        {[6, 12, 18].map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-border/30" style={{ left: `${pct(h * 60)}%` }} aria-hidden />
        ))}
        {/* Full range: earliest start to latest finish across the month. */}
        <span
          className="absolute inset-y-1.5 rounded-[3px] opacity-25"
          style={{
            left: `${pct(rangeStart)}%`,
            width: `${Math.max(0.6, pct(Math.max(0, rangeEnd - rangeStart)))}%`,
            background: color,
          }}
          title={`Full range ${agent.earliest?.time ?? '-'} to ${agent.latest?.time ?? '-'}`}
        />
        {/* Typical shift: the median day, drawn solid on top. */}
        {medStart !== null && medEnd !== null && (
          <span
            className="absolute inset-y-0.5 rounded-md"
            style={{
              left: `${pct(medStart)}%`,
              width: `${Math.max(1, pct(Math.max(0, medEnd - medStart)))}%`,
              background: color,
            }}
            title={`Typical shift ${agent.medianStart}-${agent.medianEnd} (median of ${solid.length || agent.days.length} days)`}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide' : 'Show'} {agent.days.length} {agent.days.length === 1 ? 'day' : 'days'}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
          {/*
           * Column labels. Without them the count column was a stack of bare
           * integers - 17, 83, 58, 89 - with nothing saying what was counted,
           * which is exactly what the owner queried. Widths MUST stay in step
           * with the row below or the labels sit over the wrong columns.
           */}
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider text-muted-foreground/50">
            <span className="w-14 shrink-0">Day</span>
            <span className="w-12 shrink-0 text-right">Clients</span>
            <span className="flex-1">First footprint to last</span>
            <span className="w-[5.25rem] shrink-0">Window</span>
            <span className="w-12 shrink-0 text-right">Span</span>
            <span className="w-14 shrink-0 text-right">Quiet</span>
            <span className="w-12 shrink-0 text-right" title="Replies sent from the inbox">Sent</span>
            {agent.attendance ? <span className="w-20 shrink-0 text-right">Shift</span> : null}
          </div>
          {agent.days.map((d) => {
            const label = new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })
            return (
              <div key={d.date} className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">{label}</span>
                <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-foreground/70">
                  {d.clients}
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/20">
                  {[6, 12, 18].map((h) => (
                    <span
                      key={h}
                      className="absolute inset-y-0 w-px bg-border/30"
                      style={{ left: `${pct(h * 60)}%` }}
                      aria-hidden
                    />
                  ))}
                  {/* The expected shift, faint, so a bar starting to its right reads as late at a glance. */}
                  {agent.attendance ? (
                    <span
                      className="absolute inset-y-0 border-x border-dashed border-foreground/25 bg-foreground/[0.04]"
                      style={{ left: `${pct(agent.attendance.shift.startMin)}%`, width: `${pct(agent.attendance.shift.endMin - agent.attendance.shift.startMin)}%` }}
                      title={`Shift ${agent.attendance.shift.label}`}
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={`absolute inset-y-0.5 rounded-[2px] ${d.thin ? 'opacity-40' : ''}`}
                    style={{
                      left: `${pct(d.firstMin)}%`,
                      // A 10-minute session is 0.7% of the day and would vanish
                      // entirely; 1% keeps it visible without overstating it.
                      width: `${Math.max(1, pct(d.spanMinutes))}%`,
                      background: color,
                    }}
                    title={`${d.firstTime}-${d.lastTime} · ${d.clients} clients, ${d.entries} orders · ${dur(
                      d.spanMinutes,
                    )}${d.thin ? ' · too thin to read as a shift' : ''}`}
                  />
                  {/*
                   * Quiet stretches PUNCHED OUT of the shift bar, drawn after it
                   * so they sit on top. Deliberately inset-y-0.5 to match the
                   * bar exactly - a taller overlay would read as a separate
                   * event rather than a hole in the shift. Minimum width 0.35%
                   * because a 10-minute gap is 0.7% of the day and rounds away
                   * to nothing at narrow widths.
                   */}
                  {d.gaps
                    .filter((g) => g.minutes >= gapMin)
                    .map((g, i) => (
                      <span
                        key={i}
                        className="absolute inset-y-0.5 rounded-[1px]"
                        style={{
                          left: `${pct(g.startMin)}%`,
                          width: `${Math.max(0.35, pct(g.minutes))}%`,
                          background: gapTone(g.minutes).fill,
                          // Inset shadow rather than a border: a border would add
                          // to the element's box and shift a 0.35%-wide sliver
                          // off the minute it is marking.
                          boxShadow: `inset 0 0 0 1px ${gapTone(g.minutes).edge}`,
                        }}
                        title={`${dur(g.minutes)} with no client from ${hm(g.startMin)} to ${hm(
                          g.startMin + g.minutes,
                        )} · ${gapTone(g.minutes).label}`}
                      />
                    ))}
                </div>
                <span className="w-[5.25rem] shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {d.firstTime}-{d.lastTime}
                </span>
                <span
                  className={`w-12 shrink-0 text-right font-mono text-[10px] tabular-nums ${
                    d.thin ? 'text-muted-foreground/40' : 'text-foreground/70'
                  }`}
                  title={d.thin ? 'Too few clients, or too short a gap, to describe a shift' : undefined}
                >
                  {d.thin ? 'thin' : dur(d.spanMinutes)}
                </span>
                {/* Quiet total for the day, so a bar with many thin slivers can
                    still be compared against one with a single long hole. */}
                {(() => {
                  const dayGaps = d.gaps.filter((g) => g.minutes >= gapMin)
                  const mins = dayGaps.reduce((s, g) => s + g.minutes, 0)
                  return (
                    <span
                      className="w-14 shrink-0 text-right font-mono text-[10px] tabular-nums"
                      // `swatch`, not `fill`: fill is now a near-background tint
                      // for drawing holes and would be invisible as text.
                      style={{ color: mins ? gapTone(Math.max(...dayGaps.map((g) => g.minutes))).swatch : undefined }}
                      title={
                        mins
                          ? dayGaps.map((g) => `${hm(g.startMin)} +${dur(g.minutes)}`).join(', ')
                          : `No gaps of ${gapMin}min or more`
                      }
                    >
                      {mins ? `${dayGaps.length}·${dur(mins)}` : <span className="text-muted-foreground/25">-</span>}
                    </span>
                  )
                })()}
                <span
                  className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground"
                  title={`${d.activity.replies} replies · ${d.activity.opens} leads opened · ${d.activity.stars} starred · ${d.activity.orderChanges} order edits`}
                >
                  {d.activity.replies || d.activity.opens ? d.activity.replies : <span className="text-muted-foreground/25">-</span>}
                </span>
                {agent.attendance ? (
                  <span className="w-20 shrink-0 text-right font-mono text-[10px] tabular-nums">
                    {!d.attendance?.scheduled ? (
                      <span className="text-muted-foreground/40" title="Not a scheduled day">off day</span>
                    ) : d.attendance.lateMinutes > 0 ? (
                      <span className="text-amber-500" title={`Started ${d.firstTime}, shift ${agent.attendance.shift.label}`}>+{dur(d.attendance.lateMinutes)} late</span>
                    ) : (d.attendance.earlyLeaveMinutes ?? 0) > 0 ? (
                      <span className="text-amber-500" title={`Last footprint ${d.lastTime}, shift ends 16:30`}>-{dur(d.attendance.earlyLeaveMinutes!)} early</span>
                    ) : d.attendance.earlyLeaveMinutes === null ? (
                      <span className="text-muted-foreground/60" title="Today - still running">on time</span>
                    ) : (
                      <span className="text-emerald-500">on time</span>
                    )}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * The shared clock axis, once for the whole card.
 *
 * Deliberately NOT aligned to the collapsed daily rows' spacers: the headline
 * bars are full-width, so the axis matches those. Every 3 hours, since at this
 * width 6-hourly labels left too much guesswork between gridlines.
 */
function HourAxis() {
  return (
    <div className="relative mt-1 h-4 border-t border-border/40 pt-1">
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <span
          key={h}
          className="absolute top-1 font-mono text-[10px] text-muted-foreground/60"
          style={{
            left: `${pct(h * 60)}%`,
            transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}
        >
          {hourLabel(h % 24)}
        </span>
      ))}
    </div>
  )
}

/** Per-agent hour histogram, recomputed from the day cells. */
function hoursFor(data: EntryActivity, agentId: string): number[] {
  const out = new Array(24).fill(0) as number[]
  for (const rows of Object.values(data.rowsByDay)) {
    for (const r of rows) if (r.agentId === agentId) out[r.hour] += 1
  }
  return out
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="border-border/60 bg-card/40 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-2xl leading-none tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground/70">{hint}</p>
    </Card>
  )
}

/**
 * Hour-of-day bars. Only the hours that carry work are labelled - labelling all
 * 24 turns the axis into unreadable noise at this width.
 */
function HourRibbon({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours)
  return (
    <div className="flex items-end gap-1">
      {hours.map((n, h) => (
        <div key={h} className="flex flex-1 flex-col items-center gap-1">
          <span className={`font-mono text-[9px] tabular-nums ${n ? 'text-muted-foreground' : 'text-transparent'}`}>
            {n || 0}
          </span>
          {/*
            The bar's % height needs a parent with a DEFINITE height. These bars
            first sat straight inside the flex-col with `h-24` on the outer row:
            a percentage resolved against a content-sized parent computes to 0,
            so every bar measured exactly 0px and the chart rendered as bare
            numbers with no bars. Caught only by measuring in the browser -
            nothing failed and tsc was clean. Hence this fixed-height track.
          */}
          <div className="flex h-20 w-full items-end">
            <div
              className={`w-full rounded-sm transition-all ${n ? 'bg-primary/70' : 'bg-muted/40'}`}
              style={{ height: `${n ? Math.max(4, (n / max) * 100) : 2}%` }}
              title={`${hourLabel(h)}: ${n} entries`}
            />
          </div>
          <span className={`font-mono text-[9px] ${n ? 'text-muted-foreground/70' : 'text-muted-foreground/25'}`}>
            {h % 3 === 0 ? hourLabel(h) : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
