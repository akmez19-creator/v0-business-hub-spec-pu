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
  SkipForward,
  Star,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
}

/** One product to review. `productId` is null while the row is still unmatched. */
export interface MediaQueueItem {
  excelProduct: string
  productName: string
  productId: string | null
  link: string | null | undefined
  currentImage?: string | null
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
 * Where playback starts. 1688 clips nearly always open on a logo card or a
 * blank frame, so the opening seconds show nothing worth judging.
 */
const VIDEO_START_AT = 3

/**
 * A listing video that loads and plays on its own.
 *
 * It never waits for a click: the reviewer is deciding keep-or-skip on dozens
 * of products, and a click per clip is the slowest part of that loop.
 */
function ListingVideo({ item }: { item: MediaItem }) {
  const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading')
  const videoRef = useRef<HTMLVideoElement>(null)
  const seeked = useRef(false)

  return (
    <div className="relative">
      <video
        ref={videoRef}
        // The `#t=` fragment tells the browser to begin at that offset. Paired
        // with the Range support in the proxy it pulls bytes from around the
        // 3s mark instead of dragging the whole clip down from 1688 first.
        src={`${proxied(item.url)}#t=${VIDEO_START_AT}`}
        poster={item.poster ? proxied(item.poster) : undefined}
        controls
        // Muted is what makes autoplay legal in every browser; without it the
        // clip silently refuses to start.
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        onLoadedMetadata={e => {
          // Safari ignores the media fragment often enough to need a manual
          // seek. Skipped on short clips, where 3s would land past the end.
          const el = e.currentTarget
          if (!seeked.current && Number.isFinite(el.duration) && el.duration > VIDEO_START_AT + 0.5) {
            el.currentTime = VIDEO_START_AT
          }
          seeked.current = true
        }}
        onPlaying={() => setStatus('playing')}
        onError={() => setStatus('error')}
        className="aspect-square w-full bg-black object-contain"
      />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-[11px] text-white">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading from 1688...
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-3 text-center text-[11px] text-white">
          <span>This clip would not load.</span>
          <Button
            size="sm"
            variant="secondary"
            className="h-6 text-[11px]"
            onClick={() => {
              setStatus('loading')
              seeked.current = false
              videoRef.current?.load()
            }}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  )
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
  onSaved,
  onSkipped,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  queue: MediaQueueItem[]
  startIndex?: number
  onSaved: (excelProduct: string, picks: MediaPicks) => void
  onSkipped: (excelProduct: string) => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [doneCount, setDoneCount] = useState(0)

  // Per-product selections, keyed by row, so Back restores earlier picks.
  // Photos are a set rather than one url: the whole gallery is saved to the
  // product master, with `chosenCover` naming the one that becomes the
  // product's main image.
  const [chosenImages, setChosenImages] = useState<Record<string, string[]>>({})
  const [chosenCover, setChosenCover] = useState<Record<string, string>>({})
  const [chosenVideos, setChosenVideos] = useState<Record<string, string[]>>({})

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

  useEffect(() => {
    if (open) {
      setIndex(startIndex)
      setDoneCount(0)
    }
  }, [open, startIndex])

  const show = useCallback(async (link: string | null | undefined, force = false) => {
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
      if (pickedImages.length > 0 && current.productId) {
        const res = await fetch('/api/product-master/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: current.productId,
            productName: current.productName,
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
      if (current.productId) {
        for (const url of pickedVideos) {
          await fetch('/api/product-master/clips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: current.productId,
              productName: current.productName,
              name: `${current.productName} - 1688 clip`,
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
        images: current.productId ? [] : pickedImages,
        videos: current.productId ? [] : pickedVideos,
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
            Everything on this supplier&apos;s 1688 listing. Keep as many photos and videos as you want - they all go to
            the product master for Poster and Reels Studio - then move to the next product.
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
                          {/* Keyed on the URL so moving to the next product
                              mounts a fresh element instead of reusing the
                              previous product's clip. */}
                          <ListingVideo key={v.url} item={v} />
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

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {pickedImages.length > 0
              ? `${pickedImages.length} photo${pickedImages.length === 1 ? '' : 's'} selected`
              : 'No photos selected'}
            {pickedVideos.length > 0 && ` - ${pickedVideos.length} video${pickedVideos.length === 1 ? '' : 's'} to keep`}
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
              disabled={saving || (pickedImages.length === 0 && pickedVideos.length === 0)}
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
