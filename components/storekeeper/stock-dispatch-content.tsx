'use client'

// Stock Dispatch - Mobile-optimized two-step validation workflow
// 1. Opening Stock: Validate products individually (persists to DB with history)
// 2. Distribution: Validate per contractor product-by-product (persists to DB)
// Features: Image lightbox, flag discrepancy, auto-collapse, sorted by qty
// Validated products automatically move to bottom of list in both sections
import { useState, useMemo, useEffect, useCallback, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Package, CheckCircle2, CalendarIcon, Loader2, X, Check, Users, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Flag, ZoomIn, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { guardedUpdate, sessionIsAlive, type WriteOutcome } from '@/lib/guarded-write'

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
  /** Reported by the storekeeper: there was none of this to give out. */
  no_stock?: boolean
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
  /** Ascending list of days that actually have a round, so the arrows can skip
   *  straight over off-days instead of landing on an empty screen. */
  availableDates: string[]
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

/** "Mon 24 Aug" - short enough for a button on a phone. */
function fmtRoundDay(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/)
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : (words[0][0] + words[1][0]).toUpperCase()
}

export function StockDispatchContent({
  userId,
  today,
  selectedDate,
  availableDates,
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

  // Products the storekeeper REPORTED as unavailable, same key shape.
  // Distinct from "not ticked yet": this is him saying there was none to give.
  const [noStockProducts, setNoStockProducts] = useState<Set<string>>(new Set())

  // Same report at Opening Stock level, keyed by product name only. This is the
  // one he reaches first and uses most - it is where he is standing when he
  // finds the shelf empty.
  const [noStockAtOpening, setNoStockAtOpening] = useState<Set<string>>(new Set())
  
  // Expanded products in Opening Stock (to see contractor breakdown)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  
  // Image lightbox
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Set when a write is refused because the session died while the phone slept.
  // Until it clears, the storekeeper must not keep ticking into a void.
  const [sessionLost, setSessionLost] = useState(false)

  // Sends him to log in again, remembering the page AND the date he was on so
  // he lands back on the same list instead of a generic dashboard.
  const goRelogin = useCallback(() => {
    const here = `${window.location.pathname}${window.location.search}`
    router.push(`/auth/login?next=${encodeURIComponent(here)}`)
  }, [router])

  // Handles the outcome of any stock_out write. Returns true when it truly
  // saved, so callers can roll back their optimistic tick when it did not.
  const confirmWrite = useCallback((res: WriteOutcome) => {
    if (res.ok) return true
    if (res.reason === 'auth') setSessionLost(true)
    else alert(res.message)
    return false
  }, [])

  // A sleeping phone freezes the token-refresh timer, so the session can be
  // dead the instant the screen comes back. Check on wake - before he taps -
  // rather than letting the first tap disappear.
  useEffect(() => {
    const onWake = async () => {
      if (document.visibilityState !== 'visible' || sessionLost) return
      const alive = await sessionIsAlive(createClient())
      if (!alive) setSessionLost(true)
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [sessionLost])
  
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
    const noStockFromDb = new Set<string>()
    const productDeliveries = new Map<string, Delivery[]>()
    
    for (const d of initialDeliveries) {
      const product = d.products || 'Unknown'
      if (!productDeliveries.has(product)) productDeliveries.set(product, [])
      productDeliveries.get(product)!.push(d)
      
      // Track contractor product validation from DB
      if (d.stock_out) {
        validatedContractorProductsFromDb.add(`${d.contractor_id}:${product}`)
      }
      if (d.no_stock) {
        noStockFromDb.add(`${d.contractor_id}:${product}`)
      }
    }
    
    const noStockOpeningFromDb = new Set<string>()
    for (const [product, dels] of productDeliveries) {
      if (dels.every(d => d.stock_out)) validatedProductsFromDb.add(product)
      // ANY line reported unavailable marks the product as reported. A partial
      // shortage is still a shortage, and requiring every line to be flagged
      // would leave the product looking untouched.
      if (dels.some(d => d.no_stock)) noStockOpeningFromDb.add(product)
    }
    setNoStockAtOpening(noStockOpeningFromDb)
    
    setValidatedProducts(validatedProductsFromDb)
    setValidatedContractorProducts(validatedContractorProductsFromDb)
    setNoStockProducts(noStockFromDb)
  }, [selectedDate, initialDeliveries])



  // Build product list with quantities
  const productList = useMemo(() => {
    const map = new Map<string, { product: string, image: string | null, qty: number, deliveryIds: string[], deliveries: Delivery[] }>()
    
    for (const d of deliveries) {
      const key = d.products || 'Unknown'
      if (!map.has(key)) map.set(key, { product: key, image: d.product_image, qty: 0, deliveryIds: [], deliveries: [] })
      const p = map.get(key)!
      // `?? 1`, never `|| 1`: a stored qty of 0 is a deliberate "moves no
      // stock" (typed on refund rows), and `0 || 1` would silently show 1.
      p.qty += d.qty ?? 1
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
      c.products.set(product, (c.products.get(product) || 0) + (d.qty ?? 1))
      c.total += d.qty ?? 1
      c.deliveryIds.push(d.id)
    }
    
    return map
  }, [deliveries, contractors])

  // Sorted contractors by qty (highest first)
  const sortedContractors = useMemo(() => {
    return [...contractorStock.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [contractorStock])

  // Totals
  const totalItems = deliveries.reduce((sum, d) => sum + (d.qty ?? 1), 0)
  // "Answered" = ticked OR reported as unavailable. Both are a real answer from
  // the storekeeper; only an untouched row is outstanding.
  const isProductAnswered = (product: string) =>
    validatedProducts.has(product) || noStockAtOpening.has(product)
  const validatedCount = productList.filter(p => isProductAnswered(p.product)).length
  // THE DEADLOCK: this used to demand every product be TICKED. A product with
  // no stock can never honestly be ticked, so one empty shelf locked the
  // Distribution step for the whole day and the only way on was to lie.
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
      const res = await guardedUpdate(createClient(), 'deliveries', productInfo.deliveryIds, {
        stock_out: true,
        stock_out_at: new Date().toISOString(),
        stock_out_by: userId,
        // Ticking withdraws any earlier "none there" report on the same
        // product - stock turned up after all.
        no_stock: false, no_stock_at: null, no_stock_by: null,
      })
      setNoStockAtOpening(prev => {
        const next = new Set(prev); next.delete(product); return next
      })
      // Undo the optimistic tick if the database never got it, so the screen
      // cannot show work that was silently thrown away.
      if (!confirmWrite(res)) {
        setValidatedProducts(prev => {
          const next = new Set(prev)
          next.delete(product)
          return next
        })
      }
    }
  }

  /**
   * Opening Stock: "there was none of this on the shelf."
   *
   * The honest third answer. Before this he had only tick or leave-blank, and
   * leaving it blank locked the Distribution step - so the empty shelf quietly
   * pushed him towards ticking something he never handed over.
   */
  const handleToggleNoStockProduct = async (product: string) => {
    const wasReported = noStockAtOpening.has(product)
    const productInfo = productList.find(p => p.product === product)
    if (!productInfo) return

    // ONLY the lines still outstanding. A line already counted out physically
    // left the shelf, so it cannot also be "not there" - and blanket-clearing
    // it would silently destroy work he had already done. A part-shortage
    // reports the remainder and leaves the handed-over lines alone.
    const targetIds = wasReported
      ? productInfo.deliveries.filter(d => d.no_stock).map(d => d.id)
      : productInfo.deliveries.filter(d => !d.stock_out).map(d => d.id)
    if (targetIds.length === 0) return

    setNoStockAtOpening(prev => {
      const next = new Set(prev)
      if (wasReported) next.delete(product); else next.add(product)
      return next
    })

    const res = await guardedUpdate(createClient(), 'deliveries', targetIds,
      wasReported
        ? { no_stock: false, no_stock_at: null, no_stock_by: null }
        : { no_stock: true, no_stock_at: new Date().toISOString(), no_stock_by: userId })

    if (!confirmWrite(res)) {
      setNoStockAtOpening(prev => {
        const next = new Set(prev)
        if (wasReported) next.add(product); else next.delete(product)
        return next
      })
    } else {
      setDeliveries(prev => prev.map(d =>
        targetIds.includes(d.id) ? { ...d, no_stock: !wasReported } : d))
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
      const res = await guardedUpdate(createClient(), 'deliveries', productInfo.deliveryIds, {
        stock_out: false,
        stock_out_at: null,
        stock_out_by: null,
      })
      // Put the tick back: un-ticking did not reach the database either.
      if (!confirmWrite(res)) {
        setValidatedProducts(prev => new Set([...prev, product]))
      }
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
      const res = await guardedUpdate(createClient(), 'deliveries', productDeliveryIds,
        isCurrentlyValidated
          ? { stock_out: false, stock_out_at: null, stock_out_by: null }
          // Ticking withdraws any "no stock" report on the same line: he has
          // just said the unit went out, so the two cannot both stand.
          : { stock_out: true, stock_out_at: new Date().toISOString(), stock_out_by: userId,
              no_stock: false, no_stock_at: null, no_stock_by: null })

      if (!isCurrentlyValidated) {
        setNoStockProducts(prev => {
          const next = new Set(prev); next.delete(key); return next
        })
      }

      // Restore the previous tick state - this is the tap he repeats most, so
      // it must never look done when the database says otherwise.
      if (!confirmWrite(res)) {
        setValidatedContractorProducts(prev => {
          const next = new Set(prev)
          if (isCurrentlyValidated) next.add(key)
          else next.delete(key)
          return next
        })
      }
    }
  }

  /**
   * "There was none of this to give out."
   *
   * A REPORT, not a guess: the storekeeper is standing at the shelf, so he is
   * the authority on whether the unit existed.
   *
   * Only ever touches lines still OUTSTANDING. A line already ticked has
   * physically left the shelf, so it cannot also be "not there", and clearing
   * its tick would quietly undo work he had already done.
   *
   * Goes through guardedUpdate for the same reason every other write here
   * does: on a sleeping phone an update returns 204 with no error and saves
   * nothing.
   */
  const handleToggleNoStock = async (contractorId: string, productName: string) => {
    const key = `${contractorId}:${productName}`
    const wasReported = noStockProducts.has(key)

    const rows = deliveries.filter(
      d => d.contractor_id === contractorId && d.products === productName)
    const ids = wasReported
      ? rows.filter(d => d.no_stock).map(d => d.id)
      : rows.filter(d => !d.stock_out).map(d => d.id)
    if (ids.length === 0) return

    setNoStockProducts(prev => {
      const next = new Set(prev)
      if (wasReported) next.delete(key); else next.add(key)
      return next
    })

    // No stock_out fields here: the targeted rows are un-ticked by definition,
    // so there is no tick to clear.
    const res = await guardedUpdate(createClient(), 'deliveries', ids,
      wasReported
        ? { no_stock: false, no_stock_at: null, no_stock_by: null }
        : { no_stock: true, no_stock_at: new Date().toISOString(), no_stock_by: userId })

    if (!confirmWrite(res)) {
      setNoStockProducts(prev => {
        const next = new Set(prev)
        if (wasReported) next.add(key); else next.delete(key)
        return next
      })
    } else {
      // Keep the local rows in step so a later tick does not resurrect the
      // stale value it was seeded with.
      setDeliveries(prev => prev.map(d =>
        ids.includes(d.id) ? { ...d, no_stock: !wasReported } : d))
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

  // On an empty day, the single most useful destination: the last round that
  // actually happened, or the next one coming up if there is no past work.
  const nearestRound =
    [...availableDates].reverse().find(d => d < displayDate) ||
    availableDates.find(d => d > displayDate)

  // Loading
  if (isPending) {
    return (
      <div className="space-y-4">
        <DateHeader 
          displayDate={displayDate} 
          isToday={isToday}
          availableDates={availableDates}
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
          availableDates={availableDates}
        />
        {/* An off-day must explain itself and offer the way out. The old screen
            just said "no deliveries", which on a Sunday reads as lost data. */}
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" aria-hidden />
          <p className="text-sm font-medium">No round on this date</p>
          <p className="text-xs text-muted-foreground mt-1 text-pretty">
            Nothing was scheduled to go out. Use the arrows to jump to the nearest day
            that has a round.
          </p>
          {nearestRound && (
            <a
              href={`/dashboard/storekeeper/stock-out?date=${nearestRound}`}
              className="mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Go to {fmtRoundDay(nearestRound)}
            </a>
          )}
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
        availableDates={availableDates}
      />

      {/*
        Session died while the phone was asleep. Blocking and unmissable on
        purpose: the old behaviour let him keep ticking items that were never
        being saved, and he only found out when the whole list reset.
      */}
      {sessionLost && (
        <div
          role="alert"
          className="rounded-2xl border-2 border-amber-500 bg-amber-500/10 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <Flag className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-200">
                You have been signed out - taps are no longer saving
              </p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                {'This happens when the phone sleeps for a while. Everything you ticked '}
                {'before this message is safely saved. Sign in again and you will come '}
                {'straight back to this list on the same date.'}
              </p>
            </div>
          </div>
          <button
            onClick={goRelogin}
            className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-amber-950 active:bg-amber-600"
          >
            Sign in and carry on
          </button>
        </div>
      )}

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
              <p className="text-[10px] text-muted-foreground">
                {validatedCount}/{productList.length} done
                {noStockAtOpening.size > 0 && (
                  <span className="text-red-400"> · {noStockAtOpening.size} no stock</span>
                )}
              </p>
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
            const isNoStockHere = noStockAtOpening.has(p.product)
            // Nothing left to report once every line has been counted out.
            const outstandingHere = p.deliveries.filter(d => !d.stock_out).length
            const isFlagged = flaggedProducts.has(p.product)
            const isExpanded = expandedProducts.has(p.product)
            
            // Contractor breakdown for this product
            const breakdown = new Map<string, { name: string, qty: number }>()
            for (const d of p.deliveries) {
              const cid = d.contractor_id
              const cName = contractors.find(c => c.id === cid)?.name || 'Unassigned'
              if (!breakdown.has(cid)) breakdown.set(cid, { name: cName, qty: 0 })
              breakdown.get(cid)!.qty += d.qty ?? 1
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
              <div key={p.product} className={cn(isNoStockHere ? "bg-red-500/10" : isFlagged ? "bg-amber-500/10" : isValidated ? "bg-emerald-500/5" : "bg-background")}>
                {/* Main Row - gap tightened because this row now carries a
                    third control and the product name must not wrap to 3 lines
                    on a phone. */}
                <div className="px-3 py-3 flex items-center gap-2">
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

                  {/* "None there" - the honest answer when the shelf is empty,
                      offered right beside the tick so it is no harder to give. */}
                  <button
                    onClick={() => handleToggleNoStockProduct(p.product)}
                    aria-pressed={isNoStockHere}
                    aria-label={`No stock for ${p.product}`}
                    disabled={!isNoStockHere && outstandingHere === 0}
                    className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                      isNoStockHere ? "bg-red-500 text-white"
                        : outstandingHere === 0 ? "bg-muted/20 text-muted-foreground/30"
                        : "bg-muted/50 text-muted-foreground"
                    )}
                  >
                    <Ban className="w-4 h-4" />
                  </button>

                  {/* Validate/Invalidate Button */}
                  {isValidated ? (
                    <button
                      onClick={() => handleInvalidateProduct(p.product)}
                      aria-label={`Undo counted out ${p.product}`}
                      className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0"
                    >
                      <X className="w-5 h-5 text-red-500" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleValidateProduct(p.product)}
                      aria-label={`Counted out ${p.product}`}
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
                        const isNoStock = noStockProducts.has(productKey)
                        
                        return (
                          <div 
                            key={productName} 
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-b-0",
                              isProductValidated && "bg-emerald-500/5",
                              isNoStock && "bg-red-500/5"
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
                            
                            {/* "None to give" - sits next to the tick so the
                                honest answer is exactly as easy as the tick. */}
                            <button
                              onClick={() => handleToggleNoStock(cid, productName)}
                              aria-pressed={isNoStock}
                              // Names the contractor too: the Opening Stock
                              // list above has a button for the same product,
                              // and two controls sharing one accessible name
                              // are indistinguishable to a screen reader.
                              aria-label={`No stock for ${productName}, ${data.name}`}
                              className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                isNoStock
                                  ? "bg-red-500 text-white"
                                  : "bg-muted/50 text-muted-foreground hover:bg-red-500/20"
                              )}
                            >
                              <Ban className="w-5 h-5" />
                            </button>

                            {/* Validate button - same size as Opening Stock (w-10 h-10) */}
                            <button
                              onClick={() => handleToggleContractorProduct(cid, productName)}
                              aria-pressed={isProductValidated}
                              aria-label={`Counted out ${productName}`}
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
  isToday,
  availableDates = [],
}: { 
  displayDate: string
  isToday: boolean
  availableDates?: string[]
}) {
  const dateObj = new Date(displayDate + 'T00:00:00')
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const formattedDate = dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })

  const go = (d: string) => { window.location.href = `/dashboard/storekeeper/stock-out?date=${d}` }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value
    if (newDate && newDate !== displayDate) go(newDate)
  }

  // Step to the neighbouring day that HAS a round, not simply +/- 1 day.
  // Off-days are the whole point: Sunday has no work, so a plain day step would
  // land on a blank screen and look like the stock had been lost.
  const prevRound = [...availableDates].reverse().find(d => d < displayDate)
  const nextRound = availableDates.find(d => d > displayDate)
  const hasWorkToday = availableDates.includes(displayDate)

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <RoundArrow to={prevRound} onGo={go} label="Previous round" side="left" />

        <div className="flex-1 text-center relative">
          <div className="flex items-center justify-center gap-2 mb-1">
            <CalendarIcon className="w-4 h-4 text-amber-500" aria-hidden />
            <span className="text-lg font-bold text-amber-500">{dayName}</span>
            {isToday && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">TODAY</span>
            )}
            {/* Says plainly that the day is empty because nothing was scheduled,
                rather than leaving him to wonder where the stock went. */}
            {!hasWorkToday && (
              <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-bold">
                NO ROUND
              </span>
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

        <RoundArrow to={nextRound} onGo={go} label="Next round" side="right" />
      </div>
    </div>
  )
}

/** Chevron that jumps to a day with actual work. Disabled at either end so it
 *  never navigates to a page that cannot show anything. */
function RoundArrow({ to, onGo, label, side }: {
  to?: string
  onGo: (d: string) => void
  label: string
  side: 'left' | 'right'
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={() => to && onGo(to)}
      disabled={!to}
      aria-label={label}
      className="shrink-0 rounded-xl border border-border p-2.5 text-muted-foreground disabled:opacity-30 enabled:active:bg-muted enabled:hover:text-foreground"
    >
      <Icon className="w-5 h-5" aria-hidden />
    </button>
  )
}
