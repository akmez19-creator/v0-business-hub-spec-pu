'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { setContractorRate, setContractorPayType, recordContractorPayout, processWithdrawal, resetContractorWallet, resetContractorNotifications, setContractorInitialBalance } from '@/lib/payment-actions'
import {
  Coins,
  Wallet,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  Banknote,
  AlertCircle,
  CheckCircle2,
  X,
  RotateCcw,
  BellOff,
} from 'lucide-react'

interface ContractorFinanceProps {
  contractorId: string
  contractorName: string
  currentRate: number
  payType?: 'per_delivery' | 'fixed_monthly'
  monthlySalary?: number
  totalEarned: number
  totalDeliveries?: number
  totalPaidOut: number
  balance: number
  thisMonthEarnings?: number
  thisMonthDeliveries?: number
  lastMonthEarnings?: number
  lastMonthDeliveries?: number
  recentPayouts: { amount: number; created_at: string; description: string }[]
  pendingWithdrawals?: { id: string; amount: number; payment_method: string; payment_details: any; notes: string; requested_at: string }[]
}

export function ContractorFinanceControls({
  contractorId,
  contractorName,
  currentRate,
  payType: initialPayType = 'per_delivery',
  monthlySalary: initialMonthlySalary = 0,
  totalEarned,
  totalDeliveries = 0,
  totalPaidOut,
  balance,
  thisMonthEarnings = 0,
  thisMonthDeliveries = 0,
  lastMonthEarnings = 0,
  lastMonthDeliveries = 0,
  recentPayouts,
  pendingWithdrawals = [],
}: ContractorFinanceProps) {
  const [expanded, setExpanded] = useState(false)
  const [rate, setRate] = useState(String(currentRate || ''))
  const [currentPayType, setCurrentPayType] = useState<'per_delivery' | 'fixed_monthly'>(initialPayType)
  const [salaryInput, setSalaryInput] = useState(String(initialMonthlySalary || ''))
  const [payTypeSaved, setPayTypeSaved] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDesc, setPayDesc] = useState('')
  const [rateSaved, setRateSaved] = useState(false)
  const [paySaved, setPaySaved] = useState(false)
  const [resetConfirm, setResetConfirm] = useState<'wallet' | 'notifications' | null>(null)
  const [resetDone, setResetDone] = useState<string | null>(null)
  const [showInitialBalance, setShowInitialBalance] = useState(false)
  const [initialBalanceAmount, setInitialBalanceAmount] = useState('')
  const [initialBalanceNote, setInitialBalanceNote] = useState('')
  const [initialBalanceSaved, setInitialBalanceSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  async function handleSavePayType() {
    setError(null)
    startTransition(async () => {
      const result = await setContractorPayType(
        contractorId,
        currentPayType,
        currentPayType === 'fixed_monthly' ? Number(salaryInput) : undefined
      )
      if (result.error) { setError(result.error) }
      else { setPayTypeSaved(true); setTimeout(() => setPayTypeSaved(false), 2000); router.refresh() }
    })
  }

  async function handleSaveRate() {
    const rateNum = Number(rate)
    if (!rateNum || rateNum <= 0) { setError('Enter a valid rate'); return }
    setError(null)
    startTransition(async () => {
      const result = await setContractorRate(contractorId, rateNum)
      if (result.error) { setError(result.error) }
      else { setRateSaved(true); setTimeout(() => setRateSaved(false), 2000); router.refresh() }
    })
  }

  async function handlePay() {
    const amount = Number(payAmount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }
    setError(null)
    startTransition(async () => {
      const result = await recordContractorPayout(contractorId, amount, payDesc || undefined)
      if (result.error) { setError(result.error) }
      else {
        setPaySaved(true)
        setPayAmount('')
        setPayDesc('')
        setTimeout(() => setPaySaved(false), 2000)
        router.refresh()
      }
    })
  }

  async function handleSetInitialBalance() {
    const amount = Number(initialBalanceAmount)
    if (isNaN(amount)) { setError('Enter a valid amount'); return }
    setError(null)
    startTransition(async () => {
      const result = await setContractorInitialBalance(contractorId, amount, initialBalanceNote || undefined)
      if (result.error) { setError(result.error) }
      else {
        setInitialBalanceSaved(true)
        setInitialBalanceAmount('')
        setInitialBalanceNote('')
        setTimeout(() => { setInitialBalanceSaved(false); setShowInitialBalance(false) }, 2000)
        router.refresh()
      }
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              Rs {currentRate || '--'}/delivery
              {initialMonthlySalary > 0 && (
                <span className="text-blue-500 ml-1">(- Rs {initialMonthlySalary.toLocaleString()}/mo fixed)</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-xs font-bold',
              balance > 0 ? 'text-amber-500' : 'text-emerald-500'
            )}>
              {balance > 0 ? `Rs ${balance.toLocaleString()} owed` : 'Settled'}
            </span>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-muted/30">
            <p className="text-[10px] text-muted-foreground">Past Month</p>
            <p className="text-sm font-bold text-foreground">Rs {lastMonthEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{initialPayType === 'fixed_monthly' ? 'fixed salary' : `${lastMonthDeliveries} del x Rs ${currentRate}`}</p>
          </div>
          <div className="p-2 rounded-lg bg-primary/10">
            <p className="text-[10px] text-muted-foreground">This Month</p>
            <p className="text-sm font-bold text-primary">Rs {thisMonthEarnings.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">{initialPayType === 'fixed_monthly' ? 'fixed salary' : `${thisMonthDeliveries} del x Rs ${currentRate}`}</p>
          </div>
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <p className="text-[10px] text-muted-foreground">Paid Out</p>
            <p className="text-sm font-bold text-emerald-500">Rs {totalPaidOut.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">of Rs {totalEarned.toLocaleString()} total</p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Pay Type Toggle */}
          <div className="p-3 rounded-xl bg-muted/20 border border-border/30 space-y-2.5">
            <p className="text-[10px] text-muted-foreground font-medium">Pay Structure</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPayType('per_delivery')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-semibold border transition-all',
                  currentPayType === 'per_delivery'
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-background text-muted-foreground border-border hover:border-border/80'
                )}
              >
                Per Delivery
              </button>
              <button
                onClick={() => setCurrentPayType('fixed_monthly')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-semibold border transition-all',
                  currentPayType === 'fixed_monthly'
                    ? 'bg-blue-500/15 text-blue-500 border-blue-500/40'
                    : 'bg-background text-muted-foreground border-border hover:border-border/80'
                )}
              >
                Fixed Monthly
              </button>
            </div>

            {currentPayType === 'fixed_monthly' && (
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Monthly Salary (Rs)</label>
                <input
                  type="number"
                  value={salaryInput}
                  onChange={(e) => setSalaryInput(e.target.value)}
                  placeholder="e.g. 15000"
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-blue-500/50 focus:outline-none"
                />
              </div>
            )}

            {(currentPayType !== initialPayType || (currentPayType === 'fixed_monthly' && Number(salaryInput) !== initialMonthlySalary)) && (
              <button
                onClick={handleSavePayType}
                disabled={isPending}
                className={cn(
                  'w-full h-9 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5',
                  payTypeSaved
                    ? 'bg-emerald-500/20 text-emerald-500'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                 payTypeSaved ? <Check className="w-3.5 h-3.5" /> : null}
                {payTypeSaved ? 'Saved' : 'Save Pay Structure'}
              </button>
            )}
          </div>

          {/* Rate Setting (only for per-delivery) */}
          {currentPayType === 'per_delivery' && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Rate per Delivery (Rs)</label>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 90"
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-primary/50 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSaveRate}
              disabled={isPending}
              className={cn(
                'h-9 px-4 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
                rateSaved
                  ? 'bg-emerald-500/20 text-emerald-500'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
               rateSaved ? <Check className="w-3.5 h-3.5" /> : null}
              {rateSaved ? 'Saved' : 'Set Rate'}
            </button>
          </div>
          )}

          {/* Record Payout */}
          <div className="p-3 rounded-xl bg-muted/20 border border-border/30 space-y-2">
            <p className="text-[10px] text-muted-foreground font-medium">Record Payment to {contractorName}</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="Amount (Rs)"
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={payDesc}
                  onChange={(e) => setPayDesc(e.target.value)}
                  placeholder="Note (optional)"
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-primary/50 focus:outline-none"
                />
              </div>
              <button
                onClick={handlePay}
                disabled={isPending || !payAmount}
                className={cn(
                  'h-9 px-4 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap',
                  paySaved
                    ? 'bg-emerald-500/20 text-emerald-500'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40'
                )}
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                 paySaved ? <Check className="w-3.5 h-3.5" /> : <Banknote className="w-3.5 h-3.5" />}
                {paySaved ? 'Paid' : 'Pay'}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Add Balance Adjustment */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
            <button
              onClick={() => setShowInitialBalance(!showInitialBalance)}
              className="w-full flex items-center justify-between"
            >
              <p className="text-[10px] text-amber-600 font-medium flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" />
                Add Balance / Opening Balance
              </p>
              {showInitialBalance ? <ChevronUp className="w-3.5 h-3.5 text-amber-500" /> : <ChevronDown className="w-3.5 h-3.5 text-amber-500" />}
            </button>
            
            {showInitialBalance && (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] text-muted-foreground">
                  Add to the contractor's balance. Use positive for credit, negative for deduction.
                  Current balance: <span className="font-semibold text-foreground">Rs {balance.toLocaleString()}</span>
                </p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground block mb-1">Amount to Add (Rs)</label>
                    <input
                      type="number"
                      value={initialBalanceAmount}
                      onChange={(e) => setInitialBalanceAmount(e.target.value)}
                      placeholder="e.g. 5000 or -2000"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-amber-500/50 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground block mb-1">Note (optional)</label>
                    <input
                      type="text"
                      value={initialBalanceNote}
                      onChange={(e) => setInitialBalanceNote(e.target.value)}
                      placeholder="e.g. Opening balance"
                      className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:border-amber-500/50 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSetInitialBalance}
                  disabled={isPending || initialBalanceAmount === ''}
                  className={cn(
                    'w-full h-9 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5',
                    initialBalanceSaved
                      ? 'bg-emerald-500/20 text-emerald-500'
                      : 'bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40'
                  )}
                >
                  {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                   initialBalanceSaved ? <Check className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                  {initialBalanceSaved ? 'Added' : 'Add to Balance'}
                </button>
              </div>
            )}
          </div>

          {/* Pending Withdrawals */}
          {pendingWithdrawals.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Pending Withdrawal Requests
              </p>
              {pendingWithdrawals.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div>
                    <span className="font-medium text-foreground">Rs {Number(w.amount).toLocaleString()}</span>
                    <span className="text-muted-foreground ml-2">via {w.payment_method}</span>
                    {w.notes && <span className="text-muted-foreground ml-1">- {w.notes}</span>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(w.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        startTransition(async () => {
                          await processWithdrawal(w.id, 'approved')
                          router.refresh()
                        })
                      }}
                      disabled={isPending}
                      className="h-7 px-2.5 rounded-md text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        startTransition(async () => {
                          await processWithdrawal(w.id, 'rejected')
                          router.refresh()
                        })
                      }}
                      disabled={isPending}
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

          {/* Recent payouts */}
          {recentPayouts.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Recent Payouts</p>
              {recentPayouts.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-muted/10">
                  <span className="text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {p.description ? ` - ${p.description}` : ''}
                  </span>
                  <span className="font-medium text-foreground">Rs {Number(p.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Admin Reset Tools */}
          <div className="pt-3 border-t border-border/30 space-y-2">
            {!resetConfirm && !resetDone && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setResetConfirm('wallet')}
                  className="flex items-center gap-1.5 text-[10px] text-destructive/60 hover:text-destructive transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Wallet
                </button>
                <span className="text-[8px] text-border">|</span>
                <button
                  onClick={() => setResetConfirm('notifications')}
                  className="flex items-center gap-1.5 text-[10px] text-destructive/60 hover:text-destructive transition-colors"
                >
                  <BellOff className="w-3 h-3" />
                  Clear Notifications
                </button>
              </div>
            )}
            {resetDone && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-500">
                <Check className="w-3 h-3" />
                {resetDone}
              </div>
            )}
            {resetConfirm && !resetDone && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 space-y-2">
                <p className="text-[11px] text-destructive font-medium">
                  {resetConfirm === 'wallet' ? `Reset wallet for ${contractorName}?` : `Clear all notifications for ${contractorName}?`}
                </p>
                <p className="text-[10px] text-destructive/60">
                  {resetConfirm === 'wallet'
                    ? 'This will zero out the wallet balance, earnings, payouts, and all payment transactions. Rider wallets under this contractor will also be reset.'
                    : 'This will delete all notifications for the contractor and their riders.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      startTransition(async () => {
                        if (resetConfirm === 'wallet') {
                          const result = await resetContractorWallet(contractorId)
                          if (result.error) { setError(result.error) }
                          else { setResetDone('Wallet reset complete'); setTimeout(() => { setResetConfirm(null); setResetDone(null) }, 2000); router.refresh() }
                        } else {
                          const result = await resetContractorNotifications(contractorId)
                          if (result.error) { setError(result.error) }
                          else { setResetDone('Notifications cleared'); setTimeout(() => { setResetConfirm(null); setResetDone(null) }, 2000); router.refresh() }
                        }
                      })
                    }}
                    disabled={isPending}
                    className="h-7 px-3 rounded-lg text-[10px] font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 flex items-center gap-1"
                  >
                    {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : resetConfirm === 'wallet' ? <RotateCcw className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
                    Confirm
                  </button>
                  <button
                    onClick={() => setResetConfirm(null)}
                    className="h-7 px-3 rounded-lg text-[10px] font-semibold bg-muted text-muted-foreground hover:bg-muted/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
