'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  Banknote, ArrowLeft, CheckCircle2, Loader2,
  Calendar, Clock, ChevronLeft, ChevronRight, RotateCcw,
  AlertTriangle, ShieldAlert, Scale
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

// Mauritius currency - organized for 4-column grid layout
const NOTES_HIGH = [2000, 1000, 500, 200] as const
const NOTES_LOW = [100, 50, 25, 20] as const
const COINS = [10, 5, 1] as const
const ALL_DENOMS = [...NOTES_HIGH, ...NOTES_LOW, ...COINS] as const

// Denomination colors
const DENOM_COLORS: Record<number, { bg: string; text: string }> = {
  2000: { bg: 'from-purple-600 to-purple-800', text: 'text-white' },
  1000: { bg: 'from-red-500 to-red-700', text: 'text-white' },
  500: { bg: 'from-green-500 to-green-700', text: 'text-white' },
  200: { bg: 'from-blue-500 to-blue-700', text: 'text-white' },
  100: { bg: 'from-orange-500 to-orange-700', text: 'text-white' },
  50: { bg: 'from-teal-500 to-teal-700', text: 'text-white' },
  25: { bg: 'from-pink-500 to-pink-700', text: 'text-white' },
  20: { bg: 'from-yellow-400 to-amber-500', text: 'text-amber-900' },
  10: { bg: 'from-gray-300 to-gray-500', text: 'text-gray-800' },
  5: { bg: 'from-amber-500 to-orange-600', text: 'text-amber-900' },
  1: { bg: 'from-slate-300 to-slate-500', text: 'text-gray-800' },
}

function fmtRs(n: number) { return `Rs ${n.toLocaleString()}` }

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (dt.getTime() === today.getTime()) return 'Today'
  if (dt.getTime() === yesterday.getTime()) return 'Yesterday'
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface CashDelivery {
  id: string
  index_no?: string
  customer_name: string
  payment_cash: number
  delivery_date: string
  rider_id?: string
  rider_name?: string | null
  contractor_cash_counted?: number | null
  contractor_cash_denoms?: Record<number, number> | null
  contractor_cash_counted_at?: string | null
}

interface CountedSession {
  date: string
  total: number
  denoms: Record<number, number>
  counted_at: string
  delivery_ids: string[]
}

interface CollectedDelivery {
  id: string
  index_no?: string
  customer_name: string
  payment_cash: number
  delivery_date: string
  rider_id?: string
  rider_name?: string | null
  cash_collected_at?: string | null
}

interface Props {
  contractorId: string
  deliveries: CashDelivery[]
  collectedByStore?: CollectedDelivery[]
  availableDates: string[]
  selectedDate: string
}

export function ContractorCashCollectionPage({ contractorId, deliveries, collectedByStore = [], availableDates, selectedDate }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [currentDate, setCurrentDate] = useState(selectedDate)
  const [showCountingSheet, setShowCountingSheet] = useState(false)
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Group deliveries by date
  const deliveriesByDate = useMemo(() => {
    const map: Record<string, CashDelivery[]> = {}
    for (const d of deliveries) {
      const date = d.delivery_date
      if (!map[date]) map[date] = []
      map[date].push(d)
    }
    return map
  }, [deliveries])

  // Current date's deliveries
  const currentDeliveries = deliveriesByDate[currentDate] || []
  // Check by contractor_cash_counted_at (timestamp) since contractor_cash_counted can be 0 for batch items
  const uncounted = currentDeliveries.filter(d => !d.contractor_cash_counted_at)
  const counted = currentDeliveries.filter(d => d.contractor_cash_counted_at)
  
  const totalExpected = currentDeliveries.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
  // Sum contractor_cash_counted (first delivery has total, others have 0)
  const totalCounted = counted.reduce((sum, d) => sum + Number(d.contractor_cash_counted || 0), 0)
  const totalUncounted = uncounted.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)

  // Reset counted cash for current date
  const handleResetCounting = async () => {
    setResetting(true)
    const countedIds = counted.map(d => d.id)
    if (countedIds.length > 0) {
      await supabase
        .from('deliveries')
        .update({
          contractor_cash_counted: null,
          contractor_cash_denoms: null,
          contractor_cash_counted_at: null,
        })
        .in('id', countedIds)
    }
    setShowResetConfirm(false)
    setResetting(false)
    router.refresh()
  }

  // Navigate between dates
  const dateIdx = availableDates.indexOf(currentDate)
  const navigateDate = (dir: number) => {
    const newIdx = dateIdx + dir
    if (newIdx >= 0 && newIdx < availableDates.length) {
      setCurrentDate(availableDates[newIdx])
    }
  }

  // Show counting sheet for uncounted deliveries
  if (showCountingSheet && uncounted.length > 0) {
    return (
      <CountingSheet
        contractorId={contractorId}
        deliveries={uncounted}
        totalExpected={totalUncounted}
        date={currentDate}
        onBack={() => setShowCountingSheet(false)}
        onSuccess={() => {
          setShowCountingSheet(false)
          router.refresh()
        }}
      />
    )
  }
  
  // Show edit sheet for already counted deliveries
  // Expected should be based on payment_cash (actual expected), not what was previously counted
  const expectedForCounted = counted.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
  if (showEditSheet && counted.length > 0) {
  return (
  <CountingSheet
  contractorId={contractorId}
  deliveries={counted}
  totalExpected={expectedForCounted}
        date={currentDate}
        isEdit={true}
        onBack={() => setShowEditSheet(false)}
        onSuccess={() => {
          setShowEditSheet(false)
          router.refresh()
        }}
      />
    )
  }

  return (
    <div className="space-y-4 pb-20">
      {/* Date Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateDate(-1)}
          disabled={dateIdx <= 0}
          className="p-2 rounded-xl bg-muted/50 disabled:opacity-30"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{fmtDate(currentDate)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">{currentDate}</p>
        </div>
        <button
          onClick={() => navigateDate(1)}
          disabled={dateIdx >= availableDates.length - 1}
          className="p-2 rounded-xl bg-muted/50 disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={totalUncounted > 0 ? "border-amber-500/30" : "border-muted"}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">To Count</p>
            <p className={cn("text-xl font-bold", totalUncounted > 0 ? "text-amber-500" : "text-muted-foreground")}>
              {fmtRs(totalUncounted)}
            </p>
            <p className="text-[9px] text-muted-foreground">{uncounted.length} deliveries</p>
          </CardContent>
        </Card>
        <Card className={totalCounted > 0 ? "border-emerald-500/30" : "border-muted"}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Counted</p>
            <p className={cn("text-xl font-bold", totalCounted > 0 ? "text-emerald-500" : "text-muted-foreground")}>
              {fmtRs(totalCounted)}
            </p>
            <p className="text-[9px] text-muted-foreground">{counted.length} deliveries</p>
          </CardContent>
        </Card>
      </div>

      {/* Count Button */}
      {uncounted.length > 0 && (
        <button
          onClick={() => setShowCountingSheet(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-lg shadow-lg transition-all active:scale-[0.98]"
        >
          <Banknote className="w-6 h-6" />
          Count Cash ({fmtRs(totalUncounted)})
        </button>
      )}

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <RotateCcw className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold">Reset Cash Count</h3>
                <p className="text-xs text-muted-foreground">For {fmtDate(currentDate)}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This will reset the cash count for {counted.length} deliveries ({fmtRs(totalCounted)}). You will need to count again.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-muted/80 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetCounting}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {resetting ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Already Counted Section */}
      {counted.length > 0 && (() => {
        // Find the delivery with denomination data (only first delivery in batch has it)
        const denomDelivery = counted.find(d => d.contractor_cash_denoms && typeof d.contractor_cash_denoms === 'object')
        const denomData: Record<number, number> = {}
        
        if (denomDelivery?.contractor_cash_denoms) {
          for (const [key, count] of Object.entries(denomDelivery.contractor_cash_denoms)) {
            // Handle both formats: "denomination_X" and "X"
            const denomValue = key.startsWith('denomination_') 
              ? parseInt(key.replace('denomination_', ''), 10)
              : parseInt(key, 10)
            if (!isNaN(denomValue) && Number(count) > 0) {
              denomData[denomValue] = Number(count)
            }
          }
        }
      const hasDenoms = Object.keys(denomData).length > 0
      
      // Use contractor_cash_counted sum (first delivery has total, others have 0)
      const countedTotal = counted.reduce((sum, d) => sum + Number(d.contractor_cash_counted || 0), 0)
      // Calculate expected from payment_cash
      const expectedTotal = counted.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
      const isMatch = countedTotal === expectedTotal
      const shortAmount = expectedTotal - countedTotal

        return (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isMatch ? (
                <>
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-xs font-semibold text-emerald-500">Ready for Store Collection</p>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                  </div>
                  <p className="text-xs font-semibold text-red-500">Compliance Issue Detected</p>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              {isMatch && (
                <button
                  onClick={() => setShowEditSheet(true)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground font-medium"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => setShowResetConfirm(true)}
                className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 font-medium flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>
          </div>
          
          {/* Compliance Mismatch Warning - Futuristic Design */}
          {!isMatch && (
            <div className="mb-4 relative overflow-hidden">
              {/* Animated border glow effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 via-red-600/30 to-red-500/20 animate-pulse rounded-2xl" />
              
              <Card className="relative border-2 border-red-500/50 bg-gradient-to-br from-red-950/90 via-red-900/80 to-red-950/90 backdrop-blur-sm rounded-2xl overflow-hidden">
                {/* Top warning bar */}
                <div className="bg-red-500 py-1.5 px-4 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-white animate-pulse" />
                  <p className="text-xs font-bold text-white uppercase tracking-wider">Compliance Alert</p>
                </div>
                
                <CardContent className="py-4 px-4">
                  {/* Amount discrepancy */}
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-red-500/30">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center border border-red-500/40">
                        <AlertTriangle className="w-6 h-6 text-red-400" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-red-400">
                          {shortAmount > 0 ? `Short: ${fmtRs(shortAmount)}` : `Over: ${fmtRs(Math.abs(shortAmount))}`}
                        </p>
                        <p className="text-xs text-red-300/70">Cash Discrepancy Detected</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Amount comparison */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-black/30 rounded-xl p-3 border border-amber-500/30">
                      <p className="text-[10px] text-amber-500/80 uppercase tracking-wide mb-1">Expected</p>
                      <p className="text-lg font-bold text-amber-500">{fmtRs(expectedTotal)}</p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 border border-red-500/30">
                      <p className="text-[10px] text-red-400/80 uppercase tracking-wide mb-1">Your Count</p>
                      <p className="text-lg font-bold text-red-400">{fmtRs(countedTotal)}</p>
                    </div>
                  </div>
                  
                  {/* Legal notice */}
                  <div className="bg-black/40 rounded-xl p-3 border border-red-500/20">
                    <div className="flex items-start gap-2 mb-2">
                      <Scale className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] font-semibold text-red-300">Contract & Legal Obligation</p>
                    </div>
                    <p className="text-[10px] text-red-200/70 leading-relaxed mb-2">
                      This cash includes <span className="text-amber-400 font-medium">VAT amounts</span> collected from customer invoices. 
                      Under your signed employment contract, you are obligated to remit all collected funds in full.
                    </p>
                    <p className="text-[10px] text-red-200/70 leading-relaxed mb-2">
                      Failure to account for the exact amount constitutes a <span className="text-red-400 font-medium">breach of contract</span> and 
                      may be reported to the <span className="text-red-400 font-medium">Mauritius Revenue Authority (MRA)</span> as per VAT compliance regulations.
                    </p>
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-red-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <p className="text-[9px] text-red-300/80 font-medium">
                        Store collection blocked until full amount is accounted
                      </p>
                    </div>
                  </div>
                  
                  {/* Action button */}
                  <button
                    onClick={() => setShowEditSheet(true)}
                    className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-500/20"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Correct Denomination Count
                  </button>
                </CardContent>
              </Card>
            </div>
          )}
          
          <Card className={cn("border", isMatch ? "border-emerald-500/20" : "border-red-500/20")}>
            <CardContent className="py-3 px-4">
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-medium">{counted.length} deliveries</p>
                <p className={cn("text-lg font-bold", isMatch ? "text-emerald-500" : "text-red-400")}>{fmtRs(countedTotal)}</p>
              </div>
              {isMatch && (
                <p className="text-[10px] text-emerald-500/70 mb-2">Matches expected {fmtRs(expectedTotal)}</p>
              )}
              {/* Show denomination breakdown if available */}
              {hasDenoms && (
                <div className="pt-2 border-t border-border/50">
                  <p className="text-[9px] text-muted-foreground mb-1">Denomination breakdown:</p>
                  <div className="flex flex-wrap gap-1">
                    {ALL_DENOMS
                      .filter(d => denomData[d] > 0)
                      .map(d => (
                        <span key={d} className="text-[9px] px-1.5 py-0.5 rounded bg-muted">
                          Rs{d} x {denomData[d]}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )
      })()}

      {/* Collected by Store Section */}
      {collectedByStore.length > 0 && (() => {
        // Group by collection date
        const byDate = new Map<string, CollectedDelivery[]>()
        for (const d of collectedByStore) {
          const date = d.cash_collected_at 
            ? new Date(d.cash_collected_at).toISOString().split('T')[0]
            : d.delivery_date
          if (!byDate.has(date)) byDate.set(date, [])
          byDate.get(date)!.push(d)
        }
        const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
        const totalCollected = collectedByStore.reduce((s, d) => s + Number(d.payment_cash || 0), 0)
        
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-500" />
                <p className="text-xs font-medium text-blue-500">Collected by Store</p>
              </div>
              <span className="text-sm font-bold text-blue-500">{fmtRs(totalCollected)}</span>
            </div>
            {sortedDates.map(date => {
              const items = byDate.get(date)!
              const dateTotal = items.reduce((s, d) => s + Number(d.payment_cash || 0), 0)
              return (
                <Card key={date} className="border-blue-500/20 bg-blue-500/5">
                  <CardContent className="py-3 px-4">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <p className="text-xs font-medium text-blue-400">{fmtDate(date)}</p>
                        <p className="text-[9px] text-muted-foreground">{items.length} deliveries</p>
                      </div>
                      <p className="text-sm font-bold text-blue-500">{fmtRs(dateTotal)}</p>
                    </div>
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {items.slice(0, 5).map(d => (
                        <div key={d.id} className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground truncate max-w-[60%]">{d.customer_name}</span>
                          <span className="font-medium">{fmtRs(Number(d.payment_cash || 0))}</span>
                        </div>
                      ))}
                      {items.length > 5 && (
                        <p className="text-[9px] text-muted-foreground">+{items.length - 5} more</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      })()}

      {/* Uncounted Deliveries List */}
      {uncounted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Pending Count ({uncounted.length})
          </p>
          <div className="space-y-1.5">
            {uncounted.slice(0, 8).map(d => (
              <Card key={d.id} className="border-amber-500/10">
                <CardContent className="py-2 px-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs font-medium">{d.customer_name}</p>
                      <p className="text-[9px] text-muted-foreground">
                        {d.index_no} {d.rider_name && `• ${d.rider_name}`}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-amber-500">
                      {fmtRs(Number(d.payment_cash || 0))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {uncounted.length > 8 && (
              <p className="text-[10px] text-center text-muted-foreground">
                +{uncounted.length - 8} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {currentDeliveries.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="p-3 rounded-full bg-muted w-fit mx-auto mb-3">
              <Banknote className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium">No Cash Deliveries</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              No cash payments for {fmtDate(currentDate)}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Counting Sheet Component
function CountingSheet({
  contractorId,
  deliveries,
  totalExpected,
  date,
  isEdit = false,
  onBack,
  onSuccess
}: {
  contractorId: string
  deliveries: CashDelivery[]
  totalExpected: number
  date: string
  isEdit?: boolean
  onBack: () => void
  onSuccess: () => void
}) {
  // Pre-fill denominations when editing
  const initialDenoms = useMemo(() => {
    const init: Record<number, number> = Object.fromEntries(ALL_DENOMS.map(d => [d, 0]))
    if (isEdit) {
      // Find delivery with denomination data
      const denomDelivery = deliveries.find(d => d.contractor_cash_denoms && typeof d.contractor_cash_denoms === 'object')
      if (denomDelivery?.contractor_cash_denoms) {
        for (const [key, count] of Object.entries(denomDelivery.contractor_cash_denoms)) {
          const denomValue = key.startsWith('denomination_') 
            ? parseInt(key.replace('denomination_', ''), 10)
            : parseInt(key, 10)
          if (!isNaN(denomValue) && ALL_DENOMS.includes(denomValue)) {
            init[denomValue] = Number(count) || 0
          }
        }
      }
    }
    return init
  }, [isEdit, deliveries])
  
  const [denoms, setDenoms] = useState<Record<number, number>>(initialDenoms)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const counted = ALL_DENOMS.reduce((sum, d) => sum + (denoms[d] || 0) * d, 0)
  const diff = counted - totalExpected

  const add = (d: number) => setDenoms(prev => ({ ...prev, [d]: prev[d] + 1 }))
  const sub = (d: number) => setDenoms(prev => ({ ...prev, [d]: Math.max(0, prev[d] - 1) }))

  const handleConfirm = async () => {
    if (counted === 0) return
    setSaving(true)
    setStatus('Saving...')

    try {
      const supabase = createClient()
      const ids = deliveries.map(d => d.id)

      // Convert denoms to denomination_X format for consistency with store
      const denomsFormatted: Record<string, number> = {}
      for (const [denom, count] of Object.entries(denoms)) {
        denomsFormatted[`denomination_${denom}`] = count as number
      }

      // Calculate ACTUAL counted total from denominations
      const actualCountedTotal = ALL_DENOMS.reduce((t, d) => t + d * denoms[d], 0)
      
      // Update all deliveries - mark as counted
      // First delivery stores the ACTUAL total counted, others are just marked as counted
      const countedAt = new Date().toISOString()
      
      // First delivery gets the full denomination breakdown AND the actual total
      const { error: firstError } = await supabase.from('deliveries').update({
        contractor_cash_counted: actualCountedTotal, // Store ACTUAL total counted (not payment_cash)
        contractor_cash_denoms: denomsFormatted,
        contractor_cash_counted_at: countedAt,
      }).eq('id', ids[0])
      
      // Rest of deliveries just get marked as counted (contractor_cash_counted = 0 to indicate they're part of a batch)
      if (!firstError && ids.length > 1) {
        await supabase.from('deliveries').update({
          contractor_cash_counted: 0, // 0 indicates part of batch, first delivery has the total
          contractor_cash_denoms: null,
          contractor_cash_counted_at: countedAt,
        }).in('id', ids.slice(1))
      }
      
      const error = firstError

      if (error) {
        setStatus(`Error: ${error.message}`)
        setSaving(false)
        return
      }

      setStatus('Done!')
      setTimeout(onSuccess, 500)
    } catch (e) {
      setStatus(`Error: ${e}`)
      setSaving(false)
    }
  }

  return (
    <div className="pb-4 flex flex-col min-h-[calc(100dvh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-4 py-3 mb-3">
        <button
          type="button"
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-muted/50 hover:bg-muted flex items-center justify-center transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="font-bold text-lg">{isEdit ? 'Edit Cash Count' : 'Count Cash'}</div>
          <div className="text-xs text-muted-foreground">
            Expected: <span className="text-amber-500 font-semibold">{fmtRs(totalExpected)}</span>
            <span className="mx-1">•</span>
            {fmtDate(date)}
          </div>
        </div>
      </div>

      {/* Counted Display */}
      <div className={cn(
        "rounded-2xl p-5 mb-4 text-center border transition-all",
        diff === 0 && counted > 0
          ? "border-emerald-500/50 bg-emerald-500/10"
          : diff < 0
            ? "border-red-500/50 bg-red-500/10"
            : "border-border bg-muted/30"
      )}>
        <div className="text-4xl font-black">{fmtRs(counted)}</div>
        {counted > 0 && (
          <div className={cn("text-sm font-semibold mt-1",
            diff === 0 ? "text-emerald-500" : diff < 0 ? "text-red-500" : "text-amber-500"
          )}>
            {diff === 0 ? 'Exact Match' : diff < 0 ? `Short ${fmtRs(Math.abs(diff))}` : `Over ${fmtRs(diff)}`}
          </div>
        )}
      </div>

      {/* Denomination Grid */}
      <div className="space-y-3 flex-1">
        {/* High Value Notes */}
        <div>
          <div className="text-[9px] text-muted-foreground mb-1.5 font-semibold uppercase tracking-widest">Notes</div>
          <div className="grid grid-cols-4 gap-1.5">
            {NOTES_HIGH.map(d => (
              <div key={d} className="space-y-1">
                <button
                  type="button"
                  onClick={() => add(d)}
                  className={cn(
                    "w-full aspect-[4/3] rounded-xl flex flex-col items-center justify-center font-bold",
                    "bg-gradient-to-br shadow active:scale-95 transition-all",
                    "border border-white/20",
                    DENOM_COLORS[d].bg,
                    DENOM_COLORS[d].text,
                    denoms[d] > 0 && "ring-2 ring-white/80 ring-offset-1 ring-offset-background"
                  )}
                >
                  <span className="text-[8px] font-medium opacity-70">{d >= 1000 ? `${d / 1000}K` : d}</span>
                  <span className="text-lg font-black">{denoms[d]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => sub(d)}
                  disabled={denoms[d] === 0}
                  className="w-full h-6 rounded-lg bg-muted/50 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 font-bold text-xs disabled:opacity-20 transition-colors"
                >
                  -
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Lower Value Notes */}
        <div className="grid grid-cols-4 gap-1.5">
          {NOTES_LOW.map(d => (
            <div key={d} className="space-y-1">
              <button
                type="button"
                onClick={() => add(d)}
                className={cn(
                  "w-full aspect-[4/3] rounded-xl flex flex-col items-center justify-center font-bold",
                  "bg-gradient-to-br shadow active:scale-95 transition-all",
                  "border border-white/20",
                  DENOM_COLORS[d].bg,
                  DENOM_COLORS[d].text,
                  denoms[d] > 0 && "ring-2 ring-white/80 ring-offset-1 ring-offset-background"
                )}
              >
                <span className="text-[8px] font-medium opacity-70">{d}</span>
                <span className="text-lg font-black">{denoms[d]}</span>
              </button>
              <button
                type="button"
                onClick={() => sub(d)}
                disabled={denoms[d] === 0}
                className="w-full h-6 rounded-lg bg-muted/50 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 font-bold text-xs disabled:opacity-20 transition-colors"
              >
                -
              </button>
            </div>
          ))}
        </div>

        {/* Coins */}
        <div>
          <div className="text-[9px] text-muted-foreground mb-1.5 font-semibold uppercase tracking-widest">Coins</div>
          <div className="grid grid-cols-3 gap-1.5">
            {COINS.map(d => (
              <div key={d} className="space-y-1">
                <button
                  type="button"
                  onClick={() => add(d)}
                  className={cn(
                    "w-full aspect-[4/3] rounded-xl flex flex-col items-center justify-center font-bold",
                    "bg-gradient-to-br shadow active:scale-95 transition-all",
                    "border border-white/20",
                    DENOM_COLORS[d].bg,
                    DENOM_COLORS[d].text,
                    denoms[d] > 0 && "ring-2 ring-white/80 ring-offset-1 ring-offset-background"
                  )}
                >
                  <span className="text-[8px] font-medium opacity-70">Rs{d}</span>
                  <span className="text-lg font-black">{denoms[d]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => sub(d)}
                  disabled={denoms[d] === 0}
                  className="w-full h-6 rounded-lg bg-muted/50 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 font-bold text-xs disabled:opacity-20 transition-colors"
                >
                  -
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status */}
      {status && (
        <div className={cn("p-3 rounded-xl text-sm mb-2",
          status.startsWith('Error') ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"
        )}>
          {status}
        </div>
      )}

      {/* Confirm Button */}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={saving || counted === 0}
        className={cn(
          "w-full h-14 rounded-2xl text-base font-bold flex items-center justify-center text-white",
          "shadow-lg transition-all active:scale-[0.98]",
          diff === 0 && counted > 0
            ? "bg-gradient-to-r from-emerald-500 to-emerald-600"
            : diff < 0
              ? "bg-gradient-to-r from-red-500 to-red-600"
              : "bg-gradient-to-r from-amber-500 to-amber-600",
          (saving || counted === 0) && "opacity-40"
        )}
      >
        {saving ? (
          <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Saving...</>
        ) : counted === 0 ? (
          'Count Cash First'
        ) : diff === 0 ? (
          <><CheckCircle2 className="w-5 h-5 mr-2" /> Confirm Count</>
        ) : diff < 0 ? (
          `Confirm (Short ${fmtRs(Math.abs(diff))})`
        ) : (
          `Confirm (Over ${fmtRs(diff)})`
        )}
      </button>
    </div>
  )
}
