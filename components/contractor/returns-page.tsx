'use client'

import { useState } from 'react'
import { RotateCcw, Package, CheckCircle2, Clock, ChevronDown, Calendar, ArrowLeftRight } from 'lucide-react'
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
  /** exchange | trade_in | refund - a client to settle, not just goods. */
  salesType?: string | null
  customerName?: string | null
  /** From incomingToStore(): 'unsold' | 'collected' | 'cms'. */
  incomingKind?: 'unsold' | 'collected' | 'cms' | null
  /** What went OUT to this client, so the row reads as an exchange. */
  gaveProduct?: string | null
  fromVan?: boolean
}

const FOLLOW_UP_TYPES = ['exchange', 'trade_in', 'refund']

function isFollowUpItem(i: ReturnItem) {
  return !!i.salesType && FOLLOW_UP_TYPES.includes(i.salesType)
}

/**
 * OWNER'S RULE: exchange / trade-in / refund are handled FIRST - each has a
 * client waiting to be settled, so they are pinned above the date groups.
 *
 * A follow-up whose client was MISSED is deliberately NOT pinned. Nothing was
 * collected from that client, so there is nobody to settle; the replacement
 * simply came back unsold. It stays in the plain list, labelled, so it cannot
 * read as an ordinary return either.
 *
 * These are NOT merged by product. Two clients returning the same item are two
 * separate conversations - the storekeeper merges a pile because he is counting
 * stock, the contractor must not because he is settling people.
 */
function isHandleFirst(i: ReturnItem) {
  return isFollowUpItem(i) && i.incomingKind !== 'cms'
}

function followUpLabel(t?: string | null) {
  if (t === 'trade_in') return 'Trade-in'
  if (t === 'exchange') return 'Exchange'
  if (t === 'refund') return 'Refund'
  return 'Follow-up'
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

  // Follow-ups to settle, lifted out of the date groups entirely.
  const handleFirst = pendingReturns.filter(isHandleFirst)
  const plainPending = pendingReturns.filter(i => !isHandleFirst(i))

  // The "Pending Returns" header must count only what its own list shows, or
  // it contradicts itself.
  const totalPlainPending = plainPending.reduce((s, r) => s + r.quantity, 0)
  const totalHandleFirst = handleFirst.reduce((s, r) => s + r.quantity, 0)

  const pendingByDate = groupByDate(plainPending, 'collection_date')
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

      {/* HANDLE FIRST - one row per client, never merged by product. */}
      {handleFirst.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/[0.07]">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-amber-500/20">
            <ArrowLeftRight className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-amber-400">Handle first</span>
            <span className="text-xs text-muted-foreground">
              {handleFirst.length} {handleFirst.length === 1 ? 'client' : 'clients'} to settle
              {' · '}{totalHandleFirst} {totalHandleFirst === 1 ? 'unit' : 'units'}
            </span>
          </div>
          <CardContent className="p-3 space-y-2">
            {handleFirst.map(item => (
              <div key={item.id} className="rounded-xl border border-amber-500/25 bg-background/40 px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                        {followUpLabel(item.salesType)}
                      </span>
                      {item.customerName && (
                        <span className="text-sm font-medium truncate">{item.customerName}</span>
                      )}
                    </div>
                    {/* Both directions stated. Naming only one item is what made
                        the old screen ambiguous about which way goods moved. */}
                    <p className="text-sm mt-1">
                      <span className="text-muted-foreground">Take back </span>
                      <span className="font-medium">{item.product_name}</span>
                      {item.quantity > 1 && <span className="font-medium"> x{item.quantity}</span>}
                    </p>
                    {item.gaveProduct && item.gaveProduct !== item.product_name && (
                      <p className="text-xs text-muted-foreground">
                        Gave {item.gaveProduct}
                        {item.fromVan && ' - off your van'}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {item.rider_name || 'Unknown rider'} · {fmtDate(item.collection_date)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-amber-400 shrink-0">x{item.quantity}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending Returns */}
      <Card className="border-orange-500/20">
        <button
          onClick={() => setExpandPending(!expandPending)}
          className="w-full px-4 py-3 flex items-center justify-between bg-orange-500/10"
        >
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-orange-400">
              {handleFirst.length > 0 ? 'Unsold returns' : 'Pending Returns'}
            </span>
            <span className="text-xs text-muted-foreground">({totalPlainPending})</span>
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
                            {/* A follow-up whose client was never met. It sits
                                here rather than in "Handle first" because
                                nothing was collected - but it must not read as
                                an ordinary unsold return either. */}
                            {isFollowUpItem(item) && item.incomingKind === 'cms' && (
                              <p className="text-[10px] text-amber-500/90">
                                {followUpLabel(item.salesType)} not completed - client missed.
                                Their old item is still with them.
                              </p>
                            )}
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
