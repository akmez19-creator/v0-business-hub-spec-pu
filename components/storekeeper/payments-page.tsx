'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { 
  ArrowLeft, Banknote, CreditCard, Smartphone, Users, 
  ChevronRight, TrendingUp, Calendar, ChevronLeft,
  Filter
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Delivery {
  id: string
  index_no?: string
  customer_name: string
  amount: number
  payment_method: string
  payment_cash: number
  payment_bank: number
  payment_juice: number
  delivery_date: string
  rider_id: string
  rider_name: string
  contractor_id: string
  contractor_name: string
  contractor_photo_url?: string | null
}

interface Props {
  deliveries: Delivery[]
  contractors: { id: string; name: string; photoUrl: string | null }[]
  selectedDate: string
  availableDates: string[]
}

const fmtRs = (n: number) => `Rs ${n.toLocaleString()}`
const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  if (d === today.toISOString().split('T')[0]) return 'Today'
  if (d === yesterday.toISOString().split('T')[0]) return 'Yesterday'
  return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

export function PaymentsPage({ deliveries, contractors, selectedDate, availableDates }: Props) {
  const [view, setView] = useState<'summary' | 'contractor'>('summary')
  const [selectedContractor, setSelectedContractor] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string>(selectedDate)
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'bank' | 'juice'>('all')

  // Filter deliveries by date
  const filteredByDate = useMemo(() => {
    return deliveries.filter(d => d.delivery_date === dateFilter)
  }, [deliveries, dateFilter])

  // Calculate totals by payment method
  const totals = useMemo(() => {
    const data = filteredByDate
    return {
      cash: data.reduce((sum, d) => sum + d.payment_cash, 0),
      bank: data.reduce((sum, d) => sum + d.payment_bank, 0),
      juice: data.reduce((sum, d) => sum + d.payment_juice, 0),
      total: data.reduce((sum, d) => sum + d.amount, 0),
      count: data.length,
    }
  }, [filteredByDate])

  // Group by contractor
  const byContractor = useMemo(() => {
    const map = new Map<string, {
      id: string
      name: string
      photoUrl: string | null
      cash: number
      bank: number
      juice: number
      total: number
      count: number
    }>()

    for (const d of filteredByDate) {
      if (!map.has(d.contractor_id)) {
        const contractor = contractors.find(c => c.id === d.contractor_id)
        map.set(d.contractor_id, {
          id: d.contractor_id,
          name: d.contractor_name || contractor?.name || 'Unknown',
          photoUrl: d.contractor_photo_url || contractor?.photoUrl || null,
          cash: 0, bank: 0, juice: 0, total: 0, count: 0,
        })
      }
      const c = map.get(d.contractor_id)!
      c.cash += d.payment_cash
      c.bank += d.payment_bank
      c.juice += d.payment_juice
      c.total += d.amount
      c.count++
    }

    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [filteredByDate, contractors])

  // Get selected contractor data
  const contractorData = selectedContractor ? byContractor.find(c => c.id === selectedContractor) : null
  const contractorDeliveries = selectedContractor 
    ? filteredByDate.filter(d => d.contractor_id === selectedContractor)
    : []

  // Apply method filter
  const displayDeliveries = useMemo(() => {
    if (methodFilter === 'all') return contractorDeliveries
    return contractorDeliveries.filter(d => {
      if (methodFilter === 'cash') return d.payment_cash > 0
      if (methodFilter === 'bank') return d.payment_bank > 0
      if (methodFilter === 'juice') return d.payment_juice > 0
      return true
    })
  }, [contractorDeliveries, methodFilter])

  // Date navigation
  const dateIdx = availableDates.indexOf(dateFilter)
  const navigateDate = (dir: 'prev' | 'next') => {
    const newIdx = dir === 'prev' ? dateIdx + 1 : dateIdx - 1
    if (newIdx >= 0 && newIdx < availableDates.length) {
      setDateFilter(availableDates[newIdx])
    }
  }

  // Contractor detail view
  if (selectedContractor && contractorData) {
    return (
      <div className="px-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3 py-2">
          <button onClick={() => setSelectedContractor(null)} 
            className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center active:scale-90">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 flex-1">
            {contractorData.photoUrl ? (
              <Image src={contractorData.photoUrl} alt={contractorData.name} width={40} height={40} className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
            )}
            <div>
              <div className="font-bold">{contractorData.name}</div>
              <div className="text-xs text-muted-foreground">{fmtDate(dateFilter)} - {contractorData.count} orders</div>
            </div>
          </div>
        </div>

        {/* Payment Summary Cards */}
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setMethodFilter(methodFilter === 'cash' ? 'all' : 'cash')}
            className={cn("glass-card rounded-xl p-3 text-center transition-all", 
              methodFilter === 'cash' && "ring-2 ring-emerald-500")}>
            <Banknote className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
            <div className="text-lg font-bold text-emerald-400">{fmtRs(contractorData.cash)}</div>
            <div className="text-[10px] text-muted-foreground">Cash</div>
          </button>
          <button onClick={() => setMethodFilter(methodFilter === 'bank' ? 'all' : 'bank')}
            className={cn("glass-card rounded-xl p-3 text-center transition-all",
              methodFilter === 'bank' && "ring-2 ring-blue-500")}>
            <CreditCard className="w-5 h-5 mx-auto text-blue-400 mb-1" />
            <div className="text-lg font-bold text-blue-400">{fmtRs(contractorData.bank)}</div>
            <div className="text-[10px] text-muted-foreground">Bank</div>
          </button>
          <button onClick={() => setMethodFilter(methodFilter === 'juice' ? 'all' : 'juice')}
            className={cn("glass-card rounded-xl p-3 text-center transition-all",
              methodFilter === 'juice' && "ring-2 ring-amber-500")}>
            <Smartphone className="w-5 h-5 mx-auto text-amber-400 mb-1" />
            <div className="text-lg font-bold text-amber-400">{fmtRs(contractorData.juice)}</div>
            <div className="text-[10px] text-muted-foreground">Juice</div>
          </button>
        </div>

        {/* Orders List */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {methodFilter === 'all' ? 'All Orders' : `${methodFilter.charAt(0).toUpperCase() + methodFilter.slice(1)} Orders`}
            </span>
            <span className="text-xs text-muted-foreground">{displayDeliveries.length} orders</span>
          </div>
          <div className="divide-y divide-border/30 max-h-[50vh] overflow-y-auto">
            {displayDeliveries.map(d => (
              <div key={d.id} className="px-3 py-2.5 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{d.customer_name}</div>
                  <div className="text-[11px] text-muted-foreground">{d.index_no} · {d.rider_name}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.payment_cash > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                      {fmtRs(d.payment_cash)}
                    </span>
                  )}
                  {d.payment_bank > 0 && (
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs font-bold">
                      {fmtRs(d.payment_bank)}
                    </span>
                  )}
                  {d.payment_juice > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs font-bold">
                      {fmtRs(d.payment_juice)}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {displayDeliveries.length === 0 && (
              <div className="px-3 py-8 text-center text-muted-foreground text-sm">
                No {methodFilter !== 'all' ? methodFilter : ''} orders found
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Main summary view
  return (
    <div className="px-3 space-y-3">
      <Link href="/dashboard/storekeeper" className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      {/* Compact Header with Date Nav */}
      <div className="glass-card rounded-2xl p-3">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => navigateDate('prev')} disabled={dateIdx >= availableDates.length - 1}
            className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="font-bold">{fmtDate(dateFilter)}</span>
          </div>
          <button onClick={() => navigateDate('next')} disabled={dateIdx <= 0}
            className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Total Summary */}
        <div className="flex items-center justify-between bg-muted/20 rounded-xl p-3">
          <div>
            <div className="text-2xl font-black">{fmtRs(totals.total)}</div>
            <div className="text-xs text-muted-foreground">{totals.count} orders</div>
          </div>
          <TrendingUp className="w-6 h-6 text-primary" />
        </div>
      </div>

      {/* Payment Method Breakdown */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <Banknote className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
          <div className="text-lg font-bold text-emerald-400">{fmtRs(totals.cash)}</div>
          <div className="text-[10px] text-muted-foreground">Cash</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <CreditCard className="w-5 h-5 mx-auto text-blue-400 mb-1" />
          <div className="text-lg font-bold text-blue-400">{fmtRs(totals.bank)}</div>
          <div className="text-[10px] text-muted-foreground">Bank</div>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Smartphone className="w-5 h-5 mx-auto text-amber-400 mb-1" />
          <div className="text-lg font-bold text-amber-400">{fmtRs(totals.juice)}</div>
          <div className="text-[10px] text-muted-foreground">Juice</div>
        </div>
      </div>

      {/* Contractors List */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="font-bold text-sm">By Contractor</span>
        </div>
        <div className="space-y-2">
          {byContractor.map(c => (
            <button key={c.id} onClick={() => setSelectedContractor(c.id)}
              className="glass-card rounded-xl p-3 w-full text-left active:scale-[0.98] transition-all">
              <div className="flex items-center gap-3">
                {c.photoUrl ? (
                  <Image src={c.photoUrl} alt={c.name} width={40} height={40} className="w-10 h-10 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{c.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {c.cash > 0 && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        {fmtRs(c.cash)}
                      </span>
                    )}
                    {c.bank > 0 && (
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold">
                        {fmtRs(c.bank)}
                      </span>
                    )}
                    {c.juice > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                        {fmtRs(c.juice)}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            </button>
          ))}
          {byContractor.length === 0 && (
            <div className="glass-card rounded-xl p-6 text-center text-muted-foreground text-sm">
              No deliveries for {fmtDate(dateFilter)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
