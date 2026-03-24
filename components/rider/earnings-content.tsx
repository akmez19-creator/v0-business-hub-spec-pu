'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Wallet,
  TrendingUp,
  ArrowDownLeft,
  Coins,
  AlertTriangle,
  Send,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { ProgressRing } from '@/components/ui/gamification'
import { requestWithdrawal } from '@/lib/payment-actions'

interface EarningsContentProps {
  paymentSettings: any
  stats: {
    todayEarnings: number
    todayDelivered: number
    weeklyEarnings: number
    weekDelivered: number
    monthlyEarnings: number
    monthDelivered: number
    lastMonthEarnings: number
    lastMonthDelivered: number
    lifetimeEarnings: number
    lifetimeDelivered: number
    totalPaidOut: number
    balanceOwed: number
    riderRate: number
  }
  recentPayouts: any[]
  riderId?: string
  pendingWithdrawals?: any[]
}

export function RiderEarningsContent({
  paymentSettings,
  stats,
  recentPayouts,
  riderId,
  pendingWithdrawals = [],
}: EarningsContentProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month'>('today')

  const periodData = {
    today: { earnings: stats.todayEarnings, delivered: stats.todayDelivered, label: "Today's" },
    week: { earnings: stats.weeklyEarnings, delivered: stats.weekDelivered, label: "This Week's" },
    month: { earnings: stats.monthlyEarnings, delivered: stats.monthDelivered, label: "This Month's" },
  }
  const current = periodData[selectedPeriod]

  // Weekly goal
  const weeklyGoal = stats.riderRate * 50 // 50 deliveries a week goal
  const goalProgress = weeklyGoal > 0 ? Math.min((stats.weeklyEarnings / weeklyGoal) * 100, 100) : 0

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Balance Card */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">Your Earnings</p>
          <div className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-medium",
            stats.balanceOwed > 0
              ? "bg-emerald-500/20 text-emerald-500"
              : "bg-muted/50 text-muted-foreground"
          )}>
            {stats.balanceOwed > 0 ? `Rs ${stats.balanceOwed.toLocaleString()} available` : 'No balance'}
          </div>
        </div>
        <h2 className="text-3xl font-bold mb-4 text-foreground">
          Rs {stats.monthlyEarnings.toLocaleString()}
          <span className="text-sm font-normal text-muted-foreground ml-2">this month</span>
        </h2>

        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-xl bg-muted/30">
            <p className="text-[10px] text-muted-foreground">Past Month</p>
            <p className="text-base font-bold text-foreground">Rs {stats.lastMonthEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{stats.lastMonthDelivered} del</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/10">
            <p className="text-[10px] text-muted-foreground">This Month</p>
            <p className="text-base font-bold text-primary">Rs {stats.monthlyEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{stats.monthDelivered} del</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10">
            <p className="text-[10px] text-muted-foreground">Cash Available</p>
            <p className="text-base font-bold text-emerald-500">Rs {stats.balanceOwed.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">to withdraw</p>
          </div>
        </div>
      </div>

      {/* Withdrawal Request */}
      {riderId && (
        <RiderWithdrawalSection
          riderId={riderId}
          balance={stats.balanceOwed}
          pendingWithdrawals={pendingWithdrawals}
        />
      )}

      {/* Period Selector */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex gap-2 mb-4">
          {(['today', 'week', 'month'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={cn(
                "flex-1 py-2.5 px-3 rounded-xl text-sm font-medium transition-all",
                selectedPeriod === period
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 text-muted-foreground"
              )}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{current.label} Earnings</p>
            <p className="text-3xl font-bold text-emerald-500">
              Rs {current.earnings.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {current.delivered} unique delivered clients
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Rate</p>
            <p className="text-lg font-bold text-primary">Rs {stats.riderRate}</p>
            <p className="text-[10px] text-muted-foreground">per delivery</p>
          </div>
        </div>
      </div>

      {/* Weekly Goal */}
      {weeklyGoal > 0 && (
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">Weekly Goal</h3>
            </div>
            <span className="text-sm text-muted-foreground">
              Rs {stats.weeklyEarnings.toLocaleString()} / Rs {weeklyGoal.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <ProgressRing
              progress={goalProgress}
              size={72}
              strokeWidth={7}
              gradientId="goalProgress"
              gradientColors={goalProgress >= 100 ? ['#34d399', '#10b981'] : ['#fbbf24', '#34d399']}
            >
              <span className="text-sm font-bold">{Math.round(goalProgress)}%</span>
            </ProgressRing>

            <div className="flex-1">
              <div className="h-2.5 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                  style={{ width: `${goalProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {goalProgress >= 100
                  ? 'Goal reached!'
                  : `Rs ${(weeklyGoal - stats.weeklyEarnings).toLocaleString()} more to reach your goal`
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Rate Info */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Coins className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Your Payment Rate</h3>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20">
            <span className="text-lg font-bold text-primary">Rs {stats.riderRate}</span>
            <span className="text-xs text-muted-foreground ml-1">/ delivery</span>
          </div>
        </div>
      </div>

      {/* Payout History */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Payout History</h3>
        </div>

        {recentPayouts.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <Wallet className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="font-medium text-foreground">No payouts yet</p>
            <p className="text-sm text-muted-foreground">Payouts from admin will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentPayouts.map((p, index) => (
              <div
                key={index}
                className="glass-card rounded-xl p-4 flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <ArrowDownLeft className="w-5 h-5 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.description || 'Payout'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>

                <span className="font-bold text-foreground">
                  Rs {Number(p.amount).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rate Warning */}
      {stats.riderRate === 0 && (
        <div className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Rate not set</p>
            <p className="text-xs text-muted-foreground">
              Your per-delivery rate has not been configured. Earnings will show Rs 0 until admin sets your rate.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rider Withdrawal Section ──
function RiderWithdrawalSection({ riderId, balance, pendingWithdrawals }: {
  riderId: string
  balance: number
  pendingWithdrawals: any[]
}) {
  const [showForm, setShowForm] = useState(false)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  const pendingOnes = pendingWithdrawals.filter(w => w.status === 'pending')
  const pastOnes = pendingWithdrawals.filter(w => w.status !== 'pending').slice(0, 5)

  async function handleSubmit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    if (amt > balance) { setError('Amount exceeds balance'); return }
    setError(null)

    startTransition(async () => {
      const result = await requestWithdrawal(
        'rider',
        riderId,
        amt,
        'pending',
        {},
        notes || undefined
      )
      if (result.error) { setError(result.error) }
      else {
        setSuccess(true)
        setAmount(''); setNotes('')
        setTimeout(() => { setSuccess(false); setShowForm(false); router.refresh() }, 2000)
      }
    })
  }

  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Withdrawals</h3>
        </div>
        {balance > 0 && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="h-8 px-3 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Request Withdrawal
          </button>
        )}
      </div>

      {/* Pending requests */}
      {pendingOnes.length > 0 && (
        <div className="space-y-1.5">
          {pendingOnes.map((w: any) => (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div>
                <span className="text-sm font-medium">Rs {Number(w.amount).toLocaleString()}</span>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(w.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-500">
                Pending
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Past requests */}
      {pastOnes.length > 0 && (
        <div className="space-y-1">
          {pastOnes.map((w: any) => (
            <div key={w.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/10">
              <div>
                <span className="text-xs font-medium">Rs {Number(w.amount).toLocaleString()}</span>
                <span className="text-[10px] text-muted-foreground ml-2">
                  {new Date(w.requested_at || w.processed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium",
                w.status === 'completed' ? "bg-emerald-500/20 text-emerald-500" :
                w.status === 'approved' ? "bg-blue-500/20 text-blue-500" :
                w.status === 'rejected' ? "bg-destructive/20 text-destructive" :
                "bg-muted text-muted-foreground"
              )}>
                {w.status === 'completed' ? 'Paid' :
                 w.status === 'approved' ? 'Approved' :
                 w.status === 'rejected' ? 'Rejected' :
                 w.status}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Withdrawal Form */}
      {showForm && (
        <div className="space-y-3 p-3 rounded-xl bg-muted/20 border border-border/30">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium block mb-1">Amount (Rs)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Max Rs ${balance.toLocaleString()}`}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium block mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-primary/50 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 h-9 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted/50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className={cn(
                "flex-1 h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5",
                success
                  ? "bg-emerald-500/20 text-emerald-500"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
               success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              {success ? 'Submitted' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      {pendingOnes.length === 0 && pastOnes.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">No withdrawal requests yet</p>
      )}
    </div>
  )
}
