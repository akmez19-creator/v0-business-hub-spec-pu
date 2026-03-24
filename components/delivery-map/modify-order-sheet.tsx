'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Package, Plus, ChevronDown, ChevronUp, AlertTriangle, Check, Loader2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAvailableProducts, modifyOrder } from '@/lib/modification-actions'

interface StockSource {
  deliveryId: string
  customerName: string
  status: string
  locality: string | null
  qty: number
  unitPrice: number
  isFree: boolean
}

interface StockProduct {
  productName: string
  unitPrice: number
  totalReceived: number
  availableQty: number
  freeQty: number
  activeClientCount: number
  sources: StockSource[]
}

interface ModifyOrderSheetProps {
  open: boolean
  onClose: () => void
  deliveryId: string
  customerName: string
  currentProducts: string
  currentAmount: number
  onModified?: (result: { newAmount: number; newQty: number; affectedClient?: { deliveryId: string; name: string; markedNwd: boolean; remainingQty: number } | null }) => void
}

export function ModifyOrderSheet({
  open, onClose, deliveryId, customerName, currentProducts, currentAmount, onModified
}: ModifyOrderSheetProps) {
  const [stockProducts, setStockProducts] = useState<StockProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [affectedInfo, setAffectedInfo] = useState<{ name: string; markedNwd: boolean; remainingQty: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Selection state
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<StockSource | null>(null)
  const [selectedQty, setSelectedQty] = useState(1)
  const [selectedPrice, setSelectedPrice] = useState('')
  const [selectedNotes, setSelectedNotes] = useState('')

  // Confirmation step for active clients
  const [confirmStep, setConfirmStep] = useState(false)

  useEffect(() => {
    if (!open || !deliveryId) return
    setLoading(true)
    setError(null)
    setSuccess(false)
    setExpandedProduct(null)
    setSelectedSource(null)
    setConfirmStep(false)
    getAvailableProducts(deliveryId).then(res => {
      if (res.error) setError(res.error)
      setStockProducts(res.stockProducts || [])
      setLoading(false)
    })
  }, [open, deliveryId])

  const resetForm = useCallback(() => {
    setExpandedProduct(null)
    setSelectedSource(null)
    setSelectedQty(1)
    setSelectedPrice('')
    setSelectedNotes('')
    setError(null)
    setConfirmStep(false)
  }, [])

  const selectSource = (src: StockSource) => {
    setSelectedSource(src)
    setSelectedQty(1)
    setSelectedPrice(String(src.unitPrice))
    setSelectedNotes('')
    setConfirmStep(false)
  }

  // For active clients: first click shows confirm step
  const handleActiveSelect = (src: StockSource) => {
    if (selectedSource === src) {
      setSelectedSource(null)
      setConfirmStep(false)
    } else {
      selectSource(src)
    }
  }

  const handleSubmit = async () => {
    if (!selectedSource) return
    const product = stockProducts.find(p => p.sources.includes(selectedSource))
    if (!product) return

    // For active clients, require confirm step first
    if (!selectedSource.isFree && !confirmStep) {
      setConfirmStep(true)
      return
    }

    setSubmitting(true)
    setError(null)

    const reason = selectedSource.isFree
      ? (selectedSource.status === 'nwd' ? 'nwd_available' : 'cms_available')
      : 'active_transfer'

    const price = parseFloat(selectedPrice || '0')
    if (price <= 0) { setError('Enter a valid price'); setSubmitting(false); return }

    const result = await modifyOrder({
      targetDeliveryId: deliveryId,
      sourceDeliveryId: selectedSource.deliveryId,
      productName: product.productName,
      qty: selectedQty,
      unitPrice: price,
      reason: reason as any,
      notes: selectedNotes || undefined,
    })

    setSubmitting(false)
    if (result.error) {
      setError(result.error)
    } else {
      setSuccess(true)
      const affected = result.affectedClient || null
      setAffectedInfo(affected)
      onModified?.({
        newAmount: result.newAmount!,
        newQty: result.newQty!,
        affectedClient: affected ? {
          deliveryId: selectedSource.deliveryId,
          name: affected.name,
          markedNwd: affected.markedNwd,
          remainingQty: affected.remainingQty,
        } : null,
      })
      setTimeout(() => { onClose(); resetForm(); setSuccess(false); setAffectedInfo(null) }, affected ? 3000 : 1500)
    }
  }

  if (!open) return null

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => { onClose(); resetForm() }} />

      <div className="relative w-full max-w-lg bg-[#0a1628] border-t border-cyan-500/15 rounded-t-2xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white/90 font-mono tracking-wide">MODIFY ORDER</h3>
            <p className="text-[11px] text-white/40 mt-0.5">{customerName}</p>
          </div>
          <button onClick={() => { onClose(); resetForm() }} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <X className="w-4 h-4 text-white/40" />
          </button>
        </div>

        {/* Current order */}
        <div className="mx-4 mb-3 p-3 rounded-xl bg-white/3 border border-white/5">
          <p className="text-[10px] text-white/30 font-mono mb-1">CURRENT ORDER</p>
          <p className="text-xs text-white/70 truncate">{currentProducts || 'No products'}</p>
          <p className="text-sm font-bold text-amber-400 mt-1">Rs {currentAmount.toLocaleString()}</p>
        </div>

        {/* Success */}
        {success && (
          <div className="mx-4 mb-3 space-y-2">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/20 flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-sm font-bold text-emerald-400">Order Modified</p>
                <p className="text-[11px] text-emerald-400/60">Contractor has been notified</p>
              </div>
            </div>
            {affectedInfo && (
              <div className={cn("p-3 rounded-xl border flex items-start gap-2.5",
                affectedInfo.markedNwd ? "bg-red-500/10 border-red-400/20" : "bg-amber-500/10 border-amber-400/20")}>
                <AlertTriangle className={cn("w-4 h-4 shrink-0 mt-0.5", affectedInfo.markedNwd ? "text-red-400" : "text-amber-400")} />
                <div>
                  <p className={cn("text-xs font-bold", affectedInfo.markedNwd ? "text-red-400" : "text-amber-400")}>
                    {affectedInfo.markedNwd ? `${affectedInfo.name} marked as NWD` : `${affectedInfo.name} shortage`}
                  </p>
                  <p className={cn("text-[10px] mt-0.5", affectedInfo.markedNwd ? "text-red-400/60" : "text-amber-400/60")}>
                    {affectedInfo.markedNwd
                      ? 'All products taken. Contractor notified for re-delivery.'
                      : `${affectedInfo.remainingQty} item${affectedInfo.remainingQty !== 1 ? 's' : ''} remaining. Delivery continues with shortage.`}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-400/20 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        )}

        {!loading && !success && (
          <>
            <div className="px-4 mb-2">
              <p className="text-[10px] text-cyan-400/50 font-mono">RIDER STOCK</p>
            </div>

            {/* Product list */}
            {stockProducts.map((product) => {
              const isExpanded = expandedProduct === product.productName
              const freeSources = product.sources.filter(s => s.isFree)
              const activeSources = product.sources.filter(s => !s.isFree)
              const totalSourceQty = product.sources.reduce((sum, s) => sum + s.qty, 0)

              return (
                <div key={product.productName} className="px-4 mb-2">
                  <button
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                      isExpanded ? "bg-cyan-500/8 border-cyan-400/15" : "bg-white/3 border-white/5 active:bg-white/5"
                    )}
                    onClick={() => { setExpandedProduct(isExpanded ? null : product.productName); setSelectedSource(null); setConfirmStep(false) }}
                  >
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                      product.freeQty > 0 ? "bg-emerald-500/15" : product.availableQty > 0 ? "bg-cyan-500/10" : "bg-white/5")}>
                      <Package className={cn("w-4.5 h-4.5", product.freeQty > 0 ? "text-emerald-400" : product.availableQty > 0 ? "text-cyan-400" : "text-white/30")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/85 font-medium truncate">{product.productName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {product.freeQty > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-400/15">
                            {product.freeQty} FREE
                          </span>
                        )}
                        {product.activeClientCount > 0 && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/70 border border-amber-400/10">
                            <Users className="w-2.5 h-2.5 inline mr-0.5" />
                            {product.activeClientCount} client{product.activeClientCount > 1 ? 's' : ''}
                          </span>
                        )}
                        {product.totalReceived > 0 && (
                          <span className="text-[9px] text-white/25">
                            stock: {product.availableQty}/{product.totalReceived}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-white/60">x{product.availableQty || totalSourceQty}</p>
                      <p className="text-[10px] text-white/30">Rs {product.unitPrice}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-white/20" /> : <ChevronDown className="w-3.5 h-3.5 text-white/20" />}
                  </button>

                  {/* Expanded: sources list */}
                  {isExpanded && (
                    <div className="mt-1 ml-3 space-y-1">

                      {/* ── FREE sources (NWD/CMS) ── */}
                      {freeSources.map((src, i) => {
                        const isSelected = selectedSource === src
                        return (
                          <div key={`free-${src.deliveryId}-${i}`} className={cn("rounded-lg border transition-all",
                            isSelected ? "bg-emerald-500/10 border-emerald-400/20" : "bg-white/2 border-white/5")}>
                            <button className="w-full flex items-center gap-2.5 p-2.5 text-left"
                              onClick={() => isSelected ? setSelectedSource(null) : selectSource(src)}>
                              <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-white/70 truncate">{src.customerName}</p>
                                <p className="text-[9px] text-emerald-400/50">{src.status.toUpperCase()} - safe to take</p>
                              </div>
                              <span className="text-[10px] text-white/40">x{src.qty}</span>
                            </button>

                            {isSelected && (
                              <div className="px-2.5 pb-2.5 pt-1 border-t border-emerald-400/10">
                                {renderQtyPriceRow(src, 'emerald')}
                                <button onClick={handleSubmit} disabled={submitting || !selectedPrice || selectedQty < 1}
                                  className="w-full h-9 rounded-lg bg-emerald-500/15 border border-emerald-400/20 text-emerald-400 text-[10px] font-bold font-mono flex items-center justify-center gap-1.5 active:bg-emerald-500/25 disabled:opacity-40">
                                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                  ADD TO ORDER
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* ── ACTIVE client sources ── */}
                      {activeSources.length > 0 && freeSources.length > 0 && (
                        <div className="flex items-center gap-2 py-1">
                          <div className="flex-1 h-px bg-white/5" />
                          <span className="text-[8px] text-white/15 font-mono">ACTIVE CLIENTS</span>
                          <div className="flex-1 h-px bg-white/5" />
                        </div>
                      )}

                      {activeSources.map((src, i) => {
                        const isSelected = selectedSource === src
                        // Will this take ALL their stock of this product?
                        const willLoseAll = isSelected && selectedQty >= src.qty
                        const color = isSelected ? (willLoseAll ? 'red' : 'amber') : 'amber'

                        return (
                          <div key={`active-${src.deliveryId}-${i}`} className={cn("rounded-lg border transition-all",
                            isSelected
                              ? willLoseAll ? "bg-red-500/10 border-red-400/20" : "bg-amber-500/10 border-amber-400/20"
                              : "bg-white/2 border-amber-400/8")}>
                            <button className="w-full flex items-center gap-2.5 p-2.5 text-left"
                              onClick={() => handleActiveSelect(src)}>
                              <div className={cn("w-2 h-2 rounded-full shrink-0", willLoseAll ? "bg-red-400" : "bg-amber-400")} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] text-white/70 truncate">{src.customerName}</p>
                                <p className="text-[9px] text-amber-400/50">
                                  ACTIVE{src.qty === 1 ? ' - only 1 unit' : ` - ${src.qty} units`}
                                </p>
                              </div>
                              <span className="text-[10px] text-white/40">x{src.qty}</span>
                            </button>

                            {isSelected && !confirmStep && (
                              <div className="px-2.5 pb-2.5 pt-1 border-t border-amber-400/10">
                                {renderQtyPriceRow(src, color)}
                                {/* Impact preview */}
                                <div className={cn("p-2 rounded-lg border mb-2 text-[9px] leading-relaxed",
                                  willLoseAll ? "bg-red-500/5 border-red-400/10 text-red-400/70" : "bg-amber-500/5 border-amber-400/10 text-amber-400/70")}>
                                  {willLoseAll
                                    ? <><AlertTriangle className="w-3 h-3 inline mr-1" />{src.customerName} will be marked <strong>NWD</strong> (all products taken).</>
                                    : <>{src.customerName} will have a shortage ({src.qty - selectedQty} unit{src.qty - selectedQty !== 1 ? 's' : ''} left).</>
                                  }
                                </div>
                                <button onClick={handleSubmit}
                                  className={cn("w-full h-9 rounded-lg border text-[10px] font-bold font-mono flex items-center justify-center gap-1.5",
                                    willLoseAll
                                      ? "bg-red-500/15 border-red-400/20 text-red-400 active:bg-red-500/25"
                                      : "bg-amber-500/15 border-amber-400/20 text-amber-400 active:bg-amber-500/25")}>
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  CONFIRM TAKE
                                </button>
                              </div>
                            )}

                            {/* Confirm step — rider acknowledges the impact */}
                            {isSelected && confirmStep && (
                              <div className="px-2.5 pb-2.5 pt-1 border-t border-red-400/10">
                                <div className={cn("p-3 rounded-lg border mb-2",
                                  willLoseAll ? "bg-red-500/8 border-red-400/15" : "bg-amber-500/8 border-amber-400/15")}>
                                  <p className={cn("text-[10px] font-bold mb-1", willLoseAll ? "text-red-400" : "text-amber-400")}>
                                    {willLoseAll ? `${src.customerName} will be marked NWD` : `${src.customerName} will have shortage`}
                                  </p>
                                  <p className={cn("text-[9px] leading-relaxed", willLoseAll ? "text-red-400/60" : "text-amber-400/60")}>
                                    {willLoseAll
                                      ? 'All products taken. Contractor will be notified and re-delivery will be needed.'
                                      : `${src.qty - selectedQty} item${src.qty - selectedQty !== 1 ? 's' : ''} remain. Delivery continues with reduced order.`}
                                  </p>
                                </div>
                                <input type="text" placeholder="Note (e.g. client requested, product damaged)" value={selectedNotes}
                                  onChange={e => setSelectedNotes(e.target.value)}
                                  className="w-full h-8 px-2.5 rounded-lg bg-white/5 border border-white/8 text-[10px] text-white/70 placeholder:text-white/20 mb-2 outline-none focus:border-white/15" />
                                <div className="flex gap-2">
                                  <button onClick={() => setConfirmStep(false)}
                                    className="flex-1 h-9 rounded-lg bg-white/5 border border-white/8 text-white/40 text-[10px] font-bold font-mono active:bg-white/8">
                                    BACK
                                  </button>
                                  <button onClick={handleSubmit} disabled={submitting}
                                    className={cn("flex-1 h-9 rounded-lg border text-[10px] font-bold font-mono flex items-center justify-center gap-1.5 disabled:opacity-40",
                                      willLoseAll
                                        ? "bg-red-500/15 border-red-400/20 text-red-400 active:bg-red-500/25"
                                        : "bg-amber-500/15 border-amber-400/20 text-amber-400 active:bg-amber-500/25")}>
                                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    {willLoseAll ? 'NWD + TAKE' : 'TAKE'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Empty state */}
            {stockProducts.length === 0 && (
              <div className="mx-4 mb-3 p-4 rounded-xl bg-white/3 border border-white/5 text-center">
                <Package className="w-8 h-8 text-white/15 mx-auto mb-2" />
                <p className="text-xs text-white/40">No products in rider stock</p>
                <p className="text-[10px] text-white/20 mt-1">All deliveries completed or no other deliveries today</p>
              </div>
            )}

            <div className="h-6" />
          </>
        )}
      </div>
    </div>
  )

  // Shared qty + price row
  function renderQtyPriceRow(src: StockSource, color: string) {
    const colorMap: Record<string, { border: string; text: string; focus: string }> = {
      emerald: { border: 'border-emerald-400/15', text: 'text-emerald-400', focus: 'focus:border-emerald-400/40' },
      amber: { border: 'border-amber-400/15', text: 'text-amber-400', focus: 'focus:border-amber-400/40' },
      red: { border: 'border-red-400/15', text: 'text-red-400', focus: 'focus:border-red-400/40' },
    }
    const c = colorMap[color] || colorMap.amber

    return (
      <>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-white/40 font-mono">QTY</label>
            <button onClick={() => setSelectedQty(q => Math.max(1, q - 1))}
              className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-white/50 text-xs font-bold active:bg-white/10">-</button>
            <input type="number" value={selectedQty}
              onChange={e => { const v = parseInt(e.target.value) || 1; setSelectedQty(Math.max(1, Math.min(src.qty, v))) }}
              className={cn("w-10 h-6 px-1 rounded bg-white/5 border text-[11px] font-bold text-center outline-none", c.border, c.text, c.focus)} />
            <button onClick={() => setSelectedQty(q => Math.min(src.qty, q + 1))}
              className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-white/50 text-xs font-bold active:bg-white/10">+</button>
            <span className="text-[8px] text-white/20">/{src.qty}</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[9px] text-white/30">Rs</span>
            <input type="number" value={selectedPrice} onChange={e => setSelectedPrice(e.target.value)}
              className={cn("w-16 h-6 px-1.5 rounded bg-white/5 border text-[11px] font-bold text-right outline-none", c.border, c.text, c.focus)} />
          </div>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] text-white/25 font-mono">TOTAL</span>
          <span className={cn("text-xs font-bold", c.text)}>Rs {(selectedQty * parseFloat(selectedPrice || '0')).toLocaleString()}</span>
        </div>
      </>
    )
  }
}
