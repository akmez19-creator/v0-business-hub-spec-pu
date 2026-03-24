'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { BoxesIcon, Plus, Minus, Trash2, Check, Building2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Product {
  id: string
  name: string
  sku: string | null
  price: number
  image_url: string | null
}

interface Contractor {
  id: string
  name: string
  phone: string | null
}

interface StockItem {
  productId: string
  quantity: number
}

interface StockInContentProps {
  contractors: Contractor[]
  products: Product[]
  stockGivenByContractor: Record<string, Record<string, number>>
  todayStockIn: Array<{
    id: string
    contractor_id: string
    notes: string | null
    stock_transaction_items: Array<{
      product_id: string
      quantity: number
    }>
  }>
  userId: string
  today: string
}

export function StockInContent({ 
  contractors, 
  products, 
  stockGivenByContractor, 
  todayStockIn,
  userId, 
  today 
}: StockInContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedContractor = searchParams.get('contractor')
  
  const [selectedContractor, setSelectedContractor] = useState<string | null>(preselectedContractor)
  const [items, setItems] = useState<StockItem[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  
  const contractor = contractors.find(c => c.id === selectedContractor)
  const stockGiven = selectedContractor ? stockGivenByContractor[selectedContractor] || {} : {}
  const hasStockIn = todayStockIn.some(t => t.contractor_id === selectedContractor)
  
  function addItem(productId: string) {
    const existing = items.find(i => i.productId === productId)
    const maxQty = stockGiven[productId] || 0
    
    if (existing) {
      if (existing.quantity < maxQty) {
        setItems(items.map(i => 
          i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
        ))
      }
    } else {
      setItems([...items, { productId, quantity: 1 }])
    }
  }
  
  function updateQuantity(productId: string, quantity: number) {
    const maxQty = stockGiven[productId] || 0
    if (quantity <= 0) {
      setItems(items.filter(i => i.productId !== productId))
    } else if (quantity <= maxQty) {
      setItems(items.map(i => 
        i.productId === productId ? { ...i, quantity } : i
      ))
    }
  }
  
  function removeItem(productId: string) {
    setItems(items.filter(i => i.productId !== productId))
  }
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedContractor || items.length === 0) return
    
    setSaving(true)
    const supabase = createClient()
    
    // Create stock transaction
    const { data: transaction, error: txError } = await supabase
      .from('stock_transactions')
      .insert({
        contractor_id: selectedContractor,
        transaction_type: 'stock_in',
        processed_by: userId,
        transaction_date: today,
        notes,
      })
      .select()
      .single()
    
    if (txError || !transaction) {
      console.error('Error creating transaction:', txError)
      setSaving(false)
      return
    }
    
    // Create transaction items
    const itemsToInsert = items.map(item => {
      const product = products.find(p => p.id === item.productId)
      return {
        transaction_id: transaction.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: product?.price || 0,
      }
    })
    
    await supabase
      .from('stock_transaction_items')
      .insert(itemsToInsert)
    
    // Check for missing stock and create deductions
    for (const [productId, givenQty] of Object.entries(stockGiven)) {
      const returnedItem = items.find(i => i.productId === productId)
      const returnedQty = returnedItem?.quantity || 0
      const missingQty = givenQty - returnedQty
      
      if (missingQty > 0) {
        const product = products.find(p => p.id === productId)
        const missingValue = missingQty * (product?.price || 0)
        
        await supabase
          .from('deductions')
          .insert({
            deduction_type: 'stock_missing',
            target_type: 'contractor',
            target_id: selectedContractor,
            amount: missingValue,
            reason: `Missing stock: ${missingQty}x ${product?.name} (Rs ${missingValue.toLocaleString()})`,
            status: 'pending',
            created_by: userId,
          })
      }
    }
    
    setSaving(false)
    setItems([])
    setNotes('')
    setSelectedContractor(null)
    router.refresh()
  }
  
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalGiven = Object.values(stockGiven).reduce((sum, qty) => sum + qty, 0)
  const missingCount = totalGiven - totalItems
  
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Contractor List */}
      <Card>
        <CardHeader>
          <CardTitle>Select Contractor</CardTitle>
          <CardDescription>Choose a contractor to receive stock from</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {contractors.map((c) => {
            const hasGiven = Object.keys(stockGivenByContractor[c.id] || {}).length > 0
            const hasReturned = todayStockIn.some(t => t.contractor_id === c.id)
            
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedContractor(c.id)
                  setItems([])
                  setNotes('')
                }}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedContractor === c.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                      {c.name?.charAt(0).toUpperCase() || 'C'}
                    </div>
                    <div>
                      <span className="font-medium text-sm">{c.name}</span>
                      {hasGiven && !hasReturned && (
                        <p className="text-xs text-amber-600">
                          {Object.values(stockGivenByContractor[c.id] || {}).reduce((a, b) => a + b, 0)} items to return
                        </p>
                      )}
                    </div>
                  </div>
                  {hasReturned ? (
                    <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-xs">
                      <Check className="w-3 h-3 mr-1" />
                      Done
                    </Badge>
                  ) : hasGiven ? (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                      Pending
                    </Badge>
                  ) : null}
                </div>
              </button>
            )
          })}
        </CardContent>
      </Card>
      
      {/* Product Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Products Given Today</CardTitle>
          <CardDescription>Click to mark as returned</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {!contractor ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Building2 className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">Select a contractor first</p>
            </div>
          ) : Object.keys(stockGiven).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <BoxesIcon className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">No stock given to this contractor today</p>
            </div>
          ) : (
            Object.entries(stockGiven).map(([productId, givenQty]) => {
              const product = products.find(p => p.id === productId)
              const inCart = items.find(i => i.productId === productId)
              const missing = givenQty - (inCart?.quantity || 0)
              
              return (
                <button
                  key={productId}
                  type="button"
                  onClick={() => addItem(productId)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    inCart ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{product?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Given: {givenQty} · Rs {Number(product?.price || 0).toLocaleString()} each
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {inCart && (
                        <Badge className="bg-primary text-primary-foreground">
                          {inCart.quantity} returned
                        </Badge>
                      )}
                      {missing > 0 && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {missing} missing
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
      
      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Return Summary</CardTitle>
          <CardDescription>
            {contractor ? `From ${contractor.name}` : 'Select contractor and mark returned items'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 && Object.keys(stockGiven).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <BoxesIcon className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">No items to return</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Items List */}
              {items.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {items.map((item) => {
                    const product = products.find(p => p.id === item.productId)
                    const maxQty = stockGiven[item.productId] || 0
                    return (
                      <div key={item.productId} className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{product?.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Max: {maxQty}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-center text-sm"
                            min="1"
                            max={maxQty}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                            disabled={item.quantity >= maxQty}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeItem(item.productId)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              
              {/* Summary Stats */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Given Today:</span>
                  <span className="font-medium">{totalGiven} items</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Returned:</span>
                  <span className="font-medium text-emerald-600">{totalItems} items</span>
                </div>
                {missingCount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      Missing:
                    </span>
                    <span className="font-medium text-amber-600">{missingCount} items</span>
                  </div>
                )}
              </div>
              
              {missingCount > 0 && (
                <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                  Missing items will be recorded as deductions
                </div>
              )}
              
              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Any notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
              
              {/* Submit */}
              <Button 
                type="submit" 
                className="w-full" 
                disabled={saving || (items.length === 0 && Object.keys(stockGiven).length === 0)}
              >
                <BoxesIcon className="w-4 h-4 mr-2" />
                {saving ? 'Recording...' : 'Record Stock Return'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
