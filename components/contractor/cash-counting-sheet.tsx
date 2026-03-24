'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, CheckCircle2, Loader2, Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// Mauritius currency denominations
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


interface Delivery {
  id: string
  index_no: string
  customer_name: string
  payment_cash: number
  delivery_date: string
  rider_name?: string
  contractor_cash_denoms?: Record<number, number> | null
  contractor_cash_counted?: number | null
}

interface Props {
  deliveries: Delivery[]
  totalExpected: number
  onBack: () => void
  onSuccess: () => void
}

export function ContractorCashCountingSheet({ deliveries, totalExpected, onBack, onSuccess }: Props) {
  const supabase = createClient()
  const [denoms, setDenoms] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    ALL_DENOMS.forEach(d => init[d] = 0)
    return init
  })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  const counted = useMemo(() => 
    ALL_DENOMS.reduce((sum, d) => sum + d * denoms[d], 0), 
    [denoms]
  )
  const diff = counted - totalExpected

  const add = (d: number) => setDenoms(p => ({ ...p, [d]: p[d] + 1 }))
  const sub = (d: number) => setDenoms(p => ({ ...p, [d]: Math.max(0, p[d] - 1) }))
  const reset = () => {
    const init: Record<number, number> = {}
    ALL_DENOMS.forEach(d => init[d] = 0)
    setDenoms(init)
  }

  const handleConfirm = async () => {
    if (counted === 0) return
    setSaving(true)
    setStatus('Saving cash count...')

    try {
      // Update all pending deliveries with the contractor's cash breakdown
      const deliveryIds = deliveries.map(d => d.id)
      
      const { error } = await supabase.from('deliveries').update({
        contractor_cash_denoms: denoms,
        contractor_cash_counted: counted,
        contractor_cash_counted_at: new Date().toISOString(),
      }).in('id', deliveryIds)

      if (error) {
        setStatus(`Error: ${error.message}`)
        setSaving(false)
        return
      }

      setStatus('Cash count saved!')
      setTimeout(() => {
        onSuccess()
      }, 1000)
    } catch (e) {
      setStatus(`Error: ${e}`)
      setSaving(false)
    }
  }

  return (
    <div className="px-4 pb-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 py-4 mb-4">
        <button 
          type="button" 
          onClick={onBack} 
          className="w-11 h-11 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="font-bold text-xl tracking-tight">Count Cash</div>
          <div className="text-sm text-muted-foreground">
            Expected: <span className="text-amber-400 font-semibold">{fmtRs(totalExpected)}</span>
            <span className="text-muted-foreground/60 ml-2">({deliveries.length} orders)</span>
          </div>
        </div>
      </div>

      {/* Counted Display */}
      <div className={cn(
        "rounded-3xl p-6 mb-6 text-center backdrop-blur-xl border transition-all duration-300",
        diff === 0 && counted > 0 
          ? "border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_40px_rgba(16,185,129,0.2)]" 
          : diff < 0 
            ? "border-red-500/50 bg-red-500/10 shadow-[0_0_40px_rgba(239,68,68,0.2)]" 
            : diff > 0
              ? "border-amber-500/50 bg-amber-500/10 shadow-[0_0_40px_rgba(245,158,11,0.2)]"
              : "border-white/10 bg-white/5"
      )}>
        <div className="text-5xl font-black tracking-tight">{fmtRs(counted)}</div>
        {counted > 0 && (
          <div className={cn("text-sm font-semibold mt-2 tracking-wide",
            diff === 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-amber-400"
          )}>
            {diff === 0 ? 'Exact Match' : diff < 0 ? `Short ${fmtRs(Math.abs(diff))}` : `Over ${fmtRs(diff)}`}
          </div>
        )}
      </div>

      {/* Futuristic Denomination Grid */}
      <div className="space-y-6">
        {/* Notes Section */}
        <div className="relative">
          {/* Section Header with glow */}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <Banknote className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Notes</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          </div>
          
          {/* High Value Notes */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            {NOTES_HIGH.map(d => {
              const hasCount = denoms[d] > 0
              return (
                <div key={d} className="relative group">
                  {/* Glow effect when has count */}
                  {hasCount && (
                    <div className={cn(
                      "absolute -inset-1 rounded-3xl opacity-50 blur-md transition-opacity",
                      `bg-gradient-to-br ${DENOM_COLORS[d].bg}`
                    )} />
                  )}
                  {/* Count badge - top right, always visible */}
                  <div className={cn(
                    "absolute -top-2 -right-2 z-20 min-w-8 h-8 px-2 rounded-full",
                    "flex items-center justify-center font-black text-lg",
                    "shadow-lg border-2 transition-all",
                    hasCount 
                      ? "bg-white text-gray-900 border-white scale-110" 
                      : "bg-black/60 text-white/50 border-white/20"
                  )}>
                    {denoms[d]}
                  </div>
                  <button
                    type="button"
                    onClick={() => add(d)}
                    className={cn(
                      "relative w-full aspect-square rounded-2xl flex items-center justify-center",
                      "bg-gradient-to-br backdrop-blur-sm shadow-xl",
                      "active:scale-95 transition-all duration-200 ease-out",
                      "border-2",
                      DENOM_COLORS[d].bg,
                      DENOM_COLORS[d].text,
                      hasCount ? "border-white/40 shadow-2xl" : "border-white/10"
                    )}
                  >
                    <span className="text-sm font-bold">
                      {d >= 1000 ? `Rs ${d/1000}K` : `Rs ${d}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sub(d)}
                    disabled={denoms[d] === 0}
                    className={cn(
                      "absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full",
                      "bg-black/80 border border-white/10 backdrop-blur-sm",
                      "flex items-center justify-center text-white/70 font-bold text-lg",
                      "hover:bg-red-500/80 hover:text-white hover:border-red-500/50",
                      "disabled:opacity-0 disabled:pointer-events-none",
                      "transition-all duration-200 shadow-lg"
                    )}
                  >
                    -
                  </button>
                </div>
              )
            })}
          </div>
          
          {/* Low Value Notes */}
          <div className="grid grid-cols-4 gap-3">
            {NOTES_LOW.map(d => {
              const hasCount = denoms[d] > 0
              return (
                <div key={d} className="relative group">
                  {hasCount && (
                    <div className={cn(
                      "absolute -inset-1 rounded-3xl opacity-50 blur-md transition-opacity",
                      `bg-gradient-to-br ${DENOM_COLORS[d].bg}`
                    )} />
                  )}
                  {/* Count badge - top right */}
                  <div className={cn(
                    "absolute -top-2 -right-2 z-20 min-w-8 h-8 px-2 rounded-full",
                    "flex items-center justify-center font-black text-lg",
                    "shadow-lg border-2 transition-all",
                    hasCount 
                      ? "bg-white text-gray-900 border-white scale-110" 
                      : "bg-black/60 text-white/50 border-white/20"
                  )}>
                    {denoms[d]}
                  </div>
                  <button
                    type="button"
                    onClick={() => add(d)}
                    className={cn(
                      "relative w-full aspect-square rounded-2xl flex items-center justify-center",
                      "bg-gradient-to-br backdrop-blur-sm shadow-xl",
                      "active:scale-95 transition-all duration-200 ease-out",
                      "border-2",
                      DENOM_COLORS[d].bg,
                      DENOM_COLORS[d].text,
                      hasCount ? "border-white/40 shadow-2xl" : "border-white/10"
                    )}
                  >
                    <span className="text-sm font-bold">Rs {d}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sub(d)}
                    disabled={denoms[d] === 0}
                    className={cn(
                      "absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full",
                      "bg-black/80 border border-white/10 backdrop-blur-sm",
                      "flex items-center justify-center text-white/70 font-bold text-lg",
                      "hover:bg-red-500/80 hover:text-white hover:border-red-500/50",
                      "disabled:opacity-0 disabled:pointer-events-none",
                      "transition-all duration-200 shadow-lg"
                    )}
                  >
                    -
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Coins Section */}
        <div className="relative pt-4">
          {/* Section Header with glow */}
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30">
              <div className="w-4 h-4 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 border border-amber-300" />
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Coins</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          </div>
          
          <div className="grid grid-cols-4 gap-3">
            {COINS.map(d => {
              const hasCount = denoms[d] > 0
              return (
                <div key={d} className="relative group">
                  {hasCount && (
                    <div className={cn(
                      "absolute -inset-1 rounded-full opacity-40 blur-md transition-opacity",
                      `bg-gradient-to-br ${DENOM_COLORS[d].bg}`
                    )} />
                  )}
                  {/* Count badge - top right */}
                  <div className={cn(
                    "absolute -top-2 -right-2 z-20 min-w-8 h-8 px-2 rounded-full",
                    "flex items-center justify-center font-black text-lg",
                    "shadow-lg border-2 transition-all",
                    hasCount 
                      ? "bg-white text-gray-900 border-white scale-110" 
                      : "bg-black/60 text-white/50 border-white/20"
                  )}>
                    {denoms[d]}
                  </div>
                  <button
                    type="button"
                    onClick={() => add(d)}
                    className={cn(
                      "relative w-full aspect-square rounded-full flex items-center justify-center",
                      "bg-gradient-to-br backdrop-blur-sm shadow-xl",
                      "active:scale-95 transition-all duration-200 ease-out",
                      "border-2",
                      DENOM_COLORS[d].bg,
                      DENOM_COLORS[d].text,
                      hasCount ? "border-white/40 shadow-2xl" : "border-white/10"
                    )}
                  >
                    <span className="text-sm font-bold">Rs {d}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sub(d)}
                    disabled={denoms[d] === 0}
                    className={cn(
                      "absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full",
                      "bg-black/80 border border-white/10 backdrop-blur-sm",
                      "flex items-center justify-center text-white/70 font-bold text-lg",
                      "hover:bg-red-500/80 hover:text-white hover:border-red-500/50",
                      "disabled:opacity-0 disabled:pointer-events-none",
                      "transition-all duration-200 shadow-lg"
                    )}
                  >
                    -
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1 min-h-4" />

      {/* Reset Button */}
      {counted > 0 && (
        <button
          type="button"
          onClick={reset}
          className="w-full h-10 rounded-xl bg-white/5 hover:bg-white/10 text-muted-foreground text-sm font-medium mb-3 transition-colors"
        >
          Reset Count
        </button>
      )}

      {/* Status Message */}
      {status && (
        <div className={cn("p-4 rounded-2xl text-sm mb-3 backdrop-blur-sm border",
          status.startsWith('Error') 
            ? "bg-red-500/10 text-red-300 border-red-500/30" 
            : "bg-blue-500/10 text-blue-300 border-blue-500/30"
        )}>
          {status}
        </div>
      )}

      {/* Warning if not matching */}
      {counted > 0 && diff !== 0 && (
        <Card className="border-red-500/30 bg-red-500/10 mb-3">
          <CardContent className="py-3 px-4">
            <p className="text-sm font-medium text-red-400">
              {diff < 0 ? `You need ${fmtRs(Math.abs(diff))} more to match expected amount` : `You have ${fmtRs(diff)} extra`}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Cash must match exactly before you can submit to store
            </p>
          </CardContent>
        </Card>
      )}

      {/* Confirm Button - Only enabled when exact match */}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={saving || counted === 0 || diff !== 0}
        className={cn(
          "w-full h-16 rounded-2xl text-lg font-bold flex items-center justify-center text-white",
          "shadow-xl transition-all duration-300 active:scale-[0.98]",
          diff === 0 && counted > 0 
            ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-500/30" 
            : "bg-gradient-to-r from-gray-600 to-gray-700",
          (saving || counted === 0 || diff !== 0) && "opacity-40 shadow-none"
        )}
      >
        {saving ? (
          <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Saving...</>
        ) : counted === 0 ? (
          'Count Cash First'
        ) : diff === 0 ? (
          <><CheckCircle2 className="w-5 h-5 mr-2" /> Ready for Store Collection</>
        ) : (
          `Must Match Expected (${diff > 0 ? '+' : ''}${fmtRs(diff)})`
        )}
      </button>
    </div>
  )
}
