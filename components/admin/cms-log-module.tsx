'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  ChevronDown, Search, History, CalendarClock, AlertTriangle,
  RotateCcw, Info, User, MapPin, Phone, Hash,
} from 'lucide-react'
import { cn } from '@/lib/utils'
// Import from cms-log-shared, NOT cms-log: the latter pulls in the server
// Supabase client (next/headers), which cannot be bundled for the browser.
import { reasonMeta, type CmsOrder, type CmsSummary } from '@/lib/cms-log-shared'

type Summary = CmsSummary

const fmtRs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`

function fmtDate(s: string | null) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtWhen(s: string | null) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function ReasonChip({ code }: { code: string | null }) {
  const m = reasonMeta(code)
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap', m.tone)}>
      {m.label}
    </span>
  )
}

/** One order, expandable into its full event timeline. */
function OrderRow({ order }: { order: CmsOrder }) {
  const [open, setOpen] = useState(false)
  const hasTrail = order.reasonTrail.length > 1

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/40 transition-colors"
      >
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{order.customerName || 'Unknown client'}</span>
            {order.indexNo && (
              <span className="font-mono text-[11px] text-muted-foreground">{order.indexNo}</span>
            )}
            <ReasonChip code={order.latest?.reason_code ?? null} />
            {order.resolved && (
              <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-400">
                Resolved
              </Badge>
            )}
            {hasTrail && (
              <Badge variant="outline" className="border-fuchsia-500/25 bg-fuchsia-500/10 text-[10px] text-fuchsia-400">
                {order.reasonTrail.length} reasons
              </Badge>
            )}
          </div>

          {/* Verbatim current reason - the evidence, never cleaned up. */}
          <p className="mt-1 text-sm text-muted-foreground truncate">
            {order.latest?.reason_text || 'No reason recorded'}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {order.riderName && (
              <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{order.riderName}</span>
            )}
            {order.locality && (
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{order.locality}</span>
            )}
            {order.contact && (
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{order.contact}</span>
            )}
            <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" />{order.attempts} event{order.attempts === 1 ? '' : 's'}</span>
            {order.postponedTo && (
              <span className="inline-flex items-center gap-1 text-violet-400">
                <CalendarClock className="h-3 w-3" />Due {fmtDate(order.postponedTo)}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-semibold">{order.amount != null ? fmtRs(Number(order.amount)) : '-'}</div>
          <div className="text-[11px] text-muted-foreground">{fmtDate(order.deliveryDate)}</div>
        </div>
      </button>

      {open && (
        <div className="bg-muted/20 px-4 pb-4 pl-11">
          {order.reconstructedOnly && (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[11px] text-amber-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Reconstructed from current state - this order changed before event logging existed.
                Any earlier reasons it carried were overwritten and cannot be recovered.
              </span>
            </p>
          )}

          <ol className="relative space-y-3 border-l border-border pl-4">
            {order.events.map(e => {
              const m = reasonMeta(e.reason_code)
              return (
                <li key={e.id} className="relative">
                  <span
                    className={cn(
                      'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background',
                      e.event === 'resolved' ? 'bg-emerald-500'
                        : e.event === 'reason_changed' ? 'bg-fuchsia-500' : 'bg-amber-500',
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold capitalize">
                      {e.event.replace('_', ' ')}
                    </span>
                    <ReasonChip code={e.reason_code} />
                    {e.backfilled && (
                      <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                        reconstructed
                      </span>
                    )}
                    {!m.failure && (
                      <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-400">
                        not a failure
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm">{e.reason_text || <span className="text-muted-foreground">(no reason text)</span>}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {e.backfilled ? 'Last known change ' : ''}{fmtWhen(e.changed_at)}
                    {e.old_status && ` · ${e.old_status} → ${e.new_status}`}
                    {e.postponed_to && ` · rescheduled to ${fmtDate(e.postponed_to)}`}
                  </p>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

export function CmsLogModule({
  orders, summary,
}: { orders: CmsOrder[]; summary: Summary }) {
  const [q, setQ] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [state, setState] = useState<'open' | 'resolved' | 'all'>('open')

  const filtered = useMemo(() => {
    let list = orders
    if (state === 'open') list = list.filter(o => !o.resolved)
    if (state === 'resolved') list = list.filter(o => o.resolved)
    if (reason) list = list.filter(o => (o.latest?.reason_code || 'unspecified') === reason)
    if (q.trim()) {
      const n = q.trim().toLowerCase()
      list = list.filter(o =>
        (o.customerName || '').toLowerCase().includes(n) ||
        (o.indexNo || '').toLowerCase().includes(n) ||
        (o.contact || '').toLowerCase().includes(n) ||
        o.reasonTrail.some(r => r.toLowerCase().includes(n)))
    }
    return list
  }, [orders, q, reason, state])

  return (
    <div className="flex flex-col gap-4">
      {/* Headline numbers. Postponed is deliberately separated from failures. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open CMS</p>
            <p className="text-2xl font-bold">{summary.open}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{summary.resolved} since resolved</p>
          </CardContent>
        </Card>
        <Card className="border-rose-500/25 bg-rose-500/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Genuine failures</p>
            <p className="text-2xl font-bold text-rose-400">{summary.genuineFailures}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtRs(summary.valueAtRisk)} at risk</p>
          </CardContent>
        </Card>
        <Card className="border-violet-500/25 bg-violet-500/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Postponed</p>
            <p className="text-2xl font-bold text-violet-400">{summary.postponed}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">reschedules, not failures</p>
          </CardContent>
        </Card>
        <Card className="border-fuchsia-500/25 bg-fuchsia-500/5">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Repeat CMS</p>
            <p className="text-2xl font-bold text-fuchsia-400">{summary.repeats}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">changed reason at least once</p>
          </CardContent>
        </Card>
      </div>

      {/* Honest provenance banner - the log cannot show what was destroyed. */}
      {summary.reconstructed > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-400">
          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>{summary.reconstructed}</strong> order{summary.reconstructed === 1 ? '' : 's'} shown from reconstructed
            state only, with <strong>{summary.observedEvents}</strong> genuinely observed event{summary.observedEvents === 1 ? '' : 's'} recorded so far.
            Before this log existed each new reason overwrote the previous one, so earlier attempts on those
            orders are gone. Everything from now on is captured in full.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Reason breakdown doubles as a filter. */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
              Reasons (open)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-3 pt-0">
            {summary.byReason.map(([code, n]) => {
              const m = reasonMeta(code)
              const pct = summary.open ? Math.round((n / summary.open) * 100) : 0
              const active = reason === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setReason(active ? null : code)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex-1 text-xs">{m.label}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn('block h-full rounded-full', m.failure ? 'bg-rose-500/70' : 'bg-violet-500/70')}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="w-6 text-right text-xs font-semibold tabular-nums">{n}</span>
                </button>
              )
            })}
            {!summary.byReason.length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">No open CMS orders.</p>
            )}
          </CardContent>
        </Card>

        {/* Rider split, showing reschedules apart from real failures. */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-sky-500" aria-hidden="true" />
              By rider
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-3 pt-0">
            {summary.byRider.slice(0, 8).map(([name, s]) => (
              <div key={name} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
                <span className="flex-1 truncate">{name}</span>
                <span className="text-rose-400 tabular-nums" title="genuine failures">{s.failed}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-violet-400 tabular-nums" title="postponements">{s.postponed}</span>
              </div>
            ))}
            {!summary.byRider.length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">Nothing to show.</p>
            )}
            <p className="mt-1 px-2 text-[10px] text-muted-foreground">
              <span className="text-rose-400">failures</span> / <span className="text-violet-400">postponed</span>
            </p>
          </CardContent>
        </Card>

        {/* Where postponed orders actually land. */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="h-4 w-4 text-violet-500" aria-hidden="true" />
              Rescheduled to
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-3 pt-0">
            {summary.upcoming.map(([date, n]) => (
              <div key={date} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
                <span className="flex-1">{fmtDate(date)}</span>
                <span className="font-semibold tabular-nums text-violet-400">{n}</span>
              </div>
            ))}
            {!summary.upcoming.length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">No dated postponements.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The log itself */}
      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" aria-hidden="true" />
              CMS log ({filtered.length})
            </CardTitle>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
              {(['open', 'resolved', 'all'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(s)}
                  aria-pressed={state === s}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    state === s ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Client, order no, phone or reason text"
                className="h-9 pl-8"
                aria-label="Search the CMS log"
              />
            </div>
            {reason && (
              <button
                type="button"
                onClick={() => setReason(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Clear {reasonMeta(reason).label}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length ? (
            filtered.map(o => <OrderRow key={o.deliveryId} order={o} />)
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing matches these filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
