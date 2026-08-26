'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupReturns } from '@/lib/returns-merge'
import type { InboundContractor, InboundItem } from '@/lib/returns-inbound'
import type { OutgoingContractor } from '@/lib/stock-outgoing'
import { OutgoingValidation } from './outgoing-validation'
import type { ShortageGroup } from '@/lib/stock-availability'
import { AvailabilityValidation } from './availability-validation'
import { adminValidateReturns, adminResetReturns } from '@/lib/stock-validation-actions'
import {
  AlertTriangle, Check, Loader2, PackageX, RotateCcw, CalendarDays,
  ChevronDown, ChevronRight, ExternalLink, ShieldCheck,
} from 'lucide-react'

interface Verifier { name: string; role: string }

interface Props {
  contractors: InboundContractor[]
  outgoing: OutgoingContractor[]
  view: 'out' | 'in' | 'nostock'
  outgoingBacklogUnits: number
  /** Shortages REPORTED by the storekeeper or a rider - never inferred. */
  shortages: ShortageGroup[]
  shortageUnits: number
  /** Whether this viewer may confirm/reject a rider-reported shortage. */
  canReview: boolean
  scope: 'round' | 'yesterday' | 'range' | 'all'
  from: string | null
  to: string | null
  today: string
  lastRound: string
  yesterday: string
  availableDates: string[]
  backlogUnits: number
  backlogContractors: number
  oldestOutstanding: string | null
  verifierMap: Record<string, Verifier>
}

const fmtDay = (d: string, today: string, yesterday: string) => {
  if (d === today) return 'Today'
  if (d === yesterday) return 'Yesterday'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

/** Whole days between a delivery day and today. The core admin signal. */
function ageInDays(date: string, today: string): number {
  const a = new Date(date + 'T00:00:00Z').getTime()
  const b = new Date(today + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

function ageTone(days: number): string {
  if (days >= 7) return 'text-red-400'
  if (days >= 3) return 'text-amber-400'
  return 'text-muted-foreground'
}

export function StockValidation({
  contractors, outgoing, view, outgoingBacklogUnits, shortages, shortageUnits,
  canReview, scope, from, to, today, lastRound, yesterday,
  backlogUnits, backlogContractors, oldestOutstanding, verifierMap,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSettled, setShowSettled] = useState(false)
  const [rangeFrom, setRangeFrom] = useState(from ?? '')
  const [rangeTo, setRangeTo] = useState(to ?? '')

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // Only contractors with something still outstanding lead the page; the rest
  // are reachable but must not bury the exceptions.
  const outstanding = useMemo(
    () => contractors
      .map(c => ({ ...c, unverified: c.items.filter(i => !i.verified) }))
      .filter(c => c.unverified.length > 0)
      .sort((a, b) => b.pendingQty - a.pendingQty),
    [contractors],
  )
  const settled = useMemo(
    () => contractors.filter(c => c.items.every(i => i.verified)),
    [contractors],
  )

  const scopedUnits = outstanding.reduce((s, c) => s + c.pendingQty, 0)
  const scopedRows = outstanding.reduce((s, c) => s + c.unverified.length, 0)
  const oldestAge = oldestOutstanding ? ageInDays(oldestOutstanding, today) : 0

  function run(fn: () => Promise<{ error?: string; affected?: number }>, key: string) {
    setBusy(key); setError('')
    startTransition(async () => {
      const res = await fn()
      setBusy(null)
      if (res?.error) { setError(res.error); return }
      if (res?.affected === 0) {
        setError('Nothing changed - the rows may already have been validated.')
        return
      }
      router.refresh()
    })
  }

  const validate = (items: InboundItem[], key: string) => run(() => adminValidateReturns({
    deliveryIds: items.filter(i => i.source === 'delivery').map(i => i.id),
    returnCollectionIds: items.filter(i => i.source === 'return_collection').map(i => i.id),
  }), key)

  const reset = (items: InboundItem[], key: string) => run(() => adminResetReturns({
    deliveryIds: items.filter(i => i.source === 'delivery').map(i => i.id),
    returnCollectionIds: items.filter(i => i.source === 'return_collection').map(i => i.id),
  }), key)

  // Every navigation carries the current tab, so changing the date does not
  // silently throw the admin back to the other half of the day.
  const scopeHref = (s: string) => `/dashboard/admin/stock-validation?scope=${s}&view=${view}`
  const viewHref = (v: string) => {
    const p = new URLSearchParams()
    if (scope === 'range' && (from || to)) {
      p.set('from', from || to || ''); p.set('to', to || from || '')
    } else {
      p.set('scope', scope)
    }
    p.set('view', v)
    return `/dashboard/admin/stock-validation?${p.toString()}`
  }
  const scopeLabel = scope === 'all'
    ? 'All dates'
    : from && to && from !== to
      ? `${fmtDay(from, today, yesterday)} to ${fmtDay(to, today, yesterday)}`
      : from ? fmtDay(from, today, yesterday) : '-'

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6 max-w-6xl mx-auto">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stock Validation</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {view === 'out'
            ? 'Opening stock that went onto a van without the storekeeper counting it out.'
            : view === 'nostock'
              ? 'Units a person reported having none of: nothing to hand over at dispatch, or short on the rider\u2019s load.'
              : 'Returns that left with a rider and were never counted back in by the storekeeper.'}
        </p>
      </header>

      {/* The two halves of the day. Outgoing first because it is the check the
          warehouse can still act on; returns are reviewed after the round. */}
      <nav className="flex items-center gap-2 border-b border-border" aria-label="Stock direction">
        <ViewTab href={viewHref('out')} active={view === 'out'} count={outgoingBacklogUnits}>
          Going out
        </ViewTab>
        <ViewTab href={viewHref('in')} active={view === 'in'} count={backlogUnits}>
          Coming back
        </ViewTab>
        {/* Only what a person actually reported at validation time - the
            storekeeper counting out, or the rider counting his load in.
            Never inferred from the catalogue. */}
        <ViewTab href={viewHref('nostock')} active={view === 'nostock'} count={shortageUnits} tone="red">
          No stock
        </ViewTab>
      </nav>

      {view === 'in' && (
        <>
          {/* The headline is deliberately the WHOLE backlog, not the selected day:
              a clean day must not read as "nothing wrong" while old rows rot. */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label="Summary">
            <Stat
              label="Outstanding, all dates"
              value={String(backlogUnits)}
              sub={`${backlogContractors} contractor${backlogContractors === 1 ? '' : 's'}`}
              tone={backlogUnits > 0 ? 'alert' : 'ok'}
            />
            <Stat label="In this view" value={String(scopedUnits)} sub={`${scopedRows} rows`} />
            <Stat
              label="Oldest outstanding"
              value={oldestOutstanding ? `${oldestAge}d` : '-'}
              sub={oldestOutstanding ? fmtDay(oldestOutstanding, today, yesterday) : 'nothing pending'}
              tone={oldestAge >= 7 ? 'alert' : undefined}
            />
            <Stat label="Showing" value={scopeLabel} sub={scope === 'all' ? 'full backlog' : 'selected window'} />
          </section>

          {/* Validating is a FLAG, not a restock. Saying so on the page stops the
              number being read as inventory that is available to sell again. */}
          <p className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-400" aria-hidden />
            <span className="text-pretty">
              Validating confirms the item physically came back. It does not add the unit to
              sellable stock - nothing in the system does that yet, so anything unvalidated here
              has left the stock count entirely.
            </span>
          </p>
        </>
      )}

      <nav className="flex flex-wrap items-center gap-2" aria-label="Date range">
        <ScopeTab href={scopeHref('round')} active={scope === 'round'}>
          Last round <span className="opacity-60">{fmtDay(lastRound, today, yesterday)}</span>
        </ScopeTab>
        <ScopeTab href={scopeHref('yesterday')} active={scope === 'yesterday'}>Yesterday</ScopeTab>
        <ScopeTab href={scopeHref('all')} active={scope === 'all'}>All dates</ScopeTab>

        <div className="flex items-center gap-1.5 ml-auto">
          <CalendarDays className="w-4 h-4 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor="from">From date</label>
          <Input
            id="from" type="date" value={rangeFrom}
            onChange={e => setRangeFrom(e.target.value)}
            className="h-9 w-[9.5rem]"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <label className="sr-only" htmlFor="to">To date</label>
          <Input
            id="to" type="date" value={rangeTo}
            onChange={e => setRangeTo(e.target.value)}
            className="h-9 w-[9.5rem]"
          />
          <Button
            size="sm" variant="secondary" disabled={!rangeFrom && !rangeTo}
            onClick={() => router.push(
              `/dashboard/admin/stock-validation?from=${rangeFrom || rangeTo}&to=${rangeTo || rangeFrom}&view=${view}`,
            )}
          >
            Apply
          </Button>
        </div>
      </nav>

      {error && (
        <p role="alert" className="text-sm text-red-400 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          {error}
        </p>
      )}

      {view === 'out' && (
        <OutgoingValidation
          contractors={outgoing}
          today={today}
          yesterday={yesterday}
          verifierMap={verifierMap}
        />
      )}

      {view === 'nostock' && (
        <AvailabilityValidation
          groups={shortages}
          today={today}
          yesterday={yesterday}
          canReview={canReview}
        />
      )}

      {view === 'in' && (outstanding.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 py-14 text-center">
          <ShieldCheck className="w-8 h-8 text-emerald-400" aria-hidden />
          <p className="font-medium">Everything in this window is validated</p>
          <p className="text-sm text-muted-foreground">
            {backlogUnits > 0
              ? `${backlogUnits} unit${backlogUnits === 1 ? '' : 's'} still outstanding on other dates.`
              : 'No returns are outstanding on any date.'}
          </p>
          {backlogUnits > 0 && scope !== 'all' && (
            <Button asChild variant="secondary" size="sm" className="mt-1">
              <Link href={scopeHref('all')}>Show the full backlog</Link>
            </Button>
          )}
        </div>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Outstanding returns">
          {outstanding.map(c => {
            const isOpen = expanded.has(c.id)
            const groups = groupReturns(c.unverified)
            const worst = Math.max(...c.unverified.map(i => ageInDays(i.date, today)))
            return (
              <article key={c.id} className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
                <div className="flex items-center gap-3 p-3 md:p-4">
                  <button
                    onClick={() => toggle(c.id)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
                      : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <PackageX className="w-4 h-4 shrink-0 text-amber-400" aria-hidden />
                    <span className="font-medium truncate">{c.name}</span>
                    <span className={cn('text-xs shrink-0', ageTone(worst))}>
                      {worst === 0 ? 'today' : `${worst}d old`}
                    </span>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="tabular-nums border-amber-500/40 text-amber-300">
                      {c.pendingQty} unit{c.pendingQty === 1 ? '' : 's'}
                    </Badge>
                    <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
                      <Link
                        href={`/dashboard/storekeeper/stock-in?contractor=${c.id}`}
                        title="Open on the storekeeper screen"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                        <span className="sr-only">Open {c.name} on the storekeeper screen</span>
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => validate(c.unverified, `c:${c.id}`)}
                      disabled={pending}
                    >
                      {busy === `c:${c.id}`
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                        : <Check className="w-4 h-4" aria-hidden />}
                      Validate all
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <ul className="border-t border-border/60 divide-y divide-border/40">
                    {groups.map(g => {
                      const age = Math.max(...g.entries.map(e => ageInDays(e.date, today)))
                      return (
                        <li key={g.key} className="flex items-center gap-3 px-3 md:px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm truncate">{g.label}</span>
                              {g.settlementKind && (
                                <Badge variant="outline" className="text-[10px] uppercase border-amber-500/40 text-amber-300">
                                  {g.settlementKind.replace('_', ' ')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {fmtDay(g.entries[0].date, today, yesterday)}
                              {' · '}{g.entries[0].riderName}
                              {g.entries.length > 1 && ` · ${g.entries.length} orders`}
                              {g.entries[0].customerName && ` · ${g.entries[0].customerName}`}
                            </p>
                          </div>
                          <span className={cn('text-xs tabular-nums shrink-0', ageTone(age))}>
                            {age === 0 ? 'today' : `${age}d`}
                          </span>
                          <span className="text-sm tabular-nums w-8 text-right shrink-0">{g.totalQty}</span>
                          <Button
                            size="sm" variant="secondary"
                            onClick={() => validate(g.entries, `g:${c.id}:${g.key}`)}
                            disabled={pending}
                          >
                            {busy === `g:${c.id}:${g.key}`
                              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                              : <Check className="w-4 h-4" aria-hidden />}
                            <span className="sr-only">Validate {g.label}</span>
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            )
          })}
        </section>
      ))}

      {view === 'in' && settled.length > 0 && (
        <section aria-label="Already validated">
          <button
            onClick={() => setShowSettled(v => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showSettled}
          >
            {showSettled ? <ChevronDown className="w-4 h-4" aria-hidden /> : <ChevronRight className="w-4 h-4" aria-hidden />}
            {settled.length} contractor{settled.length === 1 ? '' : 's'} fully validated in this window
          </button>

          {showSettled && (
            <ul className="mt-3 flex flex-col gap-2">
              {settled.map(c => {
                const signers = [...new Set(
                  c.items.map(i => i.verifiedBy && verifierMap[i.verifiedBy]?.name).filter(Boolean),
                )]
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/20 px-3 py-2"
                  >
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden />
                    <span className="text-sm truncate flex-1">{c.name}</span>
                    <span className="text-xs text-muted-foreground truncate hidden sm:block">
                      {signers.length ? `by ${signers.join(', ')}` : 'signer unknown'}
                    </span>
                    <Badge variant="outline" className="tabular-nums">{c.verifiedQty}</Badge>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => reset(c.items, `r:${c.id}`)}
                      disabled={pending}
                      title="Undo validation"
                    >
                      {busy === `r:${c.id}`
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                        : <RotateCcw className="w-4 h-4" aria-hidden />}
                      <span className="sr-only">Undo validation for {c.name}</span>
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'alert' | 'ok'
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3 flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn(
        'text-2xl font-semibold tabular-nums tracking-tight',
        tone === 'alert' && 'text-amber-400',
        tone === 'ok' && 'text-emerald-400',
      )}>
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground truncate">{sub}</span>}
    </div>
  )
}

/** Top-level tab for the two directions stock moves, with its own backlog
 *  count so the unselected half cannot hide a problem. */
function ViewTab({ href, active, count, children, tone }: {
  href: string; active: boolean; count: number; children: React.ReactNode
  /** Red marks a confirmed problem rather than an outstanding task. */
  tone?: 'red'
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      {count > 0 && (
        <span className={cn(
          'rounded-full px-2 py-0.5 text-xs tabular-nums',
          tone === 'red' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400',
        )}>
          {count}
        </span>
      )}
    </Link>
  )
}

function ScopeTab({ href, active, children }: {
  href: string; active: boolean; children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors border',
        active
          ? 'bg-primary text-primary-foreground border-transparent'
          : 'bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted/70',
      )}
    >
      {children}
    </Link>
  )
}
