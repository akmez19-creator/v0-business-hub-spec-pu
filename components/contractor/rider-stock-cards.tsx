'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, Package, User } from 'lucide-react'

interface RiderProduct {
  product: string
  totalQty: number
  deliveredQty: number
  pendingQty: number
  postponedQty: number
  returningQty: number
  cmsQty: number
  exchangeReturnQty: number
  returnType?: string
  source: string
}

interface RiderData {
  riderId: string
  riderName: string
  products: RiderProduct[]
  totalItems: number
  delivered: number
  pending: number
  postponed: number
  returning: number
  cms: number
  exchangeReturns: number
  returnProducts: RiderProduct[]
}

type StatusFilter = 'all' | 'delivered' | 'pending' | 'nwd' | 'cms' | 'returns'

const COLORS = [
  { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
]

function getInitials(name: string) {
  const w = name.trim().split(/\s+/)
  return w.length === 1 ? w[0].slice(0, 2).toUpperCase() : (w[0][0] + w[1][0]).toUpperCase()
}

function filterProducts(products: RiderProduct[], filter: StatusFilter): (RiderProduct & { _displayQty?: number })[] {
  if (filter === 'all') return products.filter(p => !p.returnType)
  if (filter === 'returns') return products.filter(p => !!p.returnType).map(p => ({ ...p, _displayQty: p.exchangeReturnQty }))

  // For other filters, only show non-return products
  return products
    .filter(p => !p.returnType)
    .map(p => {
      const pending = p.totalQty - p.deliveredQty - p.postponedQty - p.returningQty
      if (filter === 'delivered' && p.deliveredQty > 0) return { ...p, _displayQty: p.deliveredQty }
      if (filter === 'pending' && pending > 0) return { ...p, _displayQty: pending }
      if (filter === 'nwd' && p.postponedQty > 0) return { ...p, _displayQty: p.postponedQty }
      if (filter === 'cms' && p.cmsQty > 0) return { ...p, _displayQty: p.cmsQty }
      return null
    })
    .filter(Boolean) as (RiderProduct & { _displayQty?: number })[]
}

export function RiderStockCards({ riderProducts }: { riderProducts: RiderData[] }) {
  const [expandedRider, setExpandedRider] = useState<string | null>(null)
  const [riderFilters, setRiderFilters] = useState<Record<string, StatusFilter>>({})
  const activeRiders = riderProducts.filter(r => r.totalItems > 0)

  function setFilter(riderId: string, filter: StatusFilter) {
    setRiderFilters(prev => ({
      ...prev,
      [riderId]: prev[riderId] === filter ? 'all' : filter,
    }))
  }

  if (activeRiders.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Stock by Rider</h2>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {activeRiders.length} rider{activeRiders.length !== 1 ? 's' : ''} &middot; {activeRiders.reduce((s, r) => s + r.totalItems, 0)} items
        </span>
      </div>

      {/* Rider cards */}
      {activeRiders.map((rider, idx) => {
        const c = COLORS[idx % COLORS.length]
        const isExpanded = expandedRider === rider.riderId
        const processed = rider.delivered + rider.postponed + rider.returning
        const progressPct = rider.totalItems > 0 ? Math.round((processed / rider.totalItems) * 100) : 0
        const activeFilter = riderFilters[rider.riderId] || 'all'
        const filteredProducts = filterProducts(rider.products, activeFilter)

        return (
          <div key={rider.riderId} className={cn('rounded-2xl border bg-card overflow-hidden', c.border)}>
            {/* Header - tap to expand */}
            <button
              onClick={() => setExpandedRider(isExpanded ? null : rider.riderId)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors"
            >
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', c.bg)}>
                <span className={cn('text-xs font-bold', c.text)}>{getInitials(rider.riderName)}</span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{rider.riderName}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                  <span className="text-muted-foreground">{rider.totalItems} items</span>
                  <span className="text-muted-foreground">{rider.products.length} products</span>
                  <span className="text-muted-foreground">{progressPct}% done</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {rider.delivered > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500/15 text-emerald-500">{rider.delivered}</span>
                )}
                {rider.cms > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-500/15 text-amber-500">{rider.cms}</span>
                )}
                {rider.exchangeReturns > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-violet-500/15 text-violet-500">{rider.exchangeReturns}</span>
                )}
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
              </div>
            </button>

            {/* Expanded */}
            {isExpanded && (
              <div className="border-t border-border/50">
                {/* Progress bar */}
                <div className="px-4 pt-3 pb-2">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                    {rider.delivered > 0 && (
                      <div className="h-full bg-emerald-500" style={{ width: `${(rider.delivered / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                    {rider.postponed > 0 && (
                      <div className="h-full bg-amber-500" style={{ width: `${(rider.postponed / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                    {rider.returning > 0 && (
                      <div className="h-full bg-red-500" style={{ width: `${(rider.returning / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                  </div>
                </div>

                {/* Status filter badges - tap to filter product list below */}
                <div className="px-4 pb-2 grid grid-cols-5 gap-1">
                  <button
                    onClick={() => setFilter(rider.riderId, 'delivered')}
                    className={cn(
                      'rounded-lg py-1.5 text-center active:scale-95 transition-all border-2',
                      activeFilter === 'delivered'
                        ? 'bg-emerald-500/20 border-emerald-500/60'
                        : 'bg-emerald-500/10 border-transparent hover:bg-emerald-500/15'
                    )}
                  >
                    <p className="text-[7px] font-medium text-emerald-500/70">Delivered</p>
                    <p className="text-sm font-bold text-emerald-500 tabular-nums">{rider.delivered}</p>
                  </button>
                  <button
                    onClick={() => setFilter(rider.riderId, 'nwd')}
                    className={cn(
                      'rounded-lg py-1.5 text-center active:scale-95 transition-all border-2',
                      activeFilter === 'nwd'
                        ? 'bg-amber-500/20 border-amber-500/60'
                        : 'bg-amber-500/10 border-transparent hover:bg-amber-500/15'
                    )}
                  >
                    <p className="text-[7px] font-medium text-amber-500/70">NWD</p>
                    <p className="text-sm font-bold text-amber-500 tabular-nums">{rider.postponed}</p>
                  </button>
                  <button
                    onClick={() => setFilter(rider.riderId, 'cms')}
                    className={cn(
                      'rounded-lg py-1.5 text-center active:scale-95 transition-all border-2',
                      activeFilter === 'cms'
                        ? 'bg-red-500/20 border-red-500/60'
                        : 'bg-red-500/10 border-transparent hover:bg-red-500/15'
                    )}
                  >
                    <p className="text-[7px] font-medium text-red-500/70">CMS</p>
                    <p className="text-sm font-bold text-red-500 tabular-nums">{rider.cms}</p>
                  </button>
                  <button
                    onClick={() => setFilter(rider.riderId, 'returns')}
                    className={cn(
                      'rounded-lg py-1.5 text-center active:scale-95 transition-all border-2',
                      activeFilter === 'returns'
                        ? 'bg-violet-500/20 border-violet-500/60'
                        : 'bg-violet-500/10 border-transparent hover:bg-violet-500/15'
                    )}
                  >
                    <p className="text-[7px] font-medium text-violet-500/70">Returns</p>
                    <p className="text-sm font-bold text-violet-500 tabular-nums">{rider.exchangeReturns}</p>
                  </button>
                  <button
                    onClick={() => setFilter(rider.riderId, 'pending')}
                    className={cn(
                      'rounded-lg py-1.5 text-center active:scale-95 transition-all border-2',
                      activeFilter === 'pending'
                        ? 'bg-muted/60 border-muted-foreground/40'
                        : 'bg-muted/30 border-transparent hover:bg-muted/40'
                    )}
                  >
                    <p className="text-[7px] font-medium text-muted-foreground/70">Pending</p>
                    <p className="text-sm font-bold text-muted-foreground tabular-nums">{rider.pending}</p>
                  </button>
                </div>

                {/* Active filter label */}
                {activeFilter !== 'all' && (
                  <div className="px-4 pb-1.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-muted-foreground">
                      Showing: <span className={cn(
                        activeFilter === 'delivered' && 'text-emerald-500',
                        activeFilter === 'nwd' && 'text-amber-500',
                        activeFilter === 'cms' && 'text-red-500',
                        activeFilter === 'returns' && 'text-violet-500',
                        activeFilter === 'pending' && 'text-muted-foreground',
                      )}>
                        {activeFilter === 'delivered' ? 'Delivered' : activeFilter === 'nwd' ? 'NWD' : activeFilter === 'cms' ? 'CMS' : activeFilter === 'returns' ? 'Returns' : 'Pending'}
                      </span>
                      {' '}({filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''})
                    </p>
                    <button
                      onClick={() => setFilter(rider.riderId, activeFilter)}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Show all
                    </button>
                  </div>
                )}

                {/* Product list - filtered by active status */}
                <div className="divide-y divide-border/30 max-h-64 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-xs text-muted-foreground">No products with this status</p>
                    </div>
                  ) : (
                    filteredProducts.map((p, i) => {
                      const pending = p.totalQty - p.deliveredQty - p.postponedQty - p.returningQty
                      const displayQty = (p as any)._displayQty || p.totalQty

                      return (
                        <div key={i} className="px-4 py-2 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Package className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                              <p className="text-xs font-medium text-foreground truncate">{p.product}</p>
                              {p.source === 'partner' && (
                                <span className="px-1 py-0.5 rounded text-[7px] font-bold bg-blue-500/10 text-blue-500 shrink-0">Partner</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-[18px] mt-0.5 text-[10px]">
                              {activeFilter === 'all' ? (
                                <>
                                  {p.deliveredQty > 0 && <span className="text-emerald-500">{p.deliveredQty} del</span>}
                                  {p.postponedQty > 0 && <span className="text-amber-500">{p.postponedQty} nwd</span>}
                                  {p.cmsQty > 0 && <span className="text-red-500">{p.cmsQty} cms</span>}
                                  {pending > 0 && <span className="text-muted-foreground">{pending} pending</span>}
                                </>
                              ) : activeFilter === 'returns' ? (
                                <span className="font-medium text-violet-500">
                                  {displayQty} {p.returnType === 'exchange' ? 'exchange' : p.returnType === 'trade_in' ? 'trade-in' : 'refund'}
                                </span>
                              ) : (
                                <span className={cn(
                                  'font-medium',
                                  activeFilter === 'delivered' && 'text-emerald-500',
                                  activeFilter === 'nwd' && 'text-amber-500',
                                  activeFilter === 'cms' && 'text-red-500',
                                  activeFilter === 'pending' && 'text-muted-foreground',
                                )}>
                                  {displayQty} {activeFilter === 'delivered' ? 'delivered' : activeFilter === 'nwd' ? 'postponed' : activeFilter === 'cms' ? 'returning' : 'pending'}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={cn(
                            'text-base font-bold tabular-nums shrink-0',
                            activeFilter === 'all' ? c.text :
                            activeFilter === 'delivered' ? 'text-emerald-500' :
                            activeFilter === 'nwd' ? 'text-amber-500' :
                            activeFilter === 'cms' ? 'text-red-500' :
                            activeFilter === 'returns' ? 'text-violet-500' : 'text-muted-foreground'
                          )}>
                            {displayQty}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
