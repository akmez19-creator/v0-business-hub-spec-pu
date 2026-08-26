'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ImageOff, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { mediaSrc } from '@/lib/media-url'
import {
  loadMedia,
  MediaError,
  persistPicks,
  type MediaItem,
  type MediaPicks,
  type MediaQueueItem,
} from './po-media-picker'

/** How many products are put in front of the reviewer at once. */
export const GRID_BATCH = 20

/**
 * One product's state in the grid.
 *
 * `failed` and `empty` are kept apart from each other on purpose. "The listing
 * would not load" and "the listing has no photos" lead to different actions,
 * and collapsing them into one grey tile would tell the reviewer a product has
 * no media when the truth is we could not look.
 */
type TileState = 'loading' | 'ready' | 'empty' | 'failed'

interface Tile {
  item: MediaQueueItem
  state: TileState
  media: MediaItem[]
  error?: string
}

/**
 * Reviews a batch of products on one screen.
 *
 * Every tile that loads is ACCEPTED by default with the listing's first photo
 * as its cover - that is the suggestion. The reviewer's job is only to click
 * the ones that are wrong, which is the whole point: on a batch where the
 * suggestion is usually right, the work is proportional to the mistakes rather
 * than to the batch.
 *
 * Tiles that could not load are never accepted by default. They are excluded
 * from the save and handed back to the detailed picker, because keeping
 * "whatever loaded" for a listing we failed to read is how the wrong photo gets
 * attached to a real product.
 */
export function PoMediaGrid({
  queue,
  startIndex,
  onSaved,
  onSkipped,
  onNeedsDetail,
  onDone,
}: {
  queue: MediaQueueItem[]
  startIndex: number
  onSaved: (excelProduct: string, picks: MediaPicks) => void
  onSkipped: (excelProduct: string) => void
  /** Hand the rejected + unloadable rows to the one-at-a-time reviewer. */
  onNeedsDetail: (index: number) => void
  onDone: () => void
}) {
  const batch = queue.slice(startIndex, startIndex + GRID_BATCH)

  /**
   * The batch is identified by its row keys, never by the queue array.
   *
   * The parent rebuilds `queue` from the mappings it mutates on every save, so
   * depending on the array itself would reload the whole batch the moment the
   * first product saved - throwing away the reviewer's rejections mid-run and
   * re-fetching twenty listings for nothing.
   */
  const batchKey = batch.map(b => b.excelProduct).join('|')
  const batchRef = useRef(batch)
  batchRef.current = batch

  const [tiles, setTiles] = useState<Tile[]>([])
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [loadedCount, setLoadedCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [fatal, setFatal] = useState('')
  const cancelled = useRef(false)

  /**
   * Fetches the batch one listing at a time.
   *
   * Sequential is not caution for its own sake: the media endpoint scrapes a
   * supplier page per call, and firing twenty at once is what gets the IP
   * throttled. Tiles appear as they arrive so the grid fills in rather than
   * blocking on the slowest listing.
   */
  const loadBatch = useCallback(async () => {
    const batch = batchRef.current
    cancelled.current = false
    setTiles(batch.map(item => ({ item, state: 'loading' as TileState, media: [] })))
    setRejected(new Set())
    setLoadedCount(0)
    setFatal('')

    for (let i = 0; i < batch.length; i++) {
      if (cancelled.current) return
      const item = batch[i]
      try {
        const media = item.link ? await loadMedia(item.link) : []
        if (cancelled.current) return
        setTiles(prev => {
          const next = [...prev]
          next[i] = {
            item,
            state: media.length === 0 ? 'empty' : 'ready',
            media,
          }
          return next
        })
      } catch (e) {
        if (cancelled.current) return
        const msg = e instanceof Error ? e.message : 'Could not load this listing'
        setTiles(prev => {
          const next = [...prev]
          next[i] = { item, state: 'failed', media: [], error: msg }
          return next
        })
        /**
         * A refused session, a rejected token or an exhausted plan will fail
         * every remaining listing the same way. Stopping keeps one real cause
         * on screen instead of twenty copies of the same message.
         */
        if (
          e instanceof MediaError &&
          (e.reason === 'session' || e.reason === 'provider-auth' || e.reason === 'credit')
        ) {
          setFatal(e.message)
          return
        }
      } finally {
        if (!cancelled.current) setLoadedCount(c => c + 1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchKey])

  useEffect(() => {
    loadBatch()
    return () => {
      cancelled.current = true
    }
  }, [loadBatch])

  const toggle = (key: string) =>
    setRejected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Only tiles that actually loaded can be accepted. An unreadable listing is
  // never counted as good news.
  const acceptable = tiles.filter(t => t.state === 'ready' && !rejected.has(t.item.excelProduct))
  const emptyOnes = tiles.filter(t => t.state === 'empty')
  const problems = tiles.filter(t => t.state === 'failed')
  const stillLoading = tiles.some(t => t.state === 'loading')

  /**
   * Saves every accepted tile, keeping the full listing exactly as the
   * one-at-a-time reviewer would, then moves the batch on.
   */
  async function saveAccepted() {
    setSaving(true)
    let saved = 0
    try {
      for (const t of acceptable) {
        const imgs = t.media.filter(m => m.kind === 'image').map(m => m.url)
        const vids = t.media.filter(m => m.kind === 'video').map(m => m.url)
        await persistPicks({
          item: t.item,
          images: imgs,
          videos: vids,
          cover: imgs[0] ?? null,
          ownUrls: new Set<string>(),
          sourceLink: t.item.link,
        })
        onSaved(t.item.excelProduct, {
          cover: imgs[0] ?? null,
          images: t.item.productId ? [] : imgs,
          videos: t.item.productId ? [] : vids,
          uploaded: [],
        })
        saved++
        setSavedCount(saved)
      }

      // A listing with no media at all is a real answer, not a failure - mark it
      // reviewed so it cannot block the import forever.
      for (const t of emptyOnes) onSkipped(t.item.excelProduct)

      const leftovers = rejected.size + problems.length
      if (leftovers > 0) {
        // Land the reviewer on the first row that still needs a decision.
        const firstBad = tiles.findIndex(
          t => t.state === 'failed' || rejected.has(t.item.excelProduct),
        )
        onNeedsDetail(startIndex + Math.max(0, firstBad))
      } else if (startIndex + GRID_BATCH >= queue.length) {
        onDone()
      } else {
        onNeedsDetail(startIndex + GRID_BATCH)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            {`Reviewing ${batch.length} products`}
          </span>
          <span className="text-muted-foreground">
            {stillLoading ? `- loading ${loadedCount} of ${batch.length}` : '- all loaded'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Everything here is kept unless you click it. Click the wrong ones.
        </p>
      </div>

      {fatal && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-[12px] font-medium text-destructive">{fatal}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Loading stopped, so the rest of this batch was never checked. Nothing
              has been saved yet.
            </p>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(t => {
          const isRejected = rejected.has(t.item.excelProduct)
          const cover = t.media.find(m => m.kind === 'image')
          // Only a tile with photos is a decision. Loading, unreadable and
          // photo-less listings have nothing to keep or reject, so leaving them
          // clickable would offer a choice that changes nothing.
          const disabled = t.state !== 'ready'

          return (
            <button
              key={t.item.excelProduct}
              type="button"
              disabled={disabled}
              onClick={() => toggle(t.item.excelProduct)}
              aria-pressed={!isRejected && t.state === 'ready'}
              aria-label={
                t.state === 'failed'
                  ? `${t.item.productName} - listing would not load, nothing will be saved`
                  : t.state === 'empty'
                    ? `${t.item.productName} - listing has no photos, nothing to save`
                    : t.state === 'loading'
                      ? `${t.item.productName} - loading`
                      : `${t.item.productName} - ${isRejected ? 'rejected' : 'keeping'}`
              }
              className={`group relative flex flex-col overflow-hidden rounded-lg border-2 text-left transition ${
                t.state === 'failed'
                  ? 'border-destructive/40 bg-destructive/5'
                  : isRejected
                    ? 'border-destructive bg-destructive/10 opacity-60'
                    : t.state === 'ready'
                      ? 'border-primary/60 hover:border-primary'
                      : 'border-border'
              }`}
            >
              <div className="relative aspect-square w-full bg-muted">
                {t.state === 'loading' && (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {t.state === 'ready' && cover && (
                  <img
                    src={mediaSrc(cover.url) || '/placeholder.svg'}
                    alt={t.item.productName}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
                {t.state === 'empty' && (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">No photos on the listing</span>
                  </div>
                )}
                {t.state === 'failed' && (
                  <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <span className="text-[10px] text-destructive">Would not load</span>
                  </div>
                )}

                {/* The decision marker, readable at a glance across 20 tiles. */}
                {t.state === 'ready' && (
                  <div
                    className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ${
                      isRejected ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
                    }`}
                  >
                    {isRejected ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  </div>
                )}

                {t.state === 'ready' && t.media.length > 1 && (
                  <Badge
                    variant="secondary"
                    className="absolute bottom-1.5 left-1.5 h-5 px-1.5 text-[10px]"
                  >
                    {`${t.media.length} files`}
                  </Badge>
                )}
              </div>

              <div className="flex flex-col gap-0.5 p-2">
                <span className="line-clamp-2 text-[11px] font-medium leading-tight">
                  {t.item.productName}
                </span>
                {!t.item.productId && (
                  <span className="text-[10px] text-amber-500">Not matched yet</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {`${acceptable.length} keeping`}
          {rejected.size > 0 && ` - ${rejected.size} rejected`}
          {problems.length > 0 && ` - ${problems.length} would not load`}
          {emptyOnes.length > 0 && ` - ${emptyOnes.length} with no photos`}
          {savedCount > 0 && ` - ${savedCount} saved`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onNeedsDetail(startIndex)}
            disabled={saving}
            className="bg-transparent"
          >
            Review one by one
          </Button>
          <Button
            onClick={saveAccepted}
            disabled={saving || stillLoading || acceptable.length === 0}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? `Saving ${savedCount} of ${acceptable.length}` : `Save ${acceptable.length} good`}
          </Button>
        </div>
      </div>

      {(rejected.size > 0 || problems.length > 0) && (
        <p className="flex-shrink-0 text-[11px] leading-relaxed text-muted-foreground">
          {`The ${rejected.size + problems.length} you did not keep stay in the queue - saving takes you to the first one so you can fix it with the full tool.`}
        </p>
      )}
    </div>
  )
}
