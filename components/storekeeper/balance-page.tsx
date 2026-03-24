'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, ChevronDown, Banknote, Building2, TrendingUp, TrendingDown, Plus, Wallet, PiggyBank, Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'

// Mauritius currency denominations
const NOTES = [2000, 1000, 500, 200, 100, 50, 25] as const
const COINS_LIST = [20, 10, 5, 1] as const


interface DailyEntry {
  date: string
  cashIn: number  // collected from contractors
  cashOut: number // deposited to bank
  balance: number // running balance
}

interface BankDeposit {
  id: string
  deposit_date: string
  amount: number
  bank_name: string | null
  reference_number: string | null
  notes: string | null
}

interface Props {
  entries: DailyEntry[]
  deposits: BankDeposit[]
  totals: {
    totalCollected: number
    totalDeposited: number
    cashInHand: number
    openingBalance: number
  }
  denomTotals: Record<number, number>
  userId: string
}

function fmtRs(n: number) { return `Rs ${(n || 0).toLocaleString()}` }
function fmtDate(d: string) {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (d === today) return 'Today'
  if (d === yesterday) return 'Yesterday'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function BalancePage({ entries, deposits, totals, denomTotals, userId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showDepositDialog, setShowDepositDialog] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [bankName, setBankName] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleDeposit() {
    const amount = parseFloat(depositAmount)
    if (isNaN(amount) || amount <= 0) return

    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('bank_deposits').insert({
      amount,
      bank_name: bankName || null,
      reference_number: refNumber || null,
      notes: notes || null,
      deposited_by: userId,
      deposit_date: new Date().toISOString().split('T')[0],
    })

    if (error) {
      console.error('Failed to record deposit:', error)
      alert('Failed to record deposit')
    } else {
      setShowDepositDialog(false)
      setDepositAmount('')
      setBankName('')
      setRefNumber('')
      setNotes('')
      startTransition(() => router.refresh())
    }
    setSaving(false)
  }

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
        <div className="flex-1 font-bold text-lg">Cash Balance</div>
        <Button size="sm" onClick={() => setShowDepositDialog(true)} className="gap-1.5">
          <Plus className="w-4 h-4" /> Bank Deposit
        </Button>
      </div>

      {/* Cash In Hand - Main Display */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/5 border border-blue-500/30 p-6 mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Wallet className="w-5 h-5 text-blue-400" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Cash In Hand</span>
        </div>
        <div className="text-5xl font-black text-white tracking-tight mb-2">
          {fmtRs(totals.cashInHand)}
        </div>
        <div className="text-sm text-muted-foreground">
          Available for deposit
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs uppercase text-emerald-400 font-semibold">Total Collected</span>
          </div>
          <div className="text-2xl font-bold text-emerald-400">{fmtRs(totals.totalCollected)}</div>
          <div className="text-xs text-muted-foreground">From contractors</div>
        </div>
        <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4 text-violet-400" />
            <span className="text-xs uppercase text-violet-400 font-semibold">Bank Deposits</span>
          </div>
          <div className="text-2xl font-bold text-violet-400">{fmtRs(totals.totalDeposited)}</div>
          <div className="text-xs text-muted-foreground">{deposits.length} deposits</div>
        </div>
      </div>

      {/* Notes & Coins Breakdown */}
      {totals.cashInHand > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {/* Notes */}
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 overflow-hidden">
            <div className="px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400 uppercase">Notes</span>
              <span className="ml-auto text-sm font-bold text-emerald-400">
                {fmtRs(NOTES.reduce((t, d) => t + d * (denomTotals[d] || 0), 0))}
              </span>
            </div>
            <div className="p-3 space-y-1">
              {NOTES.filter(d => (denomTotals[d] || 0) > 0).map(d => (
                <div key={d} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Rs {d >= 1000 ? `${d/1000}K` : d}</span>
                  <span className="font-medium">{denomTotals[d]} pcs</span>
                  <span className="text-emerald-400 font-semibold">{fmtRs(d * (denomTotals[d] || 0))}</span>
                </div>
              ))}
              {NOTES.every(d => (denomTotals[d] || 0) === 0) && (
                <p className="text-xs text-muted-foreground text-center py-2">No notes</p>
              )}
            </div>
          </div>
          
          {/* Coins */}
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-amber-400 uppercase">Coins</span>
              <span className="ml-auto text-sm font-bold text-amber-400">
                {fmtRs(COINS_LIST.reduce((t, d) => t + d * (denomTotals[d] || 0), 0))}
              </span>
            </div>
            <div className="p-3 space-y-1">
              {COINS_LIST.filter(d => (denomTotals[d] || 0) > 0).map(d => (
                <div key={d} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Rs {d}</span>
                  <span className="font-medium">{denomTotals[d]} pcs</span>
                  <span className="text-amber-400 font-semibold">{fmtRs(d * (denomTotals[d] || 0))}</span>
                </div>
              ))}
              {COINS_LIST.every(d => (denomTotals[d] || 0) === 0) && (
                <p className="text-xs text-muted-foreground text-center py-2">No coins</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ledger View - Accounting Style */}
      <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden mb-6">
        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-blue-400" />
          <span className="font-semibold">Cash Ledger</span>
        </div>
        
        {/* Table Header */}
        <div className="grid grid-cols-4 text-[10px] uppercase text-muted-foreground border-b border-white/10 px-4 py-2 bg-white/5">
          <div>Date</div>
          <div className="text-right text-emerald-400">Debit (In)</div>
          <div className="text-right text-red-400">Credit (Out)</div>
          <div className="text-right text-blue-400">Balance</div>
        </div>

        {/* Opening Balance Row */}
        {totals.openingBalance > 0 && (
          <div className="grid grid-cols-4 text-sm border-b border-white/5 px-4 py-3 bg-blue-500/5">
            <div className="font-medium text-muted-foreground">Opening</div>
            <div className="text-right">-</div>
            <div className="text-right">-</div>
            <div className="text-right font-bold text-blue-400">{fmtRs(totals.openingBalance)}</div>
          </div>
        )}

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground">
            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No transactions yet</p>
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div 
              key={entry.date}
              className={cn(
                "grid grid-cols-4 text-sm border-b border-white/5 px-4 py-3",
                idx === 0 && "bg-blue-500/5"
              )}
            >
              <div className="font-medium">{fmtDate(entry.date)}</div>
              <div className={cn("text-right", entry.cashIn > 0 && "text-emerald-400 font-semibold")}>
                {entry.cashIn > 0 ? fmtRs(entry.cashIn) : '-'}
              </div>
              <div className={cn("text-right", entry.cashOut > 0 && "text-red-400 font-semibold")}>
                {entry.cashOut > 0 ? fmtRs(entry.cashOut) : '-'}
              </div>
              <div className={cn(
                "text-right font-bold",
                entry.balance >= 0 ? "text-blue-400" : "text-red-400"
              )}>
                {fmtRs(entry.balance)}
              </div>
            </div>
          ))
        )}

        {/* Closing Balance Footer */}
        <div className="grid grid-cols-4 text-sm px-4 py-4 bg-blue-500/10 border-t border-blue-500/20">
          <div className="font-bold">Closing Balance</div>
          <div className="text-right font-bold text-emerald-400">{fmtRs(totals.totalCollected)}</div>
          <div className="text-right font-bold text-red-400">{fmtRs(totals.totalDeposited)}</div>
          <div className="text-right font-black text-xl text-blue-400">{fmtRs(totals.cashInHand)}</div>
        </div>
      </div>

      {/* Recent Bank Deposits */}
      {deposits.length > 0 && (
        <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-4 py-3 bg-violet-500/10 border-b border-white/10 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-violet-400" />
            <span className="font-semibold text-violet-400">Bank Deposits</span>
          </div>
          <div className="divide-y divide-white/5">
            {deposits.slice(0, 10).map(d => (
              <div key={d.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{fmtDate(d.deposit_date)}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.bank_name || 'Bank'} {d.reference_number && `• ${d.reference_number}`}
                  </div>
                  {d.notes && <div className="text-xs text-muted-foreground mt-0.5">{d.notes}</div>}
                </div>
                <div className="font-bold text-violet-400">{fmtRs(d.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deposit Dialog */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Bank Deposit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">Rs</span>
                <Input
                  type="number"
                  placeholder="0"
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  className="pl-10 text-lg font-bold"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Bank Name (optional)</label>
              <Input
                placeholder="e.g. BOC, Commercial Bank"
                value={bankName}
                onChange={e => setBankName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Reference Number (optional)</label>
              <Input
                placeholder="Deposit slip number"
                value={refNumber}
                onChange={e => setRefNumber(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Notes (optional)</label>
              <Input
                placeholder="Any additional notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepositDialog(false)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={saving || !depositAmount}>
              {saving ? 'Saving...' : 'Record Deposit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
