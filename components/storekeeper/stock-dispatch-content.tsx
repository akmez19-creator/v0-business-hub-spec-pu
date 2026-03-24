'use client'

// Stock Dispatch - Mobile-optimized two-step validation workflow
// 1. Opening Stock: Validate products individually (persists to DB with history)
// 2. Distribution: Validate per contractor product-by-product (persists to DB)
// Features: Image lightbox, flag discrepancy, auto-collapse, sorted by qty
// Validated products automatically move to bottom of list in both sections
import { useState, useMemo, useEffect, useCallback, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Package, CheckCircle2, CalendarIcon, Loader2, X, Check, Users, ArrowRight, ChevronDown, Flag, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface Delivery {
  id: string
  delivery_date: string
  contractor_id: string
  contractor_name: string
  product_id: string | null
  products: string
  product_image: string | null
  qty: number
  status: string
  stock_out: boolean
}

interface Contractor {
  id: string
  name: string
  photo_url?: string | null
}

interface DispatchSession {
  id: string
  contractor_id: string
  dispatch_date: string
  dispatched_by: string
  total_items: number
  total_products: number
  status: string
  created_at: string
}

interface StockDispatchContentProps {
  userId: string
  today: string
  selectedDate: string
  deliveries: Delivery[]
  contractors: Contractor[]
  sessions: DispatchSession[]
}

const CONTRACTOR_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', ring: 'ring-blue-500', solid: 'bg-blue-500' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', ring: 'ring-emerald-500', solid: 'bg-emerald-500' },
  { bg: 'bg-rose-500/20', text: 'text-rose-400', ring: 'ring-rose-500', solid: 'bg-rose-500' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', ring: 'ring-amber-500', solid: 'bg-amber-500' },
  { bg: 'bg-violet-500/20', text: 'text-violet-400', ring: 'ring-violet-500', solid: 'bg-violet-500' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', ring: 'ring-cyan-500', solid: 'bg-cyan-500' },
]

function getInitials(name: string) {
  const words = name.trim().split(/\s+/)
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase()
}

export function StockDispatchContent({
  userId,
  today,
  selectedDate,
  deliveries: initialDeliveries,
  contractors,
  sessions,
}: StockDispatchContentProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [displayDate, setDisplayDate] = useState(selectedDate)
  const [deliveries, setDeliveries] = useState(initialDeliveries)
  
  // Track validated products (optimistic UI)
  const [validatedProducts, setValidatedProducts] = useState<Set<string>>(new Set())
  
  // Track contractor validations (optimistic UI)
  const [validatedContractors, setValidatedContractors] = useState<Set<string>>(new Set())
  
  // Collapse states
  const [openingStockCollapsed, setOpeningStockCollapsed] = useState(false)
  const [expandedContractors, setExpandedContractors] = useState<Set<string>>(new Set())
  
  // Flagged products (qty discrepancy)
  const [flaggedProducts, setFlaggedProducts] = useState<Set<string>>(new Set())
  
  // Contractor product validation (key: "contractorId:productName")
  const [validatedContractorProducts, setValidatedContractorProducts] = useState<Set<string>>(new Set())
  
  // Expanded products in Opening Stock (to see contractor breakdown)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  
  // Image lightbox
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  
  // Reset state on date/deliveries change
  useEffect(() => {
    setDisplayDate(selectedDate)
    setDeliveries(initialDeliveries)
    setValidatedProducts(new Set())
    setValidatedContractors(new Set())
    setValidatedContractorProducts(new Set())
    
    // Initialize validated state from actual data
    const validatedProductsFromDb = new Set<string>()
    const validatedContractorProductsFromDb = new Set<string>()
    const productDeliveries = new Map<string, Delivery[]>()
    
    for (const d of initialDeliveries) {
      const product = d.products || 'Unknown'
      if (!productDeliveries.has(product)) productDeliveries.set(product, [])
      productDeliveries.get(product)!.push(d)
      
      // Track contractor product validation from DB
      if (d.stock_out) {
        validatedContractorProductsFromDb.add(`${d.contractor_id}:${product}`)
      }
    }
    
    for (const [product, dels] of productDeliveries) {
      if (dels.every(d => d.stock_out)) validatedProductsFromDb.add(product)
    }
    
    setValidatedProducts(validatedProductsFromDb)
    setValidatedContractorProducts(validatedContractorProductsFromDb)
  }, [selectedDate, initialDeliveries])



  // Build product list with quantities
  const productList = useMemo(() => {
    const map = new Map<string, { product: string, image: string | null, qty: number, deliveryIds: string[], deliveries: Delivery[] }>()
    
    for (const d of deliveries) {
      const key = d.products || 'Unknown'
      if (!map.has(key)) map.set(key, { product: key, image: d.product_image, qty: 0, deliveryIds: [], deliveries: [] })
      const p = map.get(key)!
      p.qty += d.qty || 1
      p.deliveryIds.push(d.id)
      p.deliveries.push(d)
    }
    
    return [...map.values()].sort((a, b) => {
      const aValidated = validatedProducts.has(a.product)
      const bValidated = validatedProducts.has(b.product)
      if (aValidated !== bValidated) return aValidated ? 1 : -1
      return b.qty - a.qty
    })
  }, [deliveries, validatedProducts])

  // Build contractor stock breakdown
  const contractorStock = useMemo(() => {
    const map = new Map<string, { name: string, products: Map<string, number>, total: number, deliveryIds: string[] }>()
    
    for (const d of deliveries) {
      const cid = d.contractor_id
      const cName = contractors.find(c => c.id === cid)?.name || 'Unassigned'
      
      if (!map.has(cid)) map.set(cid, { name: cName, products: new Map(), total: 0, deliveryIds: [] })
      const c = map.get(cid)!
      const product = d.products || 'Unknown'
      c.products.set(product, (c.products.get(product) || 0) + (d.qty || 1))
      c.total += d.qty || 1
      c.deliveryIds.push(d.id)
    }
    
    return map
  }, [deliveries, contractors])

  // Sorted contractors by qty (highest first)
  const sortedContractors = useMemo(() => {
    return [...contractorStock.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [contractorStock])

  // Totals
  const totalItems = deliveries.reduce((sum, d) => sum + (d.qty || 1), 0)
  const validatedCount = productList.filter(p => validatedProducts.has(p.product)).length
  const allProductsValidated = productList.length > 0 && validatedCount === productList.length
  
  // Check if contractor is validated (all their products are validated OR manually validated)
  const isContractorValidated = (cid: string, data: { products: Map<string, number> }) => {
    // If manually validated, return true
    if (validatedContractors.has(cid)) return true
    // Otherwise check if all products for this contractor are validated
    const allProductsValidatedForContractor = [...data.products.keys()].every(
      productName => validatedContractorProducts.has(`${cid}:${productName}`)
    )
    return allProductsValidatedForContractor && data.products.size > 0
  }
  
  const contractorsValidatedCount = sortedContractors.filter(([cid, data]) => isContractorValidated(cid, data)).length
  const allContractorsValidated = contractorStock.size > 0 && contractorsValidatedCount === contractorStock.size

  // Auto-collapse Opening Stock when validated, auto-expand first contractor
  useEffect(() => {
    if (allProductsValidated && sortedContractors.length > 0) {
      setOpeningStockCollapsed(true)
      setExpandedContractors(new Set([sortedContractors[0][0]]))
    }
  }, [allProductsValidated, sortedContractors])

  // Validate single product (Opening Stock) - persists to DB with history
  const handleValidateProduct = async (product: string) => {
    // Optimistic UI update
    setValidatedProducts(prev => new Set([...prev, product]))
    
    // Get delivery IDs for this product
    const productInfo = productList.find(p => p.product === product)
    if (productInfo && productInfo.deliveryIds.length > 0) {
      const supabase = createClient()
      await supabase.from('deliveries').update({
        stock_out: true,
        stock_out_at: new Date().toISOString(),
        stock_out_by: userId,
      }).in('id', productInfo.deliveryIds)
    }
  }

  // Invalidate product (Opening Stock) - persists to DB with history
  const handleInvalidateProduct = async (product: string) => {
    // Optimistic UI update
    setValidatedProducts(prev => {
      const next = new Set(prev)
      next.delete(product)
      return next
    })
    
    // Get delivery IDs for this product
    const productInfo = productList.find(p => p.product === product)
    if (productInfo && productInfo.deliveryIds.length > 0) {
      const supabase = createClient()
      // Clear validation but keep track that it was edited
      await supabase.from('deliveries').update({
        stock_out: false,
        stock_out_at: null,
        stock_out_by: null,
      }).in('id', productInfo.deliveryIds)
    }
  }



  // Validate contractor
  const handleValidateContractor = (contractorId: string) => {
    setValidatedContractors(prev => new Set([...prev, contractorId]))
  }

  // Invalidate contractor
  const handleInvalidateContractor = (contractorId: string) => {
    setValidatedContractors(prev => {
      const next = new Set(prev)
      next.delete(contractorId)
      return next
    })
  }


  // Toggle contractor product validation with DB persist
  // Auto-expand next contractor when all products validated
  const handleToggleContractorProduct = async (contractorId: string, productName: string) => {
    const key = `${contractorId}:${productName}`
    const isCurrentlyValidated = validatedContractorProducts.has(key)
    
    // Optimistic UI update
    const newValidatedProducts = new Set(validatedContractorProducts)
    if (newValidatedProducts.has(key)) {
      newValidatedProducts.delete(key)
    } else {
      newValidatedProducts.add(key)
    }
    setValidatedContractorProducts(newValidatedProducts)
    
    // Check if all products for this contractor are now validated
    const contractorData = contractorStock.get(contractorId)
    if (contractorData && !isCurrentlyValidated) {
      const allProductsForContractor = [...contractorData.products.keys()]
      const allValidated = allProductsForContractor.every(p => newValidatedProducts.has(`${contractorId}:${p}`))
      
      if (allValidated) {
        // Collapse current contractor and expand next unvalidated one
        // Sort contractors by total qty descending (same as sortedContractors)
        const sortedList = [...contractorStock.entries()].sort((a, b) => b[1].total - a[1].total)
        
        // Find current contractor index
        const currentIndex = sortedList.findIndex(([cid]) => cid === contractorId)
        
        // Find next unvalidated contractor after current one
        let nextContractorId: string | null = null
        for (let i = currentIndex + 1; i < sortedList.length; i++) {
          const [cid, data] = sortedList[i]
          const isContractorDone = [...data.products.keys()].every(p => newValidatedProducts.has(`${cid}:${p}`))
          if (!isContractorDone) {
            nextContractorId = cid
            break
          }
        }
        
        // If no next found, check from beginning (wrap around)
        if (!nextContractorId) {
          for (let i = 0; i < currentIndex; i++) {
            const [cid, data] = sortedList[i]
            const isContractorDone = [...data.products.keys()].every(p => newValidatedProducts.has(`${cid}:${p}`))
            if (!isContractorDone) {
              nextContractorId = cid
              break
            }
          }
        }
        
        setExpandedContractors(prev => {
          const next = new Set(prev)
          next.delete(contractorId)
          if (nextContractorId) {
            next.add(nextContractorId)
          }
          return next
        })
      }
    }
    
    // Get delivery IDs for this contractor+product combo
    const productDeliveryIds = deliveries
      .filter(d => d.contractor_id === contractorId && d.products === productName)
      .map(d => d.id)
    
    if (productDeliveryIds.length > 0) {
      const supabase = createClient()
      if (isCurrentlyValidated) {
        // Invalidate
        await supabase.from('deliveries').update({
          stock_out: false,
          stock_out_at: null,
          stock_out_by: null,
        }).in('id', productDeliveryIds)
      } else {
        // Validate
        await supabase.from('deliveries').update({
          stock_out: true,
          stock_out_at: new Date().toISOString(),
          stock_out_by: userId,
        }).in('id', productDeliveryIds)
      }
    }
  }

  // Toggle flag on product (qty discrepancy)
  const handleToggleFlag = (product: string) => {
    setFlaggedProducts(prev => {
      const next = new Set(prev)
      if (next.has(product)) next.delete(product)
      else next.add(product)
      return next
    })
  }



  const isToday = displayDate === today

  // Loading
  if (isPending) {
    return (
      <div className="space-y-4">
        <DateHeader 
          displayDate={displayDate} 
          isToday={isToday}
        />
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    )
  }

  // Empty
  if (deliveries.length === 0) {
    return (
      <div className="space-y-4">
        <DateHeader 
          displayDate={displayDate} 
          isToday={isToday}
        />
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">No deliveries for this date</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Date Header */}
      <DateHeader 
        displayDate={displayDate} 
        isToday={isToday}
      />

      {/* OPENING STOCK - Summary + Products */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setOpeningStockCollapsed(!openingStockCollapsed)}
          className="w-full px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-400" />
            <div className="text-left">
              <p className="text-sm font-semibold">Opening Stock</p>
              <p className="text-[10px] text-muted-foreground">{validatedCount}/{productList.length} validated</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-blue-400 tabular-nums">{totalItems}</span>
            <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", openingStockCollapsed && "-rotate-90")} />
          </div>
        </button>



        {/* Product List */}
        {!openingStockCollapsed && (
          <div className="divide-y divide-border">

          {productList.map((p) => {
            const isValidated = validatedProducts.has(p.product)
            const isFlagged = flaggedProducts.has(p.product)
            const isExpanded = expandedProducts.has(p.product)
            
            // Contractor breakdown for this product
            const breakdown = new Map<string, { name: string, qty: number }>()
            for (const d of p.deliveries) {
              const cid = d.contractor_id
              const cName = contractors.find(c => c.id === cid)?.name || 'Unassigned'
              if (!breakdown.has(cid)) breakdown.set(cid, { name: cName, qty: 0 })
              breakdown.get(cid)!.qty += d.qty || 1
            }
            
            const toggleExpand = () => {
              setExpandedProducts(prev => {
                const next = new Set(prev)
                if (next.has(p.product)) next.delete(p.product)
                else next.add(p.product)
                return next
              })
            }
            
            return (
              <div key={p.product} className={cn(isFlagged ? "bg-amber-500/10" : isValidated ? "bg-emerald-500/5" : "bg-background")}>
                {/* Main Row */}
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Product Image - clickable to enlarge */}
                  <button
                    onClick={() => p.image && setLightboxImage(p.image)}
                    className={cn(
                      "w-12 h-12 rounded-xl overflow-hidden shrink-0 border relative group",
                      isValidated ? "border-emerald-500/30" : "border-border"
                    )}
                  >
                    {p.image ? (
                      <>
                        <img src={p.image} alt={p.product} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ZoomIn className="w-4 h-4 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted/50">
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                  </button>

                  {/* Product Name + Expand button (always show expand to see distribution) */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{p.product}</p>
                    <button 
                      onClick={toggleExpand}
                      className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground hover:text-primary"
                    >
                      {isValidated && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                      <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                      <span className={isValidated ? "text-emerald-600" : ""}>{breakdown.size} contractors</span>
                    </button>
                  </div>

                  {/* Quantity + Flag indicator */}
                  <div className={cn(
                    "min-w-[48px] px-2 py-1.5 rounded-xl text-center shrink-0 relative",
                    isFlagged ? "bg-amber-500/20" : isValidated ? "bg-emerald-500/10" : "bg-primary/10"
                  )}>
                    <p className={cn("text-lg font-bold tabular-nums", isFlagged ? "text-amber-600" : isValidated ? "text-emerald-600" : "text-primary")}>{p.qty}</p>
                    {isFlagged && <Flag className="w-3 h-3 text-amber-500 absolute -top-1 -right-1" />}
                  </div>

                  {/* Validate/Invalidate Button */}
                  {isValidated ? (
                    <button
                      onClick={() => handleInvalidateProduct(p.product)}
                      className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0"
                    >
                      <X className="w-5 h-5 text-red-500" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleValidateProduct(p.product)}
                      className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0"
                    >
                      <Check className="w-5 h-5 text-white" />
                    </button>
                  )}
                </div>
                
                {/* Expanded Contractor Breakdown + Flag (show even when validated) */}
                {isExpanded && (
                  <div className="px-4 pb-3 pl-[76px]">
                    {/* Contractor badges */}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {[...breakdown.entries()].map(([cid, b]) => {
                        const cIdx = contractors.findIndex(c => c.id === cid)
                        const color = CONTRACTOR_COLORS[cIdx >= 0 ? cIdx % CONTRACTOR_COLORS.length : 0]
                        return (
                          <div key={cid} className={cn("px-2.5 py-1.5 rounded-lg", color.bg)}>
                            <p className={cn("text-xs font-bold", color.text)}>{b.name}</p>
                            <p className={cn("text-[10px] font-semibold", color.text)}>Qty: {b.qty}</p>
                          </div>
                        )
                      })}
                    </div>
                    {/* Flag button */}
                    <button
                      onClick={() => handleToggleFlag(p.product)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        isFlagged 
                          ? "bg-amber-500 text-white" 
                          : "bg-muted/50 text-muted-foreground hover:bg-amber-500/20 hover:text-amber-500"
                      )}
                    >
                      <Flag className="w-3.5 h-3.5" />
                      {isFlagged ? "Remove Flag" : "Flag Discrepancy"}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        )}
      </div>

      {/* DISTRIBUTION BETWEEN CONTRACTORS */}
      <div className={cn(
        "rounded-2xl border bg-card overflow-hidden transition-all",
        allProductsValidated ? "border-border" : "border-border/50 opacity-50 pointer-events-none"
      )}>
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold">Distribution between Contractors</p>
              <p className="text-[10px] text-muted-foreground">
                {allProductsValidated ? `${contractorsValidatedCount}/${contractorStock.size} validated` : 'Validate opening stock first'}
              </p>
            </div>
          </div>
        </div>

        {allProductsValidated && (
          <div className="divide-y divide-border">
            {sortedContractors.map(([cid, data], i) => {
              const color = CONTRACTOR_COLORS[i % CONTRACTOR_COLORS.length]
              const isValidated = isContractorValidated(cid, data)
              const isExpanded = expandedContractors.has(cid)
              const contractorInfo = contractors.find(c => c.id === cid)
              const photoUrl = contractorInfo?.photo_url
              
              const toggleExpand = () => {
                setExpandedContractors(prev => {
                  const next = new Set(prev)
                  if (next.has(cid)) next.delete(cid)
                  else next.add(cid)
                  return next
                })
              }
              
              return (
                <div key={cid} className={cn(isValidated && "bg-emerald-500/5")}>
                  {/* Contractor Header Row - same layout as Opening Stock products */}
                  <div className="px-4 py-3 flex items-center gap-3">
                    {/* Avatar/Photo - clickable to enlarge */}
                    <button
                      onClick={() => photoUrl ? setLightboxImage(photoUrl) : toggleExpand()}
                      className={cn(
                        "w-12 h-12 rounded-xl overflow-hidden shrink-0 transition-all border relative group",
                        isValidated ? "border-emerald-500/30" : "border-border"
                      )}
                    >
                      {photoUrl ? (
                        <>
                          <img src={photoUrl} alt={data.name} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-4 h-4 text-white" />
                          </div>
                        </>
                      ) : (
                        <div className={cn("w-full h-full flex items-center justify-center text-sm font-bold", color.bg, color.text)}>
                          {getInitials(data.name)}
                        </div>
                      )}
                    </button>
                    
                    {/* Name + expand to see products + validation progress */}
                    <button onClick={toggleExpand} className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium leading-tight">{data.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <ChevronDown className={cn("w-3 h-3 transition-transform text-muted-foreground", isExpanded && "rotate-180")} />
                        {isValidated ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            <span className="text-[10px] text-emerald-600">{data.products.size}/{data.products.size} validated</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            {[...data.products.keys()].filter(p => validatedContractorProducts.has(`${cid}:${p}`)).length}/{data.products.size} validated
                          </span>
                        )}
                      </div>
                    </button>
                    
                    {/* Qty badge - no tick button, just shows total */}
                    <div className={cn(
                      "min-w-[56px] px-3 py-2 rounded-xl text-center shrink-0",
                      isValidated ? "bg-emerald-500/10" : "bg-primary/10"
                    )}>
                      <p className={cn("text-lg font-bold tabular-nums", isValidated ? "text-emerald-600" : "text-primary")}>{data.total}</p>
                    </div>
                  </div>
                  
                  {/* Expanded Product List with per-product validation - same size as Opening Stock */}
                  {/* Sort: unvalidated first (by qty desc), validated last (by qty desc) */}
                  {isExpanded && (
                    <div className="border-t border-border/50 bg-muted/20">
                      {[...data.products.entries()]
                        .sort(([aName, aQty], [bName, bQty]) => {
                          const aValidated = validatedContractorProducts.has(`${cid}:${aName}`)
                          const bValidated = validatedContractorProducts.has(`${cid}:${bName}`)
                          if (aValidated !== bValidated) return aValidated ? 1 : -1
                          return bQty - aQty
                        })
                        .map(([productName, qty]) => {
                        const pInfo = productList.find(p => p.product === productName)
                        const productKey = `${cid}:${productName}`
                        const isProductValidated = validatedContractorProducts.has(productKey)
                        
                        return (
                          <div 
                            key={productName} 
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-b-0",
                              isProductValidated && "bg-emerald-500/5"
                            )}
                          >
                            {/* Product image - same size as Opening Stock (w-12 h-12) */}
                            <button
                              onClick={() => pInfo?.image && setLightboxImage(pInfo.image)}
                              className={cn(
                                "w-12 h-12 rounded-xl overflow-hidden shrink-0 border relative group",
                                isProductValidated ? "border-emerald-500/30" : "border-border"
                              )}
                            >
                              {pInfo?.image ? (
                                <>
                                  <img src={pInfo.image} alt={productName} className="w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <ZoomIn className="w-4 h-4 text-white" />
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-muted/50">
                                  <Package className="w-5 h-5 text-muted-foreground" />
                                </div>
                              )}
                            </button>
                            
                            {/* Product name - same size as Opening Stock (text-sm) */}
                            <p className="text-sm font-medium flex-1 min-w-0 leading-tight">{productName}</p>
                            
                            {/* Qty - same size as Opening Stock */}
                            <div className={cn(
                              "min-w-[48px] px-2 py-1.5 rounded-xl text-center shrink-0",
                              isProductValidated ? "bg-emerald-500/10" : "bg-primary/10"
                            )}>
                              <p className={cn("text-lg font-bold tabular-nums", isProductValidated ? "text-emerald-600" : "text-primary")}>{qty}</p>
                            </div>
                            
                            {/* Validate button - same size as Opening Stock (w-10 h-10) */}
                            <button
                              onClick={() => handleToggleContractorProduct(cid, productName)}
                              className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                isProductValidated 
                                  ? "bg-emerald-500 text-white" 
                                  : "bg-muted/50 text-muted-foreground hover:bg-emerald-500/20"
                              )}
                            >
                              <Check className="w-5 h-5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Completion Status */}
      {allProductsValidated && allContractorsValidated && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-emerald-600">Stock Out Complete</p>
          <p className="text-xs text-muted-foreground mt-1">All products and contractors validated for {displayDate}</p>
        </div>
      )}

      {/* Image Lightbox - rendered via Portal to body */}
      {lightboxImage && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 z-10 w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30"
          >
            <X className="w-6 h-6" />
          </button>
          <div 
            className="p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={lightboxImage} 
              alt="Product" 
              className="max-w-[85vw] max-h-[70vh] rounded-xl object-contain"
              loading="eager"
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Date Header Component with native date picker
function DateHeader({ 
  displayDate, 
  isToday 
}: { 
  displayDate: string
  isToday: boolean
}) {
  const dateObj = new Date(displayDate + 'T00:00:00')
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const formattedDate = dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
  
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value
    if (newDate && newDate !== displayDate) {
      window.location.href = `/dashboard/storekeeper/stock-out?date=${newDate}`
    }
  }
  
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-center relative">
        <div className="flex items-center justify-center gap-2 mb-1">
          <CalendarIcon className="w-4 h-4 text-amber-500" />
          <span className="text-lg font-bold text-amber-500">{dayName}</span>
          {isToday && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">TODAY</span>
          )}
        </div>
        <label className="cursor-pointer inline-block">
          <span className="text-sm text-muted-foreground underline decoration-dashed underline-offset-2">{formattedDate}</span>
          <input
            type="date"
            value={displayDate}
            onChange={handleDateChange}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>
      </div>
    </div>
  )
}
