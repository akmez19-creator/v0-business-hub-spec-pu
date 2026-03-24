'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { updatePaymentSplit } from '@/lib/delivery-actions'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Banknote,
  CreditCard,
  Smartphone,
  CheckCircle,
  Clock,
  AlertCircle,
  Search,
  X,
  ChevronDown,
  Filter,
  ImageIcon,
  Zap,
  Copy,
  Share2,
  CalendarDays,
  Store,
} from 'lucide-react'

interface DeliveryPayment {
  id: string
  customer_name: string
  contact_1?: string | null
  region?: string | null
  locality?: string | null
  amount: number
  payment_method: string | null
  payment_juice: number
  payment_cash: number
  payment_bank: number
  payment_status: string
  delivery_date: string | null
  status: string
  rider_id?: string | null
  rider_name?: string | null
  payment_proof_url?: string | null
}

interface CashPendingItem {
  id: string
  index_no?: string
  customer_name: string
  payment_cash: string | number
  cash_collected: boolean
  contractor_cash_counted?: number | null
  contractor_cash_denoms?: any
  contractor_cash_counted_at?: string | null
  delivery_date: string
  rider_id?: string
  rider_name?: string | null
}

interface CollectionsOverviewProps {
  deliveries: DeliveryPayment[]
  role: 'admin' | 'contractor' | 'rider'
  riderJuicePolicies?: Record<string, string>
  cashPendingCollection?: CashPendingItem[]
  cashCollectedByStore?: CashPendingItem[]
}

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; style: string; icon: typeof CheckCircle }> = {
  paid: { label: 'Paid', style: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: CheckCircle },
  partial: { label: 'Partial', style: 'bg-amber-500/10 text-amber-500 border-amber-500/30', icon: Clock },
  unpaid: { label: 'Unpaid', style: 'bg-red-500/10 text-red-500 border-red-500/30', icon: AlertCircle },
  already_paid: { label: 'Paid', style: 'bg-blue-500/10 text-blue-500 border-blue-500/30', icon: CheckCircle },
}

const METHOD_LABELS: Record<string, string> = {
  juice: 'Juice',
  cash: 'Cash',
  paid: 'Paid',
  // backward compat
  juice_to_rider: 'Juice',
  bank: 'Paid',
  already_paid: 'Paid',
}

interface RiderJuiceInfo {
  riderId: string
  riderName: string
  totalJuice: number
  totalCash: number
  totalPaid: number
  deliveryCount: number
  proofCount: number
  noProofCount: number
}

/* Company Summary - generates shareable text summary for company */
function CompanySummary({ date, totalJuice, totalCash, totalPaid, totalCollected, riderBreakdown }: {
  date: string;
  totalJuice: number;
  totalCash: number;
  totalPaid: number;
  totalCollected: number;
  riderBreakdown: RiderJuiceInfo[];
}) {
  const [copied, setCopied] = useState(false)

  function buildSummaryText() {
    let text = `Collection Summary - ${date}\n`
    text += `${'='.repeat(35)}\n\n`
    text += `Total Collected: Rs ${totalCollected.toLocaleString()}\n`
    text += `  Juice: Rs ${totalJuice.toLocaleString()}\n`
    text += `  Cash: Rs ${totalCash.toLocaleString()}\n`
    text += `  Paid: Rs ${totalPaid.toLocaleString()}\n`

    if (riderBreakdown.length > 0) {
      text += `\nPer Rider:\n`
      text += `${'-'.repeat(35)}\n`
      for (const r of riderBreakdown) {
        const total = r.totalJuice + r.totalCash + r.totalPaid
        if (total === 0) continue
        text += `${r.riderName}: Rs ${total.toLocaleString()}`
        const parts: string[] = []
        if (r.totalJuice > 0) parts.push(`Juice Rs ${r.totalJuice.toLocaleString()}`)
        if (r.totalCash > 0) parts.push(`Cash Rs ${r.totalCash.toLocaleString()}`)
        if (r.totalPaid > 0) parts.push(`Paid Rs ${r.totalPaid.toLocaleString()}`)
        text += ` (${parts.join(', ')})\n`
      }
    }
    return text
  }

  async function handleCopy() {
    const text = buildSummaryText()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  async function handleShare() {
    const text = buildSummaryText()
    if (navigator.share) {
      try {
        await navigator.share({ title: `Collection Summary - ${date}`, text })
      } catch {
        // user cancelled
      }
    } else {
      handleCopy()
    }
  }

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-primary/5 border border-primary/20">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-primary">Send to company</p>
        <p className="text-[10px] text-muted-foreground truncate">
          Juice {totalJuice.toLocaleString()} | Cash {totalCash.toLocaleString()} | Paid {totalPaid.toLocaleString()}
        </p>
      </div>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors shrink-0"
      >
        <Copy className="w-3 h-3" />
        {copied ? 'Done' : 'Copy'}
      </button>
      <button
        onClick={handleShare}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
      >
        <Share2 className="w-3 h-3" />
        Share
      </button>
    </div>
  )
}

export function CollectionsOverview({ deliveries, role, riderJuicePolicies = {}, cashPendingCollection = [], cashCollectedByStore = [] }: CollectionsOverviewProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null) // null = "All" (7-day view)

  // Edit form state
  const [editJuice, setEditJuice] = useState(0)
  const [editCash, setEditCash] = useState(0)
  const [editBank, setEditBank] = useState(0)
  const [editMethod, setEditMethod] = useState<string | null>(null)
  const [proofView, setProofView] = useState<{ url: string; name: string } | null>(null)

  // Build available dates from deliveries (sorted newest first)
  const availableDates = [...new Set(deliveries.map(d => d.delivery_date).filter(Boolean) as string[])].sort((a, b) => b.localeCompare(a))
  const todayStr = new Date().toISOString().split('T')[0]

  // If no date selected, default to today if it exists, otherwise first available
  const effectiveDate = selectedDate
  const isWeekView = effectiveDate === null

  // Normalize: convert old method names + auto-fill amounts if missing
  const allNormalized = deliveries.map(d => {
    // Map old method names to new
    let method = d.payment_method
    if (method === 'juice_to_rider') method = 'juice'
    if (method === 'already_paid' || method === 'bank') method = 'paid'

    const hasMethod = method && method !== 'null'
    const hasAmounts = d.payment_juice > 0 || d.payment_cash > 0 || d.payment_bank > 0
    if (hasMethod && !hasAmounts && d.amount > 0) {
      const amt = d.amount
      return {
        ...d,
        payment_method: method,
        payment_juice: method === 'juice' ? amt : 0,
        payment_cash: method === 'cash' ? amt : 0,
        payment_bank: method === 'paid' ? amt : 0,
        payment_status: 'paid',
      }
    }
    return { ...d, payment_method: method }
  })

  // Filter by selected date (null = show all 7 days)
  const normalized = isWeekView
    ? allNormalized
    : allNormalized.filter(d => d.delivery_date === effectiveDate)

  const filtered = normalized.filter(d => {
    const matchSearch = !search ||
      d.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      (d.locality || d.region || '').toLowerCase().includes(search.toLowerCase()) ||
      d.rider_name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || d.payment_status === statusFilter
    return matchSearch && matchStatus
  })

  // Summary stats
  const totalAmount = normalized.reduce((s, d) => s + d.amount, 0)
  const totalCollected = normalized.reduce((s, d) => s + d.payment_juice + d.payment_cash + d.payment_bank, 0)
  const totalJuice = normalized.reduce((s, d) => s + d.payment_juice, 0)
  const totalCash = normalized.reduce((s, d) => s + d.payment_cash, 0)
  const totalPaid = normalized.reduce((s, d) => s + d.payment_bank, 0) // "Paid" uses the bank column for backward compat
  const paidCount = normalized.filter(d => d.payment_status === 'paid' || d.payment_status === 'already_paid').length
  const unpaidCount = normalized.filter(d => d.payment_status === 'unpaid').length
  const partialCount = normalized.filter(d => d.payment_status === 'partial').length

  // Build per-rider collection breakdown (for contractor view)
  const riderBreakdown: RiderJuiceInfo[] = (() => {
    if (role === 'rider') return []
    const map = new Map<string, RiderJuiceInfo>()
    for (const d of normalized) {
      const rid = d.rider_id || 'unknown'
      const rname = d.rider_name || 'Unknown'
      if (!map.has(rid)) {
        map.set(rid, { riderId: rid, riderName: rname, totalJuice: 0, totalCash: 0, totalPaid: 0, deliveryCount: 0, proofCount: 0, noProofCount: 0 })
      }
      const info = map.get(rid)!
      info.deliveryCount++
      info.totalJuice += d.payment_juice
      info.totalCash += d.payment_cash
      info.totalPaid += d.payment_bank
      // Track proofs for juice and paid methods
      const m = d.payment_method
      if ((m === 'juice' || m === 'juice_to_rider' || m === 'paid' || m === 'already_paid' || m === 'bank') && (d.payment_juice > 0 || d.payment_bank > 0)) {
        if (d.payment_proof_url) info.proofCount++
        else info.noProofCount++
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.totalJuice + b.totalCash + b.totalPaid) - (a.totalJuice + a.totalCash + a.totalPaid))
  })()

  function openEdit(d: DeliveryPayment) {
    setEditingId(d.id)
    setEditJuice(d.payment_juice)
    setEditCash(d.payment_cash)
    setEditBank(d.payment_bank)
    setEditMethod(d.payment_method)
  }

  async function savePayment(d: DeliveryPayment) {
    setSaving(true)
    const total = editJuice + editCash + editBank
    let status = 'unpaid'
    if (total >= d.amount && d.amount > 0) status = 'paid'
    else if (total > 0) status = 'partial'

    await updatePaymentSplit(d.id, {
      payment_juice: editJuice,
      payment_cash: editCash,
      payment_bank: editBank,
      payment_status: status,
      ...(editMethod ? { payment_method: editMethod } : {}),
    })
    setSaving(false)
    setEditingId(null)
    router.refresh()
  }

  // Calculate uncounted cash for badge display
  const uncountedCash = cashPendingCollection.filter(d => !d.contractor_cash_counted)

  return (
    <div className="space-y-3">
      {/* Tab Switcher for Contractors - Collections vs Cash to Store */}
      {role === 'contractor' && (cashPendingCollection.length > 0 || cashCollectedByStore.length > 0) && (
        <div className="flex gap-2 p-1 bg-muted/50 rounded-xl">
          <button
            className="flex-1 py-2.5 px-3 rounded-lg text-xs font-semibold bg-background text-foreground shadow-sm transition-all"
          >
            Collections
          </button>
          <a
            href="/dashboard/contractors/cash-collection"
            className="flex-1 py-2.5 px-3 rounded-lg text-xs font-medium text-muted-foreground transition-all flex items-center justify-center gap-1"
          >
            <Store className="w-3.5 h-3.5" />
            Cash to Store
            {uncountedCash.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold">{uncountedCash.length}</span>
            )}
          </a>
        </div>
      )}

      {/* Date tabs -- scrollable row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        <button
          onClick={() => setSelectedDate(null)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[11px] font-semibold border whitespace-nowrap transition-all shrink-0',
            isWeekView
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
          )}
        >
          <CalendarDays className="w-3 h-3 inline mr-1" />
          7 Days
        </button>
        {availableDates.map(date => {
          const d = new Date(date + 'T00:00:00')
          const isToday = date === todayStr
          const dayLabel = isToday ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
          const count = allNormalized.filter(del => del.delivery_date === date).length
          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-all shrink-0',
                effectiveDate === date
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
              )}
            >
              {dayLabel} <span className="opacity-60">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Status dots */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {isWeekView
            ? 'Last 7 days'
            : new Date((effectiveDate || todayStr) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
          }
        </span>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {paidCount}
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-1" /> {partialCount}
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 ml-1" /> {unpaidCount}
        </div>
      </div>

      {/* Combined summary card -- totals + method breakdown */}
      <Card>
        <CardContent className="p-3 space-y-2.5">
          {/* Top row: due / collected / outstanding */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">Collected</p>
              <p className="text-2xl font-bold text-emerald-500 leading-tight">Rs {totalCollected.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">of Rs {totalAmount.toLocaleString()} due</p>
              {totalAmount - totalCollected > 0 ? (
                <p className="text-sm font-semibold text-red-500">Rs {(totalAmount - totalCollected).toLocaleString()} left</p>
              ) : (
                <p className="text-sm font-semibold text-emerald-500">100% collected</p>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${totalAmount > 0 ? Math.min(100, Math.round((totalCollected / totalAmount) * 100)) : 0}%` }}
            />
          </div>
          {/* Method breakdown row */}
          <div className="flex items-center gap-3 pt-1">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-orange-500">
              <Smartphone className="w-3.5 h-3.5" /> Rs {totalJuice.toLocaleString()}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
              <Banknote className="w-3.5 h-3.5" /> Rs {totalCash.toLocaleString()}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-500">
              <CreditCard className="w-3.5 h-3.5" /> Rs {totalPaid.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Per-day breakdown when in 7-day view */}
      {isWeekView && availableDates.length > 1 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Daily Breakdown</p>
          {availableDates.map(date => {
            const dayDels = allNormalized.filter(d => d.delivery_date === date)
            const dJuice = dayDels.reduce((s, d) => s + d.payment_juice, 0)
            const dCash = dayDels.reduce((s, d) => s + d.payment_cash, 0)
            const dPaid = dayDels.reduce((s, d) => s + d.payment_bank, 0)
            const dTotal = dJuice + dCash + dPaid
            const dt = new Date(date + 'T00:00:00')
            const isToday = date === todayStr
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className="flex items-center gap-2 w-full p-2 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors text-left"
              >
                <div className="w-9 text-center shrink-0">
                  <p className="text-[10px] text-muted-foreground leading-tight">{dt.toLocaleDateString('en-GB', { weekday: 'short' })}</p>
                  <p className="text-sm font-bold leading-tight">{dt.getDate()}</p>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  {dJuice > 0 && <span className="text-[10px] text-orange-500 font-medium">J {dJuice.toLocaleString()}</span>}
                  {dCash > 0 && <span className="text-[10px] text-emerald-500 font-medium">C {dCash.toLocaleString()}</span>}
                  {dPaid > 0 && <span className="text-[10px] text-blue-500 font-medium">P {dPaid.toLocaleString()}</span>}
                  <span className="text-[9px] text-muted-foreground">{dayDels.length} del</span>
                </div>
                <p className="text-xs font-bold shrink-0">Rs {dTotal.toLocaleString()}</p>
                {isToday && <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary font-semibold shrink-0">TODAY</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Company Summary with share (contractor only) */}
      {role !== 'rider' && totalCollected > 0 && (
        <CompanySummary
          date={isWeekView
            ? (availableDates.length > 0
                ? `${new Date(availableDates[availableDates.length - 1] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${new Date(availableDates[0] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : 'Last 7 days')
            : new Date((effectiveDate || todayStr) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
          }
          totalJuice={totalJuice}
          totalCash={totalCash}
          totalPaid={totalPaid}
          totalCollected={totalCollected}
          riderBreakdown={riderBreakdown}
        />
      )}

      {/* Rider Overview (contractor only) */}
      {role !== 'rider' && riderBreakdown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Per Rider</p>
          {riderBreakdown.map(r => {
            const rTotal = r.totalJuice + r.totalCash + r.totalPaid
            if (rTotal === 0 && r.deliveryCount === 0) return null
            return (
              <div key={r.riderId} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-card border border-border/50">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                  {r.riderName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-semibold truncate">{r.riderName}</p>
                    <span className="text-[9px] text-muted-foreground">{r.deliveryCount} del</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.totalJuice > 0 && <span className="text-[10px] text-orange-500 font-medium">J {r.totalJuice.toLocaleString()}</span>}
                    {r.totalCash > 0 && <span className="text-[10px] text-emerald-500 font-medium">C {r.totalCash.toLocaleString()}</span>}
                    {r.totalPaid > 0 && <span className="text-[10px] text-blue-500 font-medium">P {r.totalPaid.toLocaleString()}</span>}
                    {r.proofCount > 0 && (
                      <span className="text-[9px] text-primary bg-primary/10 px-1 py-0.5 rounded font-medium">{r.proofCount} proof</span>
                    )}
                    {r.noProofCount > 0 && (
                      <span className="text-[9px] text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded font-medium">{r.noProofCount} no proof</span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-bold shrink-0">Rs {rTotal.toLocaleString()}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Cash Collected by Store Section (contractor only) */}
      {role === 'contractor' && cashCollectedByStore.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-emerald-500" />
              Collected by Store
            </p>
            <span className="text-xs font-medium text-emerald-500">
              Rs {cashCollectedByStore.reduce((s, d) => s + Number(d.payment_cash || 0), 0).toLocaleString()}
            </span>
          </div>
          {(() => {
            // Group by collection date
            const byDate = new Map<string, typeof cashCollectedByStore>()
            for (const d of cashCollectedByStore) {
              const date = d.cash_collected_at ? new Date(d.cash_collected_at).toISOString().split('T')[0] : d.delivery_date
              if (!byDate.has(date)) byDate.set(date, [])
              byDate.get(date)!.push(d)
            }
            const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
            return sortedDates.map(date => {
              const items = byDate.get(date)!
              const dateTotal = items.reduce((s, d) => s + Number(d.payment_cash || 0), 0)
              const dt = new Date(date + 'T00:00:00')
              const isToday = date === todayStr
              return (
                <div key={date} className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-emerald-600">
                        {isToday ? 'Today' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{items.length} deliveries</span>
                    </div>
                    <span className="text-sm font-bold text-emerald-500">Rs {dateTotal.toLocaleString()}</span>
                  </div>
                  <div className="space-y-1">
                    {items.slice(0, 3).map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[60%]">{d.customer_name}</span>
                        <span className="font-medium">Rs {Number(d.payment_cash || 0).toLocaleString()}</span>
                      </div>
                    ))}
                    {items.length > 3 && (
                      <p className="text-[10px] text-muted-foreground">+{items.length - 3} more</p>
                    )}
                  </div>
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search client, region, rider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {['all', 'unpaid', 'partial', 'paid'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                statusFilter === s
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
              )}
            >
              {s === 'all' ? `All (${normalized.length})` :
               s === 'unpaid' ? `Unpaid (${unpaidCount})` :
               s === 'partial' ? `Partial (${partialCount})` :
               `Paid (${paidCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Delivery List */}
      <div className="space-y-2">
        {filtered.map(d => {
          const collected = d.payment_juice + d.payment_cash + d.payment_bank
          const remaining = d.amount - collected
          const statusCfg = PAYMENT_STATUS_CONFIG[d.payment_status] || PAYMENT_STATUS_CONFIG.unpaid
          const StatusIcon = statusCfg.icon
          const isEditing = editingId === d.id

          return (
            <Card key={d.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                onClick={() => isEditing ? setEditingId(null) : openEdit(d)}
              >
                <div className={cn('w-2 h-8 rounded-full shrink-0', 
                  d.payment_status === 'paid' || d.payment_status === 'already_paid' ? 'bg-emerald-500' :
                  d.payment_status === 'partial' ? 'bg-amber-500' : 'bg-red-500'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{d.customer_name}</p>
                    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 border', statusCfg.style)}>
                      <StatusIcon className="w-3 h-3 mr-0.5" />
                      {statusCfg.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    {(d.locality || d.region) && <span>{d.locality || d.region}</span>}
                    {role !== 'rider' && d.rider_name && <span>- {d.rider_name}</span>}
                    {d.payment_method && <span>- {METHOD_LABELS[d.payment_method] || d.payment_method}</span>}
                    {d.payment_proof_url && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setProofView({ url: d.payment_proof_url!, name: d.customer_name }) }}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500/20 text-[10px] font-medium hover:bg-orange-500/20 transition-colors"
                      >
                        <ImageIcon className="w-3 h-3" />
                        Proof
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold">Rs {d.amount.toLocaleString()}</p>
                  {collected > 0 && collected < d.amount && (
                    <p className="text-[11px] text-amber-500">Rs {remaining.toLocaleString()} left</p>
                  )}
                </div>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', isEditing && 'rotate-180')} />
              </div>

              {/* Edit panel */}
              {isEditing && (
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-3 bg-muted/20">
                  {/* Current breakdown */}
                  {collected > 0 && (
                    <div className="flex items-center gap-3 text-xs">
                      {d.payment_juice > 0 && (
                        <span className="flex items-center gap-1 text-orange-500">
                          <Smartphone className="w-3 h-3" /> Rs {d.payment_juice}
                        </span>
                      )}
                      {d.payment_cash > 0 && (
                        <span className="flex items-center gap-1 text-emerald-500">
                          <Banknote className="w-3 h-3" /> Rs {d.payment_cash}
                        </span>
                      )}
                      {d.payment_bank > 0 && (
                        <span className="flex items-center gap-1 text-blue-500">
                          <CreditCard className="w-3 h-3" /> Paid Rs {d.payment_bank}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Edit fields */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-orange-500 flex items-center gap-1">
                        <Smartphone className="w-3 h-3" /> Juice
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editJuice}
                        onChange={(e) => setEditJuice(Number(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-emerald-500 flex items-center gap-1">
                        <Banknote className="w-3 h-3" /> Cash
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editCash}
                        onChange={(e) => setEditCash(Number(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-blue-500 flex items-center gap-1">
                        <CreditCard className="w-3 h-3" /> Paid
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editBank}
                        onChange={(e) => setEditBank(Number(e.target.value) || 0)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  {/* Quick fill buttons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => { setEditJuice(d.amount); setEditCash(0); setEditBank(0); setEditMethod('juice') }}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 transition-colors"
                    >
                      All Juice
                    </button>
                    <button
                      onClick={() => { setEditCash(d.amount); setEditJuice(0); setEditBank(0); setEditMethod('cash') }}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
                    >
                      All Cash
                    </button>
                    <button
                      onClick={() => { setEditBank(d.amount); setEditJuice(0); setEditCash(0); setEditMethod('paid') }}
                      className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors"
                    >
                      All Paid
                    </button>
                    <div className="flex-1" />
                    <span className="text-xs text-muted-foreground">
                      Total: Rs {(editJuice + editCash + editBank).toLocaleString()} / {d.amount.toLocaleString()}
                    </span>
                  </div>

                  {/* Save */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 py-2 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving}
                      onClick={() => savePayment(d)}
                      className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Payment'}
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No deliveries found for the selected filters.
          </div>
        )}
      </div>

      {/* Proof Viewer Overlay */}
      {proofView && (
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setProofView(null)}>
          <div className="relative max-w-lg w-full bg-card rounded-2xl overflow-hidden border border-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold">Payment Proof</h3>
                <p className="text-xs text-muted-foreground">{proofView.name}</p>
              </div>
              <button onClick={() => setProofView(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2">
              <img src={proofView.url} alt="Payment proof" className="w-full rounded-lg object-contain max-h-[70vh]" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
