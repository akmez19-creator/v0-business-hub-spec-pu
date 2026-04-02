'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { v4 as uuidv4 } from 'uuid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  X,
  Settings,
  ClipboardPaste,
  Check,
  Loader2,
  Search,
  Plus,
  Minus,
  ShoppingCart,
} from 'lucide-react'

interface Product {
  id: string
  name: string
  price: string
}

interface CartItem {
  id: string
  name: string
  quantity: number
  price: number
}

interface Props {
  userId: string
  products: Product[]
  regions: string[]
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function QuickOrderPanel({ userId, products, regions, isOpen, onClose, onSuccess }: Props) {
  const supabase = createClient()
  
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  
  // Form state
  const [customerName, setCustomerName] = useState('')
  const [contact1, setContact1] = useState('')
  const [contact2, setContact2] = useState('')
  const [region, setRegion] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  
  // Product search
  const [productSearch, setProductSearch] = useState('')
  
  // Cart
  const [cart, setCart] = useState<CartItem[]>([])
  
  // Settings panel
  const [showSettings, setShowSettings] = useState(false)

  const filteredProducts = productSearch
    ? products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : products

  const filteredRegions = region
    ? regions.filter(r => r.toLowerCase().includes(region.toLowerCase()))
    : regions

  const paste = async (setter: (val: string) => void) => {
    try {
      const text = await navigator.clipboard.readText()
      setter(text.trim())
    } catch {
      alert('Allow clipboard access')
    }
  }

  const addToCart = (item: Product) => {
    const existing = cart.find(c => c.id === item.id)
    if (existing) {
      setCart(cart.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c))
    } else {
      setCart([...cart, { id: item.id, name: item.name, quantity: 1, price: parseFloat(item.price) || 0 }])
    }
  }

  const updateQty = (id: string, delta: number) => {
    setCart(cart.map(c => {
      if (c.id === id) {
        const newQty = Math.max(0, c.quantity + delta)
        return { ...c, quantity: newQty }
      }
      return c
    }).filter(c => c.quantity > 0))
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0)
  const canSubmit = customerName.trim() && contact1.trim() && region && cart.length > 0

  const resetForm = () => {
    setCustomerName('')
    setContact1('')
    setContact2('')
    setRegion('')
    setDeliveryDate(new Date().toISOString().split('T')[0])
    setNotes('')
    setCart([])
    setProductSearch('')
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    
    try {
      const productsStr = cart.map(c => `${c.name} x${c.quantity}`).join(', ')
      const replyToken = uuidv4()

      const { error } = await supabase.from('deliveries').insert({
        customer_name: customerName.trim(),
        contact_1: contact1.trim(),
        contact_2: contact2.trim() || null,
        region,
        locality: region,
        products: productsStr,
        qty: totalQty,
        amount: cartTotal,
        notes: notes.trim() || null,
        status: 'pending',
        entry_date: new Date().toISOString().split('T')[0],
        delivery_date: deliveryDate,
        reply_token: replyToken,
        reply_token_created_at: new Date().toISOString(),
        created_by: userId,
        medium: 'Marketing',
      })

      if (error) throw error

      setSuccess(true)
      setTimeout(() => {
        resetForm()
        setSuccess(false)
        onSuccess?.()
      }, 800)
    } catch (error) {
      console.error('Error:', error)
      alert('Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white">
            A
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-white">Quick Order</h2>
            <p className="text-xs text-white/70">Create orders quickly</p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {success ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center animate-in zoom-in-50">
                <Check className="w-8 h-8 text-white" />
              </div>
              <p className="text-lg font-bold text-emerald-500">Order Created!</p>
            </div>
          ) : showSettings ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-orange-500">Settings</h3>
              <p className="text-sm text-zinc-400">Settings options will be available in future updates.</p>
              <Button variant="secondary" onClick={() => setShowSettings(false)} className="w-full">
                Back to Order
              </Button>
            </div>
          ) : (
            <>
              {/* User info badge */}
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Connected
              </div>

              {/* Customer Name */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Name *</label>
                <div className="flex gap-2">
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="h-11 bg-zinc-800 border-zinc-700"
                  />
                  <Button variant="secondary" size="sm" className="h-11 px-3" onClick={() => paste(setCustomerName)}>
                    <ClipboardPaste className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Contacts */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Contact 1 *</label>
                  <div className="flex gap-1">
                    <Input
                      value={contact1}
                      onChange={(e) => setContact1(e.target.value)}
                      placeholder="Phone"
                      className="h-10 bg-zinc-800 border-zinc-700 text-sm"
                    />
                    <Button variant="secondary" size="sm" className="h-10 px-2" onClick={() => paste(setContact1)}>
                      <ClipboardPaste className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Contact 2</label>
                  <div className="flex gap-1">
                    <Input
                      value={contact2}
                      onChange={(e) => setContact2(e.target.value)}
                      placeholder="Optional"
                      className="h-10 bg-zinc-800 border-zinc-700 text-sm"
                    />
                    <Button variant="secondary" size="sm" className="h-10 px-2" onClick={() => paste(setContact2)}>
                      <ClipboardPaste className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Region + Date */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Region *</label>
                  <Input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="Select..."
                    list="regions-list"
                    className="h-10 bg-zinc-800 border-zinc-700 text-sm"
                  />
                  <datalist id="regions-list">
                    {filteredRegions.slice(0, 10).map(r => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Date</label>
                  <Input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="h-10 bg-zinc-800 border-zinc-700 text-sm"
                  />
                </div>
              </div>

              {/* Products */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Products (tap to add)</label>
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products..."
                  className="h-9 bg-zinc-800 border-zinc-700 text-sm mb-2"
                />
                <div className="grid grid-cols-3 gap-1.5 max-h-[120px] overflow-y-auto">
                  {filteredProducts.map(p => {
                    const inCart = cart.find(c => c.id === p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addToCart(p)}
                        title={`${p.name} - Rs ${p.price}`}
                        className={`relative px-2 py-1.5 rounded-lg text-xs text-left truncate transition-all ${
                          inCart
                            ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {p.name}
                        {inCart && (
                          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                            {inCart.quantity}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Cart summary */}
              {cart.length > 0 && (
                <div className="bg-zinc-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3" /> Cart
                    </span>
                    <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                      {totalQty} items
                    </span>
                  </div>
                  <div className="space-y-1 max-h-[80px] overflow-y-auto">
                    {cart.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 text-zinc-300">{item.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, -1)}
                            className="w-6 h-6 rounded bg-zinc-700 hover:bg-red-500 flex items-center justify-center"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-5 text-center font-medium">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(item.id, 1)}
                            className="w-6 h-6 rounded bg-zinc-700 hover:bg-emerald-500 flex items-center justify-center"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 pt-2 border-t border-zinc-700 font-bold">
                    <span>Total</span>
                    <span className="text-emerald-500">Rs {cartTotal.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Notes</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional..."
                  className="h-9 bg-zinc-800 border-zinc-700 text-sm"
                />
              </div>
            </>
          )}
        </div>

        {/* Submit button */}
        {!success && !showSettings && (
          <div className="p-4 border-t border-zinc-800">
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className="w-full h-12 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 font-bold"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Order'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
