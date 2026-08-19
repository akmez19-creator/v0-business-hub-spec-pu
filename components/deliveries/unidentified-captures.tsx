'use client'

// Photos an agent counted but could not identify.
//
// Each row already holds a real quantity and shelf, so nothing here is
// throwaway - it becomes a count line the moment a product is confirmed. The
// point of the queue is that the agent never has to walk back to the shelf.
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HelpCircle, Loader2, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmCaptureMatch, discardCapture } from '@/lib/stock-count-actions'
import type { MatchCandidate } from '@/lib/types'

interface Capture {
  id: string
  photo_url: string
  counted_qty: number
  shelf_code: string | null
  zone: string | null
  status: string
  ai_label: string | null
  ai_candidates: MatchCandidate[] | null
  ai_error: string | null
  created_at: string
  count_status: string
  counted_by_name: string
}

interface Option {
  id: string
  name: string
  category: string | null
  image_url: string | null
}

export function UnidentifiedCaptures({
  captures,
  products,
}: {
  captures: Capture[]
  products: Option[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products
      .filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q),
      )
      .slice(0, 15)
  }, [products, query])

  if (!captures.length) return null

  async function handleConfirm(captureId: string, productId: string) {
    setBusyId(captureId)
    setError(null)
    const res = await confirmCaptureMatch({ captureId, productId })
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setOpenId(null)
    setQuery('')
    startTransition(() => router.refresh())
  }

  async function handleDiscard(captureId: string) {
    setBusyId(captureId)
    setError(null)
    const res = await discardCapture(captureId)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  /** Re-run matching - useful when the first attempt was cut short. */
  async function handleRetry(captureId: string) {
    setRetryingId(captureId)
    setError(null)
    try {
      await fetch('/api/stock-count/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId }),
      })
      startTransition(() => router.refresh())
    } catch {
      setError('Could not re-run matching')
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <header className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            Photos awaiting identification
          </h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {captures.length} {captures.length === 1 ? 'photo was' : 'photos were'}{' '}
            counted on the shelf but not matched to a product. The quantity is
            already recorded - confirm the product to turn it into a count line.
          </p>
        </div>
      </header>

      {error && <p className="text-[12px] text-rose-400">{error}</p>}

      <ul className="flex flex-col gap-2">
        {captures.map(c => {
          const isOpen = openId === c.id
          const busy = busyId === c.id || (isPending && isOpen)
          // A submitted-but-unapproved session can still take the line; an
          // approved one cannot, because its figures are already in stock.
          const locked = c.count_status === 'approved'

          return (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start gap-3">
                <ImageLightbox
                  src={c.photo_url}
                  alt={c.ai_label || 'Unidentified item'}
                  caption={`Qty ${c.counted_qty}${c.shelf_code ? ` · shelf ${c.shelf_code}` : ''}`}
                  className="h-16 w-16 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Qty {c.counted_qty}
                    {c.shelf_code && (
                      <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                        {c.shelf_code}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.counted_by_name} · {new Date(c.created_at).toLocaleDateString()}
                  </p>
                  {c.ai_label && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      AI read it as{' '}
                      <span className="text-foreground">{c.ai_label}</span>
                    </p>
                  )}
                  {c.status === 'analysing' && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-primary" /> Matching never
                      finished
                    </p>
                  )}
                  {c.ai_error && (
                    <p className="mt-1 text-[11px] text-amber-400">{c.ai_error}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-[11px]"
                    disabled={retryingId === c.id}
                    onClick={() => handleRetry(c.id)}
                  >
                    {retryingId === c.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Re-run
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    disabled={busy}
                    onClick={() => handleDiscard(c.id)}
                  >
                    <Trash2 className="h-3 w-3" /> Discard
                  </Button>
                </div>
              </div>

              {locked ? (
                <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                  That count is already approved, so this cannot be added to it -
                  record the item in a new count, then discard this photo.
                </p>
              ) : (
                <>
                  {/* The AI's own shortlist, if it produced one. */}
                  {c.ai_candidates && c.ai_candidates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {c.ai_candidates.slice(0, 5).map(cand => (
                        <button
                          key={cand.product_id}
                          disabled={busy}
                          onClick={() => handleConfirm(c.id, cand.product_id)}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:opacity-50"
                          title={cand.reason}
                        >
                          {cand.name}
                          <span className="text-muted-foreground">
                            {Math.round(cand.confidence * 100)}%
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {isOpen ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search products…"
                        autoFocus
                      />
                      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                        {results.map(p => (
                          <li
                            key={p.id}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/50"
                          >
                            <ImageLightbox
                              src={p.image_url}
                              alt={p.name}
                              caption={p.name}
                              className="h-9 w-9"
                            />
                            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                              {p.name}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 text-[11px]"
                              disabled={busy}
                              onClick={() => handleConfirm(c.id, p.id)}
                            >
                              Pick
                            </Button>
                          </li>
                        ))}
                        {query.trim() && results.length === 0 && (
                          <li className="px-1.5 py-2 text-[11px] text-muted-foreground">
                            Nothing matches that name.
                          </li>
                        )}
                      </ul>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 self-start text-[12px]"
                      onClick={() => {
                        setOpenId(c.id)
                        setQuery('')
                      }}
                    >
                      <Search className="h-3.5 w-3.5" /> Find product
                    </Button>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
