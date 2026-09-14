'use client'

import { useCallback, useEffect, useState } from 'react'
import { VideoSearchPanel } from '@/components/product-master/video-search-panel'
import type { QueueClipInput } from '@/lib/product-master/clip-jobs'

/**
 * Feature 8: one place to find a product video.
 *
 * This was two tabs - "Video search" (social, by name) and "Marketplace
 * listings" (1688, by photo) - which split ONE question across two searches the
 * user had to run separately and mentally merge.
 *
 * Now there is a single search: the product photo goes in, and every source is
 * fanned out behind it (supplier listing video, TikTok, Shorts, Reels), with the
 * results ranked into one grid. The 1688 half is not gone, it moved into that
 * fan-out - see app/api/product-master/image-search, where its listing videos
 * are ranked ABOVE social hits because reverse-image search matched the actual
 * object rather than the same category filmed by a stranger.
 *
 * The PHOTO harvest came with it, and grew: the same paid detail calls that
 * reveal the videos also carry each listing's gallery, so the search now returns
 * ~60 product photos where the old tab could show 12. Those are not a bonus -
 * the reel editor overlays a product photo onto the clip, so the pictures are
 * what let one piece of footage become several different ads.
 *
 * Supplier SOURCING (prices, who to buy from) deliberately did not move here.
 * It lives in Purchase Orders (po-supplier-finder) and Poster Studio, which is
 * where that question is actually asked - this panel only wants videos.
 */
export function SourceFinderPanel({
  onQueueClips,
  ...props
}: {
  defaultQuery?: string
  productImage?: string | null
  /**
   * Needed so photos harvested during the search can be saved to the product.
   * Nullable because the Studio can be open before a product row exists, in
   * which case there is nowhere to save and the button explains that.
   */
  productId?: string | null
  onQueueClips?: (jobs: QueueClipInput[]) => Promise<boolean>
  /** Lets the Studio reload its overlay gallery once photos are saved */
  onPhotosSaved?: () => void
}) {
  /**
   * Feature 9: how many clips are already saved. The server refuses to insert
   * a clip whose source_id it has seen before, but the count here gives that
   * guard a visible presence so a repeat save reads as "already had it"
   * rather than as a silent no-op.
   */
  const [savedCount, setSavedCount] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refreshKnown = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/product-master/clips/known-sources')
      const json = await res.json()
      if (json?.success) setSavedCount((json.saved ?? []).length)
    } catch {
      // A failed dedupe lookup must never block searching - the server-side
      // guard is the real protection, this is only the display.
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshKnown()
  }, [refreshKnown])

  /**
   * Queue clips, then re-count the library.
   *
   * The count is refreshed on a delay as well as immediately: queueing no
   * longer means the clip has arrived, so the number only becomes correct once
   * the server download has actually finished.
   */
  const handleQueue = useCallback(
    async (jobs: QueueClipInput[]) => {
      const ok = (await onQueueClips?.(jobs)) ?? false
      if (ok) setTimeout(() => void refreshKnown(), 8000)
      return ok
    },
    [onQueueClips, refreshKnown],
  )

  /*
   * No card, no header of its own.
   *
   * This used to wrap the panel in a bordered card titled "Find a product
   * video", while the panel immediately printed its own "Find product videos"
   * heading and an explanatory paragraph - two headers and a border saying the
   * same thing, stacked, before a single result was visible. The library counter
   * was the only real content here, so it moves into the panel's toolbar and the
   * rest of the chrome is gone.
   */
  return (
    <VideoSearchPanel
      {...props}
      onQueueClips={handleQueue}
      savedCount={savedCount}
      refreshingLibrary={refreshing}
      onRefreshLibrary={() => void refreshKnown()}
    />
  )
}
