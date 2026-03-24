'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Package,
  TrendingUp,
  Wallet,
  Bike,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ArrowDownLeft,

  BarChart3,
  Boxes,
} from 'lucide-react'
import { ProgressRing, XPBar } from '@/components/ui/gamification'

interface RiderDashboardContentProps {
  rider: any
  profile: any
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
    riderRate: number
  }
  stock: any
  recentPayouts: any[]
  level: number
  xp: number
  xpToNextLevel: number
}

export function RiderDashboardContent({
  rider,
  profile,
  stats,
  stock,
  recentPayouts,
  level,
  xp,
  xpToNextLevel,
}: RiderDashboardContentProps) {
  const todayProgress = stats.todayTotal > 0 ? Math.round((stats.todayDelivered / stats.todayTotal) * 100) : 0

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Today's Progress Card */}
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
            gradientId="todayRider"
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
              Rs {stats.riderRate}/delivery
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

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/dashboard/riders/deliveries"
          className="glass-card rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Bike className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Orders</p>
            <p className="text-[10px] text-muted-foreground">{stats.todayLeft} left today</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>

        <Link
          href="/dashboard/riders/earnings"
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

        <Link
          href="/dashboard/riders/stock"
          className="glass-card rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Boxes className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Stock</p>
            <p className="text-[10px] text-muted-foreground">
              {stock ? `${stock.closing_stock ?? stock.opening_stock ?? 0} in hand` : 'No stock'}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>

        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">Level {level}</p>
          </div>
          <XPBar current={xp} max={xpToNextLevel} level={level} showLabel={false} />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {stats.lifetimeDelivered} lifetime deliveries
          </p>
        </div>
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

      {/* Rate Not Set Warning */}
      {stats.riderRate === 0 && (
        <div className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Rate not set</p>
            <p className="text-xs text-muted-foreground">
              Your per-delivery rate has not been configured yet. Contact your admin to set it up.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
