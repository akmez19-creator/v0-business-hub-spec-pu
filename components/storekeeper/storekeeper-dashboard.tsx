'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Banknote, Package, BoxesIcon, Check, Search, Calendar, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle2, Clock, User, MapPin, Phone, FileText, Plus, Minus, Trash2
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface Delivery {
  id: string
  index_no: string | null
  customer_name: string
  customer_phone: string | null
  location: string | null
  status: string
  payment_cash: number
  payment_juice: number
  payment_bank: number
  return_product: string | null
  delivery_date: string
  contractor_id: string | null
  rider_id: string | null
  rider_name: string
  contractor_name: string
  cash_collected: boolean
  cash_collected_at: string | null
  stock_verified: boolean
  stock_verified_at: string | null
}

interface Contractor {
  id: string
  name: string
  phone: string | null
  riders: Array<{ id: string; name: string; phone: string | null }>
}

interface Product {
  id: string
  name: string
  sku: string | null
  price: number
  image_url: string | null
}

interface StockTransaction {
  id: string
  contractor_id: string
  transaction_type: string
  transaction_date: string
  notes: string | null
  created_at: string
  stock_transaction_items: Array<{
    id: string
    product_id: string
    quantity: number
    unit_price: number
  }>
}

interface Deduction {
  id: string
  deduction_type: string
  target_type: string
  target_id: string
  amount: number
  reason: string | null
  status: string
}

interface StorekeeperDashboardProps {
  profile: { id: string; name: string; role: string }
  today: string
  contractors: Contractor[]
  products: Product[]
  deliveries: Delivery[]
  stockTransactions: StockTransaction[]
  pendingDeductions: Deduction[]
  userId: string
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr)
  const today = formatDate(new Date())
  const yesterday = formatDate(new Date(Date.now() - 86400000))
  
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function StorekeeperDashboard({
  profile,
  today,
  contractors,
  products,
  deliveries,
  stockTransactions,
  pendingDeductions,
  userId
}: StorekeeperDashboardProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedDate, setSelectedDate] = useState(today)
  const [search, setSearch] = useState('')
  const [contractorFilter, setContractorFilter] = useState<string>('all')
  const [selectedDeliveries, setSelectedDeliveries] = useState<Set<string>>(new Set())
  const [collecting, setCollecting] = useState(false)
  
  // Stock out state
  const [selectedContractor, setSelectedContractor] = useState<string | null>(null)
  const [stockItems, setStockItems] = useState<Record<string, number>>({})
  const [stockNotes, setStockNotes] = useState('')
  const [savingStock, setSavingStock] = useState(false)
  
  // Filter deliveries by date
  const dateDeliveries = useMemo(() => {
    return deliveries.filter(d => {
      const deliveryDate = d.delivery_date?.split('T')[0]
      return deliveryDate === selectedDate
    })
  }, [deliveries, selectedDate])
  
  // Get unique dates
  const uniqueDates = useMemo(() => {
    return [...new Set(deliveries.map(d => d.delivery_date?.split('T')[0]).filter(Boolean))].sort().reverse()
  }, [deliveries])
  
  // Filter for cash collection (pending)
  const pendingCashDeliveries = useMemo(() => {
    return dateDeliveries.filter(d => {
      const matchesSearch = !search || 
        d.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        d.index_no?.toLowerCase().includes(search.toLowerCase()) ||
        d.rider_name.toLowerCase().includes(search.toLowerCase())
      const matchesContractor = contractorFilter === 'all' || d.contractor_id === contractorFilter
      return !d.cash_collected && Number(d.payment_cash) > 0 && matchesSearch && matchesContractor
    })
  }, [dateDeliveries, search, contractorFilter])
  
  // Filter for stock verification (pending)
  const pendingStockDeliveries = useMemo(() => {
    return dateDeliveries.filter(d => {
      const matchesSearch = !search || 
        d.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        d.index_no?.toLowerCase().includes(search.toLowerCase())
      const matchesContractor = contractorFilter === 'all' || d.contractor_id === contractorFilter
      return !d.stock_verified && d.return_product && d.return_product.trim() !== '' && matchesSearch && matchesContractor
    })
  }, [dateDeliveries, search, contractorFilter])
  
  // Calculate stats for selected date
  const stats = useMemo(() => {
    const forDate = dateDeliveries
    const pendingCash = forDate.filter(d => !d.cash_collected && Number(d.payment_cash) > 0)
    const collectedCash = forDate.filter(d => d.cash_collected && Number(d.payment_cash) > 0)
    const pendingStock = forDate.filter(d => !d.stock_verified && d.return_product && d.return_product.trim() !== '')
    const verifiedStock = forDate.filter(d => d.stock_verified)
    
    return {
      totalDeliveries: forDate.length,
      pendingCashCount: pendingCash.length,
      pendingCashAmount: pendingCash.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0),
      collectedCashAmount: collectedCash.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0),
      pendingStockCount: pendingStock.length,
      verifiedStockCount: verifiedStock.length,
    }
  }, [dateDeliveries])
  
  // Stock transactions for date
  const dateStockOut = useMemo(() => {
    return stockTransactions.filter(t => 
      t.transaction_date === selectedDate && t.transaction_type === 'stock_out'
    )
  }, [stockTransactions, selectedDate])
  
  const dateStockIn = useMemo(() => {
    return stockTransactions.filter(t => 
      t.transaction_date === selectedDate && t.transaction_type === 'stock_in'
    )
  }, [stockTransactions, selectedDate])
  
  // Navigate dates
  function prevDay() {
    const current = new Date(selectedDate)
    current.setDate(current.getDate() - 1)
    setSelectedDate(formatDate(current))
    setSelectedDeliveries(new Set())
  }
  
  function nextDay() {
    const current = new Date(selectedDate)
    current.setDate(current.getDate() + 1)
    setSelectedDate(formatDate(current))
    setSelectedDeliveries(new Set())
  }
  
  // Toggle delivery selection
  function toggleDelivery(id: string) {
    const newSelected = new Set(selectedDeliveries)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedDeliveries(newSelected)
  }
  
  function selectAll(items: Delivery[]) {
    if (selectedDeliveries.size === items.length) {
      setSelectedDeliveries(new Set())
    } else {
      setSelectedDeliveries(new Set(items.map(d => d.id)))
    }
  }
  
  // Mark as collected
  async function markCashCollected() {
    if (selectedDeliveries.size === 0) return
    setCollecting(true)
    
    const supabase = createClient()
    const ids = Array.from(selectedDeliveries)
    
    const { error } = await supabase
      .from('deliveries')
      .update({
        cash_collected: true,
        cash_collected_at: new Date().toISOString(),
        cash_collected_by: userId
      })
      .in('id', ids)
    
    if (!error) {
      setSelectedDeliveries(new Set())
      router.refresh()
    }
    setCollecting(false)
  }
  
  // Mark stock verified
  async function markStockVerified() {
    if (selectedDeliveries.size === 0) return
    setCollecting(true)
    
    const supabase = createClient()
    const ids = Array.from(selectedDeliveries)
    
    const { error } = await supabase
      .from('deliveries')
      .update({
        stock_verified: true,
        stock_verified_at: new Date().toISOString(),
        stock_verified_by: userId
      })
      .in('id', ids)
    
    if (!error) {
      setSelectedDeliveries(new Set())
      router.refresh()
    }
    setCollecting(false)
  }
  
  // Stock out functions
  function addStockItem(productId: string) {
    setStockItems(prev => ({
      ...prev,
      [productId]: (prev[productId] || 0) + 1
    }))
  }
  
  function updateStockQty(productId: string, qty: number) {
    if (qty <= 0) {
      const { [productId]: _, ...rest } = stockItems
      setStockItems(rest)
    } else {
      setStockItems(prev => ({ ...prev, [productId]: qty }))
    }
  }
  
  async function submitStockOut() {
    if (!selectedContractor || Object.keys(stockItems).length === 0) return
    setSavingStock(true)
    
    const supabase = createClient()
    
    // Create transaction
    const { data: tx, error: txError } = await supabase
      .from('stock_transactions')
      .insert({
        contractor_id: selectedContractor,
        transaction_type: 'stock_out',
        processed_by: userId,
        transaction_date: selectedDate,
        notes: stockNotes || null
      })
      .select()
      .single()
    
    if (tx && !txError) {
      // Create items
      const items = Object.entries(stockItems).map(([productId, quantity]) => {
        const product = products.find(p => p.id === productId)
        return {
          transaction_id: tx.id,
          product_id: productId,
          quantity,
          unit_price: product?.price || 0
        }
      })
      
      await supabase.from('stock_transaction_items').insert(items)
    }
    
    setStockItems({})
    setStockNotes('')
    setSelectedContractor(null)
    setSavingStock(false)
    router.refresh()
  }
  
  const totalStockItems = Object.values(stockItems).reduce((a, b) => a + b, 0)
  const totalStockValue = Object.entries(stockItems).reduce((sum, [pid, qty]) => {
    const product = products.find(p => p.id === pid)
    return sum + (qty * (product?.price || 0))
  }, 0)
  
  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Store Operations</h2>
          <p className="text-sm text-muted-foreground">Welcome, {profile.name}</p>
        </div>
      </div>
      
      {/* Date Navigator */}
      <Card className="bg-muted/30">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={prevDay}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="font-semibold">{formatDateDisplay(selectedDate)}</span>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value)
                  setSelectedDeliveries(new Set())
                }}
                className="w-[140px] h-8"
              />
            </div>
            
            <Button variant="ghost" size="sm" onClick={nextDay}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={stats.pendingCashAmount > 0 ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : ''}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Banknote className="w-3.5 h-3.5" />
              Pending Cash
            </div>
            <p className="text-lg font-bold text-amber-600">
              Rs {stats.pendingCashAmount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">{stats.pendingCashCount} deliveries</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Collected
            </div>
            <p className="text-lg font-bold text-emerald-600">
              Rs {stats.collectedCashAmount.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Verified today</p>
          </CardContent>
        </Card>
        
        <Card className={stats.pendingStockCount > 0 ? 'border-violet-300 bg-violet-50/50 dark:bg-violet-950/20' : ''}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <BoxesIcon className="w-3.5 h-3.5" />
              Pending Returns
            </div>
            <p className="text-lg font-bold text-violet-600">{stats.pendingStockCount}</p>
            <p className="text-xs text-muted-foreground">Need verification</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Package className="w-3.5 h-3.5" />
              Stock Out
            </div>
            <p className="text-lg font-bold">{dateStockOut.length}</p>
            <p className="text-xs text-muted-foreground">Contractors given</p>
          </CardContent>
        </Card>
      </div>
      
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-4 h-auto">
          <TabsTrigger value="overview" className="text-xs py-2 px-1">
            Overview
          </TabsTrigger>
          <TabsTrigger value="cash" className="text-xs py-2 px-1 relative">
            Cash
            {stats.pendingCashCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {stats.pendingCashCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="returns" className="text-xs py-2 px-1 relative">
            Returns
            {stats.pendingStockCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-violet-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                {stats.pendingStockCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stock" className="text-xs py-2 px-1">
            Stock Out
          </TabsTrigger>
        </TabsList>
        
        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Contractors</CardTitle>
              <CardDescription className="text-xs">Status for {formatDateDisplay(selectedDate)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {contractors.map(contractor => {
                const contractorDeliveries = dateDeliveries.filter(d => d.contractor_id === contractor.id)
                const pendingCash = contractorDeliveries.filter(d => !d.cash_collected && Number(d.payment_cash) > 0)
                const pendingCashAmt = pendingCash.reduce((sum, d) => sum + Number(d.payment_cash || 0), 0)
                const hasStockOut = dateStockOut.some(t => t.contractor_id === contractor.id)
                const hasStockIn = dateStockIn.some(t => t.contractor_id === contractor.id)
                
                return (
                  <div key={contractor.id} className="p-3 rounded-lg border bg-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                          {contractor.name?.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{contractor.name}</p>
                          <p className="text-xs text-muted-foreground">{contractor.riders?.length || 0} riders</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5">
                      {pendingCashAmt > 0 ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                          <Banknote className="w-3 h-3 mr-1" />
                          Rs {pendingCashAmt.toLocaleString()}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                          <Check className="w-3 h-3 mr-1" />
                          Cash OK
                        </Badge>
                      )}
                      
                      <Badge variant="outline" className={`text-xs ${hasStockOut ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}`}>
                        <Package className="w-3 h-3 mr-1" />
                        {hasStockOut ? 'Stock Given' : 'No Stock'}
                      </Badge>
                      
                      {hasStockIn && (
                        <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-xs">
                          <BoxesIcon className="w-3 h-3 mr-1" />
                          Returned
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
          
          {/* Pending Deductions */}
          {pendingDeductions.length > 0 && (
            <Card className="border-amber-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Pending Deductions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingDeductions.slice(0, 5).map(d => (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded bg-amber-50 dark:bg-amber-950/30">
                    <div>
                      <p className="text-sm font-medium">{d.reason}</p>
                      <p className="text-xs text-muted-foreground capitalize">{d.deduction_type.replace('_', ' ')}</p>
                    </div>
                    <span className="font-semibold text-amber-700">Rs {Number(d.amount).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        {/* Cash Collection Tab */}
        <TabsContent value="cash" className="mt-4 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {contractors.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Selection actions */}
          {pendingCashDeliveries.length > 0 && (
            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <Button variant="ghost" size="sm" onClick={() => selectAll(pendingCashDeliveries)}>
                {selectedDeliveries.size === pendingCashDeliveries.length ? 'Deselect All' : 'Select All'}
              </Button>
              {selectedDeliveries.size > 0 && (
                <Button size="sm" onClick={markCashCollected} disabled={collecting} className="bg-emerald-600 hover:bg-emerald-700">
                  <Check className="w-4 h-4 mr-1" />
                  Collect ({selectedDeliveries.size})
                </Button>
              )}
            </div>
          )}
          
          {/* Delivery list */}
          <div className="space-y-2">
            {pendingCashDeliveries.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>All cash collected for this date</p>
                </CardContent>
              </Card>
            ) : (
              pendingCashDeliveries.map(d => (
                <Card 
                  key={d.id} 
                  className={`cursor-pointer transition-colors ${selectedDeliveries.has(d.id) ? 'border-primary bg-primary/5' : ''}`}
                  onClick={() => toggleDelivery(d.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox 
                        checked={selectedDeliveries.has(d.id)} 
                        onCheckedChange={() => toggleDelivery(d.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm truncate">{d.customer_name}</p>
                          <span className="font-bold text-emerald-600">Rs {Number(d.payment_cash).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {d.index_no && <span>#{d.index_no}</span>}
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {d.rider_name}
                          </span>
                          <span>{d.contractor_name}</span>
                        </div>
                        {d.location && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {d.location}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
        
        {/* Returns/Stock Verification Tab */}
        <TabsContent value="returns" className="mt-4 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {contractors.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Selection actions */}
          {pendingStockDeliveries.length > 0 && (
            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <Button variant="ghost" size="sm" onClick={() => selectAll(pendingStockDeliveries)}>
                {selectedDeliveries.size === pendingStockDeliveries.length ? 'Deselect All' : 'Select All'}
              </Button>
              {selectedDeliveries.size > 0 && (
                <Button size="sm" onClick={markStockVerified} disabled={collecting} className="bg-violet-600 hover:bg-violet-700">
                  <Check className="w-4 h-4 mr-1" />
                  Verify ({selectedDeliveries.size})
                </Button>
              )}
            </div>
          )}
          
          {/* Returns list */}
          <div className="space-y-2">
            {pendingStockDeliveries.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>All returns verified for this date</p>
                </CardContent>
              </Card>
            ) : (
              pendingStockDeliveries.map(d => (
                <Card 
                  key={d.id} 
                  className={`cursor-pointer transition-colors ${selectedDeliveries.has(d.id) ? 'border-primary bg-primary/5' : ''}`}
                  onClick={() => toggleDelivery(d.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox 
                        checked={selectedDeliveries.has(d.id)} 
                        onCheckedChange={() => toggleDelivery(d.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-sm truncate">{d.customer_name}</p>
                          {d.index_no && <span className="text-xs text-muted-foreground">#{d.index_no}</span>}
                        </div>
                        <div className="p-2 rounded bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 mb-2">
                          <p className="text-xs font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1">
                            <BoxesIcon className="w-3 h-3" />
                            Return: {d.return_product}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {d.rider_name}
                          </span>
                          <span>{d.contractor_name}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
        
        {/* Stock Out Tab */}
        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Contractor Selection */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Select Contractor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
                {contractors.map(c => {
                  const hasToday = dateStockOut.some(t => t.contractor_id === c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedContractor(c.id)
                        setStockItems({})
                        setStockNotes('')
                      }}
                      className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                        selectedContractor === c.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{c.name}</span>
                        {hasToday && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
                            <Check className="w-3 h-3 mr-1" />
                            Done
                          </Badge>
                        )}
                      </div>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
            
            {/* Products */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Products</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
                {!selectedContractor ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Select a contractor first</p>
                ) : (
                  products.map(p => {
                    const qty = stockItems[p.id] || 0
                    return (
                      <div key={p.id} className={`p-2.5 rounded-lg border ${qty > 0 ? 'border-primary bg-primary/5' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{p.name}</p>
                            <p className="text-xs text-muted-foreground">Rs {Number(p.price).toLocaleString()}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateStockQty(p.id, qty - 1)}>
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="w-8 text-center font-medium">{qty}</span>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => addStockItem(p.id)}>
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>
          
          {/* Stock Summary */}
          {selectedContractor && Object.keys(stockItems).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>Total Items:</span>
                  <span className="font-semibold">{totalStockItems}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Value:</span>
                  <span className="font-semibold">Rs {totalStockValue.toLocaleString()}</span>
                </div>
                <Textarea
                  placeholder="Notes (optional)"
                  value={stockNotes}
                  onChange={(e) => setStockNotes(e.target.value)}
                  rows={2}
                />
                <Button className="w-full" onClick={submitStockOut} disabled={savingStock}>
                  <Package className="w-4 h-4 mr-2" />
                  {savingStock ? 'Saving...' : 'Record Stock Out'}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
