'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Phone, Package, Ban, MapPin, Mail, Search, Check, ChevronLeft, Loader2, Calendar, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmsReasonPopupProps {
  open: boolean
  customerName: string
  currentProduct?: string
  currentRegion?: string
  onClose: () => void
  onConfirm: (reason: string, extraData?: { newProduct?: string; newRegion?: string; postponedDate?: string }) => void
  products?: { name: string }[]
  regions?: string[]
  loading?: boolean
}

export function CmsReasonPopup({
  open,
  customerName,
  currentProduct,
  currentRegion,
  onClose,
  onConfirm,
  products = [],
  regions = [],
  loading = false
}: CmsReasonPopupProps) {
  const [step, setStep] = useState<'reasons' | 'wrong-product' | 'change-address' | 'postponed' | 'postponed-region' | 'other'>('reasons')
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [customReason, setCustomReason] = useState('')
  const [postponedDate, setPostponedDate] = useState('')
  const [keepSameRegion, setKeepSameRegion] = useState<boolean | null>(null)

  // Reset state when popup opens/closes
  useEffect(() => {
    if (open) {
      setStep('reasons')
      setSearch('')
      setSelectedProduct(null)
      setSelectedRegion(null)
      setCustomReason('')
      setPostponedDate('')
      setKeepSameRegion(null)
    }
  }, [open])
  
  // Get valid dates for postponement (2-7 days from now, excluding Sundays)
  const validPostponeDates = useMemo(() => {
    const dates: { date: string; label: string; dayName: string }[] = []
    const today = new Date()
    
    // Start from day after tomorrow (skip tomorrow)
    for (let i = 2; i <= 8 && dates.length < 6; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      
      // Skip Sundays (0 = Sunday)
      if (d.getDay() === 0) continue
      
      dates.push({
        date: d.toISOString().split('T')[0],
        label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' })
      })
    }
    
    return dates
  }, [])

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
    } else if (reason === 'Postponed') {
      setStep('postponed')
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

  const handlePostponedDateConfirm = () => {
    if (postponedDate) {
      // After selecting date, ask about region
      setStep('postponed-region')
    }
  }

  const handlePostponedConfirm = () => {
    if (postponedDate && keepSameRegion !== null) {
      const formattedDate = new Date(postponedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      if (keepSameRegion) {
        onConfirm(`Postponed to ${formattedDate} - Same region (${currentRegion})`, { postponedDate })
      } else if (selectedRegion) {
        onConfirm(`Postponed to ${formattedDate} - Region change: ${currentRegion} → ${selectedRegion}`, { postponedDate, newRegion: selectedRegion })
      }
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
              <button onClick={() => { 
                if (step === 'postponed-region') {
                  setStep('postponed')
                  setKeepSameRegion(null)
                  setSelectedRegion(null)
                } else {
                  setStep('reasons')
                  setSearch('')
                  setSelectedProduct(null)
                  setSelectedRegion(null)
                  setPostponedDate('')
                  setKeepSameRegion(null)
                }
              }} 
                className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <ChevronLeft className="w-4 h-4 text-white/60" />
              </button>
            )}
            <div>
              <h3 className="font-semibold text-white text-sm">
                {step === 'reasons' && 'Cannot Make Sale'}
                {step === 'wrong-product' && 'Select Correct Product'}
                {step === 'change-address' && 'Select New Region'}
                {step === 'postponed' && 'Select Postponed Date'}
                {step === 'postponed-region' && 'Same Region or Change?'}
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
            <button onClick={() => handleReasonClick('Postponed')} disabled={loading}
              className="flex items-center gap-2 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition active:scale-95 disabled:opacity-50">
              <Calendar className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Postponed</span>
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

        {/* Postponed - Date Selection */}
        {step === 'postponed' && (
          <div className="p-4 space-y-4">
            <div>
              <label className="text-[10px] text-white/30 uppercase tracking-wider block mb-2">Select Delivery Date (Next 7 days, excl. Sunday)</label>
              <div className="grid grid-cols-3 gap-2">
                {validPostponeDates.map(({ date, label, dayName }) => (
                  <button
                    key={date}
                    onClick={() => setPostponedDate(date)}
                    className={`p-3 rounded-xl border text-center transition active:scale-95 ${
                      postponedDate === date
                        ? 'bg-purple-500/20 border-purple-400/50 text-purple-400'
                        : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    <p className="text-[10px] uppercase opacity-60">{dayName}</p>
                    <p className="text-sm font-semibold">{label}</p>
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handlePostponedDateConfirm}
              disabled={!postponedDate || loading}
              className="w-full h-11 rounded-xl bg-purple-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              Continue
            </button>
          </div>
        )}

        {/* Postponed - Region Selection */}
        {step === 'postponed-region' && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 pt-3 pb-2 border-b border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wider">Postponed to</p>
              <p className="text-sm text-purple-400 font-medium mt-0.5">
                {new Date(postponedDate).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
            
            {/* Same Region or Change? */}
            {keepSameRegion === null && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-white/50 text-center mb-4">Will the client keep the same region or need a change?</p>
                <button
                  onClick={() => { setKeepSameRegion(true) }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition active:scale-[0.98]"
                >
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold">Same Region</p>
                    <p className="text-[10px] text-green-400/60">{currentRegion}</p>
                  </div>
                </button>
                <button
                  onClick={() => { setKeepSameRegion(false); setSearch('') }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition active:scale-[0.98]"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold">Change Region</p>
                    <p className="text-[10px] text-blue-400/60">Select new delivery area</p>
                  </div>
                </button>
              </div>
            )}

            {/* Same Region - Confirm */}
            {keepSameRegion === true && (
              <div className="p-4 space-y-4">
                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                  <p className="text-xs text-green-400/60 uppercase tracking-wider mb-1">Delivery Region</p>
                  <p className="text-lg font-semibold text-green-400">{currentRegion}</p>
                </div>
                <button
                  onClick={handlePostponedConfirm}
                  disabled={loading}
                  className="w-full h-11 rounded-xl bg-purple-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Confirm Postponed Delivery
                </button>
              </div>
            )}

            {/* Change Region - Select */}
            {keepSameRegion === false && (
              <>
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
                </div>
                
                <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 max-h-[35vh]">
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
                </div>
                
                <div className="px-4 py-3 border-t border-white/10 shrink-0">
                  <button
                    onClick={handlePostponedConfirm}
                    disabled={!selectedRegion || loading}
                    className="w-full h-11 rounded-xl bg-purple-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Confirm: {selectedRegion || 'Select region'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
