import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Truck, PackageCheck } from 'lucide-react'
import { type ReschedulePile, shortDay } from '@/lib/reschedule-stock'

/**
 * RESCHEDULED STOCK, split by WHERE THE GOODS PHYSICALLY ARE.
 *
 * A rescheduled order leaves its stock in one of two places, and the rider has
 * to do something different in each case:
 *
 *   keep    - it is already on his van. Do NOT let the storekeeper take it back
 *             and do NOT expect a fresh unit. This is the "which product to
 *             keep" list.
 *   collect - it went back to the store, so he must be handed it again before
 *             he leaves. Without this he drives off without the goods for an
 *             order his own list tells him to deliver.
 *
 * Read-only. Nothing here is a tick: the rider confirms goods through the
 * normal stock validation, and a second place to confirm would let the two
 * disagree.
 */
export function RescheduleStockPanel({
  keepPiles,
  collectPiles,
}: {
  keepPiles: ReschedulePile[]
  collectPiles: ReschedulePile[]
}) {
  if (keepPiles.length === 0 && collectPiles.length === 0) return null

  return (
    <section className="space-y-3" aria-labelledby="resched-stock-heading">
      <h2
        id="resched-stock-heading"
        className="text-sm font-semibold text-foreground flex items-center gap-2 px-1"
      >
        <PackageCheck className="w-4 h-4 text-primary" aria-hidden="true" />
        Rescheduled orders
      </h2>

      {/* KEEP FIRST. Acting on this one is time-critical: the storekeeper is
          counting his returns at the same moment, and once a unit is handed
          back it has to be re-issued all over again. */}
      <PileGroup
        piles={keepPiles}
        tone="keep"
        heading="Keep on your van"
        note="Already with you - do not hand these back"
        unitLabel="on van"
      />

      <PileGroup
        piles={collectPiles}
        tone="collect"
        heading="Collect from the store"
        note="Came back to the store - get these before you leave"
        unitLabel="to collect"
      />
    </section>
  )
}

function PileGroup({
  piles,
  tone,
  heading,
  note,
  unitLabel,
}: {
  piles: ReschedulePile[]
  tone: 'keep' | 'collect'
  heading: string
  note: string
  unitLabel: string
}) {
  if (piles.length === 0) return null

  const total = piles.reduce((s, p) => s + p.qty, 0)
  const keep = tone === 'keep'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
          {keep
            ? <Truck className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
            : <PackageCheck className="w-3.5 h-3.5 text-primary" aria-hidden="true" />}
          <span className={keep ? 'text-amber-500' : 'text-primary'}>{heading}</span>
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {total} {total === 1 ? 'item' : 'items'}
        </span>
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">{note}</p>

      <div className="space-y-2">
        {piles.map(p => (
          <Card
            key={p.key}
            className={`border-0 shadow-sm ${keep ? 'bg-amber-500/5' : 'bg-primary/5'}`}
          >
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.label}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    {/* Named clients, so he can match a unit to an order rather
                        than guessing which of two identical products is which. */}
                    {p.customers.length > 0 && (
                      <span className="text-[10px] text-muted-foreground truncate">
                        {p.customers.join(', ')}
                      </span>
                    )}
                    {/* The day it FIRST went out. Says how long this has been
                        dragging, which a due-date alone cannot. */}
                    {p.fromDates.length > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 bg-muted/40 text-muted-foreground border-border"
                      >
                        from {p.fromDates.map(shortDay).join(', ')}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p
                    className={`text-lg font-bold tabular-nums ${
                      keep ? 'text-amber-500' : 'text-primary'
                    }`}
                  >
                    {p.qty}
                  </p>
                  <p className="text-[9px] text-muted-foreground">{unitLabel}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
