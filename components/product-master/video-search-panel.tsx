'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Check,
  Download,
  ExternalLink,
  Eye,
  Heart,
  ImageIcon,
  Images,
  Loader2,
  Play,
  Plus,
  ScanSearch,
  Search,
  Upload,
} from 'lucide-react'

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
  score?: number
  /** Title mentions Temu - a real marketplace demo of the product */
  temu?: boolean
}

export type ImageHit = {
  id: string
  title: string
  image: string
  thumbnail: string
  width: number
  height: number
  source: string
  pageUrl: string
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

// Real reverse-image engines. They accept a public image URL, so these open
// the actual product photo as a visual search on each platform.
const lensLinks = (url: string) => [
  { name: 'Google Lens', href: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}` },
  {
    name: 'Bing Visual',
    href: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&q=imgurl:${encodeURIComponent(url)}`,
  },
  { name: 'Yandex', href: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}` },
]

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
  productImage = null,
  onUseClip,
}: {
  defaultQuery?: string
  /** Product photo from inventory - powers the lens search */
  productImage?: string | null
  onUseClip?: (file: File) => void
}) {
  const [mode, setMode] = useState<'text' | 'image'>('text')
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
  // 'all' = whole short-video index, 'temu' = Temu listings and hauls only
  const [source, setSource] = useState<'all' | 'temu'>('all')
  const lastQuery = useRef('')
  const lastSource = useRef<'all' | 'temu'>('all')

  // Lens state
  const [lensImage, setLensImage] = useState<string | null>(productImage)
  const [lensPreview, setLensPreview] = useState<string | null>(productImage)
  const [lensUpload, setLensUpload] = useState<string | null>(null) // base64 data URL
  const [lensSource, setLensSource] = useState<string>('')
  const [detected, setDetected] = useState<{ label: string; queries: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // "Find a better photo" state - a supplier thumbnail with promo text baked in
  // often gets misread, so a cleaner packshot can be swapped in first
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState(defaultQuery)
  const [pickResults, setPickResults] = useState<ImageHit[]>([])
  const [pickLoading, setPickLoading] = useState(false)
  const [pickSearched, setPickSearched] = useState(false)

  useEffect(() => {
    setLensImage(productImage)
    setLensPreview(productImage)
    setLensUpload(null)
    setLensSource('')
  }, [productImage])

  const runSearch = useCallback(
    async (q: string, next = false, src: 'all' | 'temu' = source) => {
      const term = q.trim()
      if (term.length < 2) return
      setMode('text')
      setLoading(true)
      setError('')
      if (!next) {
        setResults([])
        setPlaying(null)
        setDetected(null)
      }
      try {
        const res = await fetch('/api/product-master/video-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: term, cursor: next ? cursor : 0, source: src }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Search failed')
        setResults((prev) => (next ? [...prev, ...json.results] : json.results))
        setCursor(json.cursor || 0)
        setHasMore(Boolean(json.hasMore))
        lastQuery.current = term
        lastSource.current = src
        setSearched(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [cursor, source],
  )

  // Lens search: send the product photo, get back what it is plus videos of
  // that same kind of product ranked by how well they match
  const runLensSearch = useCallback(async () => {
    if (!lensUpload && !lensImage) return
    setMode('image')
    setLoading(true)
    setError('')
    setResults([])
    setPlaying(null)
    setDetected(null)
    setHasMore(false)
    try {
      const res = await fetch('/api/product-master/image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(lensUpload ? { imageBase64: lensUpload } : { imageUrl: lensImage }),
          productName: defaultQuery,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Image search failed')
      setResults(json.results || [])
      setDetected({ label: json.label || '', queries: json.queries || [] })
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image search failed')
    } finally {
      setLoading(false)
    }
  }, [lensUpload, lensImage, defaultQuery])

  // Pull clean product photos off the web so a poor supplier thumbnail can be
  // swapped for a proper packshot before the AI reads it
  const runImageLookup = useCallback(async (q: string) => {
    const term = q.trim()
    if (term.length < 2) return
    setPickLoading(true)
    setError('')
    try {
      const res = await fetch('/api/product-master/image-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Image lookup failed')
      setPickResults(json.results || [])
      setPickSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image lookup failed')
    } finally {
      setPickLoading(false)
    }
  }, [])

  const chooseWebImage = (hit: ImageHit) => {
    setLensImage(hit.image)
    // Preview the thumbnail - the full-size original often blocks hotlinking
    setLensPreview(inlineUrl(hit.thumbnail))
    setLensUpload(null)
    setLensSource(hit.source)
    setPickerOpen(false)
    setError('')
  }

  const onPickFile = (file?: File | null) => {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Image is too large - use one under 8MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setLensUpload(String(reader.result))
      setLensImage(String(reader.result))
      setLensPreview(String(reader.result))
      setLensSource('')
      setError('')
    }
    reader.readAsDataURL(file)
  }

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

  const publicImage = lensImage && /^https?:\/\//i.test(lensImage) ? lensImage : null

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4 text-amber-500" />
          Find product videos
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Search by name, or run the product photo through image search to find videos of the exact same
          product. Preview here, then download or drop straight into your feed.
        </p>
      </div>

      {/* Mode switch */}
      <div className="flex w-fit gap-1 rounded-lg border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'text' ? 'bg-amber-500 text-black' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          By name
        </button>
        <button
          type="button"
          onClick={() => setMode('image')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'image' ? 'bg-amber-500 text-black' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ScanSearch className="h-3.5 w-3.5" />
          By product photo
        </button>
      </div>

      {mode === 'text' ? (
        <>
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

          {/* Where to pull from. Temu mode hunts for the marketplace listings
              and hauls of this product, which sell far better than generic clips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Show:</span>
            {(
              [
                { key: 'all', label: 'All videos' },
                { key: 'temu', label: 'Temu videos' },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setSource(s.key)
                  if (query.trim().length >= 2) runSearch(query, false, s.key)
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  source === s.key
                    ? 'bg-amber-500 text-black'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
            {source === 'temu' && (
              <span className="text-xs text-muted-foreground">
                Temu listing demos and hauls of this product
              </span>
            )}
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
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
              {lensPreview ? (
                <img
                  src={lensPreview || '/placeholder.svg'}
                  alt="Product being searched"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="flex min-w-[220px] flex-1 flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {lensImage
                  ? 'This photo is read by AI to work out exactly what the product is, then videos of that same product are pulled and ranked by how well they match.'
                  : 'This product has no photo saved. Pick a clearer one off the web, or upload one.'}
              </p>
              {lensSource && (
                <p className="text-[11px] text-amber-400">
                  Using a photo from {lensSource} instead of the inventory thumbnail
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={runLensSearch} disabled={loading || !lensImage}>
                  {loading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Search by this photo
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const next = !pickerOpen
                    setPickerOpen(next)
                    if (next && !pickSearched) runImageLookup(pickQuery || defaultQuery)
                  }}
                >
                  <Images className="mr-1.5 h-3.5 w-3.5" />
                  Find a better photo
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload
                </Button>
                {productImage && (lensUpload || lensSource) && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setLensUpload(null)
                      setLensSource('')
                      setLensImage(productImage)
                      setLensPreview(productImage)
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  onPickFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          </div>

          {/* Web photo picker - swap a scrappy supplier thumbnail for a clean
              packshot so the vision pass has a fair shot at the right product */}
          {pickerOpen && (
            <div className="rounded-lg border border-border bg-background/60 p-3">
              <p className="text-xs text-muted-foreground">
                Pick a clearer photo of this product from the web, then search by it.
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
                      e.preventDefault()
                      runImageLookup(pickQuery)
                    }
                  }}
                  placeholder="Describe the product, e.g. 10m nylon clothesline rope"
                  className="flex-1"
                  aria-label="Search the web for product photos"
                />
                <Button
                  variant="secondary"
                  onClick={() => runImageLookup(pickQuery)}
                  disabled={pickLoading || pickQuery.trim().length < 2}
                >
                  {pickLoading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Find
                </Button>
              </div>

              {pickSearched && !pickLoading && pickResults.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  No photos found. Try describing the product differently.
                </p>
              )}

              {pickResults.length > 0 && (
                <div className="mt-3 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
                  {pickResults.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => chooseWebImage(img)}
                      title={`${img.title} (${img.source})`}
                      className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-amber-500"
                    >
                      <img
                        src={inlineUrl(img.thumbnail) || '/placeholder.svg'}
                        alt={img.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex items-center gap-1 rounded-full bg-amber-500 px-2 py-1 text-[10px] font-bold text-black">
                          <Check className="h-3 w-3" />
                          Use this
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Genuine reverse-image search on the big engines, opened with the
              real product photo */}
          {publicImage && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Reverse image search:</span>
              {lensLinks(publicImage).map((l) => (
                <a
                  key={l.name}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {l.name}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}

          {detected && (
            <div className="rounded-lg border border-border bg-background/60 p-2.5">
              <p className="text-xs">
                <span className="text-muted-foreground">Identified as</span>{' '}
                <span className="font-semibold text-amber-400">{detected.label || 'this product'}</span>
              </p>
              {detected.queries.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Searched:</span>
                  {detected.queries.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setQuery(q)
                        runSearch(q)
                      }}
                      className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
                      title="Run this as a normal search"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {note && <p className="text-xs text-amber-400">{note}</p>}

      {searched && !loading && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">No videos found. Try a shorter term or another photo.</p>
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
                    {mode === 'image' && (hit.score ?? 0) > 0 && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">
                        Match
                      </span>
                    )}
                    {hit.temu && mode !== 'image' && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Temu
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

      {mode === 'text' && hasMore && results.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => runSearch(lastQuery.current, true, lastSource.current)}
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
