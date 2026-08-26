import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bike, Building2, Check, DollarSign, MapPin, X } from 'lucide-react'
import { CmsReviewActions } from '@/components/admin/cms-review-actions'

/**
 * PRICE ADJUSTMENTS RAISED FROM A CMS.
 *
 * Two halves, deliberately separated: the ones still WAITING on the owner, and
 * the ones already DECIDED. The decided half used to be computed on every page
 * load and then never rendered - an unfinished section - so every past price
 * decision was invisible and unauditable even though the data was already in
 * hand.
 */

// Matches the shape `getPendingCmsModifications()` returns, and stays
// structurally compatible with what CmsReviewActions requires.
export type CmsPriceModification = {
  id: string
  target_delivery_id: string
  product_name: string
  qty: number
  unit_price: number
  total_price: number
  reason: string
  notes: string
  status: string
  new_price: number | null
  original_price: number | null
  original_qty: number | null
  created_at: string
  rider_name?: string
  contractor_name?: string
  customer_name?: string
  locality?: string
  order_code?: string | null
}

function raisedOn(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function CmsPriceReview({
  pending,
  reviewed,
}: {
  pending: CmsPriceModification[]
  reviewed: CmsPriceModification[]
}) {
  if (pending.length === 0 && reviewed.length === 0) return null

  return (
    <>
      {pending.length > 0 && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-600">
              <DollarSign className="w-5 h-5" />
              Price Adjustments Pending Review ({pending.length})
            </CardTitle>
            <CardDescription>
              Riders have made price adjustments that need your approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pending.map(mod => (
                <div
                  key={mod.id}
                  className="p-4 rounded-lg border border-purple-500/20 bg-background"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {mod.order_code && (
                          <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                            {mod.order_code}
                          </span>
                        )}
                        <h4 className="font-semibold truncate">{mod.customer_name}</h4>
                        <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px]">
                          Price Review
                        </Badge>
                      </div>

                      <div className="mb-3 p-2 rounded-md bg-muted/50">
                        <p className="text-sm font-medium">{mod.qty}x {mod.product_name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          CMS Reason: <span className="font-medium">{mod.notes}</span>
                        </p>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="truncate">{mod.locality}</span>
                        </div>
                        {mod.rider_name && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Bike className="w-3.5 h-3.5" />
                            <span>{mod.rider_name}</span>
                          </div>
                        )}
                        {mod.contractor_name && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Building2 className="w-3.5 h-3.5" />
                            <span>{mod.contractor_name}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Review Actions */}
                    <div className="lg:w-64 shrink-0">
                      <CmsReviewActions modification={mod} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ALREADY DECIDED - the revived half.
          Collapsed, because it is history rather than work, and it sits with the
          other closed lists at the foot of the page. */}
      {reviewed.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                Price adjustments already decided ({reviewed.length})
                <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">
                  show
                </span>
                <span className="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline">
                  hide
                </span>
              </summary>

              <div className="mt-4 divide-y divide-border/50">
                {reviewed.map(mod => {
                  const approved = mod.status === 'approved'
                  const changed =
                    mod.original_price !== null &&
                    mod.new_price !== null &&
                    mod.original_price !== mod.new_price

                  return (
                    <div key={mod.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      {mod.order_code && (
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                          {mod.order_code}
                        </span>
                      )}
                      <span className="font-medium text-sm truncate max-w-[14rem]">
                        {mod.customer_name}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[16rem]">
                        {mod.qty}x {mod.product_name}
                      </span>

                      {/* The decision itself: what it was, what it became.
                          Only shown as a change when the two figures actually
                          differ - an approval that kept the price the same is
                          not a price change and must not read like one. */}
                      {changed ? (
                        <span className="text-xs font-mono tabular-nums">
                          <span className="text-muted-foreground line-through">Rs {mod.original_price}</span>
                          <span className="mx-1 text-muted-foreground">-&gt;</span>
                          <span className={approved ? 'text-emerald-500 font-semibold' : 'text-muted-foreground'}>
                            Rs {mod.new_price}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          Rs {mod.new_price ?? mod.original_price ?? '-'} (unchanged)
                        </span>
                      )}

                      <Badge
                        variant="outline"
                        className={
                          approved
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px] shrink-0'
                            : 'bg-red-500/10 text-red-400 border-red-500/30 text-[10px] shrink-0'
                        }
                      >
                        {approved ? <Check className="w-3 h-3 mr-1" /> : <X className="w-3 h-3 mr-1" />}
                        {mod.status}
                      </Badge>

                      {/* "Raised", NOT "decided". `created_at` is when the rider
                          submitted the adjustment; there is no reviewed_at
                          column, so labelling this as the decision date would
                          assert a time nothing in the data records. */}
                      <span className="ml-auto text-[11px] text-muted-foreground/70 shrink-0">
                        raised {raisedOn(mod.created_at)}
                        {mod.rider_name ? ` · ${mod.rider_name}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </details>
          </CardContent>
        </Card>
      )}
    </>
  )
}
