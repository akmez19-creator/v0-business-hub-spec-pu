'use client'

import { useState } from 'react'
import { RotateCcw, Package, CheckCircle2, Clock, ChevronDown, Calendar } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface ReturnItem {
  id: string
  product_name: string
  quantity: number
  condition?: string
  collection_date: string
  rider_id?: string
  rider_name?: string | null
  verified_at?: string | null
  notes?: string | null
  source?: 'delivery' | 'return_collection'
}

interface Props {
  pendingReturns: ReturnItem[]
  verifiedByStore: ReturnItem[]
}

function fmtDate(d: string) {
  const today = new Date().toISOString().split('T')[0]
  if (d === today) return 'Today'
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function ContractorReturnsPage({ pendingReturns, verifiedByStore }: Props) {
  const [expandPending, setExpandPending] = useState(true)
  const [expandVerified, setExpandVerified] = useState(true)

  const totalPending = pendingReturns.reduce((s, r) => s + r.quantity, 0)
  const totalVerified = verifiedByStore.reduce((s, r) => s + r.quantity, 0)

  // Group by date
  const groupByDate = (items: ReturnItem[], dateField: 'collection_date' | 'verified_at') => {
    const byDate = new Map<string, ReturnItem[]>()
    for (const item of items) {
      const date = dateField === 'verified_at' && item.verified_at 
        ? new Date(item.verified_at).toISOString().split('T')[0]
        : item.collection_date
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date)!.push(item)
    }
    return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }

  const pendingByDate = groupByDate(pendingReturns, 'collection_date')
  const verifiedByDate = groupByDate(verifiedByStore, 'verified_at')

  return (
    <div className="px-4 pb-24 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold">Returns</h1>
        <p className="text-xs text-muted-foreground">Track product returns and store verifications</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-orange-500/30 bg-orange-500/10">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 text-orange-400 mx-auto mb-1" />
            <div className="text-[10px] uppercase text-muted-foreground">Pending</div>
            <div className="text-2xl font-bold text-orange-400">{totalPending}</div>
            <div className="text-xs text-muted-foreground">items to return</div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <div className="text-[10px] uppercase text-muted-foreground">Verified</div>
            <div className="text-2xl font-bold text-blue-400">{totalVerified}</div>
            <div className="text-xs text-muted-foreground">by store</div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Returns */}
      <Card className="border-orange-500/20">
        <button
          onClick={() => setExpandPending(!expandPending)}
          className="w-full px-4 py-3 flex items-center justify-between bg-orange-500/10"
        >
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-orange-400">Pending Returns</span>
            <span className="text-xs text-muted-foreground">({totalPending})</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 transition-transform", expandPending && "rotate-180")} />
        </button>
        
        {expandPending && (
          <CardContent className="p-3 space-y-3">
            {pendingByDate.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">No pending returns</p>
            ) : (
              pendingByDate.map(([date, items]) => (
                <div key={date} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <div className="px-3 py-2 bg-white/5 flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-xs font-medium">{fmtDate(date)}</span>
                    <span className="text-[10px] text-muted-foreground">({items.length} items)</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {items.map(item => (
                      <div key={item.id} className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="w-4 h-4 text-orange-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.product_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.rider_name || 'Unknown rider'}
                              {item.condition && ` • ${item.condition}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-sm font-bold text-orange-400">x{item.quantity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        )}
      </Card>

      {/* Verified by Store */}
      <Card className="border-blue-500/20">
        <button
          onClick={() => setExpandVerified(!expandVerified)}
          className="w-full px-4 py-3 flex items-center justify-between bg-blue-500/10"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-blue-400">Verified by Store</span>
            <span className="text-xs text-muted-foreground">({totalVerified})</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 transition-transform", expandVerified && "rotate-180")} />
        </button>
        
        {expandVerified && (
          <CardContent className="p-3 space-y-3">
            {verifiedByDate.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">No verified returns yet</p>
            ) : (
              verifiedByDate.map(([date, items]) => (
                <div key={date} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  <div className="px-3 py-2 bg-white/5 flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium">{fmtDate(date)}</span>
                    <span className="text-[10px] text-muted-foreground">({items.length} items)</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {items.map(item => (
                      <div key={item.id} className="px-3 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="w-4 h-4 text-blue-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.product_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.rider_name || 'Unknown rider'}
                              {item.condition && ` • ${item.condition}`}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-sm font-bold text-blue-400">x{item.quantity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
