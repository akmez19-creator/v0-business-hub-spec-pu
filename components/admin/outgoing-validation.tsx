'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OutgoingContractor, OutgoingProduct } from '@/lib/stock-outgoing'
import { adminValidateOutgoing, adminResetOutgoing } from '@/lib/stock-validation-actions'
import {
  AlertTriangle, Check, Loader2, RotateCcw, Truck,
  ChevronDown, ChevronRight, ShieldCheck,
} from 'lucide-react'

interface Verifier { name: string; role: string }

interface Props {
  contractors: OutgoingContractor[]
  today: string
  yesterday: string
  verifierMap: Record<string, Verifier>
}

const fmtDay = (d: string, today: string, yesterday: string) => {
  if (d === today) return 'Today'
  if (d === yesterday) return 'Yesterday'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export function OutgoingValidation({ contractors, today, yesterday, verifierMap }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCounted, setShowCounted] = useState(false)

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // A van with uncounted units leads the page. A fully counted one is proof of
  // work done, not an exception, so it is collapsed away by default.
  const uncounted = useMemo(
    () => contractors.filter(c => c.pendingQty > 0),
    [contractors],
  )
  const counted = useMemo(
    () => contractors.filter(c => c.pendingQty === 0),
    [contractors],
  )

  const totalMissing = uncounted.reduce((s, c) => s + c.pendingQty, 0)

  function run(fn: () => Promise<{ error?: string; affected?: number }>, key: string) {
    setBusy(key); setError('')
    startTransition(async () => {
      const res = await fn()
      setBusy(null)
      if (res?.error) { setError(res.error); return }
      if (res?.affected === 0) {
        setError('Nothing changed - these rows may already have been counted out.')
        return
      }
      router.refresh()
    })
  }

  const idsOf = (p: OutgoingProduct, onlyPending = true) =>
    p.items.filter(i => (onlyPending ? !i.validated : true)).map(i => i.id)

  return (
    <section className="flex flex-col gap-5">
      {/* Headline: units that went out of the door uncounted. */}
      <div className={cn(
        'rounded-xl border p-4 flex flex-wrap items-center gap-x-8 gap-y-3',
        totalMissing > 0
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border bg-card',
      )}>
        <div className="flex flex-col">
          <span className="text-3xl font-semibold tabular-nums">{totalMissing}</span>
          <span className="text-xs text-muted-foreground">
            {totalMissing === 1 ? 'unit left uncounted' : 'units left uncounted'}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-semibold tabular-nums">{uncounted.length}</span>
          <span className="text-xs text-muted-foreground">
            {uncounted.length === 1 ? 'van affected' : 'vans affected'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground max-w-sm text-pretty">
          {totalMissing > 0
            ? 'These units were loaded onto a van without the storekeeper counting them out. Once the rider has left, the load can no longer be checked against anything.'
            : 'Every unit loaded in this window was counted out at the warehouse.'}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {uncounted.length === 0 && counted.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <Truck className="w-8 h-8 mx-auto text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-sm text-muted-foreground">
            No vans were loaded in this window.
          </p>
        </div>
      )}

      {uncounted.map(c => {
        const key = `${c.id}::${c.date}`
        const isOpen = expanded.has(key)
        const pendingProducts = c.products.filter(p => p.pendingQty > 0)
        const allPendingIds = pendingProducts.flatMap(p => idsOf(p))

        return (
          <article key={key} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className="flex items-center gap-2 text-left min-w-0 flex-1"
              >
                {isOpen
                  ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="font-medium truncate">{c.name}</span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {fmtDay(c.date, today, yesterday)}
                </Badge>
              </button>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {c.pendingQty} of {c.totalQty} uncounted
                </span>
                <Button
                  size="sm"
                  onClick={() => run(() => adminValidateOutgoing(allPendingIds), key)}
                  disabled={busy === key}
                >
                  {busy === key
                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    : <Check className="w-4 h-4" aria-hidden="true" />}
                  <span className="ml-1.5">Accept load</span>
                </Button>
              </div>
            </div>

            {isOpen && (
              <ul className="border-t border-border divide-y divide-border">
                {c.products.map(p => {
                  const pKey = `${key}::${p.key}`
                  const done = p.pendingQty === 0
                  return (
                    <li key={pKey} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm truncate', done && 'text-muted-foreground')}>
                          {p.product}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.qty} {p.qty === 1 ? 'unit' : 'units'}
                          {p.pendingQty > 0 && p.pendingQty !== p.qty && (
                            <span className="text-amber-400"> - {p.pendingQty} uncounted</span>
                          )}
                        </p>
                      </div>
                      {done ? (
                        <Badge variant="outline" className="gap-1 text-xs border-emerald-500/40 text-emerald-400">
                          <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                          Counted
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => run(() => adminValidateOutgoing(idsOf(p)), pKey)}
                          disabled={busy === pKey}
                          aria-label={`Accept ${p.product} for ${c.name}`}
                        >
                          {busy === pKey
                            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            : <Check className="w-4 h-4" aria-hidden="true" />}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        )
      })}

      {counted.length > 0 && (
        <div>
          <button
            onClick={() => setShowCounted(v => !v)}
            aria-expanded={showCounted}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {showCounted
              ? <ChevronDown className="w-4 h-4" aria-hidden="true" />
              : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
            {counted.length} {counted.length === 1 ? 'van' : 'vans'} fully counted out
          </button>

          {showCounted && (
            <ul className="mt-3 flex flex-col gap-2">
              {counted.map(c => {
                const key = `${c.id}::${c.date}::done`
                const allIds = c.products.flatMap(p => idsOf(p, false))
                const signer = c.products
                  .flatMap(p => p.items.map(i => i.validatedBy))
                  .find(Boolean)
                const who = signer ? verifierMap[signer] : undefined
                return (
                  <li key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                    <span className="font-medium truncate flex-1 min-w-0">{c.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {fmtDay(c.date, today, yesterday)}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {c.totalQty} {c.totalQty === 1 ? 'unit' : 'units'}
                    </span>
                    {who && (
                      <span className="text-xs text-muted-foreground truncate">
                        by {who.name}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(() => adminResetOutgoing(allIds), key)}
                      disabled={busy === key}
                      aria-label={`Undo count for ${c.name}`}
                    >
                      {busy === key
                        ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        : <RotateCcw className="w-4 h-4" aria-hidden="true" />}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="text-pretty">
          {'Accepting a load here records that an admin signed it off after the fact. '}
          {'It is not the same as the storekeeper counting the units at the warehouse door, '}
          {'and it does not change stock levels.'}
        </span>
      </p>
    </section>
  )
}
