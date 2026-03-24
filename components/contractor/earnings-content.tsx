'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Wallet,
  WalletCards,
  TrendingUp,
  ArrowDownLeft,
  Coins,
  AlertTriangle,
  Bike,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  X,
  AlertCircle,
  Send,
  Calendar,
  Users,
  Banknote,
} from 'lucide-react'
import { requestWithdrawal, processWithdrawal, confirmWithdrawalPaid } from '@/lib/payment-actions'

interface PeriodStat {
  contractorEarnings: number
  contractorDeliveries: number
  riderCosts: number
  selfRiderEarnings: number
  selfRiderDeliveries: number
  totalIncome: number
}

interface ContractorEarningsContentProps {
  contractor: any
  isAlsoRider: boolean
  selfRiderRate: number
  contractorRate: number
  monthlySalary?: number
  periodStats: Record<string, PeriodStat>
  pastWorkDayLabel: string
  totalPaidOut: number
  totalRiders: number
  riderEarnings: {
    id: string
    name: string
    deliveries: number
    rate: number
    earnings: number
    isContractorSelf: boolean
  }[]
  recentPayouts: any[]
  pendingWithdrawals?: any[]
  pendingRiderWithdrawals?: any[]
}

type Period = 'pastWorkDay' | 'today' | 'week' | 'month' | 'lastMonth'

const periodLabels: Record<Period, string> = {
  pastWorkDay: 'Past Day',
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  lastMonth: 'Past Month',
}

export function ContractorEarningsContent({
  contractor,
  isAlsoRider,
  selfRiderRate,
  contractorRate,
  monthlySalary = 0,
  periodStats,
  pastWorkDayLabel,
  totalPaidOut,
  totalRiders,
  riderEarnings,
  recentPayouts,
  pendingWithdrawals = [],
  pendingRiderWithdrawals = [],
}: ContractorEarningsContentProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('month')
  const [showAllRiders, setShowAllRiders] = useState(false)

  const empty: PeriodStat = {
    contractorEarnings: 0, contractorDeliveries: 0, riderCosts: 0,
    selfRiderEarnings: 0, selfRiderDeliveries: 0, totalIncome: 0,
  }
  const current = periodStats[selectedPeriod] || empty
  const monthData = periodStats['month'] || empty

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Period Selector Tabs */}
      <div className="flex gap-1.5 p-1 rounded-xl bg-muted/30">
        {(['pastWorkDay', 'today', 'week', 'month', 'lastMonth'] as Period[]).map((period) => (
          <button
            key={period}
            onClick={() => setSelectedPeriod(period)}
            className={cn(
              "flex-1 py-1.5 px-1.5 rounded-lg text-[10px] font-medium transition-all",
              selectedPeriod === period
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {periodLabels[period]}
          </button>
        ))}
      </div>

      {/* Period label */}
      {selectedPeriod === 'pastWorkDay' && (
        <p className="text-[10px] text-muted-foreground text-center">{pastWorkDayLabel}</p>
      )}

      {/* Total Income Card */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-foreground">Your Total Income</p>
          <Link
            href="/dashboard/contractors/wallet"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            <WalletCards className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-primary">Wallet</span>
          </Link>
        </div>

        {/* Big total */}
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-3xl font-bold text-foreground">
            Rs {current.totalIncome.toLocaleString()}
          </h2>
          <span className="text-xs text-muted-foreground">{periodLabels[selectedPeriod]}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-4">
          {current.contractorDeliveries} deliveries x Rs {contractorRate} = Rs {current.totalIncome.toLocaleString()}
        </p>

        {/* Delivery split */}
        {isAlsoRider && (
          <div className="flex gap-2 mb-3">
            <div className="flex-1 p-2 rounded-lg bg-primary/10 border border-primary/20 text-center">
              <Bike className="w-3.5 h-3.5 text-primary mx-auto mb-0.5" />
              <p className="text-xs font-bold text-foreground">{current.selfRiderDeliveries}</p>
              <p className="text-[9px] text-muted-foreground">Your del</p>
            </div>
            <div className="flex-1 p-2 rounded-lg bg-muted/30 text-center">
              <Users className="w-3.5 h-3.5 text-muted-foreground mx-auto mb-0.5" />
              <p className="text-xs font-bold text-foreground">{current.contractorDeliveries - current.selfRiderDeliveries}</p>
              <p className="text-[9px] text-muted-foreground">Riders del</p>
            </div>
            <div className="flex-1 p-2 rounded-lg bg-muted/30 text-center">
              <p className="text-[9px] text-muted-foreground mb-0.5">Rate</p>
              <p className="text-xs font-bold text-primary">Rs {contractorRate}</p>
              <p className="text-[9px] text-muted-foreground">per del</p>
            </div>
          </div>
        )}

        {/* Step 1: Rider Expenses */}
        {current.riderCosts > 0 && (
          <div className="rounded-xl border border-border/40 overflow-hidden mb-3">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/20">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Expenses</p>
              <p className="text-[10px] text-muted-foreground">Gross: Rs {current.totalIncome.toLocaleString()}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-amber-500/5">
              <div className="flex items-center gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-amber-500" />
                <p className="text-[11px] font-medium text-amber-600">Riders Paid</p>
              </div>
              <p className="text-sm font-bold text-amber-600">- Rs {current.riderCosts.toLocaleString()}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-muted/10 border-t border-border/20">
              <p className="text-[11px] font-semibold text-foreground">After Rider Costs</p>
              <p className="text-sm font-bold text-foreground">Rs {Math.max(0, current.totalIncome - current.riderCosts).toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Step 2: Salary Deduction (separate from rider expenses) */}
        {monthlySalary > 0 && (
          <div className="rounded-xl border border-blue-500/30 overflow-hidden mb-3">
            <div className="flex items-center justify-between px-3 py-2 bg-blue-500/5">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide">Salary Deduction</p>
              <p className="text-[10px] text-blue-400">Monthly fixed</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-blue-500/5">
              <div className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-[11px] font-medium text-blue-600">Fixed Salary</p>
              </div>
              <p className="text-sm font-bold text-blue-600">- Rs {monthlySalary.toLocaleString()}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-500/5 border-t border-border/20">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <p className="text-[11px] font-semibold text-emerald-600">Remaining Balance</p>
              </div>
              <p className="text-sm font-bold text-emerald-600">Rs {Math.max(0, current.totalIncome - current.riderCosts - monthlySalary).toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Final Amount Left (when only rider costs, no salary) */}
        {current.riderCosts > 0 && monthlySalary <= 0 && (
          <div className="rounded-xl border border-emerald-500/30 overflow-hidden mb-3">
            <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-500/5">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <p className="text-[11px] font-semibold text-emerald-600">Amount Left</p>
              </div>
              <p className="text-sm font-bold text-emerald-600">Rs {Math.max(0, current.totalIncome - current.riderCosts).toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Detail row */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/30">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Deliveries</p>
            <p className="text-sm font-bold text-foreground">{current.contractorDeliveries}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Admin Rate</p>
            <p className="text-sm font-bold text-primary">Rs {contractorRate}/del</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Riders</p>
            <p className="text-sm font-bold text-foreground">{totalRiders}</p>
          </div>
        </div>
      </div>

      {/* All Periods Overview */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Earnings Overview</p>
        </div>
        <div className="space-y-1.5">
          {(['pastWorkDay', 'today', 'week', 'month', 'lastMonth'] as Period[]).map((period) => {
            const p = periodStats[period]
            if (!p) return null
            const isActive = selectedPeriod === period
            return (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-xl transition-all",
                  isActive ? "bg-primary/10 border border-primary/20" : "bg-muted/20 border border-transparent hover:bg-muted/30"
                )}
              >
                <div className="text-left">
                  <p className="text-[11px] font-medium text-foreground">{periodLabels[period]}</p>
                  <p className="text-[9px] text-muted-foreground">{p.contractorDeliveries} deliveries</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-bold", isActive ? "text-primary" : "text-foreground")}>
                    Rs {p.totalIncome.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-1.5 justify-end">
                    {isAlsoRider && p.selfRiderDeliveries > 0 && (
                      <span className="text-[9px] text-primary">{p.selfRiderDeliveries} yours</span>
                    )}
                    {p.riderCosts > 0 && (
                      <span className="text-[9px] text-amber-500">pay riders -{p.riderCosts.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cash Available */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-muted-foreground">Cash Available to Withdraw</p>
            <p className="text-2xl font-bold text-emerald-500">
              Rs {Math.max(0, monthData.contractorEarnings - totalPaidOut).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Total earned Rs {monthData.contractorEarnings.toLocaleString()} - Paid out Rs {totalPaidOut.toLocaleString()}
            </p>
          </div>
          <div className={cn(
            "px-3 py-1.5 rounded-full text-[10px] font-medium",
            (monthData.contractorEarnings - monthlySalary - totalPaidOut) > 0
              ? "bg-emerald-500/20 text-emerald-500"
              : "bg-muted/50 text-muted-foreground"
          )}>
            {(monthData.contractorEarnings - monthlySalary - totalPaidOut) > 0 ? 'Withdrawable' : 'Settled'}
          </div>
        </div>
      </div>

      {/* Withdrawal Request + Pending */}
      <WithdrawalSection
        requesterType="contractor"
        requesterId={contractor.id}
        balance={Math.max(0, monthData.contractorEarnings - monthlySalary - totalPaidOut)}
        pendingWithdrawals={pendingWithdrawals}
      />

      {/* Rider Withdrawal Approvals */}
      {pendingRiderWithdrawals.length > 0 && (
        <RiderWithdrawalApprovals withdrawals={pendingRiderWithdrawals} riderNames={riderEarnings} />
      )}

      {/* Rider Payable (This Month) - Other riders only */}
      {(() => {
        const otherRiders = riderEarnings.filter(r => !r.isContractorSelf)
        return (
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-sm">Rider Payable</h3>
                <span className="text-[10px] text-muted-foreground">(This Month)</span>
              </div>
              <span className="text-xs text-amber-500 font-medium">
                Rs {current.riderCosts.toLocaleString()}
              </span>
            </div>

            {/* Summary */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1 p-2.5 rounded-xl bg-primary/10">
                <p className="text-[10px] text-muted-foreground">Team Earnings</p>
                <p className="text-sm font-bold text-primary">Rs {monthData.contractorEarnings.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">
                  {monthData.contractorDeliveries} del x Rs {contractorRate}
                </p>
              </div>
              <div className="flex-1 p-2.5 rounded-xl bg-amber-500/10">
                <p className="text-[10px] text-muted-foreground">You Pay Riders</p>
                <p className="text-sm font-bold text-amber-500">Rs {monthData.riderCosts.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{otherRiders.length} riders</p>
              </div>
            </div>

            {otherRiders.length === 0 ? (
              <div className="text-center py-6">
                <Coins className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">No riders linked yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(showAllRiders ? otherRiders : otherRiders.slice(0, 5)).map((r) => (
                  <RiderEarningRow key={r.id} rider={r} />
                ))}
                {otherRiders.length > 5 && (
                  <button
                    onClick={() => setShowAllRiders(!showAllRiders)}
                    className="w-full flex items-center justify-center gap-1 py-2 text-xs text-primary font-medium"
                  >
                    {showAllRiders ? (
                      <>Show Less <ChevronUp className="w-3 h-3" /></>
                    ) : (
                      <>Show All {otherRiders.length} Riders <ChevronDown className="w-3 h-3" /></>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })()}

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
      {riderEarnings.some(r => r.rate === 0) && (
        <div className="rounded-xl p-4 border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Rates not set</p>
            <p className="text-xs text-muted-foreground">
              {riderEarnings.filter(r => r.rate === 0).map(r => r.name).join(', ')} have no rate configured. Contact admin.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// -- Rider Earning Row --
function RiderEarningRow({ rider }: { rider: { id: string; name: string; deliveries: number; rate: number; earnings: number; isContractorSelf: boolean } }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-muted/20">
      <div className="flex items-center gap-2.5">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
          rider.isContractorSelf ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {rider.name?.charAt(0).toUpperCase() || 'R'}
        </div>
        <div>
          <p className="text-sm font-medium">{rider.name} {rider.isContractorSelf && <span className="text-[10px] text-primary">(You)</span>}</p>
          <p className="text-[10px] text-muted-foreground">{rider.deliveries} deliveries @ Rs {rider.rate}/del</p>
        </div>
      </div>
      <span className="text-sm font-bold text-emerald-500">Rs {rider.earnings.toLocaleString()}</span>
    </div>
  )
}

// -- Withdrawal Request Section --
function WithdrawalSection({ requesterType, requesterId, balance, pendingWithdrawals }: {
  requesterType: 'contractor' | 'rider'
  requesterId: string
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
    if (!amt || amt <= 0) return setError('Enter a valid amount')
    if (amt > balance) return setError('Amount exceeds balance')
    setError(null)
    startTransition(async () => {
      const res = await requestWithdrawal(
        requesterType,
        requesterId,
        amt,
        'pending',
        {},
        notes
      )
      if (res?.error) {
        setError(res.error)
      } else {
        setSuccess(true)
        setShowForm(false)
        setAmount('')
        setNotes('')
        router.refresh()
        setTimeout(() => setSuccess(false), 3000)
      }
    })
  }

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Send className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-sm">Withdrawals</h3>
        </div>
        {!showForm && balance > 0 && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold"
          >
            Request Withdrawal
          </button>
        )}
      </div>

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <p className="text-xs text-emerald-500 font-medium">Withdrawal request submitted</p>
        </div>
      )}

      {showForm && (
        <div className="space-y-3 mb-4 p-4 rounded-xl bg-muted/20">
          <div>
            <label className="text-[10px] text-muted-foreground">Amount (max Rs {balance.toLocaleString()})</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-border text-sm"
              max={balance}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-lg bg-background border border-border text-sm" />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Submit Request'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg bg-muted text-muted-foreground text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pending requests */}
      {pendingOnes.length > 0 && (
        <div className="space-y-2 mb-3">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Pending</p>
          {pendingOnes.map((w: any) => (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <div>
                <p className="text-sm font-medium">Rs {Number(w.amount).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(w.requested_at).toLocaleDateString()}</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-medium">Pending</span>
            </div>
          ))}
        </div>
      )}

      {/* Past requests */}
      {pastOnes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">History</p>
          {pastOnes.map((w: any) => (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/10">
              <div>
                <p className="text-sm font-medium">Rs {Number(w.amount).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(w.requested_at).toLocaleDateString()}</p>
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium capitalize",
                w.status === 'completed' ? "bg-emerald-500/20 text-emerald-500" :
                w.status === 'approved' ? "bg-blue-500/20 text-blue-500" :
                w.status === 'rejected' ? "bg-red-500/20 text-red-500" :
                "bg-muted text-muted-foreground"
              )}>
                {w.status === 'completed' ? 'Paid' : w.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// -- Rider Withdrawal Approvals (Two-Step: Approve/Reject then Confirm Paid) --
function RiderWithdrawalApprovals({ withdrawals, riderNames }: { withdrawals: any[]; riderNames: { id: string; name: string }[] }) {
  const [isPending, startTransition] = useTransition()
  const [processing, setProcessing] = useState<string | null>(null)
  const router = useRouter()

  const getName = (id: string) => riderNames.find(r => r.id === id)?.name || 'Rider'

  const pendingOnes = withdrawals.filter(w => w.status === 'pending')
  const approvedOnes = withdrawals.filter(w => w.status === 'approved')

  function handleApproveReject(id: string, action: 'approved' | 'rejected') {
    setProcessing(id)
    startTransition(async () => {
      await processWithdrawal(id, action)
      setProcessing(null)
      router.refresh()
    })
  }

  function handleConfirmPaid(id: string) {
    setProcessing(id)
    startTransition(async () => {
      await confirmWithdrawalPaid(id)
      setProcessing(null)
      router.refresh()
    })
  }

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-amber-500" />
        <h3 className="font-semibold text-sm">Rider Withdrawal Requests</h3>
        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 text-[10px] font-medium">{withdrawals.length}</span>
      </div>

      {/* Pending: need Approve / Reject */}
      {pendingOnes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Awaiting Approval</p>
          {pendingOnes.map((w: any) => (
            <div key={w.id} className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{getName(w.requester_id)}</p>
                  <p className="text-xs text-foreground font-bold">Rs {Number(w.amount).toLocaleString()}</p>
                  {w.notes && <p className="text-[10px] text-muted-foreground">{w.notes}</p>}
                  <p className="text-[10px] text-muted-foreground">{new Date(w.requested_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleApproveReject(w.id, 'approved')}
                  disabled={isPending && processing === w.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isPending && processing === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  onClick={() => handleApproveReject(w.id, 'rejected')}
                  disabled={isPending && processing === w.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-500/20 text-red-500 text-xs font-semibold hover:bg-red-500/30 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Approved: need Confirm Paid */}
      {approvedOnes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-emerald-500 font-medium uppercase tracking-wide">Approved - Awaiting Payment</p>
          {approvedOnes.map((w: any) => (
            <div key={w.id} className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{getName(w.requester_id)}</p>
                  <p className="text-xs text-foreground font-bold">Rs {Number(w.amount).toLocaleString()}</p>
                  {w.notes && <p className="text-[10px] text-muted-foreground">{w.notes}</p>}
                </div>
              </div>
              <button
                onClick={() => handleConfirmPaid(w.id)}
                disabled={isPending && processing === w.id}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending && processing === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />}
                Confirm Paid
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
