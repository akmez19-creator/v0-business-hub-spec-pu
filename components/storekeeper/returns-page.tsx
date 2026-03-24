'use client'
// Returns verification v2 - auto-advance flow

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  Package, ArrowLeft, Loader2, Users, CheckCircle2,
  ChevronLeft, ChevronRight, Calendar, Check, RotateCcw, AlertTriangle
} from 'lucide-react'

interface ReturnItem {
  id: string
  product: string
  qty: number
  date: string
  riderName: string
  verified: boolean
  salesType?: string
  source: 'delivery' | 'return_collection'
}

interface Contractor {
  id: string
  name: string
  items: ReturnItem[]
  pendingQty: number
  verifiedQty: number
}

interface Props {
  userId: string
  contractors: Contractor[]
  allContractors: Contractor[]  // All contractors with pending returns across all dates
  selectedDate: string
  availableDates: string[]
  totalPendingAll: number  // Total pending across ALL dates
  selectedContractorId?: string | null  // Pre-select and expand this contractor
}

export function ReturnsPage({ userId, contractors, allContractors, selectedDate, availableDates, totalPendingAll, selectedContractorId }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<'date' | 'contractor'>(selectedContractorId ? 'date' : 'contractor')
  const [activeContractorId, setActiveContractorId] = useState<string | null>(selectedContractorId || null)
  const [saving, setSaving] = useState<string | null>(null)
  const [verifyingAll, setVerifyingAll] = useState(false)
  const [status, setStatus] = useState('')
  
  // Track quantities and actions per item
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})
  const [itemActions, setItemActions] = useState<Record<string, 'verified' | 'missing' | null>>({})
  
  // Track locally verified items (to avoid page reload)
  const [locallyVerified, setLocallyVerified] = useState<Set<string>>(new Set())

  const getItemQty = (itemId: string, originalQty: number) => itemQuantities[itemId] ?? originalQty
  const getItemAction = (itemId: string) => itemActions[itemId] ?? null

  const setItemQty = (itemId: string, qty: number) => {
    setItemQuantities(prev => ({ ...prev, [itemId]: Math.max(0, qty) }))
  }

  const setItemAction = (itemId: string, action: 'verified' | 'missing' | null) => {
    setItemActions(prev => ({ ...prev, [itemId]: action }))
  }

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (dt.getTime() === today.getTime()) return 'Today'
    if (dt.getTime() === yesterday.getTime()) return 'Yesterday'
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const dateIdx = availableDates.indexOf(selectedDate)
  const displayContractors = mode === 'contractor' ? allContractors : contractors

  function navigateDate(dir: 'prev' | 'next') {
    const newIdx = dir === 'prev' ? dateIdx + 1 : dateIdx - 1
    if (newIdx >= 0 && newIdx < availableDates.length) {
      router.push(`/dashboard/storekeeper/stock-in?date=${availableDates[newIdx]}`)
    }
  }

  async function verifySingle(itemId: string, contractorId: string, source: 'delivery' | 'return_collection') {
    setSaving(itemId)
    setStatus('Verifying...')
    
    let error
    if (source === 'return_collection') {
      // Update return_collections table
      const result = await supabase.from('return_collections').update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId,
      }).eq('id', itemId)
      error = result.error
    } else {
      // Update deliveries table
      const result = await supabase.from('deliveries').update({
        stock_verified: true,
        stock_verified_at: new Date().toISOString(),
        stock_verified_by: userId,
      }).eq('id', itemId)
      error = result.error
    }
    
    if (error) {
      setStatus(`Error: ${error.message}`)
      setSaving(null)
      return
    }
    
    // Update local state instead of reloading
    setLocallyVerified(prev => new Set([...prev, itemId]))
    setSaving(null)
    setStatus('')
    
    // Check if all items for this contractor are now verified
    const contractor = displayContractors.find(c => c.id === contractorId)
    if (contractor) {
      const newVerifiedSet = new Set([...locallyVerified, itemId])
      const allVerified = contractor.items.every(item => item.verified || newVerifiedSet.has(item.id))
      
      if (allVerified) {
        // Find next contractor with unverified items
        const sortedContractors = [...displayContractors].sort((a, b) => b.items.length - a.items.length)
        const currentIndex = sortedContractors.findIndex(c => c.id === contractorId)
        
        let nextContractorId: string | null = null
        // Look for next unverified contractor after current one
        for (let i = currentIndex + 1; i < sortedContractors.length; i++) {
          const c = sortedContractors[i]
          const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
          if (hasUnverified) {
            nextContractorId = c.id
            break
          }
        }
        // If no next found, check from beginning (wrap around)
        if (!nextContractorId) {
          for (let i = 0; i < currentIndex; i++) {
            const c = sortedContractors[i]
            const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
            if (hasUnverified) {
              nextContractorId = c.id
              break
            }
          }
        }
        
        // Move to next contractor or go back to list
        if (nextContractorId) {
          setActiveContractorId(nextContractorId)
          setItemQuantities({})
          setItemActions({})
        } else {
          // All contractors done, go back to dashboard
          window.location.href = '/dashboard/storekeeper'
        }
      }
    }
  }

  async function verifyAllForContractor(contractorId: string) {
    setVerifyingAll(true)
    setStatus('Verifying all items...')
    
    const contractor = displayContractors.find(c => c.id === contractorId)
    if (!contractor) return

    const unverifiedItems = contractor.items.filter(i => !i.verified && !locallyVerified.has(i.id))
    const unverifiedIds = unverifiedItems.map(i => i.id)
    
    // Separate by source
    const deliveryIds = unverifiedItems.filter(i => i.source === 'delivery').map(i => i.id)
    const returnCollectionIds = unverifiedItems.filter(i => i.source === 'return_collection').map(i => i.id)
    
    // Update deliveries table
    if (deliveryIds.length > 0) {
      const { error } = await supabase.from('deliveries').update({
        stock_verified: true,
        stock_verified_at: new Date().toISOString(),
        stock_verified_by: userId,
      }).in('id', deliveryIds)
      
      if (error) {
        setStatus(`Error: ${error.message}`)
        setVerifyingAll(false)
        return
      }
    }
    
    // Update return_collections table
    if (returnCollectionIds.length > 0) {
      const { error } = await supabase.from('return_collections').update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId,
      }).in('id', returnCollectionIds)
      
      if (error) {
        setStatus(`Error: ${error.message}`)
        setVerifyingAll(false)
        return
      }
    }
    
    // Update local state
    setLocallyVerified(prev => new Set([...prev, ...unverifiedIds]))
    setVerifyingAll(false)
    setStatus('')
    
    // Find next contractor with unverified items
    const newVerifiedSet = new Set([...locallyVerified, ...unverifiedIds])
    const sortedContractors = [...displayContractors].sort((a, b) => b.items.length - a.items.length)
    const currentIndex = sortedContractors.findIndex(c => c.id === contractorId)
    
    let nextContractorId: string | null = null
    for (let i = currentIndex + 1; i < sortedContractors.length; i++) {
      const c = sortedContractors[i]
      const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
      if (hasUnverified) {
        nextContractorId = c.id
        break
      }
    }
    if (!nextContractorId) {
      for (let i = 0; i < currentIndex; i++) {
        const c = sortedContractors[i]
        const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
        if (hasUnverified) {
          nextContractorId = c.id
          break
        }
      }
    }
    
    if (nextContractorId) {
      setActiveContractorId(nextContractorId)
      setItemQuantities({})
      setItemActions({})
    } else {
      window.location.href = '/dashboard/storekeeper'
    }
  }

  // Get active contractor data
  const activeContractor = activeContractorId ? displayContractors.find(c => c.id === activeContractorId) : null

  // Reset state when selecting a new contractor
  const selectContractor = (id: string | null) => {
    setActiveContractorId(id)
    setItemQuantities({})
    setItemActions({})
    setStatus('')
  }

  // ── VERIFICATION VIEW ──
  if (activeContractor) {
    const pendingItems = activeContractor.items.filter(i => !i.verified && !locallyVerified.has(i.id))
    const verifiedItems = activeContractor.items.filter(i => i.verified || locallyVerified.has(i.id))

    return (
      <div className="px-3 pb-4 h-[calc(100dvh-6rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 py-3 border-b border-border/30 mb-3">
          <button type="button" onClick={() => selectContractor(null)} 
            className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center active:scale-90">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="font-bold text-lg">{activeContractor.name}</div>
            <div className="text-sm text-muted-foreground">
              <span className="text-violet-400 font-bold">{pendingItems.length}</span> pending, 
              <span className="text-emerald-400 font-bold ml-1">{verifiedItems.length}</span> verified
            </div>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className={cn("p-3 rounded-xl text-sm mb-3",
            status.startsWith('Error') ? "bg-red-500/20 text-red-300" : "bg-blue-500/20 text-blue-300"
          )}>
            {status}
          </div>
        )}

        {/* Verify All Button */}
        {pendingItems.length > 0 && (
          <button type="button" onClick={() => verifyAllForContractor(activeContractor.id)} disabled={verifyingAll}
            className="w-full h-14 rounded-2xl bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 mb-3 active:scale-95 disabled:opacity-50">
            {verifyingAll ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying...</> 
              : <><CheckCircle2 className="w-5 h-5" /> Verify All ({pendingItems.length} items)</>}
          </button>
        )}

        {/* Items List - Simple format like Stock Out */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {pendingItems.map(item => (
            <div key={item.id} className="px-4 py-3 flex items-center gap-3">
              {/* Product Icon */}
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5 text-violet-400" />
              </div>
              
              {/* Product Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{item.product}</span>
                  {item.salesType && item.salesType !== 'cms' && (
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                      item.salesType === 'trade_in' ? "bg-purple-500/20 text-purple-400" :
                      item.salesType === 'exchange' ? "bg-blue-500/20 text-blue-400" :
                      item.salesType === 'refund' ? "bg-orange-500/20 text-orange-400" :
                      "bg-muted/30 text-muted-foreground"
                    )}>
                      {item.salesType.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {mode === 'contractor' && <span>{fmtDate(item.date)} · </span>}
                  {item.riderName}
                </div>
              </div>
              
              {/* Quantity Badge */}
              <div className="min-w-[40px] px-2 py-1.5 rounded-xl bg-violet-500/10 text-center shrink-0">
                <p className="text-lg font-bold text-violet-400 tabular-nums">{item.qty}</p>
              </div>
              
              {/* Verify Button - Simple green with tick */}
              <button
                type="button"
                onClick={() => verifySingle(item.id, activeContractor.id, item.source)}
                disabled={saving === item.id}
                className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 active:scale-95 disabled:opacity-50"
              >
                {saving === item.id ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Check className="w-5 h-5 text-white" />
                )}
              </button>
            </div>
          ))}

        </div>

        {/* Verified Items Section */}
        {verifiedItems.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 px-1 mb-2">Already Verified ({verifiedItems.length})</div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden divide-y divide-border">
              {verifiedItems.map(item => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3 opacity-60">
                  {/* Verified Icon */}
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  
                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.product}</span>
                      {item.salesType && item.salesType !== 'cms' && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                          item.salesType === 'trade_in' ? "bg-purple-500/20 text-purple-400" :
                          item.salesType === 'exchange' ? "bg-blue-500/20 text-blue-400" :
                          item.salesType === 'refund' ? "bg-orange-500/20 text-orange-400" :
                          "bg-muted/30 text-muted-foreground"
                        )}>
                          {item.salesType.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.riderName}</div>
                  </div>
                  
                  {/* Quantity */}
                  <div className="min-w-[40px] px-2 py-1.5 rounded-xl bg-emerald-500/10 text-center shrink-0">
                    <p className="text-lg font-bold text-emerald-400 tabular-nums">{item.qty}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary Footer */}
        {pendingItems.length > 0 && (
          <div className="glass-card rounded-xl p-3 mt-3 border-t border-border/30">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-muted-foreground">Verified:</span>
                  <span className="font-bold text-emerald-400">
                    {pendingItems.filter(i => getItemAction(i.id) === 'verified').length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-muted-foreground">Missing:</span>
                  <span className="font-bold text-red-400">
                    {pendingItems.filter(i => getItemAction(i.id) === 'missing').length}
                  </span>
                </div>
              </div>
              <div className="text-muted-foreground">
                {pendingItems.filter(i => !getItemAction(i.id)).length} left
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── MAIN LIST VIEW ──
  // Compute adjusted counts accounting for locally verified items
  const getAdjustedCounts = (c: Contractor) => {
    const localVerifiedCount = c.items.filter(i => !i.verified && locallyVerified.has(i.id)).length
    const localVerifiedQty = c.items.filter(i => !i.verified && locallyVerified.has(i.id)).reduce((sum, i) => sum + i.qty, 0)
    return {
      verifiedQty: c.verifiedQty + localVerifiedQty,
      pendingQty: Math.max(0, c.pendingQty - localVerifiedQty),
      pendingCount: c.items.filter(i => !i.verified && !locallyVerified.has(i.id)).length,
    }
  }
  
  const totalItems = displayContractors.reduce((sum, c) => sum + c.items.length, 0)
  const totalVerified = displayContractors.reduce((sum, c) => sum + getAdjustedCounts(c).verifiedQty, 0)
  const totalPending = displayContractors.reduce((sum, c) => sum + getAdjustedCounts(c).pendingQty, 0)
  const progressPercent = totalItems > 0 ? Math.round((totalVerified / (totalVerified + totalPending)) * 100) : 0

  return (
    <div className="px-3 space-y-3">
      {/* Compact Header with Date Nav + Progress */}
      <div className="glass-card rounded-2xl p-3">
        {/* Top row: Back + Mode Toggle */}
        <div className="flex items-center justify-between mb-3">
          <Link href="/dashboard/storekeeper" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex bg-muted/30 rounded-lg p-0.5">
            <button type="button" onClick={() => setMode('contractor')}
              className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                mode === 'contractor' ? "bg-violet-500 text-white" : "text-muted-foreground")}>
              Contractor
            </button>
            <button type="button" onClick={() => setMode('date')}
              className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                mode === 'date' ? "bg-violet-500 text-white" : "text-muted-foreground")}>
              Date
            </button>
          </div>
        </div>

        {/* Date Navigation (in date mode) or Title (in contractor mode) */}
        <div className="flex items-center justify-between mb-3">
          {mode === 'date' ? (
            <>
              <button type="button" onClick={() => navigateDate('prev')} disabled={dateIdx >= availableDates.length - 1}
                className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-violet-400" />
                <span className="font-bold">{fmtDate(selectedDate)}</span>
              </div>
              <button type="button" onClick={() => navigateDate('next')} disabled={dateIdx <= 0}
                className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 w-full justify-center">
              <RotateCcw className="w-4 h-4 text-violet-400" />
              <span className="font-bold">All Pending Returns</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">{totalVerified} verified</span>
              <span className="text-[10px] text-violet-400 font-bold">{totalPending} pending</span>
            </div>
          </div>
          <div className="text-2xl font-black text-violet-400">{totalPendingAll}</div>
        </div>
      </div>

      {/* Contractor List */}
      {displayContractors.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-16 h-16 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No pending returns</p>
        </div>
      ) : (
        <div className="space-y-2 pb-24">
          {displayContractors.map(c => {
            const adjusted = getAdjustedCounts(c)
            const allDone = adjusted.pendingQty === 0
            return (
              <button key={c.id} type="button" onClick={() => selectContractor(c.id)}
                className={cn(
                  "w-full glass-card rounded-2xl p-4 text-left active:scale-[0.98] transition-all",
                  allDone ? "border border-emerald-500/30 bg-emerald-500/5" : "border border-violet-500/30"
                )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center",
                    allDone ? "bg-gradient-to-br from-emerald-500 to-green-600" : "bg-gradient-to-br from-violet-500 to-purple-600"
                  )}>
                    {allDone ? <CheckCircle2 className="w-6 h-6 text-white" /> : <Users className="w-6 h-6 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.items.length} items | {adjusted.pendingQty + adjusted.verifiedQty} qty
                    </div>
                  </div>
                  <div className="text-right">
                    {allDone ? (
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded-lg">Done</span>
                    ) : (
                      <>
                        <div className="text-xl font-bold text-violet-400">{adjusted.pendingQty}</div>
                        <div className="text-[10px] text-muted-foreground">pending</div>
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
