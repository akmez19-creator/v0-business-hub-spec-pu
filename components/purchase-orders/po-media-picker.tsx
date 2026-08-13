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
  SkipForward,
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

/** One product to review. `productId` is null while the row is still unmatched. */
export interface MediaQueueItem {
  excelProduct: string
  productName: string
  productId: string | null
  link: string | null
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
  onSaved: (excelProduct: string, imageUrl: string | null, videoUrls: string[]) => void
  onSkipped: (excelProduct: string) => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [doneCount, setDoneCount] = useState(0)

  // Per-product selections, keyed by row, so Back restores earlier picks.
  const [chosenImages, setChosenImages] = useState<Record<string, string>>({})
  const [chosenVideos, setChosenVideos] = useState<Record<string, string[]>>({})

  // Listing media cached by link, so revisiting never refetches.
  const cache = useRef<Map<string, MediaItem[]>>(new Map())

  const current: MediaQueueItem | undefined = queue[index]
  const total = queue.length
  const isLast = index >= total - 1
  const pickedImage = current ? chosenImages[current.excelProduct] || null : null
  const pickedVideos = current ? chosenVideos[current.excelProduct] || [] : []

  useEffect(() => {
    if (open) {
      setIndex(startIndex)
      setDoneCount(0)
    }
  }, [open, startIndex])

  const show = useCallback(async (link: string | null, force = false) => {
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

  function pickImage(url: string) {
    if (!current) return
    setChosenImages(prev => ({ ...prev, [current.excelProduct]: url }))
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
      if (pickedImage) {
        // An unmatched row has no product yet, so the choice is handed back to
        // the import dialog and written once the product exists.
        if (current.productId) {
          const res = await fetch('/api/purchase-orders/product-media', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: current.productId, imageUrl: pickedImage }),
          })
          const json = await res.json()
          if (!json.success) throw new Error(json.error || 'Could not save the photo')
        }
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
      // reviewer kept only videos, or nothing at all.
      onSaved(current.excelProduct, pickedImage, current.productId ? [] : pickedVideos)
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
            Everything on this supplier&apos;s 1688 listing. Pick one photo to use as the product image, tick any videos
            worth keeping, then move to the next product.
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
                      Click one to use as the product image
                    </span>
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-3">
                    {images.map(m => {
                      const picked = pickedImage === m.url
                      const isCurrent = current?.currentImage === m.url
                      return (
                        <button
                          key={m.url}
                          type="button"
                          onClick={() => pickImage(m.url)}
                          className={`relative rounded-lg border overflow-hidden transition-colors ${
                            picked ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <img
                            src={proxied(m.url) || '/placeholder.svg'}
                            alt="Listing photo"
                            className="aspect-square w-full object-cover"
                            loading="lazy"
                          />
                          {picked && (
                            <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5">
                              <Check className="w-3 h-3 text-primary-foreground" />
                            </span>
                          )}
                          {isCurrent && !picked && (
                            <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-[10px]">
                              Current
                            </span>
                          )}
                        </button>
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
            {pickedImage ? '1 photo selected' : 'No photo selected'}
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
            <Button onClick={saveAndNext} disabled={saving || (!pickedImage && pickedVideos.length === 0)} className="gap-1.5">
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
