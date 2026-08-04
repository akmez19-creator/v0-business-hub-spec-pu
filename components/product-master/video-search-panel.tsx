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
  onClipPending,
  onClipSettled,
}: {
  defaultQuery?: string
  /** Product photo from inventory - powers the lens search */
  productImage?: string | null
  /** origin carries the platform's own id so the library can spot a re-save */
  onUseClip?: (file: File, origin?: { sourceId?: string | null; sourceUrl?: string | null }) => void
  /** Fired the moment a clip is queued, so the feed can show it downloading
   *  instead of sitting empty until the bytes land */
  onClipPending?: (job: { id: string; title: string; thumb?: string }) => void
  /** Fired when that job finishes, whichever way it went */
  onClipSettled?: (id: string, ok: boolean) => void
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
  // Per-clip job state. A single shared "busy" id meant a second click wiped
  // the first clip's spinner while it was still downloading, so ten clicks
  // looked like one. Each clip now owns its own status and the clicks queue.
  const [jobs, setJobs] = useState<Record<string, 'queued' | 'working' | 'done' | 'failed'>>({})
  // Plain browser download is a separate, near-instant action
  const [dlId, setDlId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  // 'all' = whole short-video index, 'temu' = Temu listings and hauls only
  const [source, setSource] = useState<'all' | 'temu'>('all')
  const lastQuery = useRef('')
  const lastSource = useRef<'all' | 'temu'>('all')
  // Feature 9: which of these results are ALREADY in the clip library, so the
  // same video is not downloaded and saved a second time.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  // Default to hiding clips already in the library: the point of the check is
  // to stop you re-watching and re-downloading footage you own. The toggle
  // exists because "show me everything" is still a legitimate thing to want.
  const [hideSaved, setHideSaved] = useState(true)

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

  // Ask the server which of the current results are already saved. Runs on
  // every result change (including "load more"), and is deliberately
  // fire-and-forget: a failed check just means no badges, never a broken grid.
  useEffect(() => {
    if (!results.length) return
    let cancelled = false
    // Must use the SAME `video:` prefix runOne writes, or nothing ever matches
    const ids = results.filter((r) => r.id).map((r) => `video:${r.id}`)
    const urls = results.map((r) => r.pageUrl).filter(Boolean)
    ;(async () => {
      try {
        const res = await fetch('/api/product-master/clips/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceIds: ids, sourceUrls: urls }),
        })
        const json = await res.json()
        if (cancelled || !json?.success) return
        // Both sets come back in storage form; the grid keys on the raw hit
        // id, so strip the prefix and fold url matches into the same set.
        const savedPrefixed = new Set<string>(json.savedIds ?? [])
        const savedUrls = new Set<string>(json.savedUrls ?? [])
        const saved = new Set<string>()
        for (const r of results) {
          if (savedPrefixed.has(`video:${r.id}`)) saved.add(r.id)
          else if (r.pageUrl && savedUrls.has(r.pageUrl)) saved.add(r.id)
        }
        setSavedIds(saved)
      } catch {
        // Badging is an enhancement; ignore failures
      }
    })()
    return () => {
      cancelled = true
    }
  }, [results])

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
  // src is passed explicitly when the source toggle triggers the re-run, since
  // the state setter in that same click hasn't committed yet
  const runLensSearch = useCallback(async (src: 'all' | 'temu' = source) => {
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
          source: src,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Image search failed')
      setResults(json.results || [])
      setDetected({ label: json.label || '', queries: json.queries || [] })
      lastSource.current = src
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image search failed')
    } finally {
      setLoading(false)
    }
  }, [lensUpload, lensImage, defaultQuery, source])

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
    setDlId(hit.id)
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
      setDlId(null)
    }
  }

  // Downloading ten videos at once would stall them all behind the browser's
  // per-host connection limit and hammer the proxy, so a small pool works
  // through the queue. Clicking is always instant - only the work is paced.
  const MAX_PARALLEL = 3
  const queueRef = useRef<VideoHit[]>([])
  const activeRef = useRef(0)
  // Kept in refs so a queued job never calls a stale version of a callback
  const useClipRef = useRef(onUseClip)
  useClipRef.current = onUseClip
  const settledRef = useRef(onClipSettled)
  settledRef.current = onClipSettled

  const runOne = async (hit: VideoHit) => {
    setJobs((p) => ({ ...p, [hit.id]: 'working' }))
    try {
      const stream = await resolveStream(hit)
      const name = safeName(hit)
      const res = await fetch(
        `/api/product-master/video-fetch?src=${encodeURIComponent(stream)}&filename=${encodeURIComponent(name)}`,
      )
      if (!res.ok) throw new Error('Could not download this video - try again')
      const blob = await res.blob()
      if (blob.size < 10_000) throw new Error('Downloaded file looks empty - try again')
      // hit.id is the platform's own video id, so the library can recognise
      // this exact clip if it shows up in a future search
      useClipRef.current?.(new File([blob], name, { type: 'video/mp4' }), {
        sourceId: hit.id ? `video:${hit.id}` : null,
        // The page url, NOT `stream`: stream urls are short-lived signed CDN
        // links that differ on every search, so storing one would never match
        // again and the dedupe check would silently always miss.
        sourceUrl: hit.pageUrl || null,
      })
      setJobs((p) => ({ ...p, [hit.id]: 'done' }))
      // Clear the feed placeholder only now the real clip has replaced it
      settledRef.current?.(hit.id, true)
    } catch (e) {
      // Marked on the card itself, so one failure out of ten is obvious
      // without a shared banner that the next job would overwrite
      setJobs((p) => ({ ...p, [hit.id]: 'failed' }))
      settledRef.current?.(hit.id, false)
      setError(e instanceof Error ? e.message : 'Could not add this video')
    }
  }

  const pump = () => {
    while (activeRef.current < MAX_PARALLEL && queueRef.current.length > 0) {
      const hit = queueRef.current.shift()!
      activeRef.current++
      void runOne(hit).finally(() => {
        activeRef.current--
        pump()
      })
    }
  }

  const useInStudio = (hit: VideoHit) => {
    if (!onUseClip) return
    // Already added, in flight, or waiting - ignore the repeat click
    const state = jobs[hit.id]
    if (state === 'queued' || state === 'working' || state === 'done') return
    setError('')
    setJobs((p) => ({ ...p, [hit.id]: 'queued' }))
    onClipPending?.({ id: hit.id, title: hit.title || 'Video', thumb: hit.cover ? inlineUrl(hit.cover) : undefined })
    queueRef.current.push(hit)
    pump()
  }

  /** One click to take every result on screen that has not been added yet */
  const useAll = () => {
    const pending = results.filter((h) => {
      // Never bulk-download something already in the library - that is the
      // exact waste the dedupe check exists to prevent, and "Use all" is the
      // easiest way to trigger it by accident.
      if (savedIds.has(h.id)) return false
      const s = jobs[h.id]
      return s !== 'queued' && s !== 'working' && s !== 'done'
    })
    if (pending.length === 0) return
    setError('')
    setJobs((p) => {
      const next = { ...p }
      for (const h of pending) next[h.id] = 'queued'
      return next
    })
    for (const h of pending) {
      onClipPending?.({ id: h.id, title: h.title || 'Video', thumb: h.cover ? inlineUrl(h.cover) : undefined })
    }
    queueRef.current.push(...pending)
    pump()
  }

  const queuedCount = Object.values(jobs).filter((s) => s === 'queued' || s === 'working').length
  const doneCount = Object.values(jobs).filter((s) => s === 'done').length

  // What the grid actually renders. Kept as a separate value so the raw
  // `results` still drives paging and the "N hidden" count stays truthful.
  const visibleResults = hideSaved ? results.filter((r) => !savedIds.has(r.id)) : results
  const hiddenCount = results.length - visibleResults.length

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

      {/* Where to pull from. Temu mode hunts the marketplace listings and hauls
          of this product, which sell far better than generic clips. It applies
          to both tabs: by photo the phrasings are built from what the AI sees
          in the picture rather than the inventory name. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Show:</span>
        {(
          [
            { key: 'all', label: 'All videos' },
            // Named "mentions" deliberately: TMAPI has no Temu endpoint, and
            // this is a TikTok keyword search, not real Temu listing data.
            // The old "Temu videos" label implied a data source that does not exist.
            { key: 'temu', label: 'Temu mentions' },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSource(s.key)
              // Re-run whichever search is already on screen, so switching
              // source never leaves stale results from the other one
              if (mode === 'image') {
                if (lensUpload || lensImage) runLensSearch(s.key)
              } else if (query.trim().length >= 2) {
                runSearch(query, false, s.key)
              }
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
            TikTok clips that mention Temu {'\u2014'} for real listings use Marketplace listings below
          </span>
        )}
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
                <Button onClick={() => runLensSearch()} disabled={loading || !lensImage}>
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

      {/* Bulk bar: taking a batch of clips is the normal case, so it should
          not cost one click and one wait per clip */}
      {results.length > 0 && onUseClip && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-[11px]" onClick={useAll}>
            <Plus className="mr-1 h-3 w-3" />
            Use all {visibleResults.length}
          </Button>
          {hiddenCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              onClick={() => setHideSaved((v) => !v)}
            >
              {hideSaved ? `Show ${hiddenCount} already in library` : 'Hide clips in library'}
            </Button>
          )}
          {queuedCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-400" aria-live="polite">
              <Loader2 className="h-3 w-3 animate-spin" />
              Adding {queuedCount} {queuedCount === 1 ? 'clip' : 'clips'}
            </span>
          )}
          {doneCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-500">
              <Check className="h-3 w-3" />
              {doneCount} in your feed
            </span>
          )}
        </div>
      )}

      {visibleResults.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleResults.map((hit) => (
            <div
              key={hit.id}
              className={`flex flex-col overflow-hidden rounded-lg border bg-card ${
                savedIds.has(hit.id) ? 'border-emerald-500/60' : 'border-border'
              }`}
            >
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
                    {hit.temu && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        Temu
                      </span>
                    )}
                  </>
                )}
                {/* Feature 9: already downloaded once - saving again would just
                    duplicate the row and re-upload the same video */}
                {savedIds.has(hit.id) && (
                  <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Check className="h-3 w-3" />
                    In library
                  </span>
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
                      variant={jobs[hit.id] === 'done' ? 'default' : 'secondary'}
                      className={`h-7 flex-1 px-2 text-[11px] ${
                        jobs[hit.id] === 'done' ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''
                      }`}
                      onClick={() => useInStudio(hit)}
                      disabled={
                        jobs[hit.id] === 'queued' || jobs[hit.id] === 'working' || jobs[hit.id] === 'done'
                      }
                    >
                      {jobs[hit.id] === 'working' ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Adding
                        </>
                      ) : jobs[hit.id] === 'queued' ? (
                        'Waiting'
                      ) : jobs[hit.id] === 'done' ? (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          Added
                        </>
                      ) : jobs[hit.id] === 'failed' ? (
                        'Retry'
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
                    disabled={dlId === hit.id}
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

      {/* Every hit is already saved. Without this the grid would simply be
          empty and read as "the search found nothing", which is the opposite
          of what happened. */}
      {results.length > 0 && visibleResults.length === 0 && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-muted-foreground">
          All {results.length} {results.length === 1 ? 'result is' : 'results are'} already in your
          library.
        </p>
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
