'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCircle, ImageIcon, Loader2, Play, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

interface MediaItem {
  url: string
  kind: 'image' | 'video'
  poster?: string | null
}

/**
 * Marketplace CDNs block hotlinking, so listing media is streamed through the
 * existing authenticated proxy (which already allowlists the alicdn/taobao
 * hosts 1688 serves from).
 */
const proxied = (url: string) =>
  `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(url)}`

export function PoMediaPicker({
  open,
  onOpenChange,
  productId,
  productName,
  link,
  currentImage,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string | null
  productName: string
  link: string | null
  currentImage?: string | null
  onSaved: (imageUrl: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [chosenImage, setChosenImage] = useState<string | null>(null)
  const [chosenVideos, setChosenVideos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!link) return
    setLoading(true)
    setError('')
    setMedia([])
    try {
      const res = await fetch('/api/purchase-orders/product-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Could not load listing media')
      setMedia(json.media || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load listing media')
    } finally {
      setLoading(false)
    }
  }, [link])

  // Load once per opening, and reset the previous product's choices.
  useEffect(() => {
    if (!open) return
    setChosenImage(null)
    setChosenVideos([])
    setPlaying(null)
    void load()
  }, [open, load])

  const images = media.filter((m) => m.kind === 'image')
  const videos = media.filter((m) => m.kind === 'video')

  function toggleVideo(url: string) {
    setChosenVideos((prev) => (prev.includes(url) ? prev.filter((v) => v !== url) : [...prev, url]))
  }

  async function save() {
    if (!productId) return
    setSaving(true)
    setError('')
    try {
      if (chosenImage) {
        const res = await fetch('/api/purchase-orders/product-media', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, imageUrl: chosenImage }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Could not save the photo')
        onSaved(chosenImage)
      }

      // Selected videos go to the shared clip library by URL. The route
      // de-duplicates on source_id, so re-saving the same clip is harmless.
      for (const url of chosenVideos) {
        await fetch('/api/product-master/clips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId,
            productName,
            name: `${productName} - 1688 clip`,
            fileUrl: url,
            source: '1688',
            sourceId: url,
            sourceUrl: link,
            duration: 0,
            width: 0,
            height: 0,
            sizeBytes: 0,
          }),
        }).catch(() => null)
      }

      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl xl:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">Choose media for {productName}</DialogTitle>
          <DialogDescription>
            Everything on the supplier&apos;s 1688 listing. Pick one photo to use as the product image, and tick any
            videos worth keeping.
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
              <Button variant="outline" size="sm" onClick={() => void load()} className="mt-2 bg-transparent">
                Try again
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && media.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">This listing has no photos or videos.</p>
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
                    {videos.map((v) => {
                      const picked = chosenVideos.includes(v.url)
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
                                  src={proxied(v.poster) || "/placeholder.svg"}
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
                    <span className="text-xs font-normal text-muted-foreground">Click one to use as the product image</span>
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-3">
                    {images.map((m) => {
                      const picked = chosenImage === m.url
                      const isCurrent = currentImage === m.url
                      return (
                        <button
                          key={m.url}
                          type="button"
                          onClick={() => setChosenImage(m.url)}
                          className={`relative rounded-lg border overflow-hidden transition-colors ${
                            picked ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <img
                            src={proxied(m.url) || "/placeholder.svg"}
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
            {chosenImage ? '1 photo selected' : 'No photo selected'}
            {chosenVideos.length > 0 && ` - ${chosenVideos.length} video${chosenVideos.length === 1 ? '' : 's'} to keep`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="bg-transparent">
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || (!chosenImage && chosenVideos.length === 0)} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Save selection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
