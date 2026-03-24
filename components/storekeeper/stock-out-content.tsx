'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Package, Plus, Minus, Trash2, Check, Building2 } from 'lucide-react'
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

interface StockOutContentProps {
  contractors: Contractor[]
  products: Product[]
  todayTransactions: Array<{
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

export function StockOutContent({ contractors, products, todayTransactions, userId, today }: StockOutContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedContractor = searchParams.get('contractor')
  
  const [selectedContractor, setSelectedContractor] = useState<string | null>(preselectedContractor)
  const [items, setItems] = useState<StockItem[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  
  const contractor = contractors.find(c => c.id === selectedContractor)
  const contractorTodayTx = todayTransactions.find(t => t.contractor_id === selectedContractor)
  
  function addItem(productId: string) {
    const existing = items.find(i => i.productId === productId)
    if (existing) {
      setItems(items.map(i => 
        i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
      ))
    } else {
      setItems([...items, { productId, quantity: 1 }])
    }
  }
  
  function updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setItems(items.filter(i => i.productId !== productId))
    } else {
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
        transaction_type: 'stock_out',
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
    
    setSaving(false)
    setItems([])
    setNotes('')
    setSelectedContractor(null)
    router.refresh()
  }
  
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0)
  const totalValue = items.reduce((sum, i) => {
    const product = products.find(p => p.id === i.productId)
    return sum + (i.quantity * (product?.price || 0))
  }, 0)
  
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Contractor List */}
      <Card>
        <CardHeader>
          <CardTitle>Select Contractor</CardTitle>
          <CardDescription>Choose a contractor to give stock to</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {contractors.map((c) => {
            const hasTodayTx = todayTransactions.some(t => t.contractor_id === c.id)
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
                    <span className="font-medium text-sm">{c.name}</span>
                  </div>
                  {hasTodayTx && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
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
      
      {/* Product Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>Click to add products</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
          {!contractor ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Building2 className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">Select a contractor first</p>
            </div>
          ) : (
            products.map((product) => {
              const inCart = items.find(i => i.productId === product.id)
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addItem(product.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    inCart ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Rs {Number(product.price).toLocaleString()}
                        {product.sku && ` · ${product.sku}`}
                      </p>
                    </div>
                    {inCart && (
                      <Badge className="bg-primary text-primary-foreground">
                        {inCart.quantity}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
      
      {/* Cart / Summary */}
      <Card>
        <CardHeader>
          <CardTitle>
            Stock Out Summary
          </CardTitle>
          <CardDescription>
            {contractor ? `For ${contractor.name}` : 'Select contractor and add products'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Package className="w-10 h-10 mb-2 opacity-50" />
              <p className="text-sm">No products added yet</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Items List */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {items.map((item) => {
                  const product = products.find(p => p.id === item.productId)
                  return (
                    <div key={item.productId} className="flex items-center justify-between p-2 rounded bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{product?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Rs {(item.quantity * (product?.price || 0)).toLocaleString()}
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
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateQuantity(item.productId, item.quantity + 1)}
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
              
              {/* Totals */}
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="flex justify-between text-sm">
                  <span>Total Items:</span>
                  <span className="font-medium">{totalItems}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span>Total Value:</span>
                  <span className="font-medium">Rs {totalValue.toLocaleString()}</span>
                </div>
              </div>
              
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
              <Button type="submit" className="w-full" disabled={saving || items.length === 0}>
                <Package className="w-4 h-4 mr-2" />
                {saving ? 'Recording...' : 'Record Stock Out'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
