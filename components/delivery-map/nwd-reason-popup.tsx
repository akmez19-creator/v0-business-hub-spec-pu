'use client'

import { useState } from 'react'
import { X, Clock, MapPin, Check, Search } from 'lucide-react'

interface NwdReasonPopupProps {
  open: boolean
  customerName: string
  currentRegion: string
  onClose: () => void
  onConfirm: (keepSameRegion: boolean, newRegion?: string) => void
  regions: string[]
  loading?: boolean
}

export function NwdReasonPopup({
  open,
  customerName,
  currentRegion,
  onClose,
  onConfirm,
  regions,
  loading = false
}: NwdReasonPopupProps) {
  const [step, setStep] = useState<'choice' | 'select-region'>('choice')
  const [selectedRegion, setSelectedRegion] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  if (!open) return null

  const filteredRegions = searchTerm
    ? regions.filter(r => r.toLowerCase().includes(searchTerm.toLowerCase()))
    : regions

  const handleKeepSameRegion = () => {
    onConfirm(true)
    resetAndClose()
  }

  const handleChangeRegion = () => {
    setStep('select-region')
  }

  const handleConfirmNewRegion = () => {
    if (selectedRegion) {
      onConfirm(false, selectedRegion)
      resetAndClose()
    }
  }

  const resetAndClose = () => {
    setStep('choice')
    setSelectedRegion('')
    setSearchTerm('')
    onClose()
  }

  return (
    <div className="absolute inset-0 z-[60] bg-black/70 flex items-end" onClick={resetAndClose}>
      <div className="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-400" />
              Next Working Day
            </h3>
            <p className="text-xs text-white/40">{customerName}</p>
          </div>
          <button onClick={resetAndClose} className="p-2 rounded-lg hover:bg-white/10 transition">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {step === 'choice' ? (
          /* Step 1: Ask about region */
          <div className="p-4 space-y-3">
            <div className="text-center py-2">
              <p className="text-sm text-white/70 mb-1">Current region:</p>
              <p className="text-lg font-semibold text-white flex items-center justify-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                {currentRegion || 'Unknown'}
              </p>
            </div>
            
            <p className="text-xs text-center text-white/50 py-2">
              Will the client keep the same delivery region for NWD?
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleKeepSameRegion}
                disabled={loading}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition active:scale-95 disabled:opacity-50"
              >
                <Check className="w-6 h-6" />
                <span className="text-xs font-bold">Keep Same Region</span>
              </button>
              
              <button
                onClick={handleChangeRegion}
                disabled={loading}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition active:scale-95 disabled:opacity-50"
              >
                <MapPin className="w-6 h-6" />
                <span className="text-xs font-bold">Change Region</span>
              </button>
            </div>
          </div>
        ) : (
          /* Step 2: Select new region */
          <div className="p-4 space-y-3">
            <button
              onClick={() => setStep('choice')}
              className="text-xs text-white/40 hover:text-white/60 flex items-center gap-1"
            >
              &larr; Back
            </button>
            
            <p className="text-sm text-white/70 text-center">Select new delivery region:</p>
            
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                placeholder="Search regions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
                autoFocus
              />
            </div>
            
            {/* Region List */}
            <div className="max-h-48 overflow-y-auto space-y-1 bg-white/5 rounded-lg p-2">
              {filteredRegions.slice(0, 50).map(region => (
                <button
                  key={region}
                  onClick={() => setSelectedRegion(region)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                    selectedRegion === region
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-white/70 hover:bg-white/10'
                  }`}
                >
                  {region}
                </button>
              ))}
              {filteredRegions.length > 50 && (
                <p className="text-xs text-white/30 text-center py-2">
                  +{filteredRegions.length - 50} more - type to search
                </p>
              )}
              {filteredRegions.length === 0 && (
                <p className="text-xs text-white/30 text-center py-4">
                  No regions found
                </p>
              )}
            </div>
            
            {/* Confirm Button */}
            <button
              onClick={handleConfirmNewRegion}
              disabled={!selectedRegion || loading}
              className="w-full py-3 rounded-xl bg-cyan-500/20 text-cyan-400 text-sm font-bold border border-cyan-500/30 hover:bg-cyan-500/30 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : `Confirm NWD to ${selectedRegion || '...'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
