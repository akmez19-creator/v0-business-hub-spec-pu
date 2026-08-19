'use client'

// Physical Stock Count - warehouse stocktake for the StoreKeeper module.
//
// Search-and-add flow: the agent finds a product, types what is physically on
// the shelf, and the line is saved immediately so a dropped connection or a
// locked phone never loses a counted shelf. Nothing touches real stock until an
// admin approves the submitted session.
import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList,
  Search,
  X,
  Loader2,
  Check,
  Send,
  Trash2,
  AlertTriangle,
  Package,
  TrendingUp,
  TrendingDown,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { mediaSrc } from '@/lib/media-url'
import {
  getOrCreateDraftCount,
  saveCountItem,
  removeCountItem,
  submitCount,
} from '@/lib/stock-count-actions'

interface CountProduct {
  id: string
  name: string
  category: string | null
  quantity: number | null
  image_url: string | null
  last_counted_at: string | null
  has_variants: boolean
}

interface CountItem {
  id: string
  product_id: string
  counted_qty: number
  system_qty: number
  is_baseline: boolean
  variance: number
  notes: string | null
}

interface RecentCount {
  id: string
  count_date: string
  status: string
  submitted_at: string | null
  reviewed_at: string | null
  review_notes: string | null
}

/**
 * A product has three distinct states, and collapsing them misleads the agent:
 *
 *  1. Formally counted before  -> last_counted_at set; the book figure is trusted.
 *  2. Has stock but uncounted  -> quantity > 0, last_counted_at null. Stock predates
 *     this module, so the number is real book stock worth reconciling against, NOT
 *     something to ignore.
 *  3. No stock on record       -> quantity 0/null and never counted; a true baseline.
 *
 * Only case 3 is a genuine "never counted" opening figure.
 */
function countLabel(p: CountProduct): string {
  if (p.last_counted_at) return `System: ${p.quantity || 0}`
  if (p.quantity) return `Book: ${p.quantity} · not yet verified`
  return 'No stock on record'
}

function activeDetailLabel(p: CountProduct): string {
  if (p.last_counted_at) return `System stock: ${p.quantity || 0}`
  if (p.quantity) return `Book stock: ${p.quantity} — never physically verified`
  return 'No stock on record - this sets the opening figure'
}

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
}

export function StockCountContent({
  products,
  draft,
  draftItems,
  recentCounts,
}: {
  products: CountProduct[]
  draft: { id: string; count_date: string; notes: string | null } | null
  draftItems: CountItem[]
  recentCounts: RecentCount[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [countId, setCountId] = useState<string | null>(draft?.id ?? null)
  const [items, setItems] = useState<CountItem[]>(draftItems)
  const [search, setSearch] = useState('')
  const [activeProduct, setActiveProduct] = useState<CountProduct | null>(null)
  const [qtyInput, setQtyInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitNotes, setSubmitNotes] = useState('')

  const qtyRef = useRef<HTMLInputElement>(null)

  const countedIds = useMemo(() => new Set(items.map((i) => i.product_id)), [items])
  const productById = useMemo(() => {
    const m = new Map<string, CountProduct>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // Only search once the agent has typed something: rendering all ~488
  // products would bury the input on a phone.
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
      .slice(0, 25)
  }, [products, search])

  useEffect(() => {
    if (activeProduct) qtyRef.current?.focus()
  }, [activeProduct])

  const totals = useMemo(() => {
    let counted = 0
    let baseline = 0
    let over = 0
    let short = 0
    for (const i of items) {
      counted += i.counted_qty
      if (i.is_baseline) baseline++
      else if (i.variance > 0) over++
      else if (i.variance < 0) short++
    }
    return { counted, baseline, over, short }
  }, [items])

  function openProduct(p: CountProduct) {
    const existing = items.find((i) => i.product_id === p.id)
    setActiveProduct(p)
    setQtyInput(existing ? String(existing.counted_qty) : '')
    setError(null)
  }

  async function handleSave() {
    if (!activeProduct) return
    const qty = Number(qtyInput)
    if (qtyInput.trim() === '' || !Number.isInteger(qty) || qty < 0) {
      setError('Enter a whole number of 0 or more')
      return
    }

    setError(null)
    setSavingId(activeProduct.id)

    // Create the session lazily on first save so merely opening the page does
    // not leave empty draft sessions behind.
    let id = countId
    if (!id) {
      const res = await getOrCreateDraftCount()
      if (!res.ok) {
        setError(res.error)
        setSavingId(null)
        return
      }
      id = res.data!.id
      setCountId(id)
    }

    const res = await saveCountItem({
      countId: id,
      productId: activeProduct.id,
      countedQty: qty,
    })

    if (!res.ok) {
      setError(res.error)
      setSavingId(null)
      return
    }

    // Must mirror the server's baseline rule exactly (see stock-count-actions):
    // only a product with no book stock at all is a true baseline. The server is
    // authoritative; this is purely so the row reads correctly before the next
    // round-trip.
    const isBaseline = !activeProduct.last_counted_at && !activeProduct.quantity
    const systemQty = activeProduct.quantity || 0

    setItems((prev) => {
      const rest = prev.filter((i) => i.product_id !== activeProduct.id)
      return [
        {
          id: prev.find((i) => i.product_id === activeProduct.id)?.id || `tmp-${activeProduct.id}`,
          product_id: activeProduct.id,
          counted_qty: qty,
          system_qty: systemQty,
          is_baseline: isBaseline,
          variance: qty - systemQty,
          notes: null,
        },
        ...rest,
      ]
    })

    setSavingId(null)
    setActiveProduct(null)
    setQtyInput('')
    setSearch('')
    startTransition(() => router.refresh())
  }

  async function handleRemove(item: CountItem) {
    if (item.id.startsWith('tmp-')) {
      setItems((prev) => prev.filter((i) => i.product_id !== item.product_id))
      startTransition(() => router.refresh())
      return
    }
    setSavingId(item.product_id)
    const res = await removeCountItem(item.id)
    setSavingId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    startTransition(() => router.refresh())
  }

  async function handleSubmit() {
    if (!countId) return
    setError(null)
    const res = await submitCount(countId, submitNotes || undefined)
    if (!res.ok) {
      setError(res.error)
      return
    }
    // Clear local session state; the server has moved it out of draft.
    setItems([])
    setCountId(null)
    setShowSubmit(false)
    setSubmitNotes('')
    startTransition(() => router.refresh())
  }

  return (
    /* pb-44 clears BOTH the app's bottom tab bar (bottom-0, h-16) and the fixed
       submit bar stacked above it (bottom-16), so the last counted row stays
       readable instead of hiding behind them. */
    <div className="flex flex-col gap-4 pb-44">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <ClipboardList className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight text-foreground">Physical Count</h1>
            <p className="text-xs text-muted-foreground">Warehouse stocktake</p>
          </div>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <p className="text-lg font-semibold leading-none text-foreground">{items.length}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">counted</p>
          </div>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <p className="text-xs text-rose-300">{error}</p>
        </div>
      )}

      {/* Search: the entry point for the whole flow. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product to count..."
          className="w-full rounded-xl border border-border bg-card py-3 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-1.5">
          {results.map((p) => {
            const already = countedIds.has(p.id)
            return (
              <li key={p.id}>
                <button
                  onClick={() => openProduct(p)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {p.image_url ? (
                      <img
                        src={mediaSrc(p.image_url) || '/placeholder.svg'}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                                {countLabel(p)}
                                {p.category ? ` · ${p.category}` : ''}
                    </p>
                  </div>
                  {already ? (
                    <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-400">
                      <Check className="h-3 w-3" /> Counted
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Tap to count</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {search.trim() && results.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No product matches &ldquo;{search.trim()}&rdquo;
        </p>
      )}

      {/* Counted lines */}
      {items.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              This session
            </h2>
            <p className="text-[11px] text-muted-foreground">{totals.counted.toLocaleString()} units</p>
          </div>

          {/* Variance rollup, so the agent sees anomalies before submitting. */}
          {(totals.over > 0 || totals.short > 0 || totals.baseline > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {totals.baseline > 0 && (
                <span className="flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-400">
                    <Sparkles className="h-3 w-3" /> {totals.baseline} opening
                </span>
              )}
              {totals.over > 0 && (
                <span className="flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-400">
                  <TrendingUp className="h-3 w-3" /> {totals.over} over
                </span>
              )}
              {totals.short > 0 && (
                <span className="flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-400">
                  <TrendingDown className="h-3 w-3" /> {totals.short} short
                </span>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-1.5">
            {items.map((item) => {
              const p = productById.get(item.product_id)
              const busy = savingId === item.product_id
              return (
                <li
                  key={item.product_id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                >
                  <button
                    onClick={() => p && openProduct(p)}
                    className="min-w-0 flex-1 text-left"
                    disabled={!p}
                  >
                    <p className="truncate text-sm font-medium text-foreground">
                      {p?.name || 'Unknown product'}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {item.is_baseline ? (
                          // No variance shown: there was no book stock at all, so
                          // this count establishes the opening figure.
                          <span className="text-[10px] font-medium text-sky-400">Opening count</span>
                      ) : item.variance === 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          Matches system ({item.system_qty})
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'text-[10px] font-medium',
                            item.variance > 0 ? 'text-emerald-400' : 'text-rose-400',
                          )}
                        >
                          {item.variance > 0 ? '+' : ''}
                          {item.variance} vs system {item.system_qty}
                        </span>
                      )}
                    </div>
                  </button>
                  <span className="shrink-0 text-base font-semibold text-foreground">
                    {item.counted_qty.toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleRemove(item)}
                    disabled={busy}
                    aria-label={`Remove ${p?.name || 'line'}`}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : (
        !search.trim() && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10">
            <ClipboardList className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No products counted yet</p>
            <p className="max-w-[15rem] text-center text-xs text-muted-foreground">
              Search for a product above and enter the quantity you physically counted.
            </p>
          </div>
        )
      )}

      {/* Recent submissions, with the admin's decision. */}
      {recentCounts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent</h2>
          <ul className="flex flex-col gap-1.5">
            {recentCounts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {new Date(c.count_date).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </p>
                  {c.review_notes && (
                    <p className="truncate text-[11px] text-muted-foreground">{c.review_notes}</p>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium capitalize',
                    STATUS_STYLES[c.status] || 'bg-muted text-muted-foreground border-border',
                  )}
                >
                  {c.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Submit bar sits above the app's bottom tab bar. */}
      {items.length > 0 && !activeProduct && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <button
            onClick={() => setShowSubmit(true)}
            disabled={isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Submit {items.length} {items.length === 1 ? 'product' : 'products'} for approval
          </button>
        </div>
      )}

      {/* Quantity entry sheet */}
      {activeProduct && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm">
          <div className="w-full rounded-t-2xl border-t border-border bg-card p-4 pb-8">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {activeProduct.image_url ? (
                  <img
                    src={mediaSrc(activeProduct.image_url) || '/placeholder.svg'}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{activeProduct.name}</p>
                <p className="text-xs text-muted-foreground">
                    {activeDetailLabel(activeProduct)}
                </p>
              </div>
              <button
                onClick={() => {
                  setActiveProduct(null)
                  setError(null)
                }}
                aria-label="Cancel"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeProduct.has_variants && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <p className="text-[11px] text-amber-300">
                  This product has variants. Enter the total across all variants.
                </p>
              </div>
            )}

            <label htmlFor="counted-qty" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Physical quantity counted
            </label>
            <input
              id="counted-qty"
              ref={qtyRef}
              type="number"
              inputMode="numeric"
              min={0}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onKeyDown={(e) => {
                // Don't submit mid-IME composition.
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault()
                  handleSave()
                }
              }}
              placeholder="0"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-2xl font-semibold text-foreground focus:border-primary/50 focus:outline-none"
            />

            {/* Live variance preview, so a mistyped digit is obvious before saving. */}
            {qtyInput.trim() !== '' &&
              Number.isInteger(Number(qtyInput)) &&
              activeProduct.last_counted_at && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {Number(qtyInput) === (activeProduct.quantity || 0) ? (
                    'Matches system stock'
                  ) : (
                    <>
                      Variance:{' '}
                      <span
                        className={cn(
                          'font-medium',
                          Number(qtyInput) > (activeProduct.quantity || 0)
                            ? 'text-emerald-400'
                            : 'text-rose-400',
                        )}
                      >
                        {Number(qtyInput) > (activeProduct.quantity || 0) ? '+' : ''}
                        {Number(qtyInput) - (activeProduct.quantity || 0)}
                      </span>
                    </>
                  )}
                </p>
              )}

            {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

            <button
              onClick={handleSave}
              disabled={savingId === activeProduct.id}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingId === activeProduct.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save count
            </button>
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      {showSubmit && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm">
          <div className="w-full rounded-t-2xl border-t border-border bg-card p-4 pb-8">
            <h3 className="text-sm font-semibold text-foreground">Submit for approval</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {items.length} {items.length === 1 ? 'product' : 'products'} ·{' '}
              {totals.counted.toLocaleString()} units. Stock updates only once an admin approves.
            </p>

            <label htmlFor="submit-notes" className="mb-1.5 mt-3 block text-xs font-medium text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              id="submit-notes"
              value={submitNotes}
              onChange={(e) => setSubmitNotes(e.target.value)}
              rows={3}
              placeholder="Anything the admin should know..."
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
            />

            {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowSubmit(false)}
                className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                Keep counting
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
