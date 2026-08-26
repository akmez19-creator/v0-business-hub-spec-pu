import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bike, Package, Truck } from 'lucide-react'
import { buildVanPiles, shortDate } from '@/lib/van-stock'

/**
 * REFUSED GOODS THAT NEVER CAME BACK TO THE STORE (NWD).
 *
 * Kept as its own section, and its units are never folded into "Total CMS":
 * CMS goods are back in the store, these are sitting on a named van. One number
 * cannot mean two different physical places.
 *
 * Grouping is by RIDER first because the goods are on ONE van - a company-wide
 * product total would say 6 Salt Cups exist somewhere without saying whose van
 * to ring. The product merge inside each rider reuses `buildVanPiles`, the same
 * helper the rider and storekeeper screens use, so a product collapses
 * identically everywhere.
 */

type VanRider = {
  riderId: string
  name: string
  // Derived from the helper rather than restated, so it cannot drift.
  piles: ReturnType<typeof buildVanPiles>
  units: number
  orders: number
  stuckUnits: number
}

export function CmsVanStock({
  vanByRider,
  vanUnitsTotal,
  vanStuckTotal,
}: {
  vanByRider: VanRider[]
  vanUnitsTotal: number
  vanStuckTotal: number
}) {
  if (vanByRider.length === 0) return null

  return (
    <Card className="border-sky-500/30 bg-sky-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sky-500">
          <Truck className="w-5 h-5" />
          Refused - still on the vans ({vanUnitsTotal})
        </CardTitle>
        <CardDescription>
          Went out and was not wanted, so it stayed on the van instead of coming
          back to the store. Never counted as store stock.
          {vanStuckTotal > 0 && (
            <span className="text-amber-500 font-medium">
              {' '}{vanStuckTotal} of these have been carried over from an earlier day.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {vanByRider.map(rider => (
            <div key={rider.riderId} className="rounded-lg border border-sky-500/20 bg-background p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="flex items-center gap-2 font-semibold text-sm">
                  <Bike className="w-4 h-4 text-sky-500" />
                  {rider.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {rider.units} {rider.units === 1 ? 'unit' : 'units'} · {rider.orders} {rider.orders === 1 ? 'order' : 'orders'}
                  {rider.stuckUnits > 0 && (
                    <span className="text-amber-500 font-medium"> · {rider.stuckUnits} carried over</span>
                  )}
                </span>
              </div>

              {/* ONE ROW PER PRODUCT - same merge rule as the rider and
                  storekeeper screens. */}
              <div className="divide-y divide-border/50">
                {rider.piles.map(pile => (
                  <div key={pile.key} className="flex items-center gap-3 py-2">
                    <Package className="w-4 h-4 text-sky-500/70 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{pile.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {pile.orderCount} {pile.orderCount === 1 ? 'order' : 'orders'}
                        {pile.dates.length > 0 && ` · ${pile.dates.map(shortDate).join(', ')}`}
                      </p>
                    </div>
                    {pile.carriedOver && (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px] shrink-0">
                        carried over
                      </Badge>
                    )}
                    <span className="font-mono text-sm font-bold text-sky-500 tabular-nums shrink-0">
                      {pile.qty}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Why there is no button here. `resetCmsDelivery()` sets
            delivery_notes to NULL and status to 'assigned', and can move the
            order to another rider - which would erase the only record of why
            the goods are out AND expect a different van to hold stock it does
            not have. Sending these out again needs a van-aware action, so it is
            not offered rather than offered wrongly. */}
        <p className="text-xs text-muted-foreground/70 mt-3 pt-3 border-t border-border">
          Read-only. Re-sending these needs to keep the goods on the same van, so
          it is not wired to the standard CMS reset.
        </p>
      </CardContent>
    </Card>
  )
}
