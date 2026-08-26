'use client'

// "Somebody went to count it and it was not there."
//
// Every row on this screen is something a NAMED PERSON reported while holding
// the stock. Three moments, three reporters:
//   storekeeper - validating stock OUT, nothing on the shelf to hand over
//   rider       - counting his load in the morning, got fewer than the round
//   returns     - storekeeper counting the van back IN, fewer came back
// Nothing here is inferred from the product catalogue, because `quantity` and
// `zone` vary far too much to accuse anyone with (239 of 851 products sit at 0
// purely because nobody counted them).
//
// That is why there are no "confidence" buckets any more. There is nothing to
// hedge: somebody said it, or nobody did.

import { useState, useTransition } from 'react'
import {
  ChevronDown, PackageX, CheckCircle2, Truck, Warehouse,
  ShieldQuestion, Undo2, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ShortageGroup, ShortageItem, ShortageSource } from '@/lib/stock-availability'
import {
  reviewStockShortfall,
  clearStockShortfallReview,
} from '@/lib/shortfall-review-actions'

interface Props {
  groups: ShortageGroup[]
  today: string
  yesterday: string
  /** Admins and managers rule on shortages; everyone else reads the outcome. */
  canReview: boolean
}

const SOURCE_META: Record<ShortageSource, { label: string; Icon: typeof Truck }> = {
  storekeeper: { label: 'Storekeeper', Icon: Warehouse },
  rider: { label: 'Rider', Icon: Truck },
}

function fmtDay(date: string, today: string, yesterday: string) {
  if (date === today) return 'Today'
  if (date === yesterday) return 'Yesterday'
  return new Date(date + 'T00:00:00').toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short' })
}

/** A rider report is the only kind an admin can rule on - see the note below. */
function isReviewable(item: ShortageItem) {
  return item.source === 'rider'
}

/**
 * Confirm / reject controls for one rider-reported shortage.
 *
 * Confirming is what actually removes the units from the storekeeper's returns
 * list, so it is never automatic and never inferred from the rider's own
 * validation - he would be approving his own report.
 */
function ReviewControls({ item, canReview }: { item: ShortageItem; canReview: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ error?: string } | undefined>) => {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res?.error) setError(res.error)
    })
  }

  const args = {
    contractorId: item.contractorId,
    stockDate: item.date,
    product: item.product,
  }

  if (item.review) {
    const confirmed = item.review === 'confirmed'
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            confirmed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted/60 text-muted-foreground',
          )}
        >
          {confirmed ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
          {confirmed ? 'Never left store' : 'Did go out'}
        </span>
        {canReview && (
          <button
            onClick={() => run(() => clearStockShortfallReview(args))}
            disabled={pending}
            className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            title="Undo this decision"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">Undo decision</span>
          </button>
        )}
      </span>
    )
  }

  if (!canReview) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
        <ShieldQuestion className="h-3 w-3" aria-hidden />
        Awaiting admin
      </span>
    )
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <span className="flex items-center gap-1.5">
        <button
          onClick={() => run(() => reviewStockShortfall({ ...args, ruling: 'confirmed' }))}
          disabled={pending}
          className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          Never left store
        </button>
        <button
          onClick={() => run(() => reviewStockShortfall({ ...args, ruling: 'rejected' }))}
          disabled={pending}
          className="rounded-full border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
        >
          It did go out
        </button>
      </span>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  )
}

export function AvailabilityValidation({ groups, today, yesterday, canReview }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const totalUnits = groups.reduce((s, g) => s + g.qty, 0)

  // Rider reports nobody has ruled on. These units are STILL on the
  // storekeeper's returns list - that is the whole point of the queue.
  const awaiting = groups.flatMap(g => g.items.filter(i => isReviewable(i) && !i.review))
  const awaitingUnits = awaiting.reduce((s, i) => s + i.qty, 0)

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-card/40 py-14 text-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-400" aria-hidden />
        <p className="text-sm font-medium">Nobody reported a shortage</p>
        <p className="text-xs text-muted-foreground text-pretty max-w-sm">
          {'Nothing appears here until somebody counts a shortage \u2014 at dispatch, on the rider\u2019s load, or when the returns come back in.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums text-red-400">
            {totalUnits}
          </span>
          <span className="text-sm text-muted-foreground text-pretty leading-relaxed">
            {'units were reported missing at validation, across '}
            {groups.length} product{groups.length === 1 ? '' : 's'}
            {' \u2014 either never handed out, or never came back. Each one was counted by a person, not worked out from the catalogue.'}
          </span>
        </div>
      </div>

      {awaitingUnits > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-amber-400">
              {awaitingUnits}
            </span>
            <span className="text-sm text-muted-foreground text-pretty leading-relaxed">
              {'units the riders say they never received, with no decision yet. Until you rule on each one it stays on the storekeeper\u2019s returns list, marked unconfirmed \u2014 nothing is hidden from him on a rider\u2019s word alone.'}
            </span>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {groups.map(g => {
          const isOpen = open === g.key
          const bothSides = g.sources.length > 1
          return (
            <li key={g.key} className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : g.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
              >
                <ChevronDown
                  className={cn('w-4 h-4 shrink-0 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180')}
                  aria-hidden
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium">{g.product}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmtDay(g.latestDate, today, yesterday)}
                    {' · '}
                    {g.contractors.length === 1
                      ? g.contractors[0]
                      : `${g.contractors.length} contractors`}
                  </span>
                </span>

                {/* Who said so. Both sides reporting the same product is the
                    strongest signal on the page, so it is stated outright. */}
                <span className="hidden sm:flex shrink-0 items-center gap-1.5">
                  {g.sources.map(s => {
                    const m = SOURCE_META[s]
                    return (
                      <span
                        key={s}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                          bothSides
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-muted/60 text-muted-foreground',
                        )}
                      >
                        <m.Icon className="w-3 h-3" aria-hidden />
                        {m.label}
                      </span>
                    )
                  })}
                </span>

                <span className="shrink-0 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium tabular-nums text-red-400">
                  {g.qty} short
                </span>
              </button>

              {isOpen && (
                <ul className="border-t border-border/60 divide-y divide-border/40">
                  {g.items.map(item => (
                    <li
                      key={`${item.source}:${item.id}`}
                      className={cn(
                        'flex flex-wrap items-center gap-3 px-4 py-2.5 pl-11',
                        isReviewable(item) && !item.review && 'bg-amber-500/5',
                      )}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm">
                          {item.contractorName}
                          {item.customer && (
                            <span className="text-muted-foreground"> · {item.customer}</span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {/* Each source is a different question answered, so
                              each gets its own sentence. The rider's is a
                              count, and a count must show its denominator or
                              "-2" is unreadable. */}
                          {item.source === 'rider'
                            ? `Counted in: got ${item.receivedQty} of ${item.expectedQty}`
                            : 'Storekeeper: none available to give out'}
                          {item.note && (
                            <span className="italic"> &middot; {item.note}</span>
                          )}
                          {item.reviewNote && (
                            <span className="italic"> &middot; {item.reviewNote}</span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {fmtDay(item.date, today, yesterday)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums w-12 text-right text-red-400">
                        -{item.qty}
                      </span>
                      {/* Only the rider's report is ruled on here. The
                          storekeeper's "none to give" was made BY the store,
                          so there is nothing for the store to confirm. */}
                      {isReviewable(item) && (
                        <ReviewControls item={item} canReview={canReview} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty leading-relaxed">
        <PackageX className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        {'A report is a flag, not a stock movement. Nothing here changes a stock level - it records that a person went to count a unit and it was not there.'}
      </p>
    </div>
  )
}
