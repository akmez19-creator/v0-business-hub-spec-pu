import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Truck, AlertTriangle } from 'lucide-react'
import { type VanPile, vanTotal, carriedOverTotal, shortDate } from '@/lib/van-stock'

/**
 * "Still on your van" - refused (NWD) units, ONE ROW PER PRODUCT.
 *
 * Rendered ABOVE the general stock list on both the rider and contractor
 * screens, because this is stock the rider is already carrying: he needs to
 * know it before he starts reading through the day's new orders.
 *
 * Read-only ON PURPOSE. These goods never reached the store, so there is
 * nothing for anyone to receive or tick here - a tick would claim a physical
 * hand-over that did not happen.
 *
 * One component used by both screens so the two cannot drift apart.
 */
export function OnVanPanel({
  piles,
  activeDate,
  heading = 'Still on your van',
}: {
  piles: VanPile[]
  activeDate: string
  heading?: string
}) {
  if (piles.length === 0) return null

  const total = vanTotal(piles)
  const carried = carriedOverTotal(piles, activeDate)

  return (
    <section className="space-y-2" aria-labelledby="on-van-heading">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="on-van-heading" className="text-sm font-semibold flex items-center gap-2">
          <Truck className="w-4 h-4 text-red-500" aria-hidden="true" />
          {heading}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {total} {total === 1 ? 'item' : 'items'} · {piles.length}{' '}
          {piles.length === 1 ? 'product' : 'products'}
        </span>
      </div>

      {/* Only stated when true - goods stuck since an earlier day are the
          reason this panel exists at all, but claiming it on a same-day
          refusal would be noise. */}
      {carried > 0 && (
        <p className="px-1 text-xs text-amber-500 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            {carried} {carried === 1 ? 'item has' : 'items have'} been on the van since
            before {shortDate(activeDate)} - not yet returned to the store
          </span>
        </p>
      )}

      <div className="space-y-2">
        {piles.map(p => (
          <Card key={p.key} className="border-0 shadow-sm bg-red-500/5">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.label}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {p.orderCount} refused {p.orderCount === 1 ? 'order' : 'orders'}
                    </span>
                    {/* Dates are shown so a rider can say WHICH day a unit is
                        from when he brings it back. */}
                    <span className="text-[10px] text-muted-foreground">
                      {p.dates.map(shortDate).join(', ')}
                    </span>
                    {p.carriedOver && (
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20"
                      >
                        carried over
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-red-500 tabular-nums">{p.qty}</p>
                  <p className="text-[9px] text-muted-foreground">on van</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
