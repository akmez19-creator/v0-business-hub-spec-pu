'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { recordAdminRiderPayout, recordAdminRiderAdvance, recordAdminRiderDeduction } from '@/lib/payment-actions'
import {
  Coins,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  Banknote,
  Plus,
  Minus,
} from 'lucide-react'

interface RiderWalletProps {
  riderId: string
  riderName: string
  riderUserId?: string | null
  balance: number
  totalEarned: number
  totalPaidOut: number
  advances: number
  deductions: number
  recentTransactions: { amount: number; transaction_type: string; created_at: string; description: string }[]
}

export function RiderWalletControls({
  riderId,
  riderName,
  riderUserId,
  balance,
  totalEarned,
  totalPaidOut,
  advances,
  deductions,
  recentTransactions,
}: RiderWalletProps) {
  const [expanded, setExpanded] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDesc, setPayDesc] = useState('')
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceDesc, setAdvanceDesc] = useState('')
  const [deductAmount, setDeductAmount] = useState('')
  const [deductDesc, setDeductDesc] = useState('')
  const [actionDone, setActionDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  async function handlePay() {
    const amount = Number(payAmount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }
    setError(null)
    startTransition(async () => {
      const result = await recordAdminRiderPayout(riderId, amount, payDesc || undefined)
      if (result.error) { setError(result.error) }
      else {
        setActionDone('Payment recorded')
        setPayAmount('')
        setPayDesc('')
        setTimeout(() => setActionDone(null), 2000)
        router.refresh()
      }
    })
  }

  async function handleAdvance() {
    const amount = Number(advanceAmount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }
    setError(null)
    startTransition(async () => {
      const result = await recordAdminRiderAdvance(riderId, amount, advanceDesc || undefined)
      if (result.error) { setError(result.error) }
      else {
        setActionDone('Advance recorded')
        setAdvanceAmount('')
        setAdvanceDesc('')
        setTimeout(() => setActionDone(null), 2000)
        router.refresh()
      }
    })
  }

  async function handleDeduction() {
    const amount = Number(deductAmount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }
    setError(null)
    startTransition(async () => {
      const result = await recordAdminRiderDeduction(riderId, amount, deductDesc || undefined)
      if (result.error) { setError(result.error) }
      else {
        setActionDone('Deduction recorded')
        setDeductAmount('')
        setDeductDesc('')
        setTimeout(() => setActionDone(null), 2000)
        router.refresh()
      }
    })
  }

  const netBalance = balance - advances + deductions

  return (
    <div className="border-t border-border/30 pt-2 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-xs font-medium text-foreground">Wallet</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-xs font-bold',
              netBalance > 0 ? 'text-emerald-500' : netBalance < 0 ? 'text-amber-500' : 'text-muted-foreground'
            )}>
              Rs {Math.abs(netBalance).toLocaleString()}
              {netBalance < 0 && ' (owes)'}
            </span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Balance Summary */}
          <div className="grid grid-cols-4 gap-1.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-center">
              <p className="text-[9px] text-muted-foreground">Earned</p>
              <p className="text-xs font-bold text-emerald-500">Rs {totalEarned.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-blue-500/10 text-center">
              <p className="text-[9px] text-muted-foreground">Paid Out</p>
              <p className="text-xs font-bold text-blue-500">Rs {totalPaidOut.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-violet-500/10 text-center">
              <p className="text-[9px] text-muted-foreground">Advances</p>
              <p className="text-xs font-bold text-violet-500">Rs {advances.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded-lg bg-red-500/10 text-center">
              <p className="text-[9px] text-muted-foreground">Deductions</p>
              <p className="text-xs font-bold text-red-500">Rs {deductions.toLocaleString()}</p>
            </div>
          </div>

          {actionDone && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 bg-emerald-500/10 px-3 py-2 rounded-lg">
              <Check className="w-3.5 h-3.5" />
              {actionDone}
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          {/* Record Payment */}
          <div className="p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-2">
            <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
              <Banknote className="w-3 h-3" />
              Record Payment to {riderName}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-emerald-500/50 focus:outline-none"
              />
              <input
                type="text"
                value={payDesc}
                onChange={(e) => setPayDesc(e.target.value)}
                placeholder="Note"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-emerald-500/50 focus:outline-none"
              />
              <button
                onClick={handlePay}
                disabled={isPending || !payAmount}
                className="h-8 px-3 rounded-lg text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1"
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Pay
              </button>
            </div>
          </div>

          {/* Record Advance */}
          <div className="p-2.5 rounded-xl bg-violet-500/5 border border-violet-500/20 space-y-2">
            <p className="text-[10px] text-violet-500 font-medium flex items-center gap-1">
              <Plus className="w-3 h-3" />
              Give Advance (reduces future balance)
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-violet-500/50 focus:outline-none"
              />
              <input
                type="text"
                value={advanceDesc}
                onChange={(e) => setAdvanceDesc(e.target.value)}
                placeholder="Note"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-violet-500/50 focus:outline-none"
              />
              <button
                onClick={handleAdvance}
                disabled={isPending || !advanceAmount}
                className="h-8 px-3 rounded-lg text-[10px] font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1"
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Add
              </button>
            </div>
          </div>

          {/* Record Deduction */}
          <div className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2">
            <p className="text-[10px] text-red-500 font-medium flex items-center gap-1">
              <Minus className="w-3 h-3" />
              Add Deduction (penalty, damage, etc.)
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={deductAmount}
                onChange={(e) => setDeductAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-red-500/50 focus:outline-none"
              />
              <input
                type="text"
                value={deductDesc}
                onChange={(e) => setDeductDesc(e.target.value)}
                placeholder="Reason"
                className="flex-1 h-8 px-2 rounded-lg border border-border bg-background text-xs focus:border-red-500/50 focus:outline-none"
              />
              <button
                onClick={handleDeduction}
                disabled={isPending || !deductAmount}
                className="h-8 px-3 rounded-lg text-[10px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 flex items-center gap-1"
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minus className="w-3 h-3" />}
                Deduct
              </button>
            </div>
          </div>

          {/* Recent Transactions */}
          {recentTransactions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Recent Transactions</p>
              {recentTransactions.slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1.5 rounded-lg bg-muted/10">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[8px] font-bold uppercase',
                      t.transaction_type === 'payout' ? 'bg-blue-500/20 text-blue-400' :
                      t.transaction_type === 'advance' ? 'bg-violet-500/20 text-violet-400' :
                      t.transaction_type === 'deduction' ? 'bg-red-500/20 text-red-400' :
                      'bg-emerald-500/20 text-emerald-400'
                    )}>
                      {t.transaction_type}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {t.description ? ` - ${t.description}` : ''}
                    </span>
                  </div>
                  <span className={cn(
                    'font-medium',
                    t.transaction_type === 'deduction' ? 'text-red-500' : 'text-foreground'
                  )}>
                    {t.transaction_type === 'deduction' ? '-' : ''}Rs {Number(t.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
