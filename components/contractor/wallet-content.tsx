'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  Wallet,
  Banknote,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  X,
  Loader2,
  Bike,
  User,
  Send,
  Clock,
  CreditCard,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Minus,
} from 'lucide-react'
import { processWithdrawal, confirmWithdrawalPaid, requestWithdrawal } from '@/lib/payment-actions'

interface RiderWallet {
  id: string
  name: string
  isSelf: boolean
  rate: number
  thisMonthEarnings: number
  thisMonthDeliveries: number
  lastMonthEarnings: number
  lastMonthDeliveries: number
  walletBalance: number
  totalEarned: number
  totalPaidOut: number
  recentPayouts: any[]
  pendingWithdrawals: any[]
}

interface WalletContentProps {
  contractor: any
  contractorWallet: any
  riderWallets: RiderWallet[]
  contractorPendingWithdrawals: any[]
  contractorApprovedWithdrawals: any[]
  totalOwedToRiders: number
  monthlySalary: number
  realBalance: number
  transactionHistory: any[]
  thisMonthEarnings: number
  walletAdjustments: number
}

export function ContractorWalletContent({
  contractor,
  contractorWallet,
  riderWallets,
  contractorPendingWithdrawals,
  contractorApprovedWithdrawals,
  totalOwedToRiders,
  monthlySalary,
  realBalance,
  transactionHistory,
  thisMonthEarnings,
  walletAdjustments,
}: WalletContentProps) {
  const totalThisMonth = riderWallets.reduce((s, r) => s + r.thisMonthEarnings, 0)
  const totalLastMonth = riderWallets.reduce((s, r) => s + r.lastMonthEarnings, 0)
  // Use actual earnings-based balance, not the wallet record
  const myBalance = realBalance

  // Salary reserved = the contractor's fixed monthly salary (set by admin)
  // Available to withdraw = total balance minus the reserved salary amount
  const salaryReserved = monthlySalary
  const maxWithdrawable = Math.max(0, myBalance - salaryReserved)

  const [showWithdrawForm, setShowWithdrawForm] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawNotes, setWithdrawNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleRequestWithdrawal = () => {
    const amount = Number(withdrawAmount)
    if (!amount || amount <= 0 || amount > maxWithdrawable) return
    startTransition(async () => {
      const result = await requestWithdrawal(
        'contractor',
        contractor.id,
        amount,
        'pending',
        {},
        withdrawNotes || undefined
      )
      if (result.success) {
        setShowWithdrawForm(false)
        setWithdrawAmount('')
        setWithdrawNotes('')
        router.refresh()
      }
    })
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Wallet</h1>
        <p className="text-sm text-muted-foreground">Manage rider payments & balances</p>
      </div>

      {/* Contractor Balance Card */}
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <p className="text-sm text-muted-foreground">Your Balance</p>
          </div>
          <div className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-medium",
            myBalance > 0 ? "bg-emerald-500/20 text-emerald-500" : "bg-muted/50 text-muted-foreground"
          )}>
            {myBalance > 0 ? 'Funds Available' : 'No balance'}
          </div>
        </div>
        <h2 className="text-3xl font-bold text-foreground mb-1">
          Rs {myBalance.toLocaleString()}
        </h2>
        <p className="text-[10px] text-muted-foreground mb-3">Total balance</p>

        {/* Breakdown: what can be withdrawn vs what's reserved */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-[10px] text-emerald-500 font-medium">Available to Withdraw</p>
            <p className="text-lg font-bold text-emerald-600">Rs {maxWithdrawable.toLocaleString()}</p>
            <p className="text-[9px] text-emerald-500/70">
              {myBalance < monthlySalary ? 'For rider payments only' : 'After salary reserved'}
            </p>
          </div>
          {monthlySalary > 0 && (
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <p className="text-[10px] text-blue-500 font-medium">Salary Reserved</p>
              <p className="text-lg font-bold text-blue-600">Rs {salaryReserved.toLocaleString()}</p>
              <p className="text-[9px] text-blue-500/70">Deducted monthly</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="p-2.5 rounded-xl bg-muted/30">
            <p className="text-[10px] text-muted-foreground">Past Month</p>
            <p className="text-sm font-bold text-foreground">Rs {totalLastMonth.toLocaleString()}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-primary/10">
            <p className="text-[10px] text-muted-foreground">This Month</p>
            <p className="text-sm font-bold text-primary">Rs {totalThisMonth.toLocaleString()}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10">
            <p className="text-[10px] text-muted-foreground">Owed to Riders</p>
            <p className="text-sm font-bold text-amber-500">Rs {totalOwedToRiders.toLocaleString()}</p>
          </div>
        </div>

        {/* Pending contractor withdrawals */}
        {contractorPendingWithdrawals.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {contractorPendingWithdrawals.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <div>
                    <p className="text-xs font-medium text-foreground">Rs {Number(w.amount).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground">Pending approval</p>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-amber-500 px-2 py-0.5 rounded-full bg-amber-500/10">Pending</span>
              </div>
            ))}
          </div>
        )}

        {/* Approved (awaiting payment) */}
        {contractorApprovedWithdrawals.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {contractorApprovedWithdrawals.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <div>
                    <p className="text-xs font-medium text-foreground">Rs {Number(w.amount).toLocaleString()}</p>
                    <p className="text-[9px] text-muted-foreground">Approved - awaiting payment</p>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-emerald-500 px-2 py-0.5 rounded-full bg-emerald-500/10">Approved</span>
              </div>
            ))}
          </div>
        )}

        {/* Request Withdrawal Button / Form */}
        {!showWithdrawForm ? (
          <div className="space-y-1.5">
            <button
              onClick={() => setShowWithdrawForm(true)}
              disabled={maxWithdrawable <= 0}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                maxWithdrawable > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
              {myBalance < monthlySalary ? 'Request Withdrawal (Rider Payments)' : 'Request Withdrawal'}
            </button>
            {maxWithdrawable <= 0 && totalOwedToRiders <= 0 && (
              <p className="text-[10px] text-center text-muted-foreground">No rider payments due at this time</p>
            )}
            {maxWithdrawable <= 0 && totalOwedToRiders > 0 && (
              <p className="text-[10px] text-center text-amber-500">Insufficient balance to cover rider payments</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 p-3 rounded-xl bg-muted/20 border border-border/40">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">Request Withdrawal</p>
              <button onClick={() => setShowWithdrawForm(false)} className="p-1 rounded-md hover:bg-muted/40">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                {myBalance < monthlySalary 
                  ? `Amount for rider payments (max Rs ${maxWithdrawable.toLocaleString()})`
                  : `Withdrawal amount (max Rs ${maxWithdrawable.toLocaleString()})`
                }
              </label>
              <input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                max={maxWithdrawable}
                min={1}
                placeholder="Enter amount"
                className="w-full h-9 rounded-lg bg-background border border-border px-3 text-sm"
              />
              {monthlySalary > 0 && (
                <p className="text-[9px] text-blue-500 mt-1">
                  Rs {salaryReserved.toLocaleString()} is reserved for your monthly salary deduction
                </p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">Notes (optional)</label>
              <input
                type="text"
                value={withdrawNotes}
                onChange={(e) => setWithdrawNotes(e.target.value)}
                placeholder="Any notes..."
                className="w-full h-9 rounded-lg bg-background border border-border px-3 text-sm"
              />
            </div>

            <button
              onClick={handleRequestWithdrawal}
              disabled={isPending || !withdrawAmount || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > maxWithdrawable}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Request
            </button>
          </div>
        )}
      </div>

      {/* Transaction History - Mini Bank Statement */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Transaction History</h2>
        </div>
        
        <div className="glass-card rounded-2xl p-3 space-y-2">
          {/* This Month Delivery Earnings - Always show first */}
          {thisMonthEarnings > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-500 bg-emerald-500/10">
                  <Bike className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Delivery Earnings</p>
                  <p className="text-[10px] text-muted-foreground">
                    This month ({Math.round(thisMonthEarnings / (contractor.rate_per_delivery || 90))} deliveries × Rs {contractor.rate_per_delivery || 90})
                  </p>
                  <p className="text-[9px] text-muted-foreground/70">Ongoing</p>
                </div>
              </div>
              <div className="text-sm font-semibold text-emerald-500">
                +Rs {thisMonthEarnings.toLocaleString()}
              </div>
            </div>
          )}

          {/* Transaction Records - Fixed payout display as negative (v3) */}
          {transactionHistory.map((tx: any) => {
              const isAdjustment = tx.transaction_type === 'adjustment'
              const isPayout = tx.transaction_type === 'payout'
              const isWithdrawal = tx.transaction_type === 'withdrawal'
              
              // Determine display info based on transaction type
              let icon = <ArrowDownLeft className="w-4 h-4" />
              let colorClass = 'text-emerald-500 bg-emerald-500/10'
              let label = 'Credit'
              let isPositive = true
              
              if (isAdjustment) {
                const amt = Number(tx.amount)
                icon = amt >= 0 ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />
                colorClass = amt >= 0 ? 'text-amber-500 bg-amber-500/10' : 'text-red-500 bg-red-500/10'
                label = amt >= 0 ? 'Opening Balance' : 'Adjustment'
                isPositive = amt >= 0
              } else if (isPayout || isWithdrawal) {
                // Payout/Withdrawal = money going OUT of wallet (negative)
                icon = <ArrowUpRight className="w-4 h-4" />
                colorClass = 'text-red-500 bg-red-500/10'
                label = isPayout ? 'Withdrawal Paid' : 'Withdrawal Request'
                isPositive = false
              }
              
              const date = new Date(tx.created_at)
              const formattedDate = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              const formattedTime = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              
              return (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', colorClass)}>
                      {icon}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {tx.description || `${tx.transaction_type} transaction`}
                      </p>
                      <p className="text-[9px] text-muted-foreground/70">{formattedDate} • {formattedTime}</p>
                    </div>
                  </div>
                  <div className={cn('text-sm font-semibold', isPositive ? 'text-emerald-500' : 'text-red-500')}>
                    {isPositive ? '+' : '-'}Rs {Math.abs(Number(tx.amount)).toLocaleString()}
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* Rider Wallets */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bike className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Rider Wallets ({riderWallets.length})</h2>
        </div>

        {riderWallets.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <User className="w-10 h-10 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No riders linked yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {riderWallets.map(r => (
              <RiderWalletCard key={r.id} rider={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RiderWalletCard({ rider }: { rider: RiderWallet }) {
  const [expanded, setExpanded] = useState(false)
  const [isPendingAction, startTransition] = useTransition()
  const router = useRouter()

  const owed = Math.max(0, (rider.thisMonthEarnings + rider.lastMonthEarnings) - rider.totalPaidOut)

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
            rider.isSelf ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
          )}>
            {rider.name.charAt(0).toUpperCase()}
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">
              {rider.name}
              {rider.isSelf && <span className="text-[10px] text-primary ml-1">(You)</span>}
            </p>
            <p className="text-[10px] text-muted-foreground">Rs {rider.rate}/delivery</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className={cn(
              "text-sm font-bold",
              owed > 0 ? "text-amber-500" : "text-emerald-500"
            )}>
              {owed > 0 ? `Rs ${owed.toLocaleString()}` : 'Settled'}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {owed > 0 ? 'owed' : 'all paid'}
            </p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Monthly Breakdown */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-xl bg-muted/20">
              <p className="text-[10px] text-muted-foreground">Past Month</p>
              <p className="text-sm font-bold text-foreground">Rs {rider.lastMonthEarnings.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{rider.lastMonthDeliveries} del</p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10">
              <p className="text-[10px] text-muted-foreground">This Month</p>
              <p className="text-sm font-bold text-primary">Rs {rider.thisMonthEarnings.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{rider.thisMonthDeliveries} del</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10">
              <p className="text-[10px] text-muted-foreground">Total Paid</p>
              <p className="text-sm font-bold text-emerald-500">Rs {rider.totalPaidOut.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{rider.recentPayouts.length} payouts</p>
            </div>
          </div>

          {/* Pending Withdrawal Requests */}
          {/* Pending: Approve/Reject */}
          {rider.pendingWithdrawals.filter((w: any) => w.status === 'pending').length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Pending Withdrawal Request
              </p>
              {rider.pendingWithdrawals.filter((w: any) => w.status === 'pending').map((w: any) => (
                <div key={w.id} className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">Rs {Number(w.amount).toLocaleString()}</span>
                    {w.notes && <p className="text-[10px] text-muted-foreground mt-0.5">{w.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => startTransition(async () => { await processWithdrawal(w.id, 'approved'); router.refresh() })}
                      disabled={isPendingAction}
                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1"
                    >
                      {isPendingAction ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Approve
                    </button>
                    <button
                      onClick={() => startTransition(async () => { await processWithdrawal(w.id, 'rejected'); router.refresh() })}
                      disabled={isPendingAction}
                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold bg-destructive/20 text-destructive hover:bg-destructive/30 flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Approved: Confirm Paid */}
          {rider.pendingWithdrawals.filter((w: any) => w.status === 'approved').length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Approved - Awaiting Payment
              </p>
              {rider.pendingWithdrawals.filter((w: any) => w.status === 'approved').map((w: any) => (
                <div key={w.id} className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">Rs {Number(w.amount).toLocaleString()}</span>
                    {w.notes && <p className="text-[10px] text-muted-foreground mt-0.5">{w.notes}</p>}
                  </div>
                  <button
                    onClick={() => startTransition(async () => { await confirmWithdrawalPaid(w.id); router.refresh() })}
                    disabled={isPendingAction}
                    className="w-full h-8 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-1"
                  >
                    {isPendingAction ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
                    Confirm Paid
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Recent Payouts */}
          {rider.recentPayouts.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Recent Payouts</p>
              {rider.recentPayouts.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/10">
                  <span className="text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {p.description ? ` - ${p.description}` : ''}
                  </span>
                  <span className="font-medium text-foreground">Rs {Number(p.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
