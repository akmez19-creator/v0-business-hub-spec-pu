'use client'

import { useCallback, useEffect, useState } from 'react'
import { Library, Loader2, RefreshCw, Search, Store, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VideoSearchPanel } from '@/components/product-master/video-search-panel'
import { MarketplaceSearchPanel } from '@/components/product-master/marketplace-search-panel'

/**
 * Feature 8: one place to find a product video.
 *
 * "Find product video" (the TikTok-style feed) and "Marketplace listing" used
 * to be two separate stacked sections, so the same search had to be typed
 * twice and the page grew very tall before the actual reel editor appeared.
 * They answer the same question from two angles, so they belong behind one
 * header as two tabs.
 *
 * Both child panels take an identical prop shape and are mounted unchanged -
 * this is purely a container, so their download/dedupe behaviour is untouched.
 *
 * Both stay MOUNTED when inactive (forceMount + hidden) so that switching tabs
 * does not throw away search results or in-flight downloads.
 */
export function SourceFinderPanel({
  onClipSettled,
  ...props
}: {
  defaultQuery?: string
  productImage?: string | null
  onUseClip?: (file: File, origin?: { sourceId?: string | null; sourceUrl?: string | null }) => void
  onClipPending?: (job: { id: string; title: string; thumb?: string }) => void
  onClipSettled?: (id: string, ok: boolean) => void
}) {
  const [tab, setTab] = useState('videos')

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

  // A clip that just landed should immediately count towards the library
  const handleSettled = useCallback(
    (id: string, ok: boolean) => {
      onClipSettled?.(id, ok)
      if (ok) void refreshKnown()
    },
    [onClipSettled, refreshKnown],
  )

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Find a product video</h3>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <Library className="h-3.5 w-3.5" />
            {savedCount === null ? '\u2014' : savedCount} already saved
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshKnown()}
            disabled={refreshing}
            aria-label="Refresh library index"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="videos" className="gap-1.5">
            <Video className="h-3.5 w-3.5" />
            Video search
          </TabsTrigger>
          <TabsTrigger value="marketplace" className="gap-1.5">
            <Store className="h-3.5 w-3.5" />
            Marketplace listings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" forceMount hidden={tab !== 'videos'} className="mt-3">
          <VideoSearchPanel {...props} onClipSettled={handleSettled} />
        </TabsContent>

        <TabsContent value="marketplace" forceMount hidden={tab !== 'marketplace'} className="mt-3">
          <MarketplaceSearchPanel {...props} onClipSettled={handleSettled} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
