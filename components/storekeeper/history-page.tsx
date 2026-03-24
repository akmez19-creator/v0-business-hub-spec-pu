'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Calendar, Banknote, CheckCircle2, AlertTriangle,
  ChevronDown, Package, Users, Bike
} from 'lucide-react'

function fmtRs(n: number) { return `Rs ${n.toLocaleString()}` }
function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (dt.getTime() === today.getTime()) return 'Today'
  if (dt.getTime() === yesterday.getTime()) return 'Yesterday'
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface DailySummary {
  date: string; totalOrders: number; totalAmount: number
  totalCash: number; collectedCash: number; pendingCash: number
  totalBank: number; totalReturns: number; verifiedReturns: number
  riderCount: number
}

interface SessionRecord {
  id: string; collection_date: string; contractor_name: string
  rider_name: string | null
  expected_cash: number; collected_cash: number
  shortage: number; surplus: number
  status: string; notes: string | null
}

interface Props {
  dailySummaries: DailySummary[]
  sessions: SessionRecord[]
}

export function HistoryPage({ dailySummaries, sessions }: Props) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  // Totals across all days
  const totalCollected = dailySummaries.reduce((t, d) => t + d.collectedCash, 0)
  const totalPending = dailySummaries.reduce((t, d) => t + d.pendingCash, 0)
  const totalReturns = dailySummaries.reduce((t, d) => t + d.totalReturns, 0)
  const totalVerified = dailySummaries.reduce((t, d) => t + d.verifiedReturns, 0)

  return (
    <div className="space-y-3 px-2">
      <Link href="/dashboard/storekeeper" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground active:scale-95 transition-all">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="glass-card rounded-2xl p-4">
        <h2 className="font-bold text-lg">Collection History</h2>
        <p className="text-xs text-muted-foreground mt-1">All-time cash collections and return verifications</p>
      </div>

      {/* Overall stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
          <div className="font-bold text-lg text-emerald-400">{fmtRs(totalCollected)}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Total Collected</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Banknote className="w-5 h-5 mx-auto text-amber-400 mb-1" />
          <div className="font-bold text-lg text-amber-400">{fmtRs(totalPending)}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Still Pending</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Package className="w-5 h-5 mx-auto text-violet-400 mb-1" />
          <div className="font-bold text-lg text-violet-400">{totalVerified}/{totalReturns}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Returns Verified</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Calendar className="w-5 h-5 mx-auto text-blue-400 mb-1" />
          <div className="font-bold text-lg">{dailySummaries.length}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Days Active</div>
        </div>
      </div>

      {/* Daily list */}
      <div className="space-y-2">
        {dailySummaries.length === 0 && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <Calendar className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No history yet</p>
          </div>
        )}

        {dailySummaries.map(day => {
          const isExpanded = expandedDate === day.date
          const cashDone = day.pendingCash === 0 && day.totalCash > 0
          const returnsDone = day.totalReturns > 0 && day.verifiedReturns === day.totalReturns
          const allDone = (cashDone || day.totalCash === 0) && (returnsDone || day.totalReturns === 0)
          const daySessions = sessions.filter(s => s.collection_date === day.date)

          return (
            <div key={day.date} className={cn("glass-card rounded-2xl overflow-hidden transition-all", allDone && "border border-emerald-500/20")}>
              <button type="button" onClick={() => setExpandedDate(isExpanded ? null : day.date)}
                className="w-full p-3 flex items-center gap-3 text-left hover:bg-muted/30 active:scale-[0.98] transition-all">
                {/* Status dot */}
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  allDone ? "bg-emerald-500/20" : day.pendingCash > 0 ? "bg-amber-500/20" : "bg-muted/40"
                )}>
                  {allDone ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> :
                   day.pendingCash > 0 ? <AlertTriangle className="w-5 h-5 text-amber-400" /> :
                   <Calendar className="w-5 h-5 text-muted-foreground" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{fmtDate(day.date)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {day.totalOrders} orders &middot; {day.riderCount} riders
                  </div>
                </div>

                <div className="text-right shrink-0 mr-2">
                  {day.pendingCash > 0 ? (
                    <div className="text-xs text-amber-400 font-semibold">{fmtRs(day.pendingCash)} pending</div>
                  ) : day.collectedCash > 0 ? (
                    <div className="text-xs text-emerald-400 font-semibold">{fmtRs(day.collectedCash)}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No cash</div>
                  )}
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="border-t border-border/30 p-3 space-y-3">
                  {/* Day breakdown */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="rounded-xl bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Cash</div>
                      <div className="font-bold text-xs text-amber-400">{fmtRs(day.totalCash)}</div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Collected</div>
                      <div className="font-bold text-xs text-emerald-400">{fmtRs(day.collectedCash)}</div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Bank</div>
                      <div className="font-bold text-xs text-blue-400">{fmtRs(day.totalBank)}</div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-2 text-center">
                      <div className="text-[10px] text-muted-foreground">Returns</div>
                      <div className="font-bold text-xs text-violet-400">{day.verifiedReturns}/{day.totalReturns}</div>
                    </div>
                  </div>

                  {/* Collection sessions for this day */}
                  {daySessions.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Collection Sessions</h4>
                      {daySessions.map(s => (
                        <div key={s.id} className={cn("rounded-xl p-2.5 flex items-center justify-between text-xs",
                          s.shortage > 0 ? "bg-red-500/10 border border-red-500/20" : "bg-emerald-500/5 border border-emerald-500/20"
                        )}>
                          <div className="flex items-center gap-2 min-w-0">
                            <Bike className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{s.rider_name || s.contractor_name}</div>
                              {s.notes && <div className="text-[10px] text-muted-foreground truncate">{s.notes}</div>}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <div className="font-bold">{fmtRs(s.collected_cash)}</div>
                            {s.shortage > 0 && <div className="text-[10px] text-red-400">-{fmtRs(s.shortage)} short</div>}
                            {s.surplus > 0 && <div className="text-[10px] text-blue-400">+{fmtRs(s.surplus)} surplus</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="flex gap-2">
                    <Link href={`/dashboard/storekeeper/cash-collection?date=${day.date}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl glass-card text-xs font-semibold hover:bg-amber-500/10 text-amber-400 transition-all active:scale-95">
                      <Banknote className="w-3.5 h-3.5" /> Collect
                    </Link>
                    <Link href={`/dashboard/storekeeper/stock-in?date=${day.date}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl glass-card text-xs font-semibold hover:bg-violet-500/10 text-violet-400 transition-all active:scale-95">
                      <Package className="w-3.5 h-3.5" /> Returns
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
