'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, ChevronDown, Banknote, Coins, RotateCcw, Package } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Denominations {
  2000: number; 1000: number; 500: number; 200: number; 100: number
  50: number; 25: number; 20: number; 10: number; 5: number; 1: number
}

interface Session {
  id: string
  contractorId: string
  contractorName: string
  collectedCash: number
  denominations: Denominations
}

interface ReturnSession {
  contractorId: string
  contractorName: string
  count: number
  items: { product: string; qty: number }[]
}

interface Totals {
  collectedCash: number
  denominations: Denominations
  contractorCount: number
  returnsCount?: number
  returnsContractorCount?: number
}

interface Props {
  selectedDate: string
  sessions: Session[]
  returns?: ReturnSession[]
  totals: Totals
  availableDates: string[]
}

const NOTES = [2000, 1000, 500, 200, 100, 50, 25] as const
const COINS = [20, 10, 5, 1] as const

function fmtRs(n: number) { return `Rs ${(n || 0).toLocaleString()}` }
function fmtDate(d: string) {
  const today = new Date().toISOString().split('T')[0]
  if (d === today) return 'Today'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function DailySummaryPage({ selectedDate, sessions, returns = [], totals, availableDates }: Props) {
  const router = useRouter()
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [expandedContractor, setExpandedContractor] = useState<string | null>(null)

  const handleDateChange = (date: string) => {
    router.push(`/dashboard/storekeeper/daily-summary?date=${date}`)
    setShowDatePicker(false)
  }

  const notesTotal = NOTES.reduce((t, d) => t + ((totals.denominations[d] || 0) * d), 0)
  const coinsTotal = COINS.reduce((t, d) => t + ((totals.denominations[d] || 0) * d), 0)
  const totalNotes = NOTES.reduce((t, d) => t + (totals.denominations[d] || 0), 0)
  const totalCoins = COINS.reduce((t, d) => t + (totals.denominations[d] || 0), 0)

  return (
    <div className="px-4 pb-24 h-[calc(100dvh-4rem)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => router.push('/dashboard/storekeeper')}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 font-bold text-lg">Collection Log</div>
      </div>

      {/* Date Picker */}
      <button 
        onClick={() => setShowDatePicker(!showDatePicker)}
        className="w-full mb-4 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-emerald-400" />
          <span className="font-semibold">{fmtDate(selectedDate)}</span>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", showDatePicker && "rotate-180")} />
      </button>

      {showDatePicker && (
        <div className="mb-4 p-3 rounded-2xl bg-white/5 border border-white/10 max-h-48 overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            {availableDates.map(date => (
              <button
                key={date}
                onClick={() => handleDateChange(date)}
                className={cn(
                  "px-3 py-2 rounded-xl text-sm font-medium transition-colors",
                  date === selectedDate ? "bg-emerald-500 text-white" : "bg-white/5 hover:bg-white/10"
                )}
              >
                {fmtDate(date)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* Total Cash Collected */}
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 border border-emerald-500/30 p-4 text-center">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Cash Collected</div>
          <div className="text-2xl font-black text-emerald-400 tracking-tight mb-1">
            {fmtRs(totals.collectedCash)}
          </div>
          <div className="text-xs text-muted-foreground">
            {totals.contractorCount} contractor{totals.contractorCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Total Returns */}
        <div className="rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/30 p-4 text-center">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Returns Verified</div>
          <div className="text-2xl font-black text-orange-400 tracking-tight mb-1">
            {totals.returnsCount || 0} items
          </div>
          <div className="text-xs text-muted-foreground">
            {totals.returnsContractorCount || 0} contractor{(totals.returnsContractorCount || 0) !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Notes & Coins Summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-emerald-400" />
            <span className="text-xs uppercase text-emerald-400 font-semibold">Notes</span>
          </div>
          <div className="text-2xl font-bold">{fmtRs(notesTotal)}</div>
          <div className="text-xs text-muted-foreground">{totalNotes} pcs</div>
        </div>
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="text-xs uppercase text-amber-400 font-semibold">Coins</span>
          </div>
          <div className="text-2xl font-bold">{fmtRs(coinsTotal)}</div>
          <div className="text-xs text-muted-foreground">{totalCoins} pcs</div>
        </div>
      </div>

      {/* Notes Table */}
      <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden mb-4">
        <div className="px-4 py-3 bg-emerald-500/10 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-emerald-400">Notes</span>
          </div>
          <span className="font-bold text-emerald-400">{fmtRs(notesTotal)}</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase text-muted-foreground border-b border-white/5">
              <th className="text-left px-4 py-2">Denomination</th>
              <th className="text-center px-4 py-2">Count</th>
              <th className="text-right px-4 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {NOTES.map(d => {
              const count = totals.denominations[d] || 0
              return (
                <tr key={d} className={cn("border-b border-white/5 last:border-0", count === 0 && "opacity-30")}>
                  <td className="px-4 py-3 font-medium">Rs {d.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-xl font-bold", count > 0 ? "text-emerald-400" : "text-muted-foreground")}>{count}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmtRs(count * d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Coins Table */}
      <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-amber-500/10 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-amber-400">Coins</span>
          </div>
          <span className="font-bold text-amber-400">{fmtRs(coinsTotal)}</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase text-muted-foreground border-b border-white/5">
              <th className="text-left px-4 py-2">Denomination</th>
              <th className="text-center px-4 py-2">Count</th>
              <th className="text-right px-4 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {COINS.map(d => {
              const count = totals.denominations[d] || 0
              return (
                <tr key={d} className={cn("border-b border-white/5 last:border-0", count === 0 && "opacity-30")}>
                  <td className="px-4 py-3 font-medium">Rs {d}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("text-xl font-bold", count > 0 ? "text-amber-400" : "text-muted-foreground")}>{count}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmtRs(count * d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Returns by Contractor */}
      {returns.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden mb-6">
          <div className="px-4 py-3 bg-orange-500/10 border-b border-white/10 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-orange-400">Returns by Contractor</span>
          </div>
          <div className="divide-y divide-white/5">
            {returns.map(r => (
              <div key={r.contractorId} className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-sm font-bold text-orange-400">
                      {r.contractorName.charAt(0)}
                    </div>
                    <span className="font-medium">{r.contractorName}</span>
                  </div>
                  <span className="text-sm font-bold text-orange-400">{r.count} items</span>
                </div>
                <div className="pl-11 space-y-1">
                  {r.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Package className="w-3 h-3" />
                      <span className="truncate">{item.product}</span>
                      <span className="text-orange-400">x{item.qty}</span>
                    </div>
                  ))}
                  {r.items.length > 3 && (
                    <p className="text-[10px] text-muted-foreground">+{r.items.length - 3} more items</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cash by Contractor */}
      {sessions.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-500/10 border-b border-white/10 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-emerald-400">Cash by Contractor</span>
          </div>
          <div className="divide-y divide-white/5">
            {sessions.map(s => (
              <div key={s.id}>
                <button
                  onClick={() => setExpandedContractor(expandedContractor === s.id ? null : s.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center text-sm font-bold text-emerald-400">
                      {s.contractorName.charAt(0)}
                    </div>
                    <span className="font-medium">{s.contractorName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-400">{fmtRs(s.collectedCash)}</span>
                    <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", expandedContractor === s.id && "rotate-180")} />
                  </div>
                </button>
                
                {expandedContractor === s.id && (
                  <div className="px-4 pb-4 bg-white/5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                        <div className="text-[10px] uppercase text-emerald-400 font-semibold mb-2">Notes</div>
                        {NOTES.map(d => {
                          const count = s.denominations[d] || 0
                          if (count === 0) return null
                          return (
                            <div key={d} className="flex justify-between text-sm py-0.5">
                              <span className="text-muted-foreground">Rs {d.toLocaleString()}</span>
                              <span className="font-bold text-emerald-400">{count}</span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
                        <div className="text-[10px] uppercase text-amber-400 font-semibold mb-2">Coins</div>
                        {COINS.map(d => {
                          const count = s.denominations[d] || 0
                          if (count === 0) return null
                          return (
                            <div key={d} className="flex justify-between text-sm py-0.5">
                              <span className="text-muted-foreground">Rs {d}</span>
                              <span className="font-bold text-amber-400">{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
