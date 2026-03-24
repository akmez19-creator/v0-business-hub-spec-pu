'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  Banknote, ArrowLeft, CheckCircle2, Loader2,
  Calendar, ChevronLeft, ChevronRight, Store
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

// Mauritius currency - notes and coins
const NOTES_HIGH = [2000, 1000, 500, 200] as const
const NOTES_LOW = [100, 50, 25] as const
const COINS = [20, 10, 5, 1] as const
const ALL_DENOMS = [...NOTES_HIGH, ...NOTES_LOW, ...COINS] as const

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

interface Delivery {
  id: string
  index_no?: string
  customer_name: string
  payment_cash: number
  delivery_date: string
  rider_id?: string
  rider_name?: string
  contractor_id: string | null
  cash_collected: boolean
  contractor_cash_denoms?: Record<string, number> | null
  contractor_cash_counted?: number
  contractor_cash_counted_at?: string | null
}

interface Contractor {
  id: string
  name: string
  photo_url: string | null
}

interface Props {
  userId: string
  deliveries: Delivery[]
  contractors: Contractor[]
  availableDates: string[]
  selectedDate: string
}

export function CashCollectionPage({ userId, deliveries, contractors, availableDates, selectedDate }: Props) {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(selectedDate)
  const [activeContractor, setActiveContractor] = useState<string | null>(null)

  // Get contractor map
  const contractorMap = useMemo(() => {
    const map = new Map<string, Contractor>()
    for (const c of contractors) map.set(c.id, c)
    return map
  }, [contractors])

  // Group deliveries by date
  const deliveriesByDate = useMemo(() => {
    const map = new Map<string, Delivery[]>()
    for (const d of deliveries) {
      const date = d.delivery_date
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(d)
    }
    return map
  }, [deliveries])

  // Current date deliveries
  const currentDeliveries = deliveriesByDate.get(currentDate) || []
  
  // Group by contractor for current date
  const contractorGroups = useMemo(() => {
    const map = new Map<string, { contractor: Contractor | null; deliveries: Delivery[]; expectedTotal: number; contractorCounted: number; hasContractorCount: boolean }>()
    for (const d of currentDeliveries) {
      const cid = d.contractor_id || 'unknown'
      if (!map.has(cid)) {
        map.set(cid, {
          contractor: contractorMap.get(cid) || null,
          deliveries: [],
          expectedTotal: 0,
          contractorCounted: 0,
          hasContractorCount: false
        })
      }
      const group = map.get(cid)!
      group.deliveries.push(d)
      group.expectedTotal += Number(d.payment_cash || 0)
      // Check if contractor has counted (contractor_cash_counted_at is set means counted)
      // contractor_cash_counted can be 0 for batch items, so check the timestamp instead
      if (d.contractor_cash_counted_at) {
        group.hasContractorCount = true
        // Only add if > 0 (first delivery has total, others have 0)
        if (d.contractor_cash_counted && d.contractor_cash_counted > 0) {
          group.contractorCounted += Number(d.contractor_cash_counted)
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.expectedTotal - a.expectedTotal)
  }, [currentDeliveries, contractorMap])

  // Total expected (from delivery payment_cash) and contractor counted totals
  const totalExpected = currentDeliveries.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
  const totalContractorCounted = contractorGroups.reduce((sum, g) => sum + g.contractorCounted, 0)
  const hasAnyContractorCount = contractorGroups.some(g => g.hasContractorCount)

  // Date navigation
  const dateIndex = availableDates.indexOf(currentDate)
  const canPrev = dateIndex < availableDates.length - 1
  const canNext = dateIndex > 0

  const goToPrevDate = () => {
    if (canPrev) {
      const newDate = availableDates[dateIndex + 1]
      setCurrentDate(newDate)
      router.push(`/dashboard/storekeeper/cash-collection?date=${newDate}`)
    }
  }

  const goToNextDate = () => {
    if (canNext) {
      const newDate = availableDates[dateIndex - 1]
      setCurrentDate(newDate)
      router.push(`/dashboard/storekeeper/cash-collection?date=${newDate}`)
    }
  }

  // Show counting sheet for a contractor
  if (activeContractor) {
    const group = contractorGroups.find(g => g.contractor?.id === activeContractor)
    if (group) {
      return (
        <CountingSheet
          userId={userId}
          contractor={group.contractor!}
          deliveries={group.deliveries}
          totalExpected={group.expectedTotal}
          contractorCounted={group.contractorCounted}
          hasContractorCount={group.hasContractorCount}
          date={currentDate}
          onBack={() => setActiveContractor(null)}
          onSuccess={() => {
            // Navigate to stock-in (returns) page after collection
            router.push(`/dashboard/storekeeper/stock-in?contractor=${activeContractor}`)
          }}
        />
      )
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Date Navigation Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevDate}
          disabled={!canPrev}
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
            canPrev ? "bg-muted hover:bg-muted/80" : "opacity-30"
          )}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold">{fmtDate(currentDate)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{currentDate}</div>
        </div>
        
        <button
          onClick={goToNextDate}
          disabled={!canNext}
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
            canNext ? "bg-muted hover:bg-muted/80" : "opacity-30"
          )}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-amber-500/30">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Expected</p>
            <p className="text-xl font-bold text-amber-500">{fmtRs(totalExpected)}</p>
            <p className="text-[9px] text-muted-foreground">{currentDeliveries.length} deliveries</p>
          </CardContent>
        </Card>
        <Card className={cn("border", hasAnyContractorCount ? "border-blue-500/30" : "border-muted")}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Contractor Counted</p>
            <p className={cn("text-xl font-bold", hasAnyContractorCount ? "text-blue-500" : "text-muted-foreground")}>
              {hasAnyContractorCount ? fmtRs(totalContractorCounted) : 'Not yet'}
            </p>
            <p className="text-[9px] text-muted-foreground">{contractorGroups.filter(g => g.hasContractorCount).length} contractors</p>
          </CardContent>
        </Card>
      </div>

      {/* Difference Alert */}
      {hasAnyContractorCount && totalContractorCounted !== totalExpected && (
        <Card className={cn("border", totalContractorCounted < totalExpected ? "border-red-500/50 bg-red-500/5" : "border-blue-500/50 bg-blue-500/5")}>
          <CardContent className="py-2 px-4">
            <p className={cn("text-xs font-medium", totalContractorCounted < totalExpected ? "text-red-500" : "text-blue-500")}>
              {totalContractorCounted < totalExpected 
                ? `Short by ${fmtRs(totalExpected - totalContractorCounted)}` 
                : `Over by ${fmtRs(totalContractorCounted - totalExpected)}`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Contractor List */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contractors</p>
        
        {contractorGroups.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-medium">All Collected</p>
              <p className="text-xs text-muted-foreground mt-1">No pending cash for this date</p>
            </CardContent>
          </Card>
        ) : (
          contractorGroups.map((group) => (
            <button
              key={group.contractor?.id || 'unknown'}
              onClick={() => group.contractor && setActiveContractor(group.contractor.id)}
              className="w-full text-left"
            >
              <Card className={cn(
                "border transition-all hover:border-amber-500/50",
                group.hasContractorCount && "border-blue-500/30 bg-blue-500/5"
              )}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                      {group.contractor?.photo_url ? (
                        <Image
                          src={group.contractor.photo_url}
                          alt={group.contractor.name}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Store className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{group.contractor?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">{group.deliveries.length} deliveries</p>
                    </div>
                    
                    {/* Amount */}
                    <div className="text-right">
                      {group.hasContractorCount ? (
                        <>
                          <p className="text-lg font-bold text-blue-500">{fmtRs(group.contractorCounted)}</p>
                          {group.contractorCounted !== group.expectedTotal && (
                            <p className={cn("text-[10px]", group.contractorCounted < group.expectedTotal ? "text-red-500" : "text-emerald-500")}>
                              {group.contractorCounted < group.expectedTotal ? 'Short' : 'Over'}: {fmtRs(Math.abs(group.expectedTotal - group.contractorCounted))}
                            </p>
                          )}
                          <p className="text-[9px] text-muted-foreground line-through">{fmtRs(group.expectedTotal)}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-lg font-bold text-amber-500">{fmtRs(group.expectedTotal)}</p>
                          <p className="text-[10px] text-muted-foreground">Not counted yet</p>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// Counting Sheet Component
function CountingSheet({
  userId,
  contractor,
  deliveries,
  totalExpected,
  contractorCounted,
  hasContractorCount,
  date,
  onBack,
  onSuccess
}: {
  userId: string
  contractor: Contractor
  deliveries: Delivery[]
  totalExpected: number
  contractorCounted: number
  hasContractorCount: boolean
  date: string
  onBack: () => void
  onSuccess: () => void
}) {
  const supabase = createClient()
  
  // Get contractor's pre-counted denominations
  const contractorDenoms = useMemo(() => {
    const result: Record<number, number> = {}
    for (const d of ALL_DENOMS) result[d] = 0
    
    const denomDelivery = deliveries.find(d => d.contractor_cash_denoms && typeof d.contractor_cash_denoms === 'object')
    if (denomDelivery?.contractor_cash_denoms) {
      for (const d of ALL_DENOMS) {
        const key = `denomination_${d}`
        result[d] = Number(denomDelivery.contractor_cash_denoms[key] || 0)
      }
    }
    return result
  }, [deliveries])
  
  const contractorTotal = ALL_DENOMS.reduce((t, d) => t + d * contractorDenoms[d], 0)
  
  const [saving, setSaving] = useState(false)

  // For storekeeper, the "counted" is what contractor counted (read-only view)
  const counted = contractorCounted
  // Compare against expected amount
  const diff = counted - totalExpected

  const handleSave = async () => {
    // Prevent collection if amounts don't match
    if (diff !== 0) {
      alert('Cannot collect: Amount mismatch. Contractor must recount.')
      return
    }
    
    setSaving(true)
    try {
      const ids = deliveries.map(d => d.id)
      
      // Mark deliveries as collected
      const { error } = await supabase.from('deliveries').update({
        cash_collected: true,
        cash_collected_at: new Date().toISOString(),
        cash_collected_by: userId,
      }).in('id', ids)

      if (error) throw error

      // Save collection session using contractor's denominations
      const denomsFormatted: Record<string, number> = {}
      for (const [denom, count] of Object.entries(contractorDenoms)) {
        denomsFormatted[`denomination_${denom}`] = count as number
      }

      await supabase.from('cash_collection_sessions').insert({
        contractor_id: contractor.id,
        collection_date: date,
        expected_cash: totalExpected,
        collected_cash: counted,
        ...denomsFormatted,
        collected_by: userId,
        status: diff === 0 ? 'matched' : diff > 0 ? 'over' : 'short',
      })

      onSuccess()
    } catch (err) {
      console.error('Save error:', err)
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 pb-32 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-muted hover:bg-muted/80 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="font-bold text-lg">{contractor.name}</div>
          <div className="text-xs text-muted-foreground">
            {hasContractorCount ? (
              <>
                Contractor counted: <span className="text-blue-500 font-semibold">{fmtRs(contractorCounted)}</span>
                {contractorCounted !== totalExpected && (
                  <span className="text-red-500 ml-1">({contractorCounted < totalExpected ? '-' : '+'}{fmtRs(Math.abs(totalExpected - contractorCounted))})</span>
                )}
              </>
            ) : (
              <>Expected: <span className="text-amber-500 font-semibold">{fmtRs(totalExpected)}</span></>
            )}
            <span className="mx-1">•</span>
            {fmtDate(date)}
          </div>
        </div>
      </div>

      {/* Contractor Pre-Count Banner */}
      {hasContractorCount && (
        <Card className={cn(
          "border",
          contractorCounted === totalExpected ? "border-emerald-500/50 bg-emerald-500/10" : "border-amber-500/50 bg-amber-500/10"
        )}>
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={cn("w-5 h-5", contractorCounted === totalExpected ? "text-emerald-500" : "text-amber-500")} />
              <div>
                <p className="text-xs font-medium">Contractor Counted (To Collect)</p>
                <p className={cn("text-lg font-bold", contractorCounted === totalExpected ? "text-emerald-500" : "text-amber-500")}>
                  {fmtRs(contractorCounted)}
                </p>
                {contractorCounted !== totalExpected && (
                  <p className="text-[10px] text-muted-foreground">Expected was {fmtRs(totalExpected)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Card - Read Only View */}
      <Card className={cn(
        "border-2",
        diff === 0 ? "border-emerald-500" : diff > 0 ? "border-blue-500" : "border-amber-500"
      )}>
        <CardContent className="py-4 px-5">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">To Collect</p>
              <p className={cn(
                "text-3xl font-black",
                diff === 0 ? "text-emerald-500" : diff > 0 ? "text-blue-500" : "text-amber-500"
              )}>
                {fmtRs(counted)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase">vs Expected</p>
              <p className={cn(
                "text-xl font-bold",
                diff === 0 ? "text-emerald-500" : diff > 0 ? "text-blue-500" : "text-amber-500"
              )}>
                {diff === 0 ? 'MATCH' : diff > 0 ? `+${fmtRs(diff)}` : fmtRs(diff)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contractor's Denomination Breakdown - Read Only View */}
      <div className="space-y-5">
        {/* Notes Section */}
        <div className="relative">
          {/* Section Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <Banknote className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Notes</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          </div>
          
          {/* Notes Grid - High Value */}
          <div className="grid grid-cols-4 gap-2 mb-2">
            {NOTES_HIGH.map(d => {
              const count = contractorDenoms[d] || 0
              const hasCount = count > 0
              return (
                <div key={d} className={cn(
                  "relative rounded-xl p-3 text-center transition-all",
                  "bg-gradient-to-br border",
                  DENOM_COLORS[d].bg,
                  DENOM_COLORS[d].text,
                  hasCount ? "border-white/30 shadow-lg" : "border-white/10 opacity-40"
                )}>
                  <p className="text-[10px] font-medium opacity-70 mb-0.5">
                    {d >= 1000 ? `Rs ${d/1000}K` : `Rs ${d}`}
                  </p>
                  <p className="text-2xl font-black">{count}</p>
                  {hasCount && (
                    <p className="text-[9px] opacity-60 mt-0.5">= {fmtRs(d * count)}</p>
                  )}
                </div>
              )
            })}
          </div>
          
          {/* Notes Grid - Low Value */}
          <div className="grid grid-cols-3 gap-2">
            {NOTES_LOW.map(d => {
              const count = contractorDenoms[d] || 0
              const hasCount = count > 0
              return (
                <div key={d} className={cn(
                  "relative rounded-xl p-3 text-center transition-all",
                  "bg-gradient-to-br border",
                  DENOM_COLORS[d].bg,
                  DENOM_COLORS[d].text,
                  hasCount ? "border-white/30 shadow-lg" : "border-white/10 opacity-40"
                )}>
                  <p className="text-[10px] font-medium opacity-70 mb-0.5">Rs {d}</p>
                  <p className="text-2xl font-black">{count}</p>
                  {hasCount && (
                    <p className="text-[9px] opacity-60 mt-0.5">= {fmtRs(d * count)}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Coins Section */}
        <div className="relative">
          {/* Section Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 border border-amber-300" />
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Coins</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          </div>
          
          <div className="grid grid-cols-4 gap-2">
            {COINS.map(d => {
              const count = contractorDenoms[d] || 0
              const hasCount = count > 0
              return (
                <div key={d} className={cn(
                  "relative rounded-full aspect-square flex flex-col items-center justify-center transition-all",
                  "bg-gradient-to-br border",
                  DENOM_COLORS[d].bg,
                  DENOM_COLORS[d].text,
                  hasCount ? "border-white/30 shadow-lg" : "border-white/10 opacity-40"
                )}>
                  <p className="text-[9px] font-medium opacity-70">Rs {d}</p>
                  <p className="text-xl font-black">{count}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Save Button - Only enabled when amounts match */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <button
          onClick={handleSave}
          disabled={saving || counted === 0 || diff !== 0}
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all",
            diff === 0
              ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          ) : diff !== 0 ? (
            `Amount Mismatch (${diff > 0 ? '+' : ''}${fmtRs(diff)})`
          ) : (
            `Collect ${fmtRs(counted)}`
          )}
        </button>
      </div>
    </div>
  )
}
