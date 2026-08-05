'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, Download, ImageOff, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Bulk one-click posts: run the SAME poster+caption generator that Poster
 * Studio's "One-click post" button uses, but for many products at once.
 *
 * Design notes:
 * - Products with no usable photo are SKIPPED, not failed. The generator needs
 *   a source image, so those are pulled out up front and listed with the reason
 *   rather than firing doomed requests.
 * - Generations run through a small concurrency pool (not all at once): each
 *   product already fans out to four model calls server-side, so launching
 *   every product in parallel would mean dozens of simultaneous paid calls and
 *   rate-limit rejections. Two products in flight keeps it moving without that.
 * - Each product settles on its own. One product erroring never blocks or
 *   discards the others - the whole point of a batch is partial success.
 */

export interface BulkProduct {
  id: string
  name: string
  image: string | null
  price?: number | string | null
  promoPrice?: number | string | null
}

type PostCopy = { hook: string; body: string; cta: string; hashtags: string; raw: string }
type Option = {
  label: string
  provider: 'google' | 'openai'
  image: string | null
  imageError: string | null
  post: PostCopy | null
  copyError: string | null
}
type RowStatus = 'pending' | 'running' | 'done' | 'error'
interface Row {
  product: BulkProduct
  status: RowStatus
  options?: Option[]
  error?: string
}

// Two products in flight at once. Each one is itself four model calls, so this
// is really "up to eight model calls at a time" - already plenty.
const CONCURRENCY = 2

const hasPhoto = (p: BulkProduct) => !!(p.image && String(p.image).trim())

const captionText = (p: PostCopy) =>
  [p.hook, p.body, p.cta, p.hashtags].map((s) => s?.trim()).filter(Boolean).join('\n\n')

export function BulkPosterDialog({
  open,
  onOpenChange,
  products,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Snapshot of the selected products, taken when the dialog opens */
  products: BulkProduct[]
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [skipped, setSkipped] = useState<BulkProduct[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  // Guards the runner so a re-render while generating cannot kick off a second
  // pass over the same products (which would double every paid call).
  const startedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      // Reset for the next open. Results are intentionally discarded on close -
      // they are large data URLs and holding them all is a memory sink.
      startedRef.current = false
      setRows([])
      setSkipped([])
      return
    }
    if (startedRef.current) return
    startedRef.current = true

    const runnable = products.filter(hasPhoto)
    setRows(runnable.map((product) => ({ product, status: 'pending' as RowStatus })))
    setSkipped(products.filter((p) => !hasPhoto(p)))

    // ── the concurrency pool ──
    const runOne = async (product: BulkProduct) => {
      setRows((rs) => rs.map((r) => (r.product.id === product.id ? { ...r, status: 'running' } : r)))
      try {
        // Promo price becomes the highlighted "now"; the list price becomes the
        // struck-out "was" only when a promo actually exists.
        const priceNow = product.promoPrice ?? product.price ?? ''
        const priceWas =
          product.promoPrice != null && String(product.promoPrice) !== '' && product.price != null
            ? product.price
            : ''
        const res = await fetch('/api/product-master/generate-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            productName: product.name,
            sourceImage: product.image,
            priceNow: String(priceNow),
            priceWas: String(priceWas),
            currency: 'Rs',
          }),
        })
        const json = await res.json()
        const options: Option[] = Array.isArray(json.options) ? json.options : []
        // A partial result (one provider worked) still counts as done.
        if (!json.success && options.length === 0) throw new Error(json.error || 'Generation failed')
        setRows((rs) =>
          rs.map((r) => (r.product.id === product.id ? { ...r, status: 'done', options } : r)),
        )
      } catch (e) {
        setRows((rs) =>
          rs.map((r) =>
            r.product.id === product.id
              ? { ...r, status: 'error', error: e instanceof Error ? e.message : 'Generation failed' }
              : r,
          ),
        )
      }
    }

    let cursor = 0
    let cancelled = false
    const worker = async () => {
      while (!cancelled && cursor < runnable.length) {
        const next = runnable[cursor++]
        await runOne(next)
      }
    }
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, runnable.length) }, worker))

    return () => {
      // If the dialog unmounts mid-run, stop handing out new work. In-flight
      // requests still resolve, but their setState no-ops after reset.
      cancelled = true
    }
  }, [open, products])

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      // Clipboard may be blocked; the caption is visible on screen regardless.
    }
  }

  const done = rows.filter((r) => r.status === 'done').length
  const errored = rows.filter((r) => r.status === 'error').length
  const finished = rows.length > 0 && rows.every((r) => r.status === 'done' || r.status === 'error')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/15">
              <Sparkles className="h-4 w-4 text-fuchsia-400" />
            </span>
            Bulk posts
            <span className="font-normal text-muted-foreground">
              {rows.length} product{rows.length === 1 ? '' : 's'}
            </span>
          </DialogTitle>
          <DialogDescription>
            Each product gets a poster and caption from both Gemini and ChatGPT, just like the One-click
            button. Pick the better one per product.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            {/* Progress line - the batch is long, so it must be legible at a glance */}
            {rows.length > 0 && (
              <div className="flex items-center gap-3 text-sm">
                {finished ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-fuchsia-400" />
                )}
                <span className="font-medium">
                  {done + errored} of {rows.length} done
                  {errored > 0 && <span className="text-destructive"> ({errored} failed)</span>}
                </span>
              </div>
            )}

            {/* Skipped products - named with the reason so nothing vanishes silently */}
            {skipped.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-500">
                  <ImageOff className="h-3.5 w-3.5" />
                  Skipped {skipped.length} product{skipped.length === 1 ? '' : 's'} with no photo
                </p>
                <p className="text-xs text-muted-foreground">
                  {skipped.map((p) => p.name).join(', ')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Add a photo in Poster Studio (upload or a marketplace listing), then run these again.
                </p>
              </div>
            )}

            {rows.length === 0 && skipped.length > 0 && (
              <p className="text-sm text-muted-foreground">
                None of the selected products have a photo, so there is nothing to generate.
              </p>
            )}

            {/* One block per product */}
            {rows.map((row) => (
              <section key={row.product.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <header className="flex items-center gap-2">
                  {row.product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.product.image || '/placeholder.svg'}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  ) : null}
                  <span className="truncate text-sm font-semibold">{row.product.name}</span>
                  <span className="ml-auto shrink-0">
                    {row.status === 'pending' && (
                      <span className="text-xs text-muted-foreground">Queued</span>
                    )}
                    {row.status === 'running' && (
                      <span className="flex items-center gap-1.5 text-xs text-fuchsia-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Generating
                      </span>
                    )}
                    {row.status === 'done' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <Check className="h-3.5 w-3.5" />
                        Ready
                      </span>
                    )}
                    {row.status === 'error' && (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Failed
                      </span>
                    )}
                  </span>
                </header>

                {row.status === 'error' && (
                  <p className="text-xs text-destructive">{row.error}</p>
                )}

                {row.status === 'done' && row.options && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {row.options.map((opt) => {
                      const text = opt.post ? captionText(opt.post) : ''
                      const key = `${row.product.id}:${opt.provider}`
                      return (
                        <article
                          key={key}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wide">{opt.label}</h4>
                            {opt.image && (
                              <a
                                href={opt.image}
                                download={`${row.product.name}-${opt.label}.png`.replace(/\s+/g, '-').toLowerCase()}
                                className="inline-flex items-center rounded-md px-2 py-1 text-xs hover:bg-muted"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span className="sr-only">Download {opt.label} poster</span>
                              </a>
                            )}
                          </div>

                          {opt.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={opt.image || '/placeholder.svg'}
                              alt={`${opt.label} poster for ${row.product.name}`}
                              className="w-full rounded-md border border-border"
                            />
                          ) : (
                            <p className="flex items-start gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {opt.imageError || 'No poster returned'}
                            </p>
                          )}

                          {opt.post ? (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">Caption</span>
                                <Button size="sm" variant="ghost" onClick={() => void copy(key, text)}>
                                  {copied === key ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                  <span className="ml-1 text-xs">{copied === key ? 'Copied' : 'Copy'}</span>
                                </Button>
                              </div>
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs leading-relaxed">
                                {text}
                              </pre>
                            </div>
                          ) : (
                            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {opt.copyError || 'No caption returned'}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
