'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Users,
  CheckCircle,
  Clock,
  Wallet,
  XCircle,
  Package,
  ChevronRight,
  BarChart3,
  ArrowDownLeft,
  Bike,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  IdCard,
  X,
} from 'lucide-react'
import { ProgressRing } from '@/components/ui/gamification'

interface ContractorDashboardContentProps {
  contractor: any
  stats: {
    todayTotal: number
    todayDelivered: number
    todayLeft: number
    todayFailed: number
    todayEarnings: number
    weekDelivered: number
    weekEarnings: number
    monthDelivered: number
    monthEarnings: number
    lifetimeDelivered: number
    lifetimeEarnings: number
    totalPaidOut: number
    balanceOwed: number
    totalRiders: number
    activeRiders: number
  }
  riderBreakdown: {
    id: string
    name: string
    total: number
    delivered: number
    left: number
    failed: number
    earnings: number
    rate: number
    isContractorSelf: boolean
  }[]
  recentPayouts: any[]
}

export function ContractorDashboardContent({
  contractor,
  stats,
  riderBreakdown,
  recentPayouts,
}: ContractorDashboardContentProps) {
  const [showAllRiders, setShowAllRiders] = useState(false)
  const [nicDismissed, setNicDismissed] = useState(false)
  const todayProgress = stats.todayTotal > 0 ? Math.round((stats.todayDelivered / stats.todayTotal) * 100) : 0

  const displayedRiders = showAllRiders ? riderBreakdown : riderBreakdown.slice(0, 4)

  const needsNicVerification = !contractor.nic_number && !nicDismissed

  return (
    <div className="px-4 py-4 space-y-4">
      {/* NIC Nudge -- links to Settings */}
      {needsNicVerification && (
        <Link
          href="/dashboard/contractors/settings"
          className="relative flex items-center gap-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <IdCard className="w-4.5 h-4.5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground">Verify your identity</p>
            <p className="text-[10px] text-muted-foreground">Tap to scan your NIC in Settings</p>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setNicDismissed(true) }}
            className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-background/50 hover:bg-background/80 transition-colors"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        </Link>
      )}

      {/* Today's Overview */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Today</h2>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
          <ProgressRing
            progress={todayProgress}
            size={64}
            strokeWidth={6}
            gradientId="todayContractor"
            gradientColors={
              todayProgress === 100 ? ['#34d399', '#10b981'] :
              todayProgress >= 50 ? ['#fbbf24', '#f59e0b'] :
              ['#f87171', '#ef4444']
            }
          >
            <span className="text-sm font-bold">{todayProgress}%</span>
          </ProgressRing>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2.5 rounded-xl bg-muted/30">
            <Package className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{stats.todayTotal}</p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-emerald-500/10">
            <CheckCircle className="w-4 h-4 mx-auto mb-1 text-emerald-500" />
            <p className="text-lg font-bold text-emerald-500">{stats.todayDelivered}</p>
            <p className="text-[10px] text-muted-foreground">Done</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-amber-500/10">
            <Clock className="w-4 h-4 mx-auto mb-1 text-amber-500" />
            <p className="text-lg font-bold text-amber-500">{stats.todayLeft}</p>
            <p className="text-[10px] text-muted-foreground">Left</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-red-500/10">
            <XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" />
            <p className="text-lg font-bold text-red-500">{stats.todayFailed}</p>
            <p className="text-[10px] text-muted-foreground">Failed</p>
          </div>
        </div>

        {/* Team info */}
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">
            {stats.activeRiders} of {stats.totalRiders} riders active
          </span>
        </div>
      </div>

      {/* Earnings Card */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <span className="text-xs font-bold text-emerald-500">Rs</span>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Earnings</h3>
            <p className="text-[10px] text-muted-foreground">
              Across all {stats.totalRiders} riders
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-3 rounded-xl bg-muted/30 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">Today</p>
            <p className="text-base font-bold text-emerald-500">Rs {stats.todayEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{stats.todayDelivered} del.</p>
          </div>
          <div className="p-3 rounded-xl bg-muted/30 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">This Week</p>
            <p className="text-base font-bold text-foreground">Rs {stats.weekEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{stats.weekDelivered} del.</p>
          </div>
          <div className="p-3 rounded-xl bg-muted/30 text-center">
            <p className="text-[10px] text-muted-foreground mb-0.5">This Month</p>
            <p className="text-base font-bold text-foreground">Rs {stats.monthEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{stats.monthDelivered} del.</p>
          </div>
        </div>

        {/* Balance Summary */}
        <div className="p-3 rounded-xl border border-border/50 bg-background/50 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Lifetime Earned</span>
            <span className="font-semibold text-emerald-500">Rs {stats.lifetimeEarnings.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Paid Out</span>
            <span className="font-semibold text-foreground">Rs {stats.totalPaidOut.toLocaleString()}</span>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Balance Owed</span>
            <span className={cn(
              "font-bold",
              stats.balanceOwed > 0 ? "text-amber-500" : "text-emerald-500"
            )}>
              Rs {stats.balanceOwed.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Rider Breakdown */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Bike className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Rider Performance Today</h3>
        </div>

        {riderBreakdown.length === 0 ? (
          <div className="text-center py-6">
            <Users className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No riders linked yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedRiders.map((r) => {
              const progress = r.total > 0 ? Math.round((r.delivered / r.total) * 100) : 0
              return (
                <div key={r.id} className="p-3 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {r.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {r.name}
                          {r.isContractorSelf && (
                            <span className="text-[10px] text-primary ml-1">(You)</span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Rs {r.rate}/del</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-emerald-500">Rs {r.earnings.toLocaleString()}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Progress bar */}
                    <div className="flex-1">
                      <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            progress === 100 ? "bg-emerald-500" :
                            progress >= 50 ? "bg-amber-500" : "bg-red-400"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0">
                      <span className="text-emerald-500 font-medium">{r.delivered}</span>
                      <span>/</span>
                      <span>{r.total}</span>
                    </div>
                  </div>
                </div>
              )
            })}

            {riderBreakdown.length > 4 && (
              <button
                onClick={() => setShowAllRiders(!showAllRiders)}
                className="w-full flex items-center justify-center gap-1 py-2 text-xs text-primary font-medium"
              >
                {showAllRiders ? (
                  <>Show Less <ChevronUp className="w-3 h-3" /></>
                ) : (
                  <>Show All {riderBreakdown.length} Riders <ChevronDown className="w-3 h-3" /></>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/dashboard/contractors/deliveries"
          className="glass-card rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Deliveries</p>
            <p className="text-[10px] text-muted-foreground">{stats.todayLeft} left today</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>

        <Link
          href="/dashboard/contractors/earnings"
          className="glass-card rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Earnings</p>
            <p className="text-[10px] text-muted-foreground">Full breakdown</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>
      </div>

      {/* Recent Payouts */}
      {recentPayouts.length > 0 && (
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Recent Payouts</h3>
          </div>
          <div className="space-y-2">
            {recentPayouts.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ArrowDownLeft className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{p.description || 'Payout'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>
                <span className="font-semibold text-sm">Rs {Number(p.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning if no rates set */}
      {riderBreakdown.some(r => r.rate === 0) && (
        <div className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Rates not set</p>
            <p className="text-xs text-muted-foreground">
              {riderBreakdown.filter(r => r.rate === 0).map(r => r.name).join(', ')} — rates not configured. Contact admin.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
