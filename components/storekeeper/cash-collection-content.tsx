'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Banknote, Check, Search, CheckCircle2, Filter, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Delivery {
  id: string
  index_no: string | null
  customer_name: string
  payment_cash: number
  payment_juice: number
  payment_bank: number
  delivery_date: string
  contractor_id: string | null
  rider_id: string | null
  rider_name: string
  contractor_name: string
  cash_collected: boolean
}

interface Contractor {
  id: string
  name: string
  phone: string | null
}

interface CashCollectionContentProps {
  deliveries: Delivery[]
  contractors: Contractor[]
  userId: string
}

// Format date to YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// Format date for display
function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr)
  const today = formatDate(new Date())
  const yesterday = formatDate(new Date(Date.now() - 86400000))
  
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function CashCollectionContent({ deliveries, contractors, userId }: CashCollectionContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [contractorFilter, setContractorFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>(formatDate(new Date())) // Default to today
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collecting, setCollecting] = useState(false)
  
  // Navigate date
  function prevDay() {
    const current = new Date(dateFilter)
    current.setDate(current.getDate() - 1)
    setDateFilter(formatDate(current))
    setSelected(new Set()) // Clear selection on date change
  }
  
  function nextDay() {
    const current = new Date(dateFilter)
    current.setDate(current.getDate() + 1)
    setDateFilter(formatDate(current))
    setSelected(new Set()) // Clear selection on date change
  }
  
  function goToToday() {
    setDateFilter(formatDate(new Date()))
    setSelected(new Set())
  }
  
  // Filter deliveries by date, contractor and search
  const filtered = deliveries.filter(d => {
    const deliveryDateStr = d.delivery_date?.split('T')[0] || ''
    const matchesDate = dateFilter === 'all' || deliveryDateStr === dateFilter
    const matchesSearch = !search || 
      d.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      d.index_no?.toLowerCase().includes(search.toLowerCase()) ||
      d.rider_name.toLowerCase().includes(search.toLowerCase())
    const matchesContractor = contractorFilter === 'all' || d.contractor_id === contractorFilter
    return matchesDate && matchesSearch && matchesContractor
  })
  
  // Get unique dates for quick reference
  const uniqueDates = [...new Set(deliveries.map(d => d.delivery_date?.split('T')[0]).filter(Boolean))].sort().reverse()
  
  // Calculate totals
  const totalPending = filtered.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
  const selectedTotal = Array.from(selected).reduce((sum, id) => {
    const d = deliveries.find(del => del.id === id)
    return sum + Number(d?.payment_cash || 0)
  }, 0)
  
  function toggleSelect(id: string) {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelected(newSelected)
  }
  
  function selectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(d => d.id)))
    }
  }
  
  async function markAsCollected() {
    if (selected.size === 0) return
    setCollecting(true)
    
    const supabase = createClient()
    const ids = Array.from(selected)
    const today = new Date().toISOString().split('T')[0]
    
    // Group selected deliveries by contractor
    const byContractor = new Map<string, { total: number, deliveryIds: string[] }>()
    for (const id of ids) {
      const delivery = deliveries.find(d => d.id === id)
      if (delivery && delivery.contractor_id) {
        const existing = byContractor.get(delivery.contractor_id) || { total: 0, deliveryIds: [] }
        existing.total += Number(delivery.payment_cash || 0)
        existing.deliveryIds.push(id)
        byContractor.set(delivery.contractor_id, existing)
      }
    }
    
    // Update all selected deliveries as cash collected
    const { error } = await supabase
      .from('deliveries')
      .update({
        cash_collected: true,
        cash_collected_at: new Date().toISOString(),
        cash_collected_by: userId,
      })
      .in('id', ids)
    
    if (error) {
      console.error('Error marking as collected:', error)
      alert('Failed to mark as collected')
      setCollecting(false)
      return
    }
    
    // Create or update cash_collection_sessions for each contractor
    for (const [contractorId, data] of byContractor) {
      // Check if session exists for this contractor today
      const { data: existingSession } = await supabase
        .from('cash_collection_sessions')
        .select('id, collected_cash')
        .eq('contractor_id', contractorId)
        .eq('collection_date', today)
        .eq('collected_by', userId)
        .single()
      
      if (existingSession) {
        // Update existing session - add to collected amount
        await supabase
          .from('cash_collection_sessions')
          .update({
            collected_cash: Number(existingSession.collected_cash || 0) + data.total,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSession.id)
      } else {
        // Create new session
        await supabase
          .from('cash_collection_sessions')
          .insert({
            contractor_id: contractorId,
            collection_date: today,
            collected_cash: data.total,
            expected_cash: data.total,
            collected_by: userId,
            status: 'completed',
          })
      }
    }
    
    setSelected(new Set())
    startTransition(() => {
      router.refresh()
    })
    
    setCollecting(false)
  }
  
  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Collection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              Rs {totalPending.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">{filtered.length} deliveries</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Selected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">
              Rs {selectedTotal.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">{selected.size} selected</p>
          </CardContent>
        </Card>
        
        <Card className="flex items-center justify-center">
          <Button 
            onClick={markAsCollected} 
            disabled={selected.size === 0 || collecting}
            size="lg"
            className="gap-2"
          >
            <CheckCircle2 className="w-5 h-5" />
            {collecting ? 'Marking...' : `Mark ${selected.size} as Collected`}
          </Button>
        </Card>
      </div>
      
      {/* Date Navigation */}
      <Card className="bg-muted/30">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={prevDay}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold text-lg">{formatDateDisplay(dateFilter)}</span>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value)
                  setSelected(new Set())
                }}
                className="w-auto"
              />
            </div>
            
            <div className="flex gap-2">
              {dateFilter !== formatDate(new Date()) && (
                <Button variant="outline" size="sm" onClick={goToToday}>
                  Today
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={nextDay}>
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
          
          {/* Quick date links */}
          {uniqueDates.length > 0 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              <Button 
                variant={dateFilter === 'all' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => { setDateFilter('all'); setSelected(new Set()) }}
              >
                All Dates
              </Button>
              {uniqueDates.slice(0, 7).map(date => (
                <Button 
                  key={date} 
                  variant={dateFilter === date ? 'default' : 'outline'} 
                  size="sm"
                  onClick={() => { setDateFilter(date!); setSelected(new Set()) }}
                >
                  {formatDateDisplay(date!)}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search customer, index, rider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={contractorFilter} onValueChange={setContractorFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="All contractors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contractors</SelectItem>
            {contractors.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={selectAll}>
          {selected.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
        </Button>
      </div>
      
      {/* Deliveries List */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Cash Collections</CardTitle>
          <CardDescription>
            Select deliveries to mark cash as collected
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mb-4 text-emerald-500" />
              <p className="font-medium">All cash collected!</p>
              <p className="text-sm">No pending collections</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((delivery) => (
                <div
                  key={delivery.id}
                  onClick={() => toggleSelect(delivery.id)}
                  className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selected.has(delivery.id)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <Checkbox 
                    checked={selected.has(delivery.id)}
                    onCheckedChange={() => toggleSelect(delivery.id)}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{delivery.customer_name}</p>
                      {delivery.index_no && (
                        <Badge variant="outline" className="text-xs">
                          {delivery.index_no}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                      <span>{delivery.contractor_name}</span>
                      <span>•</span>
                      <span>{delivery.rider_name}</span>
                      <span>•</span>
                      <span>{new Date(delivery.delivery_date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <p className="font-bold text-lg text-emerald-600">
                      Rs {Number(delivery.payment_cash).toLocaleString()}
                    </p>
                    {(delivery.payment_juice > 0 || delivery.payment_bank > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {delivery.payment_juice > 0 && `Juice: ${delivery.payment_juice}`}
                        {delivery.payment_bank > 0 && ` Bank: ${delivery.payment_bank}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
