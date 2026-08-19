'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, ImageIcon, Loader2, Search, ShieldCheck, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { mediaSrc } from '@/lib/media-url'

/** A ranked 1688 listing, as returned by the marketplace search. */
interface SupplierHit {
  id: string
  title: string
  image: string | null
  price: string | null
  sold: number
  pageUrl: string | null
  score: number
  seller: {
    name: string | null
    years: number
    repurchaseRate: number
    verified: boolean
    rating: number
  }
}

/** 12400 reads as 12.4k at a glance; the exact figure is never the point. */
const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n)

/**
 * Marketplace CDNs block hotlinking, so their thumbnails go through the same
 * authenticated proxy the rest of the picker uses. mediaSrc rewrites only those
 * hosts: a reference photo you just uploaded sits on Vercel Blob, which the
 * proxy does not allowlist, so proxying it would 403 the very photo you are
 * searching with.
 */
const proxied = (url: string) => mediaSrc(url)

/**
 * Finds a replacement 1688 supplier from a photo of the product.
 *
 * When a listing dies the photo is usually all that survives, so the photo is
 * the way back to a live listing. Results are ranked by sales volume together
 * with supplier trust signals, because the goal is a seller worth re-ordering
 * from rather than merely a page that loads.
 */
export function SupplierFinder({
  productName,
  currentImage,
  onPick,
  onClose,
}: {
  productName: string
  currentImage?: string | null
  onPick: (url: string) => void
  onClose: () => void
}) {
  const [reference, setReference] = useState<string | null>(currentImage ?? null)
  const [preview, setPreview] = useState<string | null>(currentImage ?? null)
  const [busy, setBusy] = useState<'upload' | 'search' | null>(null)
  const [hits, setHits] = useState<SupplierHit[]>([])
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  // Names the vision pass read off the photo, and which one produced the
  // results on screen - without that the reviewer cannot tell what they are
  // looking at after tapping two chips.
  const [terms, setTerms] = useState<string[]>([])
  const [activeTerm, setActiveTerm] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * Host the image so Alibaba can fetch it.
   *
   * 1688's image search only accepts an Alibaba-hosted photo, and the server
   * converts by having Alibaba pull from a URL - which a local File or a
   * clipboard blob does not have. Uploading first is what makes both work.
   */
  const takeFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image')
      return
    }
    setError('')
    setBusy('upload')
    // Show the local copy immediately - waiting on the upload to render the
    // thumbnail makes a slow connection feel like nothing happened.
    const localPreview = URL.createObjectURL(file)
    setPreview(localPreview)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed')
      setReference(json.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setPreview(currentImage ?? null)
    } finally {
      setBusy(null)
    }
  }, [currentImage])

  // Paste anywhere while the finder is open. Screenshotting a product and
  // hitting Ctrl+V is the fastest route from "listing is dead" to a new one.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0]
      if (file) {
        e.preventDefault()
        void takeFile(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [takeFile])

  /** One marketplace call. `term` searches by name; omitting it searches by photo. */
  async function runSearch(term?: string): Promise<SupplierHit[]> {
    const res = await fetch('/api/product-master/marketplace-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Image mode and keyword mode are mutually exclusive upstream: the route
        // drops the keyword whenever an image is present, so sending both would
        // silently run the photo search twice and never search the name at all.
        ...(term ? { query: term } : { imageUrl: reference }),
        // 1688 is the only source with image search, and the only one these
        // products are actually bought from. Its platform id is 'alibaba' -
        // '1688' matches no platform and the search is rejected outright.
        platforms: ['alibaba'],
        sort: 'best',
      }),
    })
    // middleware.ts answers any unauthenticated /api call with the bare body
    // {"error":"Unauthorized"}, which as a search error reads like the
    // marketplace rejected the query rather than "you have been signed out".
    if (res.status === 401) throw new Error('Your session has expired - sign in again to search.')
    const json = await res.json()
    if (!json.success) throw new Error(json.error || 'Search failed')
    return (json.results || []) as SupplierHit[]
  }

  /**
   * Search by one of the suggested names.
   *
   * Kept as its own action because every call is billable, so a name is only
   * searched when it is actually asked for.
   */
  async function searchByTerm(term: string) {
    setBusy('search')
    setError('')
    setSearched(true)
    setActiveTerm(term)
    try {
      setHits(await runSearch(term))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setHits([])
    } finally {
      setBusy(null)
    }
  }

  async function search() {
    if (!reference) return
    setBusy('search')
    setError('')
    setSearched(true)
    setTerms([])
    setActiveTerm(null)
    try {
      /**
       * Look at the photo and search it at the same time.
       *
       * The visual search alone matched anything of a similar shape, because
       * 1688's image search is pure visual similarity and the route discards the
       * keyword in image mode - the product name was being passed in and
       * ignored. Reading the photo produces a name that actually describes it
       * ("stovetop kettle" rather than "kettle", which returns plastic cups).
       *
       * Run together rather than in sequence: the vision pass takes a few
       * seconds, and making the reviewer wait for it before seeing any results
       * would make a working search feel broken.
       */
      const [visual, described] = await Promise.allSettled([
        runSearch(),
        fetch('/api/product-master/photo-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: reference }),
        }).then(r => r.json()),
      ])

      if (visual.status === 'rejected') throw visual.reason
      let merged = visual.value

      const read: string[] =
        described.status === 'fulfilled' && described.value?.success ? described.value.terms || [] : []

      /**
       * Offer the spreadsheet name too, but last and never auto-searched.
       *
       * It is the name that was already failing to find anything useful, so it
       * does not deserve a paid call by default - but it is occasionally the only
       * one carrying a model number, so removing the option would lose that.
       */
      const sheetName = productName.trim()
      const suggestions =
        sheetName.length > 1 && !read.some(t => t.toLowerCase() === sheetName.toLowerCase())
          ? [...read, sheetName]
          : read
      setTerms(suggestions)

      // Search the broadest suggestion straight away so the closer results are
      // simply there. The sharper names stay one tap away rather than costing a
      // call each on every photo.
      // Strictly a name the vision pass read - NOT `suggestions[0]`, which falls
      // back to the spreadsheet name when the vision pass fails and would spend
      // a call re-running the search that was already coming up short.
      if (read[0]) {
        try {
          const byName = await runSearch(read[0])
          setActiveTerm(read[0])
          // Name matches lead: they describe the object, whereas a visual match
          // can be any object of that shape. De-duplicated by listing id so a
          // listing found both ways is not shown twice.
          const seen = new Set(byName.map(h => h.id))
          merged = [...byName, ...merged.filter(h => !seen.has(h.id))]
        } catch {
          // The photo results are already good enough to show; a failed extra
          // search must not throw away the search that did work.
        }
      }

      setHits(merged)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setHits([])
    } finally {
      setBusy(null)
    }
  }

  return (
    // h-full so the results list gets every spare pixel of the overlay; the
    // border lives on the overlay wrapper instead of being drawn twice.
    <div className="flex h-full min-h-0 flex-col gap-3 bg-card p-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Find a supplier by photo</h3>
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close supplier search</span>
        </Button>
      </div>

      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-3 rounded-md border border-dashed p-3"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) void takeFile(file)
        }}
      >
        {preview ? (
          <img
            src={proxied(preview)}
            alt="Reference product photo"
            className="h-20 w-20 flex-shrink-0 rounded border object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded border bg-muted">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
        )}

        <div className="flex min-w-[220px] flex-1 flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            {reference
              ? 'Search 1688 for this product. Paste, drop or upload a different photo to change it.'
              : 'Paste a screenshot, drop an image, or upload a photo of the product.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void takeFile(file)
                // Reset so choosing the same file twice still fires onChange.
                e.target.value = ''
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 bg-transparent text-[11px]"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
            >
              {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload photo
            </Button>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clipboard className="h-3 w-3" />
              or press Ctrl+V
            </span>
            <Button
              size="sm"
              className="ml-auto h-7 gap-1.5 text-[11px]"
              onClick={() => void search()}
              disabled={!reference || busy !== null}
            >
              {busy === 'search' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search 1688
            </Button>
          </div>
        </div>
      </div>

      {/*
        What the photo was read as. The whole point is that the storekeeper can
        see the names in plain English and pick the one that matches what they
        are holding - the photo search on its own gives no clue what it thought
        the thing was, so a wrong result looked like a broken search.
      */}
      {terms.length > 0 && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Looks like</span>
          {terms.map(term => {
            const active = term === activeTerm
            return (
              <Button
                key={term}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => void searchByTerm(term)}
                disabled={busy !== null}
                className="h-6 rounded-full px-2.5 text-[11px] font-normal"
                // Not every chip is obviously a search action, so say so.
                title={active ? `Showing results for "${term}"` : `Search 1688 for "${term}"`}
              >
                {term}
              </Button>
            )
          })}
        </div>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {busy === 'search' && (
        <p className="text-[11px] text-muted-foreground">Searching 1688 and ranking sellers...</p>
      )}

      {searched && busy !== 'search' && !error && hits.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No listings matched that photo. A clearer photo of just the product, on a plain background, usually finds
          more.
        </p>
      )}

      {hits.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {hits.length} listings, best sellers first - ranked on units sold, years trading, repeat buyers and
            verified status.
          </p>
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-2 gap-2 pr-2 md:grid-cols-3 xl:grid-cols-4">
              {hits.map((hit, i) => (
                <div key={hit.id} className="flex flex-col gap-1.5 rounded-md border p-2">
                  <div className="relative">
                    {hit.image ? (
                      <img
                        src={proxied(hit.image) || '/placeholder.svg'}
                        alt={hit.title}
                        className="aspect-square w-full rounded object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded bg-muted">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    {/* The top few are what the ranking is actually for, so
                        they are called out rather than left to row order. */}
                    {i < 3 && (
                      <Badge className="absolute left-1 top-1 h-4 px-1 text-[9px]">Best {i + 1}</Badge>
                    )}
                  </div>

                  <p className="line-clamp-2 text-[11px] leading-tight" title={hit.title}>
                    {hit.title}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    {hit.price && <span className="font-semibold text-foreground">{hit.price}</span>}
                    {hit.sold > 0 && <span>{compact(hit.sold)} sold</span>}
                    {hit.seller.years > 0 && <span>{hit.seller.years}y</span>}
                    {hit.seller.repurchaseRate > 0 && <span>{hit.seller.repurchaseRate}% repeat</span>}
                    {hit.seller.verified && (
                      <span className="flex items-center gap-0.5 text-primary">
                        <ShieldCheck className="h-3 w-3" />
                        verified
                      </span>
                    )}
                  </div>

                  {hit.seller.name && (
                    <p className="truncate text-[10px] text-muted-foreground" title={hit.seller.name}>
                      {hit.seller.name}
                    </p>
                  )}

                  <div className="mt-auto flex items-center gap-1.5 pt-1">
                    <Button
                      size="sm"
                      className="h-6 flex-1 text-[10px]"
                      disabled={!hit.pageUrl}
                      onClick={() => hit.pageUrl && onPick(hit.pageUrl)}
                    >
                      Use this
                    </Button>
                    {hit.pageUrl && (
                      <a
                        href={hit.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
