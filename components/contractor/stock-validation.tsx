'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package,
  CheckCircle2,
  AlertTriangle,
  Minus,
  Plus,
  ShieldCheck,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Truck,
  ClipboardCheck,
  User,
  Users,
  Clock,
  RotateCcw,
  CalendarClock,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  generateDailyStock,
  updateStockReceived,
  validateDailyStock,
  resetDailyStockValidation,
  regenerateDailyStock,
  clearDailyStock,
} from '@/lib/stock-actions'

interface StockItem {
  id: string
  product: string
  expected_qty: number
  received_qty: number | null
  delivered_qty: number
  postponed_qty: number
  returning_qty: number
  is_validated: boolean
  source: string
  notes: string | null
}

interface ValidationRecord {
  is_validated: boolean
  validated_at: string | null
  total_expected: number
  total_received: number
  notes: string | null
}

interface DeliveryRecord {
  id: string
  product: string
  qty: number
  status: string
  locality: string
  address: string
  source: 'main' | 'partner'
}

interface RiderProducts {
  riderId: string
  riderName: string
  products: {
    product: string
    totalQty: number
    deliveredQty: number
    pendingQty: number
    postponedQty: number
    returningQty: number
    cmsQty: number
    exchangeReturnQty: number
    returnType?: string
    source: string
  }[]
  deliveries: DeliveryRecord[]
  totalItems: number
  delivered: number
  pending: number
  postponed: number
  returning: number
  cms: number
  exchangeReturns: number
  returnProducts: any[]
}

interface StockValidationProps {
  contractorId: string
  stockItems: StockItem[]
  validation: ValidationRecord | null
  riderProducts: RiderProducts[]
  today: string
}

export function StockValidation({
  contractorId,
  stockItems: initialItems,
  validation: initialValidation,
  riderProducts,
  today,
}: StockValidationProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [items, setItems] = useState(initialItems)
  const [validation, setValidation] = useState(initialValidation)
  const [generating, setGenerating] = useState(false)
  const [validating, setValidating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [validationNotes, setValidationNotes] = useState('')

  useEffect(() => {
    setItems(initialItems)
    setValidation(initialValidation)
  }, [initialItems, initialValidation])

  const isValidated = validation?.is_validated === true

  // Summary
  const totalExpected = items.reduce((s, i) => s + i.expected_qty, 0)
  const totalReceived = items.reduce((s, i) => s + (i.received_qty ?? i.expected_qty), 0)
  const totalDelivered = items.reduce((s, i) => s + (i.delivered_qty || 0), 0)
  const totalPostponed = items.reduce((s, i) => s + (i.postponed_qty || 0), 0)
  const totalReturning = items.reduce((s, i) => s + (i.returning_qty || 0), 0)
  const mainItems = items.filter(i => i.source === 'main')
  const partnerItems = items.filter(i => i.source === 'partner')
  const hasDiscrepancy = items.some(i => (i.received_qty ?? i.expected_qty) !== i.expected_qty)

  // Generate stock from assigned deliveries
  const [genError, setGenError] = useState<string | null>(null)
  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    const result = await generateDailyStock(contractorId)
    if (result.error) {
      setGenError(result.error)
    }
    startTransition(() => router.refresh())
    setGenerating(false)
  }

  // Update qty
  const handleQtyChange = async (id: string, newQty: number) => {
    if (newQty < 0) return
    setItems(prev => prev.map(i => i.id === id ? { ...i, received_qty: newQty } : i))
    await updateStockReceived(id, newQty)
  }

  // Validate
  const handleValidate = async () => {
    setValidating(true)
    setShowConfirm(false)
    const result = await validateDailyStock(contractorId, validationNotes || undefined)
    if (result.success) {
      setValidation({
        is_validated: true,
        validated_at: new Date().toISOString(),
        total_expected: result.totalExpected || totalExpected,
        total_received: result.totalReceived || totalReceived,
        notes: validationNotes || null,
      })
    }
    startTransition(() => router.refresh())
    setValidating(false)
  }

  // Reset
  const handleReset = async () => {
    await resetDailyStockValidation(contractorId)
    setValidation(null)
    startTransition(() => router.refresh())
  }

  // Regenerate
  const handleRegenerate = async () => {
    setGenerating(true)
    await regenerateDailyStock(contractorId)
    startTransition(() => router.refresh())
    setGenerating(false)
  }

  // Clear stock
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const handleClear = async () => {
    setClearing(true)
    setShowClearConfirm(false)
    await clearDailyStock(contractorId)
    setItems([])
    setValidation(null)
    startTransition(() => router.refresh())
    setClearing(false)
  }

  // (rider totals are computed inside RiderDeliveryOverview)

  // ── EMPTY STATE: No stock generated yet ──
  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Package className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Generate Today{"'"}s Stock</p>
            <p className="text-xs text-muted-foreground mt-1">
              Load the product list from assigned deliveries to validate what you received.
            </p>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
  {generating ? 'Generating...' : 'Generate Stock List'}
  </button>
  {genError && (
    <p className="text-xs text-red-400 text-center mt-2">{genError}</p>
  )}
  </div>
  </div>
  )
  }

  return (
    <div className="space-y-4">
      {/* ── STEP 1: Main Stock Validation ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isValidated ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            ) : (
              <ClipboardCheck className="w-5 h-5 text-primary" />
            )}
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isValidated ? 'Stock Validated' : 'Validate Main Stock'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {isValidated
                  ? `Confirmed at ${new Date(validation!.validated_at!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Confirm quantities you received before rider dispatch'
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isValidated && (
              <button
                onClick={handleReset}
                className="text-[10px] text-muted-foreground hover:text-foreground font-medium px-2 py-1 rounded-lg border border-border hover:border-primary/30 transition-colors"
              >
                Edit
              </button>
            )}
            <button
              onClick={handleRegenerate}
              disabled={generating}
              className="p-1.5 rounded-lg border border-border hover:border-primary/30 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh stock from deliveries"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", generating && "animate-spin")} />
            </button>
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={clearing}
              className="p-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              title="Clear all stock"
            >
              <Trash2 className={cn("w-3.5 h-3.5", clearing && "animate-pulse")} />
            </button>
          </div>
        </div>

        {/* ── NOT VALIDATED: full editing view ── */}
        {!isValidated && (
          <>
            {/* Summary bar */}
            <div className="px-4 py-2 border-b border-border bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{items.length}</span> products
                  </span>
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground">{totalExpected}</span> expected
                  </span>
                  <span className={cn(
                    "font-semibold",
                    totalReceived === totalExpected ? "text-emerald-500" : "text-amber-500"
                  )}>
                    {totalReceived} received
                  </span>
                </div>
                {hasDiscrepancy && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    Mismatch
                  </span>
                )}
              </div>
            </div>

            {/* Stock items list */}
            <div className="divide-y divide-border">
              {mainItems.length > 0 && (
                <>
                  {partnerItems.length > 0 && (
                    <div className="px-4 py-1.5 bg-muted/20">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Main Deliveries</p>
                    </div>
                  )}
                  {mainItems.map(item => (
                    <StockItemRow
                      key={item.id}
                      item={item}
                      isValidated={false}
                      onQtyChange={handleQtyChange}
                    />
                  ))}
                </>
              )}
              {partnerItems.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-muted/20">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Partner Deliveries</p>
                  </div>
                  {partnerItems.map(item => (
                    <StockItemRow
                      key={item.id}
                      item={item}
                      isValidated={false}
                      onQtyChange={handleQtyChange}
                    />
                  ))}
                </>
              )}
            </div>

            {/* Validate button */}
            <div className="p-3 border-t border-border space-y-2">
              {showConfirm ? (
                <div className="space-y-2">
                  <textarea
                    value={validationNotes}
                    onChange={e => setValidationNotes(e.target.value)}
                    placeholder="Add notes (optional)..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-xs focus:border-primary/50 focus:outline-none resize-none"
                  />
                  {hasDiscrepancy && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/5">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      <p className="text-[10px] text-amber-500">
                        Received qty differs from expected. This will be recorded.
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleValidate}
                      disabled={validating}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {validating ? 'Validating...' : 'Confirm Stock Received'}
                    </button>
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all"
                >
                  <ShieldCheck className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                  Validate Stock ({totalReceived} items)
                </button>
              )}
            </div>
          </>
        )}

        {/* ── VALIDATED: compact collapsed view with expand option ── */}
        {isValidated && (
          <ValidatedStockView
            items={items}
            mainItems={mainItems}
            partnerItems={partnerItems}
            totalReceived={totalReceived}
            totalDelivered={totalDelivered}
            totalPostponed={totalPostponed}
            totalReturning={totalReturning}
            isPending={isPending}
            generating={generating}
            onReset={handleReset}
            onRegenerate={handleRegenerate}
            riderProducts={riderProducts}
          />
        )}
      </div>

      {/* ── Clear Stock Confirmation ── */}
      {showClearConfirm && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-400">Clear All Stock?</p>
              <p className="text-[10px] text-muted-foreground">This will remove the entire stock list. You can regenerate it later from deliveries.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              disabled={clearing}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : 'Yes, Clear Stock'}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-4 py-2.5 rounded-xl bg-muted text-muted-foreground text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Stock Detail List (always show when items exist) ── */}
      {items.length > 0 && (
        <StockDetailList items={items} totalReceived={totalReceived} riderProducts={riderProducts} />
      )}

    </div>
  )
}

// ── Validated Stock View ──
// Compact summary with expand toggle -- "All Products" vs "By Rider" tabs
function ValidatedStockView({
  items,
  mainItems,
  partnerItems,
  totalReceived,
  totalDelivered,
  totalPostponed,
  totalReturning,
  isPending,
  generating,
  onReset,
  onRegenerate,
  riderProducts,
}: {
  items: StockItem[]
  mainItems: StockItem[]
  partnerItems: StockItem[]
  totalReceived: number
  totalDelivered: number
  totalPostponed: number
  totalReturning: number
  isPending: boolean
  generating: boolean
  onReset: () => void
  onRegenerate: () => void
  riderProducts: RiderProducts[]
}) {
  const [showItems, setShowItems] = useState(false)
  const [viewMode, setViewMode] = useState<'all' | 'byRider'>('all')
  const activeRiders = riderProducts.filter(r => r.totalItems > 0)

  return (
    <div>
      {/* Compact summary row */}
      <div className="px-4 py-2.5 flex items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0 text-[11px]">
          <span className="font-semibold text-emerald-500 tabular-nums">{totalReceived}</span>
          <span className="text-muted-foreground/50">|</span>
          <span className="text-emerald-500 tabular-nums">{totalDelivered} <span className="text-[9px] opacity-60">del</span></span>
          <span className="text-amber-500 tabular-nums">{totalPostponed} <span className="text-[9px] opacity-60">nwd</span></span>
          {(() => {
            const exRtn = riderProducts.reduce((s, r) => s + r.exchangeReturns, 0)
            const realCms = Math.max(0, totalReturning - exRtn)
            return <>
              {realCms > 0 && <span className="text-red-500 tabular-nums">{realCms} <span className="text-[9px] opacity-60">cms</span></span>}
              {exRtn > 0 && <span className="text-violet-500 tabular-nums">{exRtn} <span className="text-[9px] opacity-60">rtn</span></span>}
            </>
          })()}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onReset}
            disabled={isPending}
            className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
            title="Redo validation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRegenerate}
            disabled={generating || isPending}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            title="Clear & regenerate stock"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", generating && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* View Stock toggle */}
      <div className="border-t border-border/50">
        <button
          onClick={() => setShowItems(!showItems)}
          className="w-full px-4 py-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
        >
          <Package className="w-3 h-3" />
          {showItems ? 'Hide Stock List' : `View Stock List (${items.length} products)`}
          <ChevronDown className={cn("w-3 h-3 transition-transform", showItems && "rotate-180")} />
        </button>
      </div>

      {/* Expanded content */}
      {showItems && (
        <div className="border-t border-border/50">
          {/* Tab switcher: All Products / By Rider */}
          {activeRiders.length > 0 && (
            <div className="px-4 pt-2.5 pb-1.5 flex gap-1.5">
              <button
                onClick={() => setViewMode('all')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all border',
                  viewMode === 'all'
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-muted/30 text-muted-foreground border-transparent hover:border-border'
                )}
              >
                All Products
              </button>
              <button
                onClick={() => setViewMode('byRider')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all border',
                  viewMode === 'byRider'
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-muted/30 text-muted-foreground border-transparent hover:border-border'
                )}
              >
                By Rider ({activeRiders.length})
              </button>
            </div>
          )}

          {/* ── All Products view ── */}
          {viewMode === 'all' && (
            <div className="divide-y divide-border/30 max-h-[60vh] overflow-y-auto">
              {mainItems.length > 0 && partnerItems.length > 0 && (
                <div className="px-4 py-1.5 bg-muted/20 sticky top-0 z-10">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Main Deliveries</p>
                </div>
              )}
              {mainItems.map(item => (
                <ValidatedProductRow key={item.id} item={item} />
              ))}
              {partnerItems.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-muted/20 sticky top-0 z-10">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Partner Deliveries</p>
                  </div>
                  {partnerItems.map(item => (
                    <ValidatedProductRow key={item.id} item={item} isPartner />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── By Rider view ── */}
          {viewMode === 'byRider' && (
            <div className="max-h-[60vh] overflow-y-auto">
              {activeRiders.map(rider => (
                <RiderStockSection key={rider.riderId} rider={rider} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Shared product row used in All Products view
function ValidatedProductRow({ item, isPartner }: { item: StockItem; isPartner?: boolean }) {
  const received = item.received_qty ?? item.expected_qty
  const delivered = item.delivered_qty || 0
  const postponed = item.postponed_qty || 0
  const returning = item.returning_qty || 0
  const pending = received - delivered - postponed - returning
  const isMatch = received === item.expected_qty

  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">
          {item.product}
          {isPartner && <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500">Partner</span>}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
          <span>Exp: <span className="font-semibold text-foreground">{item.expected_qty}</span></span>
          {delivered > 0 && <span className="text-emerald-500 font-medium">{delivered} del</span>}
          {postponed > 0 && <span className="text-amber-500 font-medium">{postponed} nwd</span>}
          {returning > 0 && <span className="text-red-500 font-medium">{returning} cms</span>}
          {pending > 0 && <span>{pending} left</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn("text-sm font-bold tabular-nums", isMatch ? "text-emerald-500" : "text-amber-500")}>{received}</span>
        {isMatch
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        }
      </div>
    </div>
  )
}

// Collapsible per-rider stock section used in By Rider view
function RiderStockSection({ rider }: { rider: RiderProducts }) {
  const [expanded, setExpanded] = useState(false)
  const processed = rider.delivered + rider.postponed + rider.returning
  const progress = rider.totalItems > 0 ? Math.round((processed / rider.totalItems) * 100) : 0

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors"
      >
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-primary">
            {rider.riderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">{rider.riderName}</p>
          <div className="flex items-center gap-2 mt-0.5 text-[10px]">
            <span className="text-muted-foreground">{rider.totalItems} items</span>
            <span className="text-muted-foreground">{progress}%</span>
            {rider.delivered > 0 && <span className="text-emerald-500 font-medium">{rider.delivered}</span>}
            {rider.postponed > 0 && <span className="text-amber-500 font-medium">{rider.postponed}</span>}
            {rider.cms > 0 && <span className="text-red-500 font-medium">{rider.cms} cms</span>}
            {rider.exchangeReturns > 0 && <span className="text-violet-500 font-medium">{rider.exchangeReturns} rtn</span>}
          </div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="divide-y divide-border/20">
          {/* Mini progress bar */}
          <div className="px-4 pb-2">
            <div className="h-1 bg-muted rounded-full overflow-hidden flex">
              {rider.delivered > 0 && (
                <div className="h-full bg-emerald-500" style={{ width: `${(rider.delivered / Math.max(rider.totalItems, 1)) * 100}%` }} />
              )}
              {rider.postponed > 0 && (
                <div className="h-full bg-amber-500" style={{ width: `${(rider.postponed / Math.max(rider.totalItems, 1)) * 100}%` }} />
              )}
              {rider.cms > 0 && (
                <div className="h-full bg-red-500" style={{ width: `${(rider.cms / Math.max(rider.totalItems, 1)) * 100}%` }} />
              )}
            </div>
          </div>
          {/* Delivery product list (non-return) */}
          {rider.products.filter(p => !p.returnType).map((p, i) => {
            const pending = p.totalQty - p.deliveredQty - p.postponedQty - p.returningQty
            return (
              <div key={i} className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {p.product}
                    {p.source === 'partner' && <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500">P</span>}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                    <span>Qty: <span className="font-semibold text-foreground">{p.totalQty}</span></span>
                    {p.deliveredQty > 0 && <span className="text-emerald-500 font-medium">{p.deliveredQty} del</span>}
                    {p.postponedQty > 0 && <span className="text-amber-500 font-medium">{p.postponedQty} nwd</span>}
                    {p.cmsQty > 0 && <span className="text-red-500 font-medium">{p.cmsQty} cms</span>}
                    {pending > 0 && <span>{pending} left</span>}
                  </div>
                </div>
                <span className="text-sm font-bold tabular-nums text-foreground">{p.totalQty}</span>
              </div>
            )
          })}
          {/* Return products section */}
          {rider.returnProducts.length > 0 && (
            <div className="border-t border-violet-500/20 bg-violet-500/[0.03]">
              <div className="px-4 py-1.5 flex items-center gap-1.5">
                <RotateCcw className="w-3 h-3 text-violet-400" />
                <p className="text-[9px] font-bold text-violet-400">COLLECTED RETURNS</p>
              </div>
              {rider.returnProducts.map((p, i) => (
                <div key={`rtn-${i}`} className="px-4 py-1.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-foreground truncate">{p.product}</p>
                      <span className={cn("px-1 py-0 rounded text-[7px] font-bold",
                        p.returnType === 'exchange' ? 'bg-violet-500/15 text-violet-400' :
                        p.returnType === 'trade_in' ? 'bg-blue-500/15 text-blue-400' :
                        'bg-red-500/15 text-red-400'
                      )}>
                        {p.returnType === 'exchange' ? 'EXCHG' : p.returnType === 'trade_in' ? 'TRADE' : 'REFND'}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-violet-400">{p.exchangeReturnQty}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stock Detail List ──
// Clickable category pills: Delivered, NWD, CMS, Returns (exchange/trade-in/refund), Pending
type StockCategory = 'delivered' | 'postponed' | 'returning' | 'returns' | 'pending' | null

function StockDetailList({ items, totalReceived, riderProducts }: { items: StockItem[]; totalReceived: number; riderProducts: RiderProducts[] }) {
  const [activeCategory, setActiveCategory] = useState<StockCategory>(null)

  const sortedItems = [...items].sort((a, b) => a.product.localeCompare(b.product))

  const totalDelivered = items.reduce((s, i) => s + (i.delivered_qty || 0), 0)
  const totalPostponed = items.reduce((s, i) => s + (i.postponed_qty || 0), 0)
  // The DB returning_qty lumps CMS + exchange returns. Use riderProducts to split them.
  const totalExchangeReturns = riderProducts.reduce((s, r) => s + r.exchangeReturns, 0)
  const totalRawReturning = items.reduce((s, i) => s + (i.returning_qty || 0), 0)
  const totalCms = Math.max(0, totalRawReturning - totalExchangeReturns)
  const totalPending = Math.max(0, totalReceived - totalDelivered - totalPostponed - totalRawReturning)
  const displayTotal = totalReceived

  const categories: { key: StockCategory; label: string; count: number; color: string; bg: string; border: string }[] = [
    { key: 'delivered', label: 'Delivered', count: totalDelivered, color: 'text-emerald-500', bg: 'bg-emerald-500', border: 'border-emerald-500' },
    { key: 'postponed', label: 'NWD', count: totalPostponed, color: 'text-amber-500', bg: 'bg-amber-500', border: 'border-amber-500' },
    { key: 'returning', label: 'CMS', count: totalCms, color: 'text-red-500', bg: 'bg-red-500', border: 'border-red-500' },
    { key: 'returns', label: 'Returns', count: totalExchangeReturns, color: 'text-violet-500', bg: 'bg-violet-500', border: 'border-violet-500' },
    { key: 'pending', label: 'Pending', count: totalPending, color: 'text-muted-foreground', bg: 'bg-muted-foreground', border: 'border-muted-foreground' },
  ]

  // Collect return products from riderProducts for 'returns' filter
  const allReturnProducts = riderProducts.flatMap(r => r.returnProducts || [])

  // Filter items based on active category
  const filteredItems = activeCategory && activeCategory !== 'returns'
    ? sortedItems.filter(item => {
        const received = item.received_qty ?? item.expected_qty
        const delivered = item.delivered_qty || 0
        const postponed = item.postponed_qty || 0
        const returning = item.returning_qty || 0
        const pending = received - delivered - postponed - returning

        if (activeCategory === 'delivered') return delivered > 0
        if (activeCategory === 'postponed') return postponed > 0
        if (activeCategory === 'returning') return returning > 0
        if (activeCategory === 'pending') return pending > 0
        return false
      })
    : []

  function getQtyForCategory(item: StockItem): number {
    const received = item.received_qty ?? item.expected_qty
    const delivered = item.delivered_qty || 0
    const postponed = item.postponed_qty || 0
    const returning = item.returning_qty || 0
    if (activeCategory === 'delivered') return delivered
    if (activeCategory === 'postponed') return postponed
    if (activeCategory === 'returning') return returning
    if (activeCategory === 'pending') return received - delivered - postponed - returning
    return 0
  }

  const activeMeta = categories.find(c => c.key === activeCategory)
  const processed = totalDelivered + totalPostponed + totalCms + totalExchangeReturns

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Stock Classification</p>
        </div>
        <span className="text-[10px] text-muted-foreground">{processed}/{displayTotal} processed</span>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
          {totalDelivered > 0 && (
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(totalDelivered / Math.max(displayTotal, 1)) * 100}%` }} />
          )}
          {totalPostponed > 0 && (
            <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${(totalPostponed / Math.max(displayTotal, 1)) * 100}%` }} />
          )}
          {totalCms > 0 && (
            <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(totalCms / Math.max(displayTotal, 1)) * 100}%` }} />
          )}
          {totalExchangeReturns > 0 && (
            <div className="h-full bg-violet-500 transition-all duration-500" style={{ width: `${(totalExchangeReturns / Math.max(displayTotal, 1)) * 100}%` }} />
          )}
        </div>
      </div>

      {/* Category pills - clickable */}
      <div className="px-4 pb-3 grid grid-cols-5 gap-1">
        {categories.map(cat => {
          const isActive = activeCategory === cat.key
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(isActive ? null : cat.key)}
              className={cn(
                'rounded-xl py-2 text-center transition-all border',
                isActive
                  ? `${cat.bg}/15 ${cat.border}/40 ${cat.color}`
                  : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50',
              )}
            >
              <p className={cn('text-[9px] font-medium', isActive ? `${cat.color}/80` : 'opacity-60')}>{cat.label}</p>
              <p className={cn('text-base font-bold tabular-nums', isActive ? cat.color : '')}>{cat.count}</p>
            </button>
          )
        })}
      </div>

      {/* Filtered product list (non-returns) */}
      {activeCategory && activeCategory !== 'returns' && filteredItems.length > 0 && (
        <div className="border-t border-border/50 divide-y divide-border/30 max-h-72 overflow-y-auto">
          {filteredItems.map(item => {
            const qty = getQtyForCategory(item)
            return (
              <div key={item.id} className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{item.product}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Qty: {item.expected_qty}
                    {item.source === 'partner' && (
                      <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500">Partner</span>
                    )}
                  </p>
                </div>
                <span className={cn('text-sm font-bold tabular-nums', activeMeta?.color)}>{qty}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Returns product list (exchange/trade-in/refund collected from customers) */}
      {activeCategory === 'returns' && allReturnProducts.length > 0 && (
        <div className="border-t border-violet-500/20 divide-y divide-border/30 max-h-72 overflow-y-auto bg-violet-500/[0.02]">
          {allReturnProducts.map((p, idx) => (
            <div key={idx} className="px-4 py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-foreground truncate">{p.product}</p>
                  <span className={cn("px-1 py-0 rounded text-[7px] font-bold",
                    p.returnType === 'exchange' ? 'bg-violet-500/15 text-violet-400' :
                    p.returnType === 'trade_in' ? 'bg-blue-500/15 text-blue-400' :
                    'bg-red-500/15 text-red-400'
                  )}>
                    {p.returnType === 'exchange' ? 'EXCHANGE' : p.returnType === 'trade_in' ? 'TRADE-IN' : 'REFUND'}
                  </span>
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-violet-500">{p.exchangeReturnQty}</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state for selected category */}
      {activeCategory && activeCategory !== 'returns' && filteredItems.length === 0 && (
        <div className="border-t border-border/50 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">No items in this category</p>
        </div>
      )}
      {activeCategory === 'returns' && allReturnProducts.length === 0 && (
        <div className="border-t border-border/50 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">No returns collected yet</p>
        </div>
      )}
    </div>
  )
}

// ── Rider Stock Breakdown ──
// Shows per-rider stock classification cards with expandable product lists
function RiderStockBreakdown({ riderProducts }: { riderProducts: RiderProducts[] }) {
  const activeRiders = riderProducts.filter(r => r.totalItems > 0)
  const [expandedRider, setExpandedRider] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<Record<string, string | null>>({})

  if (activeRiders.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Stock by Rider
        </h2>
        <span className="text-[10px] text-muted-foreground">{activeRiders.length} rider{activeRiders.length !== 1 ? 's' : ''}</span>
      </div>

      {activeRiders.map(rider => {
        const isExpanded = expandedRider === rider.riderId
        const processed = rider.delivered + rider.postponed + rider.returning
        const progress = rider.totalItems > 0 ? Math.round((processed / rider.totalItems) * 100) : 0
        const activeCat = expandedCategory[rider.riderId] || null

        const cats = [
          { key: 'delivered', label: 'Del', count: rider.delivered, color: 'text-emerald-500', bg: 'bg-emerald-500', border: 'border-emerald-500' },
          { key: 'postponed', label: 'NWD', count: rider.postponed, color: 'text-amber-500', bg: 'bg-amber-500', border: 'border-amber-500' },
          { key: 'returning', label: 'CMS', count: rider.returning, color: 'text-red-500', bg: 'bg-red-500', border: 'border-red-500' },
          { key: 'pending', label: 'Pend', count: rider.pending, color: 'text-muted-foreground', bg: 'bg-muted-foreground', border: 'border-muted-foreground' },
        ]

        // Filter products for active category
        const filteredProducts = activeCat
          ? rider.products.filter(p => {
              if (activeCat === 'delivered') return p.deliveredQty > 0
              if (activeCat === 'postponed') return p.postponedQty > 0
              if (activeCat === 'returning') return p.returningQty > 0
              if (activeCat === 'pending') return (p.totalQty - p.deliveredQty - p.postponedQty - p.returningQty) > 0
              return false
            })
          : []

        function getCatQty(p: typeof rider.products[number]) {
          if (activeCat === 'delivered') return p.deliveredQty
          if (activeCat === 'postponed') return p.postponedQty
          if (activeCat === 'returning') return p.returningQty
          if (activeCat === 'pending') return p.totalQty - p.deliveredQty - p.postponedQty - p.returningQty
          return 0
        }

        const catMeta = cats.find(c => c.key === activeCat)

        return (
          <div key={rider.riderId} className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Rider header - always visible */}
            <button
              onClick={() => setExpandedRider(isExpanded ? null : rider.riderId)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">
                  {rider.riderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{rider.riderName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{rider.totalItems} items</span>
                  <span className="text-[10px] text-muted-foreground">{progress}% processed</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {rider.delivered > 0 && <span className="text-[10px] font-bold text-emerald-500">{rider.delivered}</span>}
                {rider.postponed > 0 && <span className="text-[10px] font-bold text-amber-500">{rider.postponed}</span>}
                {rider.returning > 0 && <span className="text-[10px] font-bold text-red-500">{rider.returning}</span>}
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
              </div>
            </button>

            {/* Expanded: progress + categories + products */}
            {isExpanded && (
              <div className="border-t border-border/50">
                {/* Progress bar */}
                <div className="px-4 pt-3 pb-2">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                    {rider.delivered > 0 && (
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(rider.delivered / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                    {rider.postponed > 0 && (
                      <div className="h-full bg-amber-500 transition-all" style={{ width: `${(rider.postponed / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                    {rider.returning > 0 && (
                      <div className="h-full bg-red-500 transition-all" style={{ width: `${(rider.returning / Math.max(rider.totalItems, 1)) * 100}%` }} />
                    )}
                  </div>
                </div>

                {/* Category pills */}
                <div className="px-4 pb-3 grid grid-cols-4 gap-1.5">
                  {cats.map(cat => {
                    const isActive = activeCat === cat.key
                    return (
                      <button
                        key={cat.key}
                        onClick={() => setExpandedCategory(prev => ({
                          ...prev,
                          [rider.riderId]: isActive ? null : cat.key
                        }))}
                        className={cn(
                          'rounded-xl py-1.5 text-center transition-all border',
                          isActive
                            ? `${cat.bg}/15 ${cat.border}/40 ${cat.color}`
                            : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        <p className={cn('text-[8px] font-medium', isActive ? `${cat.color}/80` : 'opacity-60')}>{cat.label}</p>
                        <p className={cn('text-sm font-bold tabular-nums', isActive ? cat.color : '')}>{cat.count}</p>
                      </button>
                    )
                  })}
                </div>

                {/* Filtered product list */}
                {activeCat && filteredProducts.length > 0 && (
                  <div className="border-t border-border/30 divide-y divide-border/20 max-h-48 overflow-y-auto">
                    {filteredProducts.map((p, i) => (
                      <div key={i} className="px-4 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{p.product}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Total: {p.totalQty}
                            {p.source === 'partner' && (
                              <span className="ml-1.5 px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500">Partner</span>
                            )}
                          </p>
                        </div>
                        <span className={cn('text-sm font-bold tabular-nums', catMeta?.color)}>{getCatQty(p)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {activeCat && filteredProducts.length === 0 && (
                  <div className="border-t border-border/30 px-4 py-4 text-center">
                    <p className="text-[10px] text-muted-foreground">No items in this category</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Rider Delivery Overview ──
// Per-rider tabbed view: All / Delivered / NWD / CMS
function RiderDeliveryOverview({ riderProducts }: { riderProducts: RiderProducts[] }) {
  const [expandedRider, setExpandedRider] = useState<string | null>(null)
  const [riderTab, setRiderTab] = useState<Record<string, string>>({})

  const activeRiders = riderProducts.filter(r => r.totalItems > 0)
  const totalAll = activeRiders.reduce((s, r) => s + r.totalItems, 0)
  const totalDelivered = activeRiders.reduce((s, r) => s + r.delivered, 0)
  const totalPostponed = activeRiders.reduce((s, r) => s + r.postponed, 0)
  const totalCms = activeRiders.reduce((s, r) => s + r.cms, 0)
  const totalExchangeReturns = activeRiders.reduce((s, r) => s + r.exchangeReturns, 0)

  if (activeRiders.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <Truck className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No deliveries assigned to riders yet</p>
      </div>
    )
  }

  const tabs = [
    { key: 'all', label: 'All', count: totalAll, color: 'text-foreground', bg: 'bg-muted' },
    { key: 'delivered', label: 'Delivered', count: totalDelivered, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { key: 'nwd', label: 'NWD', count: totalPostponed, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { key: 'cms', label: 'CMS', count: totalCms, color: 'text-red-500', bg: 'bg-red-500/10' },
    { key: 'returns', label: 'Returns', count: totalExchangeReturns, color: 'text-violet-500', bg: 'bg-violet-500/10' },
  ]

  // Global filter
  const [globalTab, setGlobalTab] = useState('all')

  // Filter riders by global tab
  const filteredRiders = globalTab === 'all' ? activeRiders : activeRiders.filter(r => {
    if (globalTab === 'delivered') return r.delivered > 0
    if (globalTab === 'nwd') return r.postponed > 0
    if (globalTab === 'cms') return r.cms > 0
    if (globalTab === 'returns') return r.exchangeReturns > 0
    return true
  })

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <User className="w-4 h-4" />
          Orders Overview
        </h2>
        <span className="text-[10px] text-muted-foreground">{activeRiders.length} riders</span>
      </div>

      {/* Global status filter tabs */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/50">
        {tabs.map(tab => {
          const isActive = globalTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setGlobalTab(tab.key)}
              className={cn(
                "flex-1 py-1.5 px-1 rounded-lg text-[10px] font-semibold transition-all text-center",
                isActive
                  ? `bg-card shadow-sm ${tab.color}`
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              <span className={cn(
                "ml-1 tabular-nums",
                isActive ? tab.color : "text-muted-foreground/60"
              )}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Rider cards */}
      {filteredRiders.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-muted/10 p-6 text-center">
          <p className="text-xs text-muted-foreground">
            No {globalTab === 'nwd' ? 'postponed (NWD)' : globalTab === 'cms' ? 'returning (CMS)' : 'delivered'} items
          </p>
        </div>
      ) : (
        filteredRiders.map(r => {
          const isExpanded = expandedRider === r.riderId
          const currentTab = riderTab[r.riderId] || globalTab
          const processed = r.delivered + r.postponed + r.returning
          const progress = r.totalItems > 0 ? Math.round((processed / r.totalItems) * 100) : 0

          // Filter deliveries by current tab
          const filteredDeliveries = r.deliveries.filter(d => {
            if (currentTab === 'all') return true
            if (currentTab === 'delivered') return d.status === 'delivered' || d.status === 'picked_up'
            if (currentTab === 'nwd') return d.status === 'nwd'
            if (currentTab === 'cms') return d.status === 'cms'
            return true
          })

          // Count per status for tab badges
          const deliveredDels = r.deliveries.filter(d => d.status === 'delivered' || d.status === 'picked_up')
          const nwdDels = r.deliveries.filter(d => d.status === 'nwd')
          const cmsDels = r.deliveries.filter(d => d.status === 'cms')
          const pendingDels = r.deliveries.filter(d => !['delivered', 'picked_up', 'nwd', 'cms'].includes(d.status))

          const riderTabs = [
            { key: 'all', label: 'All', count: r.deliveries.length },
            { key: 'delivered', label: 'Done', count: deliveredDels.length, color: 'text-emerald-500', dot: 'bg-emerald-500' },
            { key: 'nwd', label: 'NWD', count: nwdDels.length, color: 'text-amber-500', dot: 'bg-amber-500' },
            { key: 'cms', label: 'CMS', count: cmsDels.length, color: 'text-red-500', dot: 'bg-red-500' },
          ]

          return (
            <div key={r.riderId} className="rounded-2xl border border-border bg-card overflow-hidden">
              {/* Rider header */}
              <button
                onClick={() => setExpandedRider(isExpanded ? null : r.riderId)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">
                    {r.riderName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{r.riderName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {r.delivered > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {r.delivered}
                      </span>
                    )}
                    {r.postponed > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {r.postponed}
                      </span>
                    )}
                    {r.returning > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-red-500 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {r.returning}
                      </span>
                    )}
                    {r.pending > 0 && (
                      <span className="text-[10px] text-muted-foreground">{r.pending} pending</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {progress === 100 ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <div className="w-9 h-9 rounded-full border-2 border-primary/20 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-primary">{progress}%</span>
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border">
                  {/* Progress bar */}
                  <div className="px-4 py-2 bg-muted/10">
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                      {r.delivered > 0 && (
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(r.delivered / r.totalItems) * 100}%` }} />
                      )}
                      {r.postponed > 0 && (
                        <div className="h-full bg-amber-500 transition-all" style={{ width: `${(r.postponed / r.totalItems) * 100}%` }} />
                      )}
                      {r.returning > 0 && (
                        <div className="h-full bg-red-500 transition-all" style={{ width: `${(r.returning / r.totalItems) * 100}%` }} />
                      )}
                    </div>
                  </div>

                  {/* Per-rider tab filter */}
                  <div className="px-3 py-1.5 flex items-center gap-1 border-b border-border bg-muted/5">
                    {riderTabs.map(tab => {
                      if (tab.count === 0 && tab.key !== 'all') return null
                      const isActive = currentTab === tab.key
                      return (
                        <button
                          key={tab.key}
                          onClick={(e) => { e.stopPropagation(); setRiderTab(prev => ({ ...prev, [r.riderId]: tab.key })) }}
                          className={cn(
                            "px-2 py-1 rounded-md text-[10px] font-medium transition-all",
                            isActive
                              ? "bg-card shadow-sm border border-border text-foreground"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {tab.dot && <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1", tab.dot)} />}
                          {tab.label}
                          {tab.count > 0 && <span className="ml-0.5 tabular-nums">{tab.count}</span>}
                        </button>
                      )
                    })}
                  </div>

                  {/* Delivery list */}
                  {filteredDeliveries.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[11px] text-muted-foreground">No {currentTab === 'all' ? '' : currentTab} deliveries</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {filteredDeliveries.map(d => {
                        const statusConfig = {
                          delivered: { label: 'Delivered', color: 'text-emerald-500', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
                          picked_up: { label: 'Delivered', color: 'text-emerald-500', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
                          nwd: { label: 'NWD', color: 'text-amber-500', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
                          cms: { label: 'CMS', color: 'text-red-500', bg: 'bg-red-500/10', dot: 'bg-red-500' },
                        }[d.status] || { label: 'Pending', color: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground/40' }

                        return (
                          <div key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                            <div className={cn("w-2 h-2 rounded-full shrink-0", statusConfig.dot)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-medium text-foreground truncate">{d.product}</p>
                                {d.source === 'partner' && (
                                  <span className="shrink-0 px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/10 text-blue-500">P</span>
                                )}
                              </div>
                {d.locality && (
                    <p className="text-[10px] text-muted-foreground truncate">{d.locality}{d.address ? ` - ${d.address}` : ''}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-bold text-foreground tabular-nums">x{d.qty}</span>
                              <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-semibold", statusConfig.bg, statusConfig.color)}>
                                {statusConfig.label}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Rider summary footer */}
                  {(nwdDels.length > 0 || cmsDels.length > 0) && currentTab === 'all' && (
                    <div className="px-4 py-2 border-t border-border bg-muted/5">
                      <div className="flex items-center gap-3">
                        {nwdDels.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <CalendarClock className="w-3 h-3 text-amber-500" />
                            <span className="text-[10px] text-amber-500 font-medium">
                              {nwdDels.reduce((s, d) => s + d.qty, 0)} to reschedule
                            </span>
                          </div>
                        )}
                        {cmsDels.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <RotateCcw className="w-3 h-3 text-red-500" />
                            <span className="text-[10px] text-red-500 font-medium">
                              {cmsDels.reduce((s, d) => s + d.qty, 0)} to collect back
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Single Stock Item Row ──
function StockItemRow({
  item,
  isValidated,
  onQtyChange,
}: {
  item: StockItem
  isValidated: boolean
  onQtyChange: (id: string, qty: number) => void
}) {
  const received = item.received_qty ?? item.expected_qty
  const isMatch = received === item.expected_qty
  const delivered = item.delivered_qty || 0
  const postponed = item.postponed_qty || 0
  const returning = item.returning_qty || 0
  const pending = received - delivered - postponed - returning
  const hasActivity = delivered > 0 || postponed > 0 || returning > 0

  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{item.product}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Expected: <span className="font-semibold text-foreground">{item.expected_qty}</span></span>
          {hasActivity && isValidated && (
            <>
              {delivered > 0 && <span className="text-emerald-500 font-medium">{delivered} done</span>}
              {postponed > 0 && <span className="text-amber-500 font-medium">{postponed} NWD</span>}
              {returning > 0 && <span className="text-red-500 font-medium">{returning} CMS</span>}
              {pending > 0 && <span className="text-muted-foreground">{pending} left</span>}
            </>
          )}
        </div>
      </div>

      {isValidated ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn(
            "text-sm font-bold tabular-nums",
            isMatch ? "text-emerald-500" : "text-amber-500"
          )}>
            {received}
          </span>
          {isMatch ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onQtyChange(item.id, Math.max(0, received - 1))}
            className="w-7 h-7 rounded-lg border border-border bg-muted flex items-center justify-center hover:bg-muted/80 active:scale-95 transition-all"
          >
            <Minus className="w-3 h-3 text-foreground" />
          </button>
          <div className={cn(
            "w-10 h-7 rounded-lg border flex items-center justify-center text-xs font-bold tabular-nums",
            isMatch
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
              : "border-amber-500/30 bg-amber-500/5 text-amber-600"
          )}>
            {received}
          </div>
          <button
            onClick={() => onQtyChange(item.id, received + 1)}
            className="w-7 h-7 rounded-lg border border-border bg-muted flex items-center justify-center hover:bg-muted/80 active:scale-95 transition-all"
          >
            <Plus className="w-3 h-3 text-foreground" />
          </button>
        </div>
      )}
    </div>
  )
}
