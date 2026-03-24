'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  Package,
  ChevronDown,
  ChevronUp,
  Search,
  ClipboardList,
  MapPin,
  User,
  RefreshCw,
  CheckCircle,
} from 'lucide-react'

interface Delivery {
  id: string
  customer_name: string
  region?: string | null
  rider_id?: string | null
  products?: string | null
  qty?: number | null
  status: string
  sales_type?: string | null
  return_product?: string | null
}

interface PartnerDelivery {
  id: string
  product?: string | null
  supplier?: string | null
  address?: string | null
  region?: string | null
  rider_id?: string | null
  qty?: number | null
  status: string
}

interface Rider {
  id: string
  name: string
}

interface StockOverviewProps {
  deliveries: Delivery[]
  partnerDeliveries: PartnerDelivery[]
  riders: Rider[]
  initialGenerated?: boolean
}

interface StockLine {
  product: string
  qty: number
  source: 'main' | 'partner'
  region: string
  customerOrSupplier: string
  category: 'delivery' | 'cms' | 'exchange' | 'trade_in' | 'refund'
}

const RIDER_COLORS = [
  { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', pill: 'bg-blue-500/20 text-blue-400' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', pill: 'bg-emerald-500/20 text-emerald-400' },
  { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', pill: 'bg-rose-500/20 text-rose-400' },
  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', pill: 'bg-amber-500/20 text-amber-400' },
  { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30', pill: 'bg-violet-500/20 text-violet-400' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30', pill: 'bg-cyan-500/20 text-cyan-400' },
]

function getInitials(name: string) {
  const w = name.trim().split(/\s+/)
  return w.length === 1 ? w[0].slice(0, 2).toUpperCase() : (w[0][0] + w[1][0]).toUpperCase()
}

function parseProducts(raw: string): string[] {
  return raw.split(/[,;\n]+/).map(p => p.trim()).filter(p => p.length > 0)
}

export function StockOverview({ deliveries, partnerDeliveries, riders, initialGenerated = false }: StockOverviewProps) {
  const [generated, setGenerated] = useState(initialGenerated)
  const [expandedRider, setExpandedRider] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Build rider stock map (includes 'unassigned' for deliveries without a rider)
  const riderStock = useMemo(() => {
    const map = new Map<string, StockLine[]>()
    for (const r of riders) map.set(r.id, [])
    // Add a special 'unassigned' bucket for deliveries without a rider
    map.set('unassigned', [])

    const RETURN_TYPES = ['exchange', 'trade_in', 'refund'] as const

    for (const d of deliveries) {
      if (!d.products) continue
      const riderId = d.rider_id || 'unassigned'
      const lines = map.get(riderId) || []

      // Determine the category for the delivered product
      const salesType = (d.sales_type || 'sale') as string

      for (const product of parseProducts(d.products)) {
        lines.push({
          product,
          qty: d.qty || 1,
          source: 'main',
          region: d.region || 'Unknown',
          customerOrSupplier: d.customer_name,
          category: 'delivery',
        })
      }

      // CMS: product returns to rider (customer missed)
      if (d.status === 'cms') {
        for (const product of parseProducts(d.products)) {
          lines.push({
            product,
            qty: d.qty || 1,
            source: 'main',
            region: d.region || 'Unknown',
            customerOrSupplier: d.customer_name,
            category: 'cms',
          })
        }
      }

      // Exchange/Trade-In/Refund: when delivered, the return_product comes back
      if (d.status === 'delivered' && RETURN_TYPES.includes(salesType as any)) {
        const returnProduct = (d.return_product || '').trim()
        if (returnProduct) {
          lines.push({
            product: returnProduct,
            qty: d.qty || 1,
            source: 'main',
            region: d.region || 'Unknown',
            customerOrSupplier: d.customer_name,
            category: salesType as 'exchange' | 'trade_in' | 'refund',
          })
        }
      }

      map.set(d.rider_id, lines)
    }

    for (const d of partnerDeliveries) {
      if (!d.rider_id || !d.product) continue
      const lines = map.get(d.rider_id) || []
      lines.push({
        product: d.product,
        qty: d.qty || 1,
        source: 'partner',
        region: d.region || 'Unknown',
        customerOrSupplier: d.supplier || 'Partner',
        category: 'delivery',
      })
      map.set(riderId, lines)
    }
    return map
  }, [deliveries, partnerDeliveries, riders])

  // Master stock: aggregate delivery products across all riders including unassigned (excludes returns)
  const masterStock = useMemo(() => {
    const agg = new Map<string, { displayName: string; totalQty: number; riders: { name: string; qty: number }[] }>()
    for (const [riderId, lines] of riderStock) {
      const rider = riderId === 'unassigned' ? null : riders.find(r => r.id === riderId)
      const riderName = riderId === 'unassigned' ? 'Unassigned' : (rider?.name || 'Unknown')
      for (const line of lines) {
        if (line.category !== 'delivery') continue
        const key = line.product.toLowerCase().trim()
        if (!agg.has(key)) agg.set(key, { displayName: line.product, totalQty: 0, riders: [] })
        const entry = agg.get(key)!
        entry.totalQty += line.qty
        const existing = entry.riders.find(r => r.name === riderName)
        if (existing) existing.qty += line.qty
        else entry.riders.push({ name: riderName, qty: line.qty })
      }
    }
    return [...agg.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [riderStock, riders])

  // Returns summary across all riders: CMS + Exchange/Trade-In/Refund
  const returnsSummary = useMemo(() => {
    const cms: { product: string; qty: number; rider: string }[] = []
    const exchangeReturns: { product: string; qty: number; rider: string; type: string }[] = []
    for (const [riderId, lines] of riderStock) {
      const rider = riders.find(r => r.id === riderId)
      const riderName = rider?.name || 'Unknown'
      for (const line of lines) {
        if (line.category === 'cms') {
          cms.push({ product: line.product, qty: line.qty, rider: riderName })
        } else if (['exchange', 'trade_in', 'refund'].includes(line.category)) {
          exchangeReturns.push({ product: line.product, qty: line.qty, rider: riderName, type: line.category })
        }
      }
    }
    return { cms, exchangeReturns }
  }, [riderStock, riders])

  // Count all deliveries with products (including those without a rider)
  const totalAssigned = deliveries.filter(d => d.products).length + partnerDeliveries.filter(d => d.product).length
  const totalProductLines = useMemo(() => {
    let c = 0
    for (const [, lines] of riderStock) c += lines.length
    return c
  }, [riderStock])

  // Not yet generated - show the Generate button
  if (!generated) {
    return (
      <div className="space-y-3">
        {/* Info card */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Stock Overview</p>
              <p className="text-[11px] text-muted-foreground">Generate stock list from assigned deliveries</p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="rounded-lg bg-muted/30 p-2.5 text-center">
              <p className="text-base font-bold text-foreground tabular-nums">{totalAssigned}</p>
              <p className="text-[9px] text-muted-foreground">Assigned</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-2.5 text-center">
              <p className="text-base font-bold text-foreground tabular-nums">{totalProductLines}</p>
              <p className="text-[9px] text-muted-foreground">Product Lines</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-2.5 text-center">
              <p className="text-base font-bold text-foreground tabular-nums">{riders.length}</p>
              <p className="text-[9px] text-muted-foreground">Riders</p>
            </div>
          </div>

          <button
            onClick={() => setGenerated(true)}
            disabled={totalAssigned === 0}
            className={cn(
              "w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2",
              totalAssigned > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <ClipboardList className="w-4 h-4" />
            {totalAssigned > 0
              ? `Generate Stock List (${totalProductLines} items)`
              : 'Assign deliveries to riders first'
            }
          </button>
        </div>
      </div>
    )
  }

  // Generated - show the full stock breakdown
  const filteredRiders = riders.filter(r => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    const lines = riderStock.get(r.id) || []
    return r.name.toLowerCase().includes(q) || lines.some(l => l.product.toLowerCase().includes(q))
  })

  return (
    <div className="space-y-3">
      {/* Header with regenerate */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <p className="text-xs font-semibold text-foreground">Stock Generated</p>
          <span className="text-[10px] text-muted-foreground">({totalProductLines} items, {riders.length} riders)</span>
        </div>
        <button
          onClick={() => setGenerated(false)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {/* Master stock list */}
      {masterStock.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-primary" />
            <p className="text-xs font-semibold text-foreground">Main Stock List</p>
            <span className="text-[10px] text-muted-foreground ml-auto">{masterStock.length} products</span>
          </div>
          <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
            {masterStock.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2">
                <span className="text-[10px] text-muted-foreground/50 w-5 text-right tabular-nums shrink-0">{idx + 1}</span>
                <span className="flex-1 text-xs text-foreground truncate">{item.displayName}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {item.riders.map((r, ri) => (
                    <span key={ri} className="px-1 py-0.5 rounded text-[8px] font-bold bg-muted text-muted-foreground">
                      {getInitials(r.name)}:{r.qty}
                    </span>
                  ))}
                </div>
                <span className="text-xs font-bold text-foreground tabular-nums w-8 text-right shrink-0">{item.totalQty}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CMS Returns Summary */}
      {returnsSummary.cms.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <p className="text-xs font-semibold text-amber-400">CMS Returns</p>
            <span className="text-[10px] text-amber-400/60 ml-auto">
              {returnsSummary.cms.reduce((s, c) => s + c.qty, 0)} items
            </span>
          </div>
          <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
            {returnsSummary.cms.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-xs text-foreground truncate">{item.product}</span>
                <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-muted text-muted-foreground">{item.rider}</span>
                <span className="text-xs font-bold text-amber-400 tabular-nums w-6 text-right shrink-0">{item.qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exchange/Trade-In/Refund Returns Summary */}
      {returnsSummary.exchangeReturns.length > 0 && (
        <div className="rounded-xl border border-violet-500/30 bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-violet-500/20 bg-violet-500/5 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-violet-400" />
            <p className="text-xs font-semibold text-violet-400">Collected Returns</p>
            <span className="text-[10px] text-violet-400/60 ml-auto">
              {returnsSummary.exchangeReturns.reduce((s, c) => s + c.qty, 0)} items
            </span>
          </div>
          <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
            {returnsSummary.exchangeReturns.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-xs text-foreground truncate">{item.product}</span>
                <span className={cn("px-1 py-0.5 rounded text-[8px] font-bold",
                  item.type === 'exchange' ? 'bg-violet-500/15 text-violet-400' :
                  item.type === 'trade_in' ? 'bg-blue-500/15 text-blue-400' :
                  'bg-red-500/15 text-red-400'
                )}>
                  {item.type === 'exchange' ? 'EXCHG' : item.type === 'trade_in' ? 'TRADE' : 'REFND'}
                </span>
                <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-muted text-muted-foreground">{item.rider}</span>
                <span className="text-xs font-bold text-violet-400 tabular-nums w-6 text-right shrink-0">{item.qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search rider or product..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 h-9 text-sm rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
        />
      </div>

      {/* Per-rider breakdown */}
      <div className="space-y-2">
        {filteredRiders.map((rider, idx) => {
          const rc = RIDER_COLORS[idx % RIDER_COLORS.length]
          const lines = riderStock.get(rider.id) || []
          const isExpanded = expandedRider === rider.id

          // Split by category
          const deliveryLines = lines.filter(l => l.category === 'delivery')
          const cmsLines = lines.filter(l => l.category === 'cms')
          const returnLines = lines.filter(l => ['exchange', 'trade_in', 'refund'].includes(l.category))

          // Aggregate delivery products only
          const productAgg = new Map<string, { qty: number; count: number }>()
          for (const l of deliveryLines) {
            const key = l.product.toLowerCase().trim()
            if (!productAgg.has(key)) productAgg.set(key, { qty: 0, count: 0 })
            const e = productAgg.get(key)!
            e.qty += l.qty
            e.count++
          }
          const aggList = [...productAgg.entries()]
            .map(([key, val]) => ({ product: deliveryLines.find(l => l.product.toLowerCase().trim() === key)?.product || key, ...val }))
            .sort((a, b) => b.qty - a.qty)

          // Group deliveries by region
          const byRegion = new Map<string, StockLine[]>()
          for (const l of deliveryLines) {
            if (!byRegion.has(l.region)) byRegion.set(l.region, [])
            byRegion.get(l.region)!.push(l)
          }

          const mainCount = deliveryLines.filter(l => l.source === 'main').length
          const partnerCount = deliveryLines.filter(l => l.source === 'partner').length
          const cmsCount = cmsLines.reduce((s, l) => s + l.qty, 0)
          const returnCount = returnLines.reduce((s, l) => s + l.qty, 0)

          return (
            <div key={rider.id} className={cn("rounded-xl border bg-card overflow-hidden", rc.border)}>
              <button
                onClick={() => setExpandedRider(isExpanded ? null : rider.id)}
                className="w-full flex items-center gap-2.5 px-3 py-3 hover:bg-muted/30 transition-colors"
              >
                <span className={cn("w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0", rc.bg, rc.text)}>
                  {getInitials(rider.name)}
                </span>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{rider.name}</p>
                    <div className="flex items-center gap-1">
                      {mainCount > 0 && <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[9px] font-bold">{mainCount}</span>}
                      {partnerCount > 0 && <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 text-[9px] font-bold">{partnerCount}P</span>}
                      {cmsCount > 0 && <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-[9px] font-bold">{cmsCount} CMS</span>}
                      {returnCount > 0 && <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 text-[9px] font-bold">{returnCount} RTN</span>}
                    </div>
                  </div>
                  {lines.length > 0 ? (
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {aggList.slice(0, 3).map(a => `${a.product} (${a.qty})`).join(', ')}
                      {aggList.length > 3 && ` +${aggList.length - 3} more`}
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground mt-0.5">No products assigned</p>
                  )}
                </div>
                <div className="flex flex-col items-end shrink-0">
                  <span className={cn("text-base font-bold tabular-nums", rc.text)}>{lines.length}</span>
                  <span className="text-[9px] text-muted-foreground">items</span>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isExpanded && lines.length > 0 && (
                <div className="border-t border-border">
                  {/* Product summary */}
                  <div className="px-3 py-2 bg-muted/20 border-b border-border">
                    <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                      <ClipboardList className="w-3 h-3" /> Product Summary
                    </p>
                    <div className="space-y-0.5">
                      {aggList.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-foreground truncate flex-1">{item.product}</span>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="text-muted-foreground text-[10px]">{item.count} delivery{item.count !== 1 ? 'ies' : ''}</span>
                            <span className={cn("px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums", rc.pill)}>{item.qty}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Region breakdown */}
                  {[...byRegion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([region, regionLines]) => (
                    <div key={region} className="border-b border-border last:border-b-0">
                      <div className="px-3 py-1.5 bg-muted/10 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] font-semibold text-foreground">{region}</span>
                        <span className="text-[9px] text-muted-foreground">({regionLines.length})</span>
                      </div>
                      <div className="divide-y divide-border/50">
                        {regionLines.map((line, li) => (
                          <div key={li} className="flex items-center gap-2 px-3 py-1.5">
                            <span className="flex-1 text-[11px] text-foreground truncate">{line.product}</span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{line.customerOrSupplier}</span>
                            {line.source === 'partner' && (
                              <span className="px-1 py-0 rounded text-[8px] font-bold bg-violet-500/15 text-violet-400">P</span>
                            )}
                            <span className="text-[10px] font-bold text-foreground tabular-nums shrink-0 w-6 text-right">{line.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* CMS Returns section */}
              {isExpanded && cmsLines.length > 0 && (
                <div className="border-t border-amber-500/20">
                  <div className="px-3 py-2 bg-amber-500/5 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <p className="text-[10px] font-bold text-amber-400">CMS RETURNS</p>
                    <span className="text-[9px] text-amber-400/60 ml-auto">{cmsCount} items returning</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {cmsLines.map((line, li) => (
                      <div key={`cms-${li}`} className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/[0.02]">
                        <span className="flex-1 text-[11px] text-foreground truncate">{line.product}</span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{line.customerOrSupplier}</span>
                        <span className="px-1 py-0 rounded text-[8px] font-bold bg-amber-500/15 text-amber-400">CMS</span>
                        <span className="text-[10px] font-bold text-foreground tabular-nums shrink-0 w-6 text-right">{line.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Exchange/Trade-In/Refund Returns section */}
              {isExpanded && returnLines.length > 0 && (
                <div className="border-t border-violet-500/20">
                  <div className="px-3 py-2 bg-violet-500/5 flex items-center gap-2">
                    <RefreshCw className="w-3 h-3 text-violet-400" />
                    <p className="text-[10px] font-bold text-violet-400">COLLECTED RETURNS</p>
                    <span className="text-[9px] text-violet-400/60 ml-auto">{returnCount} items collected</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {returnLines.map((line, li) => (
                      <div key={`rtn-${li}`} className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/[0.02]">
                        <span className="flex-1 text-[11px] text-foreground truncate">{line.product}</span>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{line.customerOrSupplier}</span>
                        <span className={cn("px-1 py-0 rounded text-[8px] font-bold",
                          line.category === 'exchange' ? 'bg-violet-500/15 text-violet-400' :
                          line.category === 'trade_in' ? 'bg-blue-500/15 text-blue-400' :
                          'bg-red-500/15 text-red-400'
                        )}>
                          {line.category === 'exchange' ? 'EXCHG' : line.category === 'trade_in' ? 'TRADE' : 'REFND'}
                        </span>
                        <span className="text-[10px] font-bold text-foreground tabular-nums shrink-0 w-6 text-right">{line.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isExpanded && lines.length === 0 && (
                <div className="px-3 py-6 text-center border-t border-border">
                  <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No assigned deliveries with products</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
