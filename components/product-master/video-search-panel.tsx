'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Download, ExternalLink, Eye, Heart, Loader2, Play, Plus, Search } from 'lucide-react'

export type VideoHit = {
  id: string
  title: string
  cover: string | null
  play: string | null
  duration: number
  author: string
  authorId: string
  pageUrl: string
  plays: number
  likes: number
}

const inlineUrl = (src: string) =>
  `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(src)}`

const compact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

const clock = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

const safeName = (hit: VideoHit) =>
  `tiktok-${(hit.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'video'}.mp4`

// Resolve a fresh watermark-free HD stream for a search hit by handing its
// TikTok page URL to the existing resolver. Falls back to the search result's
// own stream if the resolver is unavailable.
async function resolveStream(hit: VideoHit): Promise<string> {
  try {
    const res = await fetch('/api/product-master/video-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: hit.pageUrl }),
    })
    const meta = await res.json()
    if (meta.success && meta.videoUrl) return meta.videoUrl as string
  } catch {
    // fall through
  }
  if (hit.play) return hit.play
  throw new Error('No downloadable stream for this video')
}

export function VideoSearchPanel({
  defaultQuery = '',
  onUseClip,
}: {
  defaultQuery?: string
  onUseClip?: (file: File) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<VideoHit[]>([])
  const [cursor, setCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const lastQuery = useRef('')

  const runSearch = useCallback(async (q: string, next = false) => {
    const term = q.trim()
    if (term.length < 2) return
    setLoading(true)
    setError('')
    if (!next) {
      setResults([])
      setPlaying(null)
    }
    try {
      const res = await fetch('/api/product-master/video-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term, cursor: next ? cursor : 0 }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Search failed')
      setResults((prev) => (next ? [...prev, ...json.results] : json.results))
      setCursor(json.cursor || 0)
      setHasMore(Boolean(json.hasMore))
      lastQuery.current = term
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [cursor])

  // Auto-run the first search for the product this studio was opened with
  useEffect(() => {
    if (defaultQuery.trim().length >= 2) runSearch(defaultQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultQuery])

  const download = async (hit: VideoHit) => {
    setBusyId(hit.id)
    setNote('')
    try {
      const stream = await resolveStream(hit)
      const name = safeName(hit)
      const a = document.createElement('a')
      a.href = `/api/product-master/video-fetch?src=${encodeURIComponent(stream)}&filename=${encodeURIComponent(name)}`
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setNote(`Downloading ${name}`)
      setTimeout(() => setNote(''), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusyId(null)
    }
  }

  const useInStudio = async (hit: VideoHit) => {
    if (!onUseClip) return
    setBusyId(hit.id)
    setNote('')
    try {
      const stream = await resolveStream(hit)
      const name = safeName(hit)
      const res = await fetch(
        `/api/product-master/video-fetch?src=${encodeURIComponent(stream)}&filename=${encodeURIComponent(name)}`,
      )
      if (!res.ok) throw new Error('Could not download this video - try again')
      const blob = await res.blob()
      if (blob.size < 10_000) throw new Error('Downloaded file looks empty - try again')
      onUseClip(new File([blob], name, { type: 'video/mp4' }))
      setNote(`Added to your feed: ${name}`)
      setTimeout(() => setNote(''), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this video')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4 text-amber-500" />
          Find product videos on TikTok
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Search real TikTok videos for this product, preview them here, then download or drop them straight
          into your feed to cut and brand.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
              e.preventDefault()
              runSearch(query)
            }
          }}
          placeholder="e.g. orthopedic leg pillow"
          className="flex-1"
          aria-label="Search product videos"
        />
        <Button onClick={() => runSearch(query)} disabled={loading || query.trim().length < 2}>
          {loading && results.length === 0 ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-3.5 w-3.5" />
          )}
          Search
        </Button>
      </div>

      {/* Platforms without a public search API - deep-link out instead of
          pretending we can list their videos here */}
      {query.trim().length >= 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Also browse:</span>
          {[
            { name: 'Instagram', href: `https://www.instagram.com/explore/tags/${encodeURIComponent(query.trim().replace(/\s+/g, ''))}/` },
            { name: 'Temu', href: `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query.trim())}` },
            { name: 'YouTube', href: `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}&sp=EgIYAQ%253D%253D` },
          ].map((p) => (
            <a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {p.name}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
          <span className="text-xs text-muted-foreground">
            {'\u2014'} paste any link you find into the box below
          </span>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {note && <p className="text-xs text-amber-400">{note}</p>}

      {searched && !loading && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">No videos found for that search. Try a shorter term.</p>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((hit) => (
            <div key={hit.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              <div className="relative aspect-[9/16] bg-black">
                {playing === hit.id && hit.play ? (
                  <video
                    src={inlineUrl(hit.play)}
                    controls
                    autoPlay
                    playsInline
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <>
                    {hit.cover ? (
                      <img
                        src={inlineUrl(hit.cover) || '/placeholder.svg'}
                        alt={hit.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}
                    <button
                      type="button"
                      onClick={() => setPlaying(hit.id)}
                      disabled={!hit.play}
                      aria-label={`Play ${hit.title}`}
                      className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity hover:opacity-100 disabled:hidden"
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90">
                        <Play className="ml-0.5 h-5 w-5 fill-foreground text-foreground" />
                      </span>
                    </button>
                    {hit.duration > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {clock(hit.duration)}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-1.5 p-2">
                <p className="line-clamp-2 text-xs leading-snug" title={hit.title}>
                  {hit.title}
                </p>
                <p className="truncate text-[11px] text-muted-foreground" title={hit.author}>
                  @{hit.authorId || hit.author}
                </p>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {compact(hit.plays)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {compact(hit.likes)}
                  </span>
                  <a
                    href={hit.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto hover:text-foreground"
                    aria-label="Open on TikTok"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-auto flex gap-1.5 pt-1">
                  {onUseClip && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 flex-1 px-2 text-[11px]"
                      onClick={() => useInStudio(hit)}
                      disabled={busyId === hit.id}
                    >
                      {busyId === hit.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Plus className="mr-1 h-3 w-3" />
                          Use
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => download(hit)}
                    disabled={busyId === hit.id}
                    aria-label={`Download ${hit.title}`}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && results.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => runSearch(lastQuery.current, true)}
          disabled={loading}
          className="self-center"
        >
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Load more
        </Button>
      )}
    </section>
  )
}
