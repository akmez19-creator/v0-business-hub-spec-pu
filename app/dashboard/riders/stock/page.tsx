import { redirect } from 'next/navigation'
import { muToday } from '@/lib/business-date'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  Truck,
  CheckCircle2,
  XCircle,
  Clock,
  ShoppingBag,
} from 'lucide-react'
import { OnVanPanel } from '@/components/stock/on-van-panel'
import { buildVanPiles } from '@/lib/van-stock'
import { RescheduleStockPanel } from '@/components/stock/reschedule-stock-panel'
import {
  isPendingReattempt,
  staysOnVan,
  awaitingIssue,
  buildReschedulePiles,
} from '@/lib/reschedule-stock'

interface ProductStock {
  product: string
  totalQty: number
  deliveredQty: number
  pendingQty: number
  nwdQty: number
  cmsQty: number
  /** Never loaded - tracked apart from nwdQty so it is not read as on-van. */
  cancelledQty: number
  /**
   * Units carried over from a failed earlier attempt. Part of `pendingQty`,
   * counted separately only to badge the row - a re-attempt and a fresh order
   * are both outstanding work, so they must share one "left" figure.
   */
  reattemptQty: number
}

export default async function RiderStockPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')

  // Get rider record (same pattern as rider deliveries/collections)
  let rider = null
  const { data: riderByProfile } = await supabase
    .from('riders')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (riderByProfile) {
    rider = riderByProfile
  } else if (profile?.rider_id) {
    const { data: riderById } = await supabase
      .from('riders')
      .select('*')
      .eq('id', profile.rider_id)
      .single()
    rider = riderById
  }

  if (!rider) {
    return (
      <RiderMobileLayout profile={profile}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Rider profile not found</p>
        </div>
      </RiderMobileLayout>
    )
  }

  const today = muToday()

  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('id, customer_name, products, qty, status, locality, amount, sales_type, return_product, delivery_date, rescheduled_to, reschedule_stock_mode, stock_out, stock_out_at, van_confirmed_by')
    .eq('rider_id', rider.id)
    // `active_date`, NOT `delivery_date`. This is the day the order is TO BE
    // delivered; `delivery_date` is the immutable day it first went out on the
    // van. Filtering the old column is why a rescheduled order never appeared
    // on its new day - 45 orders (59 units) were invisible today, 4 of them
    // JEFFREY's. `active_date` is a generated column
    // (`coalesce(rescheduled_to, delivery_date)`), so orders that were never
    // rescheduled are completely unaffected.
    .eq('active_date', today)
    .order('locality', { ascending: true })

  const allDeliveries = deliveries || []

  // NWD stays on the van, so it is NOT a today-only fact: unreconciled refusals
  // from earlier days are still physically with the rider. Queried separately
  // and NOT date-filtered, otherwise the panel shows 0 on any day he happens to
  // have no fresh refusals while older units ride around unnoticed.
  const { data: vanRows } = await supabase
    .from('deliveries')
    .select('id, products, qty, status, delivery_date, customer_name')
    .eq('rider_id', rider.id)
    .eq('status', 'nwd')
    // `IS NOT TRUE`, never `= false`: in Postgres `stock_verified = false`
    // silently DROPS a NULL, which would hide van stock rather than show it.
    // No NULLs today, but that is luck and not a constraint.
    .not('stock_verified', 'is', true)
    .order('delivery_date', { ascending: false })

  const vanPiles = buildVanPiles(
    (vanRows || []).map(r => ({
      id: r.id,
      product: r.products,
      qty: r.qty,
      status: r.status,
      deliveryDate: r.delivery_date,
      customerName: r.customer_name,
    })),
    today,
  )

  // RESCHEDULED STOCK, split by where the goods physically are.
  //
  // `staysOnVan()` answers this from EITHER an agent's tick at reschedule time
  // or - authoritatively - a storekeeper's confirmation at the shelf
  // (`van_confirmed_by`). The agent's tick alone was never enough to rely on:
  // it exists on 1 of 66 rescheduled orders, because the dialog left 38 blank
  // and day-closure never asks. So when the storekeeper cannot find goods and
  // records it, this panel moves them to "keep on your van" with no re-entry.
  const reattempts = allDeliveries.filter(isPendingReattempt)
  const toPileRow = (d: (typeof allDeliveries)[number]) => ({
    product: d.products,
    qty: d.qty,
    customerName: d.customer_name,
    deliveryDate: d.delivery_date,
  })

  const keepPiles = buildReschedulePiles(reattempts.filter(staysOnVan).map(toPileRow))
  // Only what the store has NOT already handed over for THIS day. `stock_out`
  // is one undated boolean, so a re-issue can carry a `true` left over from the
  // attempt that failed - `awaitingIssue()` treats that as stale rather than
  // telling him to collect something already in his hands.
  const collectPiles = buildReschedulePiles(
    reattempts.filter(d => awaitingIssue(d, today)).map(toPileRow),
  )

  // Build product stock map
  const productMap = new Map<string, ProductStock>()
  const RETURN_TYPES = ['exchange', 'trade_in', 'refund']

  // Track return products separately
  const returnProducts = new Map<string, { product: string; qty: number; fromType: string }>()

  for (const d of allDeliveries) {
    const productName = d.products || 'Unknown Product'
    const qty = Number(d.qty || 1)

    if (!productMap.has(productName)) {
      productMap.set(productName, {
        product: productName,
        totalQty: 0,
        deliveredQty: 0,
        pendingQty: 0,
        nwdQty: 0,
        cmsQty: 0,
        cancelledQty: 0,
        reattemptQty: 0,
      })
    }

    const entry = productMap.get(productName)!
    // A cancelled order was never loaded, so it is not part of the day's load
    // and must not dilute the progress bar's denominator.
    if (d.status !== 'cancelled') entry.totalQty += qty

    // A RESCHEDULED ORDER'S STATUS DESCRIBES A DAY THAT IS OVER.
    // A reschedule cannot clear `status` (the storekeeper's returns view needs
    // it to stay 'cms' on the original day), so on the new day the row still
    // reads 'cms' or 'nwd' from the failed attempt. Read literally, that put
    // JEFFREY's Make Up Pen, Mirror Film and Grinding Head in the "CMS" bucket
    // with "0 remaining" - struck through as finished on a day he still had to
    // deliver all three. Counted as outstanding work instead.
    if (isPendingReattempt(d)) {
      entry.pendingQty += qty
      entry.reattemptQty += qty
    } else if (d.status === 'delivered') {
      entry.deliveredQty += qty
    } else if (d.status === 'nwd') {
      // `cancelled` was lumped in here. It NEVER LEFT THE BUILDING, so adding
      // it told the rider he was carrying stock he was never handed. It is now
      // counted separately below and excluded from the load total.
      entry.nwdQty += qty
    } else if (d.status === 'cancelled') {
      entry.cancelledQty += qty
    } else if (d.status === 'cms') {
      entry.cmsQty += qty
    } else {
      entry.pendingQty += qty
    }

    // Track return products for exchange/trade_in/refund deliveries
    if (d.status === 'delivered' && RETURN_TYPES.includes(d.sales_type || '')) {
      const returnProduct = (d.return_product || '').trim()
      if (returnProduct) {
        const existing = returnProducts.get(returnProduct)
        if (existing) {
          existing.qty += qty
        } else {
          returnProducts.set(returnProduct, { product: returnProduct, qty, fromType: d.sales_type || '' })
        }
      }
    }
  }

  const returnList = Array.from(returnProducts.values()).sort((a, b) => a.product.localeCompare(b.product))
  const totalReturns = returnList.reduce((s, r) => s + r.qty, 0)

  const productList = Array.from(productMap.values()).sort((a, b) => a.product.localeCompare(b.product))

  const totalItems = productList.reduce((s, p) => s + p.totalQty, 0)
  const totalDelivered = productList.reduce((s, p) => s + p.deliveredQty, 0)
  const totalPending = productList.reduce((s, p) => s + p.pendingQty, 0)
  const totalNwd = productList.reduce((s, p) => s + p.nwdQty, 0)
  const totalCms = productList.reduce((s, p) => s + p.cmsQty, 0)
  const uniqueProducts = productList.length

  return (
    <RiderMobileLayout profile={profile}>
      <div className="space-y-4 pb-4">
        {/* Header */}
        <div className="px-1">
          <h1 className="text-lg font-bold text-foreground">My Stock</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{totalPending}</p>
                  <p className="text-[9px] text-muted-foreground">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{totalDelivered}</p>
                  <p className="text-[9px] text-muted-foreground">Delivered</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-red-500/10">
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{totalNwd}</p>
                  <p className="text-[9px] text-muted-foreground">NWD</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CMS + Returns row */}
        <div className="grid grid-cols-3 gap-2">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <ShoppingBag className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">{totalItems}</p>
                  <p className="text-[9px] text-muted-foreground">{uniqueProducts} products</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-amber-500/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10">
                  <Package className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-amber-500">{totalCms}</p>
                  <p className="text-[9px] text-muted-foreground">CMS</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-violet-500/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-violet-500/10">
                  <Package className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <div>
                  <p className="text-lg font-bold text-violet-500">{totalReturns}</p>
                  <p className="text-[9px] text-muted-foreground">Returns</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progress Bar */}
        {totalItems > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Progress</span>
              <span>{totalDelivered}/{totalItems} ({Math.round((totalDelivered / totalItems) * 100)}%)</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden flex">
              {totalDelivered > 0 && (
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(totalDelivered / totalItems) * 100}%` }} />
              )}
              {totalNwd > 0 && (
                <div className="h-full bg-red-500 transition-all" style={{ width: `${(totalNwd / totalItems) * 100}%` }} />
              )}
              {totalCms > 0 && (
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${(totalCms / totalItems) * 100}%` }} />
              )}
            </div>
          </div>
        )}

        {/* STILL ON THE VAN - deliberately ABOVE the general list. This is
            stock he is already carrying, so he must see it before reading
            through the day's new orders. */}
        <OnVanPanel piles={vanPiles} activeDate={today} />

        {/* RESCHEDULED ORDERS - also above the general list, and for the same
            reason: what to keep and what to collect both have to be settled
            before he starts loading, not discovered afterwards. */}
        <RescheduleStockPanel keepPiles={keepPiles} collectPiles={collectPiles} />

        {/* Product Breakdown */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Package className="w-4 h-4" />
            Product Breakdown
          </h2>

          {productList.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-12 text-center">
                <Truck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No deliveries assigned today</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {productList.map((p) => {
                const allDone = p.pendingQty === 0

                return (
                  <Card key={p.product} className={`border-0 shadow-sm transition-colors ${allDone ? 'opacity-60' : ''}`}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${allDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                            {p.product}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">Qty: {p.totalQty}</span>
                            {p.deliveredQty > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                {p.deliveredQty} done
                              </Badge>
                            )}
                            {p.nwdQty > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-red-500/10 text-red-600 border-red-500/20">
                                {p.nwdQty} NWD
                              </Badge>
                            )}
                            {p.cmsQty > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20">
                                {p.cmsQty} CMS
                              </Badge>
                            )}
                            {p.pendingQty > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/20">
                                {p.pendingQty} left
                              </Badge>
                            )}
                            {/* Says WHY an item he already tried is back on the
                                list, so a re-attempt does not read as a
                                duplicate or a mistake. */}
                            {p.reattemptQty > 0 && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                                {p.reattemptQty} retry
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-lg font-bold text-foreground">{p.pendingQty}</p>
                          <p className="text-[9px] text-muted-foreground">remaining</p>
                        </div>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden mt-2 flex">
                        {p.deliveredQty > 0 && (
                          <div className="h-full bg-emerald-500" style={{ width: `${(p.deliveredQty / p.totalQty) * 100}%` }} />
                        )}
                        {p.nwdQty > 0 && (
                          <div className="h-full bg-red-500" style={{ width: `${(p.nwdQty / p.totalQty) * 100}%` }} />
                        )}
                        {p.cmsQty > 0 && (
                          <div className="h-full bg-amber-500" style={{ width: `${(p.cmsQty / p.totalQty) * 100}%` }} />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Returns to collect */}
        {returnList.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-500" />
              Returns Collected ({totalReturns})
            </h2>
            <div className="space-y-2">
              {returnList.map((r) => (
                <Card key={r.product} className="border-0 shadow-sm">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.product}</p>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 mt-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
                          {r.fromType === 'exchange' ? 'Exchange' : r.fromType === 'trade_in' ? 'Trade In' : 'Refund'}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-amber-500">{r.qty}</p>
                        <p className="text-[9px] text-muted-foreground">collected</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Per-delivery list */}
        {allDeliveries.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Truck className="w-4 h-4" />
              Delivery Details ({allDeliveries.length})
            </h2>
            <div className="space-y-1.5">
              {allDeliveries.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border/50">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    isPendingReattempt(d) ? 'bg-primary' :
                    d.status === 'delivered' ? 'bg-emerald-500' :
                    d.status === 'nwd' || d.status === 'cancelled' ? 'bg-red-500' :
                    d.status === 'cms' ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-foreground truncate">{d.customer_name}</p>
                      {d.sales_type && d.sales_type !== 'sale' && (
                        <span className={`text-[8px] font-bold px-1 py-0 rounded shrink-0 ${
                          d.sales_type === 'exchange' ? 'bg-violet-500/10 text-violet-600' :
                          d.sales_type === 'trade_in' ? 'bg-blue-500/10 text-blue-600' :
                          d.sales_type === 'refund' ? 'bg-red-500/10 text-red-600' :
                          'bg-teal-500/10 text-teal-600'
                        }`}>
                          {d.sales_type === 'exchange' ? 'EXCHG' : d.sales_type === 'trade_in' ? 'TRADE' : d.sales_type === 'refund' ? 'REFND' : 'DROP'}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{d.products} x{d.qty || 1}</p>
                    {d.return_product && <p className="text-[9px] text-amber-600 truncate">Pickup: {d.return_product}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {/* A re-attempt is OUTSTANDING, whatever the stored status
                        says. Showing the old 'CMS' here told him this stop was
                        already closed. */}
                    <Badge variant="outline" className={`text-[9px] ${
                      isPendingReattempt(d) ? 'bg-primary/10 text-primary border-primary/20' :
                      d.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                      d.status === 'nwd' ? 'bg-red-500/10 text-red-600 border-red-500/20' :
                      d.status === 'cms' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                      'bg-blue-500/10 text-blue-600 border-blue-500/20'
                    }`}>
                      {isPendingReattempt(d) ? 'Retry'
                        : d.status === 'delivered' ? 'Done'
                        : d.status === 'nwd' ? 'NWD'
                        : d.status === 'cms' ? 'CMS' : 'Pending'}
                    </Badge>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{d.locality || '-'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </RiderMobileLayout>
  )
}
