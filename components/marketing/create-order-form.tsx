'use client'

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { 
  ShoppingCart, 
  Plus,
  Minus,
  Check,
  Loader2,
  Send,
  ClipboardPaste,
} from 'lucide-react'

interface Product {
  id: string
  name: string
  price: string
  is_active: boolean
}

interface Client {
  id: string
  name: string
  phone: string | null
  address: string | null
  city: string | null
}

interface Props {
  userId: string
  products: Product[]
  recentClients: Client[]
  regions: string[]
}

interface CartItem {
  id: string
  name: string
  quantity: number
  price: number
}

export function CreateOrderForm({ userId, products, recentClients, regions }: Props) {
  const router = useRouter()
  const supabase = createClient()
  
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  
  // Customer info
  const [customerName, setCustomerName] = useState('')
  const [contact1, setContact1] = useState('')
  const [contact2, setContact2] = useState('')
  const [region, setRegion] = useState('')
  const [regionSearch, setRegionSearch] = useState('')
  const [showRegions, setShowRegions] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  
  // Cart
  const [cart, setCart] = useState<CartItem[]>([])

  // Paste from clipboard
  const paste = async (setter: (val: string) => void) => {
    try {
      const text = await navigator.clipboard.readText()
      setter(text.trim())
    } catch {
      alert('Allow clipboard access')
    }
  }

  // Region filter
  const filteredRegions = regionSearch
    ? regions.filter(r => r.toLowerCase().includes(regionSearch.toLowerCase()))
    : regions

  const selectRegion = (r: string) => {
    setRegion(r)
    setRegionSearch(r)
    setShowRegions(false)
  }

  const addToCart = (item: Product) => {
    const existing = cart.find(c => c.id === item.id)
    if (existing) {
      setCart(cart.map(c => 
        c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
      ))
    } else {
      setCart([...cart, {
        id: item.id,
        name: item.name,
        quantity: 1,
        price: parseFloat(item.price) || 0,
      }])
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

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    
    try {
      const products = cart.map(c => `${c.name} x${c.quantity}`).join(', ')
      
      // Generate reply token for client link
      const replyToken = uuidv4()

      const { error } = await supabase.from('deliveries').insert({
        customer_name: customerName.trim(),
        contact_1: contact1.trim(),
        contact_2: contact2.trim() || null,
        region,
        locality: region, // Also set locality for compatibility
        products,
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
        setCustomerName('')
        setContact1('')
        setContact2('')
        setRegion('')
        setRegionSearch('')
        setDeliveryDate(new Date().toISOString().split('T')[0])
        setNotes('')
        setCart([])
        setSuccess(false)
      }, 600)
      
      router.refresh()
    } catch (error) {
      console.error('Error:', error)
      alert('Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+Enter to submit
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSubmit && !saving) {
        handleSubmit()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [canSubmit, saving])

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center animate-in zoom-in-50 duration-300">
          <Check className="w-10 h-10 text-white" />
        </div>
        <p className="text-xl font-bold text-emerald-500">Order Created!</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Customer Info Card */}
      <div className="bg-card border rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-4">Customer Details</h2>
        
        <div className="space-y-4">
          {/* Customer Name */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Customer Name *</label>
            <div className="flex gap-2">
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Paste or type customer name"
                className="h-14 text-lg font-medium"
                autoFocus
              />
              <Button 
                type="button"
                variant="secondary"
                className="h-14 px-5 gap-2 font-semibold"
                onClick={() => paste(setCustomerName)}
              >
                <ClipboardPaste className="w-5 h-5" />
                Paste
              </Button>
            </div>
          </div>

          {/* Contacts - Side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contact #1 *</label>
              <div className="flex gap-2">
                <Input
                  value={contact1}
                  onChange={(e) => setContact1(e.target.value)}
                  placeholder="Primary phone"
                  className="h-14 text-lg"
                />
                <Button 
                  type="button"
                  variant="secondary"
                  className="h-14 px-5 gap-2 font-semibold"
                  onClick={() => paste(setContact1)}
                >
                  <ClipboardPaste className="w-5 h-5" />
                  Paste
                </Button>
              </div>
            </div>
            
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contact #2</label>
              <div className="flex gap-2">
                <Input
                  value={contact2}
                  onChange={(e) => setContact2(e.target.value)}
                  placeholder="Secondary phone (optional)"
                  className="h-14 text-lg"
                />
                <Button 
                  type="button"
                  variant="secondary"
                  className="h-14 px-5 gap-2 font-semibold"
                  onClick={() => paste(setContact2)}
                >
                  <ClipboardPaste className="w-5 h-5" />
                  Paste
                </Button>
              </div>
            </div>
          </div>

          {/* Region + Delivery Date + Notes */}
          <div className="grid grid-cols-3 gap-4">
            <div className="relative">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Region *</label>
              <Input
                value={regionSearch}
                onChange={(e) => {
                  setRegionSearch(e.target.value)
                  setRegion('')
                  setShowRegions(true)
                }}
                onFocus={() => setShowRegions(true)}
                onBlur={() => setTimeout(() => setShowRegions(false), 150)}
                placeholder="Type to search..."
                className={`h-14 text-lg ${region ? 'border-emerald-500 bg-emerald-500/5' : ''}`}
              />
              {showRegions && filteredRegions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border-2 border-violet-500/30 rounded-xl shadow-2xl max-h-64 overflow-y-auto">
                  {filteredRegions.map(r => (
                    <button
                      key={r}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectRegion(r)
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-violet-500 hover:text-white font-medium transition-colors border-b border-border/20 last:border-0"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Delivery Date *</label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="h-14 text-lg"
              />
            </div>
            
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional delivery notes"
                className="h-14 text-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Products + Cart */}
      <div className="grid grid-cols-3 gap-4">
        {/* Products */}
        <div className="col-span-2 bg-card border rounded-2xl p-6">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-4">
            Tap Products to Add
          </h2>
          
          <div className="flex flex-wrap gap-3 max-h-[400px] overflow-y-auto">
            {products.map(item => {
              const inCart = cart.find(c => c.id === item.id)
              
              return (
                <button 
                  key={item.id}
                  type="button"
                  onClick={() => addToCart(item)}
                  className={`
                    relative px-6 py-4 rounded-2xl font-semibold text-base transition-all duration-150
                    ${inCart 
                      ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-xl shadow-violet-500/30 scale-105' 
                      : 'bg-muted hover:bg-muted/70 hover:scale-102'
                    }
                    cursor-pointer active:scale-95
                  `}
                >
                  <span className="block">{item.name}</span>
                  <span className="text-sm opacity-80">Rs {item.price}</span>
                  {inCart && (
                    <span className="absolute -top-3 -right-3 w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-lg border-2 border-background">
                      {inCart.quantity}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Cart */}
        <div className="bg-card border rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Cart
            </h2>
            {totalQty > 0 && (
              <span className="bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {totalQty} items
              </span>
            )}
          </div>

          <div className="flex-1 min-h-[120px]">
            {cart.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No products added</p>
            ) : (
              <div className="space-y-2">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between bg-muted rounded-xl px-3 py-2">
                    <span className="font-medium text-sm truncate flex-1">{item.name}</span>
                    <div className="flex items-center gap-2">
                      <button 
                        type="button"
                        onClick={() => updateQty(item.id, -1)}
                        className="w-7 h-7 rounded-lg bg-background hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-6 text-center font-bold">{item.quantity}</span>
                      <button 
                        type="button"
                        onClick={() => updateQty(item.id, 1)}
                        className="w-7 h-7 rounded-lg bg-background hover:bg-emerald-500 hover:text-white flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Total */}
          {cart.length > 0 && (
            <div className="border-t pt-4 mt-4">
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-emerald-500">Rs {cartTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Submit */}
          <Button 
            type="button"
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            size="lg"
            className="w-full mt-4 h-14 text-lg font-bold bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
          >
            {saving ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                CREATE ORDER
              </>
            )}
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-2">Press Ctrl+Enter</p>
        </div>
      </div>
    </div>
  )
}
