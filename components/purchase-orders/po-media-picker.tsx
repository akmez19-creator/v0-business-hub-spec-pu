'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  ImageIcon,
  Loader2,
  Play,
  Plus,
  SkipForward,
  Sparkles,
  Star,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'

interface MediaItem {
  url: string
  kind: 'image' | 'video'
  poster?: string | null
}

/**
 * What the reviewer kept for one product. `images` and `videos` are only
 * populated for rows that had no product yet - those still need attaching once
 * the product master record exists.
 */
export interface MediaPicks {
  cover: string | null
  images: string[]
  videos: string[]
  /** The name the reviewer confirmed for this product on the same screen. */
  name?: string | null
  /** The inventory product this row ended up pointing at. */
  productId?: string | null
}

/** One product to review. `productId` is null while the row is still unmatched. */
export interface MediaQueueItem {
  excelProduct: string
  productName: string
  productId: string | null
  link: string | null | undefined
  currentImage?: string | null
}

/** Minimal inventory record needed to offer a match. */
export interface PickerProduct {
  id: string
  name: string
}

/**
 * Marketplace CDNs block hotlinking, so listing media is streamed through the
 * existing authenticated proxy (which already allowlists the alicdn/taobao
 * hosts 1688 serves from).
 */
const proxied = (url: string) =>
  `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(url)}`

/** Fetch every photo and video on one listing. */
async function loadMedia(link: string): Promise<MediaItem[]> {
  const res = await fetch('/api/purchase-orders/product-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Could not load listing media')
  return (json.media || []) as MediaItem[]
}

/**
 * Steps through the queue one product at a time: see every photo and video on
 * that supplier listing, pick the ones to keep, then move to the next product.
 *
 * Choices are held per product so going Back restores what was already picked,
 * and the next listing is prefetched so stepping through feels instant.
 */
export function PoMediaPicker({
  open,
  onOpenChange,
  queue,
  startIndex = 0,
  products,
  onSaved,
  onSkipped,
  onSuggestName,
  onMatch,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  queue: MediaQueueItem[]
  startIndex?: number
  /** Inventory to match against, searched inline on this screen. */
  products: PickerProduct[]
  onSaved: (excelProduct: string, picks: MediaPicks) => void
  onSkipped: (excelProduct: string) => void
  /** Ask the AI to read the chosen photo and return a clean product name. */
  onSuggestName: (excelProduct: string, imageUrl: string | null) => Promise<string | null>
  onMatch: (excelProduct: string, productId: string | null) => void
  /** Create the inventory product and return its new id. */
  onCreate: (excelProduct: string, name: string) => Promise<string | null>
}) {
  const [index, setIndex] = useState(startIndex)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [doneCount, setDoneCount] = useState(0)

  // Per-product selections, keyed by row, so Back restores earlier picks.
  // Photos are a set rather than one url: the whole gallery is saved to the
  // product master, with `chosenCover` naming the one that becomes the
  // product's main image.
  const [chosenImages, setChosenImages] = useState<Record<string, string[]>>({})
  const [chosenCover, setChosenCover] = useState<Record<string, string>>({})
  const [chosenVideos, setChosenVideos] = useState<Record<string, string[]>>({})

  // Naming and inventory matching happen on this same screen, so they are also
  // held per row: stepping Back must show what was already decided.
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({})
  const [matchChoice, setMatchChoice] = useState<Record<string, string | null>>({})
  const [naming, setNaming] = useState(false)
  const [creating, setCreating] = useState(false)
  const [productSearch, setProductSearch] = useState('')

  // Listing media cached by link, so revisiting never refetches.
  const cache = useRef<Map<string, MediaItem[]>>(new Map())

  const current: MediaQueueItem | undefined = queue[index]
  const total = queue.length
  const isLast = index >= total - 1
  const pickedImages = current ? chosenImages[current.excelProduct] || [] : []
  const pickedVideos = current ? chosenVideos[current.excelProduct] || [] : []
  // The cover falls back to the first pick, so a reviewer who never nominates
  // one still ends up with a sensible product image.
  const cover = current ? chosenCover[current.excelProduct] || pickedImages[0] || null : null

  const key = current?.excelProduct ?? ''
  const nameValue = current ? (nameDraft[key] ?? current.productName) : ''
  // An explicit choice wins, but an untouched row shows whatever the row is
  // already mapped to, so an existing match is never silently dropped.
  const selectedId = current ? (key in matchChoice ? matchChoice[key] : current.productId) : null
  const selectedProduct = products.find(p => p.id === selectedId) || null
  // Naming reads the photo the reviewer starred, falling back to the photo the
  // product already has.
  const nameImage = cover || current?.currentImage || null

  // Inventory hits for the search box. Seeded from the product name so the
  // likely match is already on screen before the reviewer types anything.
  const matchQuery = (productSearch.trim() || nameValue.trim()).toLowerCase()
  const matches =
    matchQuery.length < 2
      ? []
      : products.filter(p => p.name.toLowerCase().includes(matchQuery)).slice(0, 6)

  useEffect(() => {
    if (open) {
      setIndex(startIndex)
      setDoneCount(0)
    }
  }, [open, startIndex])

  // A search typed for one product must never leak into the next.
  useEffect(() => {
    setProductSearch('')
  }, [index])

  const show = useCallback(async (link: string | null | undefined, force = false) => {
    setPlaying(null)
    setError('')
    if (!link) {
      setMedia([])
      return
    }
    const hit = cache.current.get(link)
    if (hit && !force) {
      setMedia(hit)
      return
    }
    setLoading(true)
    setMedia([])
    try {
      const items = await loadMedia(link)
      cache.current.set(link, items)
      setMedia(items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load listing media')
    } finally {
      setLoading(false)
    }
  }, [])

  // Load the current listing, then warm the next one in the background.
  useEffect(() => {
    if (!open || !current) return
    void show(current.link)
    const next = queue[index + 1]
    if (next?.link && !cache.current.has(next.link)) {
      void loadMedia(next.link)
        .then(items => cache.current.set(next.link as string, items))
        .catch(() => null)
    }
  }, [open, index, current, queue, show])

  const images = media.filter(m => m.kind === 'image')
  const videos = media.filter(m => m.kind === 'video')

  function toggleImage(url: string) {
    if (!current) return
    const key = current.excelProduct
    setChosenImages(prev => {
      const list = prev[key] || []
      const next = list.includes(url) ? list.filter(u => u !== url) : [...list, url]
      // Dropping the cover photo must hand the role to another pick, never
      // leave the product pointing at an image that is no longer selected.
      if (!next.includes(chosenCover[key])) {
        setChosenCover(c => ({ ...c, [key]: next[0] || '' }))
      }
      return { ...prev, [key]: next }
    })
  }

  /** Promote an already-selected photo to be the product's main image. */
  function makeCover(url: string) {
    if (!current) return
    const key = current.excelProduct
    setChosenImages(prev => {
      const list = prev[key] || []
      return list.includes(url) ? prev : { ...prev, [key]: [...list, url] }
    })
    setChosenCover(c => ({ ...c, [key]: url }))
  }

  function toggleAllImages() {
    if (!current) return
    const key = current.excelProduct
    const all = images.map(m => m.url)
    const takeAll = pickedImages.length < all.length
    setChosenImages(prev => ({ ...prev, [key]: takeAll ? all : [] }))
    setChosenCover(c => ({ ...c, [key]: takeAll ? chosenCover[key] || all[0] : '' }))
  }

  function toggleAllVideos() {
    if (!current) return
    const key = current.excelProduct
    const all = videos.map(v => v.url)
    setChosenVideos(prev => ({ ...prev, [key]: pickedVideos.length < all.length ? all : [] }))
  }

  function toggleVideo(url: string) {
    if (!current) return
    setChosenVideos(prev => {
      const list = prev[current.excelProduct] || []
      return {
        ...prev,
        [current.excelProduct]: list.includes(url) ? list.filter(v => v !== url) : [...list, url],
      }
    })
  }

  /** Read the starred photo and drop the suggested name into the field. */
  async function nameFromPhoto() {
    if (!current) return
    setNaming(true)
    try {
      const suggested = await onSuggestName(current.excelProduct, nameImage)
      if (suggested) setNameDraft(prev => ({ ...prev, [key]: suggested }))
    } finally {
      setNaming(false)
    }
  }

  /**
   * Create the inventory product immediately and select it, so the photos and
   * clips saved by this same screen have a real owner to attach to.
   */
  async function createAndSelect() {
    if (!current) return
    setCreating(true)
    setError('')
    try {
      const id = await onCreate(current.excelProduct, nameValue)
      if (id) {
        setMatchChoice(prev => ({ ...prev, [key]: id }))
        setProductSearch('')
      } else {
        setError('Could not create that product')
      }
    } finally {
      setCreating(false)
    }
  }

  /** Move on without keeping anything, recording the row as reviewed. */
  function skipAndNext() {
    if (current) onSkipped(current.excelProduct)
    advance()
  }

  function advance() {
    if (isLast) {
      onOpenChange(false)
      return
    }
    setIndex(i => i + 1)
  }

  /** Persist this product's picks, then step to the next one. */
  async function saveAndNext() {
    if (!current) return
    setSaving(true)
    setError('')
    try {
      // The whole photo selection goes to the product's gallery, with the
      // cover mirrored onto products.image_url by the route. An unmatched row
      // has no product yet, so its picks are handed back to the import dialog
      // and written once the product exists.
      // The match chosen on this screen decides where the media lands, so it
      // is applied before anything is written.
      const targetId = selectedId || null
      // Covers clearing a match too, so the row never stays mapped to a
      // product the reviewer just rejected.
      if (targetId !== current.productId) onMatch(current.excelProduct, targetId)

      if (pickedImages.length > 0 && targetId) {
        const res = await fetch('/api/product-master/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: targetId,
            productName: nameValue || current.productName,
            images: pickedImages,
            primaryUrl: cover,
            source: '1688',
            sourceUrl: current.link,
          }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Could not save the photos')
      }

      // Selected videos go to the shared clip library by URL. The route
      // de-duplicates on source_id, so re-saving the same clip is harmless.
      // An unmatched row has no owner yet, so its clips are handed back and
      // attached once the product master record exists.
      if (targetId) {
        for (const url of pickedVideos) {
          await fetch('/api/product-master/clips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: targetId,
              productName: nameValue || current.productName,
              name: `${nameValue || current.productName} - 1688 clip`,
              fileUrl: url,
              source: '1688',
              sourceId: url,
              sourceUrl: current.link,
              duration: 0,
              width: 0,
              height: 0,
              sizeBytes: 0,
            }),
          }).catch(() => null)
        }
      }

      // Always report the outcome so the row leaves the queue, even when the
      // reviewer kept only videos. Anything that could not be written yet
      // (unmatched row) is handed back to be attached after the product exists.
      onSaved(current.excelProduct, {
        cover,
        images: targetId ? [] : pickedImages,
        videos: targetId ? [] : pickedVideos,
        name: nameValue.trim() || null,
        productId: targetId,
      })
      setDoneCount(c => c + 1)
      advance()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const stepLabel = total > 0 ? `Product ${Math.min(index + 1, total)} of ${total}` : 'No products'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl xl:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="gap-2">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate">{current?.productName || 'Choose media'}</DialogTitle>
            <Badge variant="secondary" className="flex-shrink-0 text-[11px] tabular-nums">
              {stepLabel}
            </Badge>
          </div>
          <Progress value={total ? ((index + (isLast ? 1 : 0)) / total) * 100 : 0} className="h-1" />
          <DialogDescription>
            Everything on this supplier&apos;s 1688 listing. Keep as many photos and videos as you want, name the
            product from the photo, and match it to inventory - all before moving to the next product.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading listing media...
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-destructive">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void show(current?.link ?? null, true)}
                className="mt-2 bg-transparent"
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && media.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-center text-sm text-muted-foreground">
              {current?.link
                ? 'This listing has no photos or videos.'
                : 'This product has no 1688 link, so there is nothing to browse.'}
            </p>
            <Button variant="outline" onClick={skipAndNext} className="gap-1.5 bg-transparent">
              Skip to next
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {!loading && media.length > 0 && (
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="flex flex-col gap-5 pb-2">
              {videos.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <Video className="w-4 h-4 text-primary" />
                    Videos
                    <Badge variant="secondary" className="text-[10px]">
                      {videos.length}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllVideos}
                      className="ml-auto h-6 text-[11px]"
                    >
                      {pickedVideos.length < videos.length ? 'Keep all' : 'Clear all'}
                    </Button>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {videos.map(v => {
                      const picked = pickedVideos.includes(v.url)
                      return (
                        <div
                          key={v.url}
                          className={`relative rounded-lg border overflow-hidden transition-colors ${
                            picked ? 'border-primary ring-1 ring-primary' : 'border-border'
                          }`}
                        >
                          {playing === v.url ? (
                            <video
                              src={proxied(v.url)}
                              poster={v.poster ? proxied(v.poster) : undefined}
                              controls
                              autoPlay
                              className="aspect-square w-full bg-black object-contain"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPlaying(v.url)}
                              className="relative block w-full"
                              aria-label="Play video"
                            >
                              {v.poster ? (
                                <img
                                  src={proxied(v.poster) || '/placeholder.svg'}
                                  alt=""
                                  className="aspect-square w-full object-cover"
                                />
                              ) : (
                                <div className="aspect-square w-full bg-muted" />
                              )}
                              <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Play className="w-8 h-8 text-white" />
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleVideo(v.url)}
                            className="flex w-full items-center gap-1.5 p-2 text-xs hover:bg-accent transition-colors"
                          >
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                picked ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                              }`}
                            >
                              {picked && <Check className="w-3 h-3 text-primary-foreground" />}
                            </span>
                            {picked ? 'Keeping' : 'Keep this video'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {images.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <ImageIcon className="w-4 h-4 text-primary" />
                    Photos
                    <Badge variant="secondary" className="text-[10px]">
                      {images.length}
                    </Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      Tick every photo to keep - the starred one becomes the product image
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllImages}
                      className="ml-auto h-6 text-[11px]"
                    >
                      {pickedImages.length < images.length ? 'Select all' : 'Clear all'}
                    </Button>
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-3">
                    {images.map(m => {
                      const picked = pickedImages.includes(m.url)
                      const isCover = cover === m.url
                      const isCurrent = current?.currentImage === m.url
                      return (
                        <div
                          key={m.url}
                          className={`relative rounded-lg border overflow-hidden transition-colors ${
                            isCover
                              ? 'border-primary ring-2 ring-primary'
                              : picked
                                ? 'border-primary/70 ring-1 ring-primary/60'
                                : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleImage(m.url)}
                            className="block w-full"
                            aria-label={picked ? 'Remove this photo' : 'Keep this photo'}
                          >
                            <img
                              src={proxied(m.url) || '/placeholder.svg'}
                              alt="Listing photo"
                              className="aspect-square w-full object-cover"
                              loading="lazy"
                            />
                            <span
                              className={`absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded border ${
                                picked ? 'bg-primary border-primary' : 'border-white/70 bg-black/40'
                              }`}
                            >
                              {picked && <Check className="w-3 h-3 text-primary-foreground" />}
                            </span>
                          </button>

                          {/* Only a kept photo can be the cover, so this is
                              offered once the photo is actually selected. */}
                          {picked && (
                            <button
                              type="button"
                              onClick={() => makeCover(m.url)}
                              disabled={isCover}
                              className={`flex w-full items-center justify-center gap-1 py-1 text-[10px] transition-colors ${
                                isCover
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-accent text-muted-foreground'
                              }`}
                            >
                              <Star className={`w-3 h-3 ${isCover ? 'fill-current' : ''}`} />
                              {isCover ? 'Product image' : 'Make main'}
                            </button>
                          )}
                          {isCurrent && !picked && (
                            <span className="absolute right-1 top-1 rounded bg-background/90 px-1 text-[10px]">
                              Current
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Naming and matching live on the same screen as the photos, so one
            pass through the queue finishes a product completely. */}
        {current && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="po-name" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Product name
              </label>
              <div className="flex gap-1.5">
                <Input
                  id="po-name"
                  value={nameValue}
                  onChange={e => setNameDraft(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder="Two-word name"
                  className="h-8 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={nameFromPhoto}
                  disabled={naming || !nameImage}
                  title={nameImage ? 'Read the starred photo' : 'Pick a photo first'}
                  className="h-8 flex-shrink-0 gap-1 bg-transparent"
                >
                  {naming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  From photo
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                PO called it &ldquo;{current.excelProduct}&rdquo;
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="po-match" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Inventory match
              </label>
              {selectedProduct ? (
                <div className="flex h-8 items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-2">
                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                  <span className="flex-1 truncate text-sm">{selectedProduct.name}</span>
                  <button
                    type="button"
                    onClick={() => setMatchChoice(prev => ({ ...prev, [key]: null }))}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex gap-1.5">
                    <Input
                      id="po-match"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search inventory..."
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={createAndSelect}
                      disabled={creating || !nameValue.trim()}
                      className="h-8 flex-shrink-0 gap-1 bg-transparent"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Create
                    </Button>
                  </div>
                  {/* Only a handful of hits are listed: the reviewer is
                      confirming one product, not browsing the catalogue. */}
                  {matches.length > 0 && (
                    <div className="flex flex-col gap-0.5 rounded-md border bg-background p-1">
                      {matches.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setMatchChoice(prev => ({ ...prev, [key]: p.id }))
                            setProductSearch('')
                          }}
                          className="truncate rounded px-2 py-1 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {productSearch.trim() !== '' && matches.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      No inventory product matches - use Create to add it.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {pickedImages.length > 0
              ? `${pickedImages.length} photo${pickedImages.length === 1 ? '' : 's'} selected`
              : 'No photos selected'}
            {pickedVideos.length > 0 && ` - ${pickedVideos.length} video${pickedVideos.length === 1 ? '' : 's'} to keep`}
            {selectedProduct ? ` - matched to ${selectedProduct.name}` : ' - no inventory match yet'}
            {doneCount > 0 && ` - ${doneCount} saved so far`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0 || saving}
              className="gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          <Button variant="outline" onClick={skipAndNext} disabled={saving} className="gap-1.5 bg-transparent">
            {isLast ? 'Finish' : 'Skip'}
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              onClick={saveAndNext}
              disabled={saving || creating}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isLast ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              {isLast ? 'Save & finish' : 'Save & next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
