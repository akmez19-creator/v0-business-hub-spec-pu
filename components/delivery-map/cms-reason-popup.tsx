'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Phone, Package, Ban, MapPin, Mail, Search, Check, ChevronLeft, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmsReasonPopupProps {
  open: boolean
  customerName: string
  currentProduct?: string
  onClose: () => void
  onConfirm: (reason: string, extraData?: { newProduct?: string; newRegion?: string }) => void
  products?: { name: string }[]
  regions?: string[]
  loading?: boolean
}

export function CmsReasonPopup({
  open,
  customerName,
  currentProduct,
  onClose,
  onConfirm,
  products = [],
  regions = [],
  loading = false
}: CmsReasonPopupProps) {
  const [step, setStep] = useState<'reasons' | 'wrong-product' | 'change-address' | 'other'>('reasons')
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [customReason, setCustomReason] = useState('')

  // Reset state when popup opens/closes
  useEffect(() => {
    if (open) {
      setStep('reasons')
      setSearch('')
      setSelectedProduct(null)
      setSelectedRegion(null)
      setCustomReason('')
    }
  }, [open])

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products.slice(0, 50) // Show first 50 if no search
    const q = search.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 50)
  }, [products, search])

  // Filter regions by search
  const filteredRegions = useMemo(() => {
    if (!search.trim()) return regions.slice(0, 50)
    const q = search.toLowerCase()
    return regions.filter(r => r.toLowerCase().includes(q)).slice(0, 50)
  }, [regions, search])

  const handleReasonClick = (reason: string) => {
    if (reason === 'Wrong Product') {
      setStep('wrong-product')
      setSearch('')
    } else if (reason === 'Change of Address') {
      setStep('change-address')
      setSearch('')
    } else if (reason === 'Other') {
      setStep('other')
    } else {
      onConfirm(reason)
    }
  }

  const handleProductConfirm = () => {
    if (selectedProduct) {
      onConfirm('Wrong Product', { newProduct: selectedProduct })
    }
  }

  const handleAddressConfirm = () => {
    if (selectedRegion) {
      onConfirm('Change of Address', { newRegion: selectedRegion })
    }
  }

  const handleOtherConfirm = () => {
    if (customReason.trim()) {
      onConfirm(customReason.trim())
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-[60] bg-black/70 flex items-end" onClick={onClose}>
      <div className="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl overflow-hidden max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            {step !== 'reasons' && (
              <button onClick={() => { setStep('reasons'); setSearch(''); setSelectedProduct(null); setSelectedRegion(null) }} 
                className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <ChevronLeft className="w-4 h-4 text-white/60" />
              </button>
            )}
            <div>
              <h3 className="font-semibold text-white text-sm">
                {step === 'reasons' && 'Cannot Make Sale'}
                {step === 'wrong-product' && 'Select Correct Product'}
                {step === 'change-address' && 'Select New Region'}
                {step === 'other' && 'Enter Reason'}
              </h3>
              <p className="text-xs text-white/40">{customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 transition">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {/* Reasons Grid */}
        {step === 'reasons' && (
          <div className="p-4 grid grid-cols-2 gap-2">
            <button onClick={() => handleReasonClick('Wrong Number')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95 disabled:opacity-50">
              <Phone className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Wrong Number</span>
            </button>
            <button onClick={() => handleReasonClick('Wrong Product')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition active:scale-95 disabled:opacity-50">
              <Package className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Wrong Product</span>
            </button>
            <button onClick={() => handleReasonClick('Always No Ans')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 transition active:scale-95 disabled:opacity-50">
              <Phone className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Always No Ans</span>
            </button>
            <button onClick={() => handleReasonClick('Client Refused')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95 disabled:opacity-50">
              <Ban className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Client Refused</span>
            </button>
            <button onClick={() => handleReasonClick('Change of Address')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition active:scale-95 disabled:opacity-50">
              <MapPin className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Change of Address</span>
            </button>
            <button onClick={() => handleReasonClick('Cancelled Order')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95 disabled:opacity-50">
              <X className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Cancelled Order</span>
            </button>
            <button onClick={() => handleReasonClick('Other')} disabled={loading}
              className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/40 text-xs font-bold hover:text-white hover:border-white/20 transition active:scale-95 disabled:opacity-50">
              <Mail className="w-3.5 h-3.5" /> Other Reason
            </button>
          </div>
        )}

        {/* Wrong Product Selection */}
        {step === 'wrong-product' && (
          <div className="flex flex-col flex-1 min-h-0">
            {currentProduct && (
              <div className="px-4 pt-3 pb-2 border-b border-white/5">
                <p className="text-[10px] text-white/30 uppercase tracking-wider">Current Product</p>
                <p className="text-sm text-amber-400 font-medium mt-0.5">{currentProduct}</p>
              </div>
            )}
            
            {/* Search */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search products..."
                  className="w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/50"
                  autoFocus
                />
              </div>
              <p className="text-[10px] text-white/30 mt-2">
                {products.length} products available • Showing {filteredProducts.length}
              </p>
            </div>
            
            {/* Product List */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
              {filteredProducts.map(p => (
                <button
                  key={p.name}
                  onClick={() => setSelectedProduct(p.name)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition",
                    selectedProduct === p.name
                      ? "bg-amber-500/20 border border-amber-400/30"
                      : "bg-white/3 border border-transparent hover:bg-white/5"
                  )}
                >
                  <span className="text-sm text-white/80 truncate">{p.name}</span>
                  {selectedProduct === p.name && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <p className="text-center text-white/30 text-sm py-6">No products found</p>
              )}
            </div>
            
            {/* Confirm Button */}
            <div className="px-4 py-3 border-t border-white/10 shrink-0">
              <button
                onClick={handleProductConfirm}
                disabled={!selectedProduct || loading}
                className="w-full h-11 rounded-xl bg-amber-500 text-black text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm: {selectedProduct || 'Select a product'}
              </button>
            </div>
          </div>
        )}

        {/* Change of Address Selection */}
        {step === 'change-address' && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Search */}
            <div className="px-4 py-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search regions..."
                  className="w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-400/50"
                  autoFocus
                />
              </div>
              <p className="text-[10px] text-white/30 mt-2">
                {regions.length} regions available • Showing {filteredRegions.length}
              </p>
            </div>
            
            {/* Region List */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 max-h-[40vh]">
              {filteredRegions.map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(r)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition",
                    selectedRegion === r
                      ? "bg-blue-500/20 border border-blue-400/30"
                      : "bg-white/3 border border-transparent hover:bg-white/5"
                  )}
                >
                  <span className="text-sm text-white/80">{r}</span>
                  {selectedRegion === r && <Check className="w-4 h-4 text-blue-400 shrink-0" />}
                </button>
              ))}
              {filteredRegions.length === 0 && (
                <p className="text-center text-white/30 text-sm py-6">No regions found</p>
              )}
            </div>
            
            {/* Confirm Button */}
            <div className="px-4 py-3 border-t border-white/10 shrink-0">
              <button
                onClick={handleAddressConfirm}
                disabled={!selectedRegion || loading}
                className="w-full h-11 rounded-xl bg-blue-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                New Region: {selectedRegion || 'Select a region'}
              </button>
            </div>
          </div>
        )}

        {/* Other Reason */}
        {step === 'other' && (
          <div className="p-4 space-y-4">
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Enter CMS Reason</label>
              <input
                type="text"
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                placeholder="Type the reason..."
                className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                autoFocus
              />
            </div>
            <button
              onClick={handleOtherConfirm}
              disabled={!customReason.trim() || loading}
              className="w-full h-11 rounded-xl bg-white/10 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition hover:bg-white/15"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
