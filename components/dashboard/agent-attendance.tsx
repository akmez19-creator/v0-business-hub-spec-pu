'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AgentSummary, EntryActivity } from '@/lib/entry-activity'

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`)
const dayLabel = (date: string) =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * Attendance against a fixed shift, for the roles that have one.
 *
 * "Present" here means the system saw the person: an order typed OR an inbox
 * footprint (reply sent, lead opened, star, order edit). It is a floor - it
 * cannot see a phone call or a WhatsApp reply typed from the handset - so the
 * card names what it measured instead of claiming to know the truth.
 */
export function AgentAttendance({ data, colorOf }: { data: EntryActivity; colorOf: Map<string, string> }) {
  const withShift = data.agents.filter((a) => a.attendance)
  if (!withShift.length) return null
  const trackedFrom = data.activityTrackedFrom
  const monthStart = `${data.month}-01`
  const partial = trackedFrom && trackedFrom > monthStart && trackedFrom <= `${data.month}-31`
  const before = trackedFrom && trackedFrom > `${data.month}-31`

  return (
    <Card className="border-border/60 bg-card/40 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg">Attendance</h2>
        <span className="text-xs text-muted-foreground">Marketing agents · shift {withShift[0].attendance!.shift.label} · Mon-Sat</span>
      </div>
      <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
        Start = first sign of the person in the system that day (an order typed, a reply sent, a lead opened); finish = the last.
        Late is counted after a {withShift[0].attendance!.shift.graceMin}-minute grace.{' '}
        {before ? (
          <span className="text-amber-500">Inbox footprints only exist from {dayLabel(trackedFrom!)} - this month is judged on orders alone, so a quiet morning in the inbox looks like a late start.</span>
        ) : partial ? (
          <span className="text-amber-500">Inbox footprints are recorded from {dayLabel(trackedFrom!)}; days before that are judged on orders alone.</span>
        ) : trackedFrom ? (
          <span>Inbox footprints are included for the whole month.</span>
        ) : (
          <span className="text-amber-500">No inbox footprints recorded yet - judged on orders alone until agents use the inbox.</span>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {withShift.map((a) => (
          <AgentAttendanceRow key={a.id} agent={a} color={colorOf.get(a.id) ?? 'var(--chart-1)'} today={data.today} />
        ))}
      </div>
    </Card>
  )
}

function AgentAttendanceRow({ agent, color, today }: { agent: AgentSummary; color: string; today: string }) {
  const at = agent.attendance!
  const punctuality = at.presentDays ? Math.round((at.onTimeDays / at.presentDays) * 100) : null
  const tone = punctuality === null ? 'text-muted-foreground' : punctuality >= 90 ? 'text-emerald-500' : punctuality >= 70 ? 'text-amber-500' : 'text-red-500'
  const lateDays = agent.days.filter((d) => d.attendance?.scheduled && (d.attendance.lateMinutes > 0 || (d.attendance.earlyLeaveMinutes ?? 0) > 0))

  return (
    <section className="rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="font-medium">{agent.name}</span>
          <Badge variant="outline" className="border-border/60 px-1.5 py-0 text-[10px] text-muted-foreground">{at.shift.label}</Badge>
        </span>
        <span className={`font-mono text-sm tabular-nums ${tone}`} title="Scheduled days present and started within the grace">
          {punctuality === null ? '-' : `${punctuality}% on time`}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs sm:grid-cols-6">
        <Stat label="Present" value={`${at.presentDays}/${at.scheduledDays}`} hint="Scheduled days (Mon-Sat, already over) with any footprint" />
        <Stat label="Late" value={at.lateDays ? `${at.lateDays}d · ${dur(at.lateMinutesTotal)}` : '0'} hint={at.latestStart ? `Worst ${dayLabel(at.latestStart.date)} at ${at.latestStart.time} (+${dur(at.latestStart.lateMinutes)})` : 'Never started after 08:05'} warn={at.lateDays > 0} />
        <Stat label="Left early" value={at.earlyDays ? `${at.earlyDays}d · ${dur(at.earlyMinutesTotal)}` : '0'} hint="Last footprint before 16:30 on a finished day" warn={at.earlyDays > 0} />
        <Stat label="Avg start" value={at.averageStart ?? '-'} hint="Mean first footprint on present days" />
        <Stat label="Avg finish" value={at.averageEnd ?? '-'} hint="Mean last footprint on finished present days" />
        <Stat
          label="Inbox"
          value={agent.activity.replies ? `${agent.activity.replies} sent` : '-'}
          hint={`${agent.activity.replies} replies · ${agent.activity.opens} leads opened · ${agent.activity.stars} starred · ${agent.activity.orderChanges} order edits`}
        />
      </dl>

      {at.missingDays.length ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="text-red-500">No activity</span> on {at.missingDays.length} scheduled {at.missingDays.length === 1 ? 'day' : 'days'}:{' '}
          <span className="font-mono">{at.missingDays.map(dayLabel).join(', ')}</span>
          <span className="text-muted-foreground/70"> - check against leave before reading it as absence.</span>
        </p>
      ) : null}

      {lateDays.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {lateDays.map((d) => (
            <li
              key={d.date}
              className="rounded-md border border-border/50 bg-muted/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums"
              title={`${d.firstTime}-${d.lastTime} · ${d.clients} clients · ${d.activity.replies} replies${d.date === today ? ' · still running' : ''}`}
            >
              {dayLabel(d.date)}
              {d.attendance!.lateMinutes > 0 ? <span className="text-amber-500"> +{dur(d.attendance!.lateMinutes)} late</span> : null}
              {(d.attendance!.earlyLeaveMinutes ?? 0) > 0 ? <span className="text-amber-500"> -{dur(d.attendance!.earlyLeaveMinutes!)} early</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div title={hint}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</dt>
      <dd className={`font-mono text-sm tabular-nums ${warn ? 'text-amber-500' : 'text-foreground/90'}`}>{value}</dd>
    </div>
  )
}
