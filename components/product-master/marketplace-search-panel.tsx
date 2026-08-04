'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  ImageIcon,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Video,
} from 'lucide-react'

export type MarketplaceHit = {
  id: string
  platform: string
  platformLabel: string
  title: string
  video: string | null
  image: string | null
  images: string[]
  price: string | null
  sold: number
  pageUrl: string | null
}

type PlatformInfo = { id: string; label: string; note: string }
type PlatformResult = { id: string; label: string; count: number; error: string | null }

const inlineUrl = (src: string) => `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(src)}`

const compact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

/**
 * 1688 is ticked by default because it is the only marketplace the current
 * TMAPI plan actually has credit for - every other one answers with "No API
 * credit for this marketplace" until it is topped up per platform. Defaulting
 * to AliExpress/Shopee meant the first search always returned a row of errors.
 */
const DEFAULT_PLATFORMS = ['alibaba']

export function MarketplaceSearchPanel({
  defaultQuery = '',
  onUseClip,
  onClipPending,
  onClipSettled,
  onMakePoster,
}: {
  defaultQuery?: string
  onUseClip?: (file: File) => void
  onClipPending?: (job: { id: string; title: string; thumb?: string }) => void
  onClipSettled?: (id: string, ok: boolean) => void
  /** Send a listing photo to Poster Studio */
  onMakePoster?: (args: { image: string; title: string }) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([])
  const [selected, setSelected] = useState<string[]>(DEFAULT_PLATFORMS)
  const [configured, setConfigured] = useState(true)
  const [results, setResults] = useState<MarketplaceHit[]>([])
  const [perPlatform, setPerPlatform] = useState<PlatformResult[]>([])
  const [videoOnly, setVideoOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, 'queued' | 'working' | 'done' | 'failed'>>({})
  const queue = useRef<Promise<void>>(Promise.resolve())

  // The platform list comes from the server so there is only ever one copy of it
  useEffect(() => {
    let alive = true
    fetch('/api/product-master/marketplace-search')
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.success) return
        setPlatforms(j.platforms || [])
        setConfigured(Boolean(j.configured))
      })
      .catch(() => {
        // The grid still works if this fails; the search call will report why
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setQuery(defaultQuery)
  }, [defaultQuery])

  const runSearch = useCallback(async () => {
    const term = query.trim()
    if (term.length < 2 || !selected.length) return
    setLoading(true)
    setError('')
    setResults([])
    setPlaying(null)
    try {
      const res = await fetch('/api/product-master/marketplace-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term, platforms: selected, page: 1, videoOnly }),
      })
      const json = await res.json()
      if (!json.success) {
        setPerPlatform(json.platforms || [])
        throw new Error(json.error || 'Search failed')
      }
      setResults(json.results || [])
      setPerPlatform(json.platforms || [])
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, selected, videoOnly])

  /**
   * Pull a listing video into the feed. Runs through a promise chain so ten
   * clicks download one after another instead of all at once - the same
   * queueing the TikTok panel uses, for the same reason.
   */
  const useClip = useCallback(
    (hit: MarketplaceHit) => {
      if (!onUseClip || !hit.video || jobs[hit.id]) return
      setJobs((j) => ({ ...j, [hit.id]: 'queued' }))
      onClipPending?.({ id: hit.id, title: hit.title, thumb: hit.image ?? undefined })

      queue.current = queue.current.then(async () => {
        setJobs((j) => ({ ...j, [hit.id]: 'working' }))
        try {
          const res = await fetch(inlineUrl(hit.video as string))
          if (!res.ok) throw new Error('Could not fetch clip')
          const blob = await res.blob()
          const name = `${hit.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'listing'}.mp4`
          onUseClip(new File([blob], name, { type: blob.type || 'video/mp4' }))
          setJobs((j) => ({ ...j, [hit.id]: 'done' }))
          onClipSettled?.(hit.id, true)
        } catch {
          setJobs((j) => ({ ...j, [hit.id]: 'failed' }))
          onClipSettled?.(hit.id, false)
        }
      })
    },
    [jobs, onClipPending, onClipSettled, onUseClip],
  )

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))

  const videoCount = results.filter((r) => r.video).length
  const failedPlatforms = perPlatform.filter((p) => p.error)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Marketplace listings</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Search real product listings and pull their seller videos and photos. These are shop listings, not
          social feeds {'\u2014'} fewer clips than TikTok, but always the exact product.
        </p>
      </div>

      {!configured && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-200">
            TMAPI_TOKEN is not set, so marketplace search is unavailable. Add it in project settings.
          </p>
        </div>
      )}

      {/* Each ticked marketplace is a separate paid API call, so the cost of a
          search is made obvious before it runs rather than after the bill */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Marketplaces:</span>
          {platforms.map((p) => {
            const on = selected.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                title={p.note}
                aria-pressed={on}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  on ? 'bg-amber-500 text-black' : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {selected.length === 0
            ? 'Pick at least one marketplace.'
            : `${selected.length} ${selected.length === 1 ? 'marketplace' : 'marketplaces'} = ${selected.length} API ${
                selected.length === 1 ? 'call' : 'calls'
              } per search.`}
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
              e.preventDefault()
              runSearch()
            }
          }}
          placeholder="e.g. u-shaped massage pillow"
          className="flex-1"
          aria-label="Search marketplace listings"
        />
        <Button onClick={runSearch} disabled={loading || query.trim().length < 2 || !selected.length}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          Search
        </Button>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={videoOnly}
          onChange={(e) => setVideoOnly(e.target.checked)}
          className="h-3.5 w-3.5 accent-amber-500"
        />
        Only listings with a video
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Naming the marketplace that failed matters: a wrong endpoint path and
          an genuinely empty result look identical without it */}
      {failedPlatforms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          {failedPlatforms.map((p) => (
            <span key={p.id} className="rounded-full border border-amber-500/30 px-2 py-0.5">
              {p.label}: {p.error}
            </span>
          ))}
        </div>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          No listings found. Try a shorter term, or untick {'"'}Only listings with a video{'"'}.
        </p>
      )}

      {results.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {results.length} {results.length === 1 ? 'listing' : 'listings'} {'\u2014'} {videoCount} with video
        </p>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((hit) => {
            const job = jobs[hit.id]
            return (
              <div key={hit.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
                <div className="relative aspect-square bg-black">
                  {playing === hit.id && hit.video ? (
                    <video
                      src={inlineUrl(hit.video)}
                      controls
                      autoPlay
                      playsInline
                      className="h-full w-full object-contain"
                    />
                  ) : hit.image ? (
                    <img
                      src={inlineUrl(hit.image) || '/placeholder.svg'}
                      alt={hit.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}

                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {hit.platformLabel}
                  </span>

                  {hit.video && playing !== hit.id && (
                    <button
                      type="button"
                      onClick={() => setPlaying(hit.id)}
                      className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors hover:bg-black/50"
                      aria-label={`Play ${hit.title}`}
                    >
                      <span className="rounded-full bg-amber-500 p-2">
                        <Video className="h-4 w-4 text-black" />
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1.5 p-2">
                  <p className="line-clamp-2 text-[11px] leading-relaxed" title={hit.title}>
                    {hit.title}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {hit.price && <span className="font-semibold text-amber-400">{hit.price}</span>}
                    {hit.sold > 0 && <span>{compact(hit.sold)} sold</span>}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {onUseClip && hit.video && (
                      <button
                        type="button"
                        onClick={() => useClip(hit)}
                        disabled={Boolean(job)}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-1 text-[10px] font-bold text-black transition-opacity disabled:opacity-60"
                      >
                        {job === 'queued' || job === 'working' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : job === 'done' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Plus className="h-3 w-3" />
                        )}
                        {job === 'done' ? 'Added' : job === 'failed' ? 'Retry' : 'Use clip'}
                      </button>
                    )}

                    {onMakePoster && hit.image && (
                      <button
                        type="button"
                        onClick={() => onMakePoster({ image: hit.image as string, title: hit.title })}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Sparkles className="h-3 w-3" />
                        Poster
                      </button>
                    )}

                    {hit.pageUrl && (
                      <a
                        href={hit.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
