'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Heart,
  ImageIcon,
  Images,
  Library,
  Loader2,
  Play,
  Plus,
  Globe,
  ImagePlus,
  RefreshCw,
  ScanSearch,
  Search,
  Store,
  Upload,
} from 'lucide-react'
import { mediaSrc } from '@/lib/media-url'
import type { QueueClipInput } from '@/lib/product-master/clip-jobs'

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
  /** Where it came from. Absent on legacy name-search responses = TikTok. */
  platform?: 'tiktok' | 'youtube' | 'instagram' | 'alibaba' | 'facebook' | 'bilibili'
  /**
   * Whether the clip can actually be pulled into the feed.
   *
   * YouTube Shorts are searchable but their media is bot-walled server-side, so
   * those hits are watch-and-open only. Undefined means TikTok, which is
   * downloadable - that keeps the older name-search response working unchanged.
   */
  downloadable?: boolean
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

const isYouTube = (hit: VideoHit) => hit.platform === 'youtube'

/**
 * Instagram Reels behave unlike the other two: the mp4 IS fetchable (so they
 * can be added to the feed), but hashtag media exposes no thumbnail and no play
 * count, and the mp4 url is single-use - it cannot be re-resolved later.
 */
const isInstagram = (hit: VideoHit) => hit.platform === 'instagram'

/**
 * A supplier's own listing video, matched by reverse-image search on the product
 * photo. The most valuable source here: it films the ACTUAL product on a plain
 * background, where social hits are the same category filmed by strangers.
 * Titles are Chinese and there are no play/like counts to show.
 */
const isSupplier = (hit: VideoHit) => hit.platform === 'alibaba'

/**
 * A Facebook reel found through open web search, because Facebook exposes no
 * video search API at all. Only a permalink is known up front - the stream is
 * resolved when the clip is added, so there is no cover to show.
 */
const isFacebook = (hit: VideoHit) => hit.platform === 'facebook'

/**
 * A Chinese video-platform hit from the opt-in deep search. Unlike YouTube these
 * ARE downloadable from our server (measured), so they behave like TikTok hits
 * rather than watch-only reference. Titles are Chinese, so the cover carries the
 * meaning here - the text will read as tofu boxes on a Latin-only font stack.
 */
const isBilibili = (hit: VideoHit) => hit.platform === 'bilibili'

/** A hit can be added to the feed only if its media is actually fetchable. */
const canDownload = (hit: VideoHit) => hit.downloadable !== false

/**
 * Thumbnail URL for a result card.
 *
 * Platform-dependent, and getting this wrong shows an empty box: TikTok covers
 * are on hosts the video-fetch proxy allowlists, while YouTube thumbnails live
 * on i.ytimg.com, which is NOT on that allowlist - proxying one is rejected.
 * ytimg does not hotlink-block, so it loads directly.
 */
const coverSrc = (hit: VideoHit) => {
  if (!hit.cover) return null
  return isYouTube(hit) ? hit.cover : inlineUrl(hit.cover)
}

/**
 * Hand-off links for grabbing a YouTube Short.
 *
 * We cannot fetch a Short from the server, and it is worth being precise about
 * why, because the reason is not "it is impossible". Tested from this box:
 * youtubei ANDROID/IOS/TVEMBED/WEB clients, @distube/ytdl-core, youtubei.js,
 * and six public Piped/Invidious instances. Every one failed the same way -
 * "Sign in to confirm you're not a bot" / LOGIN_REQUIRED / 403. That is IP
 * REPUTATION on a datacenter address, not a broken technique: the very same
 * tools work from a home connection, which is why they appear to work fine
 * "on the net".
 *
 * So the honest fix is a hand-off. These open in the shop's own browser, on the
 * shop's own residential IP, where the wall does not apply. Ordered by how
 * reliable they have been; the last one is the no-JS fallback.
 */
const SHORTS_GRABBERS: { label: string; hint: string; url: (pageUrl: string) => string }[] = [
  {
    label: 'cobalt.tools',
    hint: 'Cleanest - no ads, direct mp4',
    url: (u) => `https://cobalt.tools/?u=${encodeURIComponent(u)}`,
  },
  {
    label: 'SaveFrom',
    hint: 'Picks quality, works without login',
    url: (u) => `https://en.savefrom.net/1-youtube-video-downloader/#url=${encodeURIComponent(u)}`,
  },
  {
    label: 'ssyoutube',
    hint: 'Old reliable - the "ss" trick',
    url: (u) => u.replace('://www.youtube.com', '://ssyoutube.com').replace('://youtube.com', '://ssyoutube.com'),
  },
]

/**
 * Where a silent preview starts playing, in seconds.
 *
 * Not 0 on purpose. Product clips - supplier listing videos especially - open on
 * a logo card, a title slide or a black frame, so the first seconds show
 * everything except the product. Three seconds in, the thing itself is on
 * screen, which is the whole point of skimming a grid of these.
 */
const PREVIEW_START = 3

/**
 * A card thumbnail that plays itself, silently, while it is on screen.
 *
 * Deliberately NOT a plain `autoPlay` video: 40+ of these mount at once, and
 * autoplaying every one would pull tens of megabytes through the proxy and choke
 * the tab. An IntersectionObserver plays only what is actually visible and
 * pauses the rest, so cost scales with what is being looked at, not with the
 * size of the result set.
 */
function AutoPreview({ src, poster, className }: { src: string; poster?: string | null; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Seek past the intro. `duration` can be NaN until metadata lands, and
    // seeking a short clip to 3s would land on a black tail frame, so clips
    // that are barely longer than the offset just start at 0.
    const seek = () => {
      if (Number.isFinite(el.duration) && el.duration > PREVIEW_START + 1.5) {
        try {
          el.currentTime = PREVIEW_START
        } catch {
          /* seeking before the stream is ready is not fatal - it plays from 0 */
        }
      }
    }
    el.addEventListener('loadedmetadata', seek)

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          seek()
          // Autoplay is blocked unless muted, and can still reject.
          void el.play().catch(() => {})
        } else {
          el.pause()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)

    return () => {
      io.disconnect()
      el.removeEventListener('loadedmetadata', seek)
    }
  }, [src])

  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      className={className}
    />
  )
}

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
  `${hit.platform || 'tiktok'}-${(hit.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'video'}.mp4`

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
  productId = '',
  onQueueClips,
  onPhotosSaved,
  savedCount = null,
  refreshingLibrary = false,
  onRefreshLibrary,
}: {
  defaultQuery?: string
  /**
   * Library counter, shown in this panel's single toolbar. It lives in the
   * parent (which owns the fetch) but is displayed here, because giving it its
   * own header card meant two stacked headers before any result.
   */
  savedCount?: number | null
  refreshingLibrary?: boolean
  onRefreshLibrary?: () => void
  /** Product photo from inventory - powers the lens search */
  productImage?: string | null
  /**
   * Needed to save harvested photos - `POST /images` keys on it. Nullable
   * because the Studio can be open before a product row exists.
   */
  productId?: string | null
  /**
   * Hand videos to the server-side download queue.
   *
   * This used to download in the browser and pass a File up, but the Studio
   * dialog is mounted conditionally, so closing it unmounted the panel and
   * cancelled every download in flight. Recording a job instead means the work
   * outlives the dialog, the page, and the tab.
   */
  onQueueClips?: (jobs: QueueClipInput[]) => Promise<boolean>
  /**
   * Tell the Studio to reload its gallery after photos are saved, so the new
   * pictures appear in the reel editor's overlay picker straight away instead
   * of only after the dialog is closed and reopened.
   */
  onPhotosSaved?: () => void
}) {
  // Photo-first. Searching by the inventory name returned junk (a rope came
  // back as truck clips) because the shop's label is not what anyone films the
  // product as; the photo is read by AI and searched under its real names.
  // "By name" stays available as the manual fallback.
  const [mode, setMode] = useState<'text' | 'image'>(productImage ? 'image' : 'text')
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<VideoHit[]>([])
  const [cursor, setCursor] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  /** Which Short's link was just copied, for the 1.5s confirmation. */
  const [copied, setCopied] = useState<string | null>(null)
  // Per-clip job state. A single shared "busy" id meant a second click wiped
  // the first clip's spinner while it was still downloading, so ten clicks
  // looked like one. Each clip now owns its own status and the clicks queue.
  const [jobs, setJobs] = useState<Record<string, 'queued' | 'working' | 'done' | 'failed'>>({})
  // Plain browser download is a separate, near-instant action
  const [dlId, setDlId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const lastQuery = useRef('')
  // Feature 9: which of these results are ALREADY in the clip library, so the
  // same video is not downloaded and saved a second time.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  // Default to hiding clips already in the library: the point of the check is
  // to stop you re-watching and re-downloading footage you own. The toggle
  // exists because "show me everything" is still a legitimate thing to want.
  const [hideSaved, setHideSaved] = useState(true)

  /**
   * Product photos harvested from the 1688 listings during the video search.
   *
   * Kept because the reel editor overlays a product photo onto the clip, so the
   * pictures decide how many different ads the footage can produce. They arrive
   * free with the detail calls that reveal the videos.
   */
  /**
   * Photos are COLLAPSED by default.
   *
   * ~60 harvested thumbnails is a full screen of pictures, and putting them
   * above the video wall meant the videos - the thing actually being chosen -
   * were always below the fold. They stay one click away, because they are still
   * how you confirm the search found the right object and what the reel editor
   * burns onto a clip.
   */
  const [showPhotos, setShowPhotos] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  /** Which harvested photos are ticked for saving. Starts empty - the user chooses. */
  const [pickedPhotos, setPickedPhotos] = useState<Set<string>>(new Set())
  const [savingPhotos, setSavingPhotos] = useState(false)
  const [photoNote, setPhotoNote] = useState('')

  // Lens state
  const [lensImage, setLensImage] = useState<string | null>(productImage)
  const [lensPreview, setLensPreview] = useState<string | null>(productImage)
  const [lensUpload, setLensUpload] = useState<string | null>(null) // base64 data URL
  const [lensSource, setLensSource] = useState<string>('')
  const [detected, setDetected] = useState<{
    label: string
    queries: string[]
    /** Other names this product is really sold under, from the vision pass */
    names: string[]
    /** Title words used for scoring; reused by the opt-in Reels search */
    keywords: string[]
    counts: { tiktok: number; youtube: number; alibaba: number; facebook: number }
    /** Set when one platform failed but the other still returned results */
    partial: string
    /**
     * Why the Facebook row is what it is. `blockedEngines` is the load-bearing
     * half: only DuckDuckGo and Brave index reel permalinks and both rate-limit
     * server IPs hard, so zero results from a REFUSED engine is not evidence
     * that no reels exist - and must not be shown as if it were.
     */
    web: { found: number; engines: string[]; blockedEngines: string[] } | null
    /**
     * Same distinction for 1688. The server has always reported WHY the supplier
     * row is empty ("Image too large", "No API credit left", "token rejected")
     * and the UI threw it away, so a photo Alibaba flat-out refused looked
     * exactly like a product with no supplier video - which is how a 300KB limit
     * silently hid 1688 on 56% of the catalogue.
     */
    listing: { matched: number; checked: number; videos: number; error: string } | null
    deep: { ran: boolean; videos: number; error: string; terms: string[] } | null
  } | null>(null)

  /**
   * Deep search: adds Chinese video platforms, off by default.
   *
   * Opt-in on purpose. It is not a quality setting - it changes WHAT you get
   * (long-form Chinese hands-on tests rather than short ad-style clips), so it
   * is worth a lot for a gadget nobody has filmed in English and nothing for a
   * product that is already all over TikTok. Sticky within a session so it does
   * not have to be re-ticked for every product.
   */
  const [deepSearch, setDeepSearch] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Meta Reels is opt-in, not part of the auto fan-out: Instagram allows only
  // ~30 unique hashtags per account per rolling 7 days, so searching it on
  // every product would burn the weekly budget in a few clicks.
  const [reelsLoading, setReelsLoading] = useState(false)
  const [reelsNote, setReelsNote] = useState('')

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
    async (q: string, next = false) => {
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
    },
    [cursor],
  )

  // Lens search: send the product photo, get back what the AI thinks it is,
  // the other names it is really sold under, and videos of that same product
  // from TikTok and YouTube Shorts ranked by how well they match.
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
          deep: deepSearch,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Image search failed')
      setResults(json.results || [])
      setDetected({
        label: json.label || '',
        queries: json.queries || [],
        names: json.names || [],
        keywords: json.keywords || [],
        counts: json.counts || { tiktok: 0, youtube: 0, alibaba: 0, facebook: 0 },
        partial: json.partial || '',
        web: json.web || null,
        listing: json.listing || null,
        deep: json.deep || null,
      })

      // Photos ride along with the video search at no extra cost. Reset the
      // ticks on a fresh search so a previous product's picks cannot be saved
      // onto this one.
      setPhotos(Array.isArray(json.photos) ? (json.photos as string[]) : [])
      setPickedPhotos(new Set())
      setPhotoNote('')
      setReelsNote('')
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image search failed')
    } finally {
      setLoading(false)
    }
  }, [lensUpload, lensImage, defaultQuery, deepSearch])

  /**
   * Opt-in Meta (Instagram) Reels search, appended to the existing results.
   *
   * Reuses the names/keywords from the photo pass, so no second vision call is
   * made. Kept behind a button because of Instagram's ~30-hashtags-per-week
   * cap, and because measured yield is low: a hashtag matches a WORD, not a
   * product, so most of what comes back is unrelated and gets filtered out.
   */
  const runReelsSearch = useCallback(async () => {
    if (!detected) return
    setReelsLoading(true)
    setReelsNote('')
    try {
      const res = await fetch('/api/product-master/reels-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: detected.names, keywords: detected.keywords }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Reels search failed')

      const fresh = (json.results || []) as VideoHit[]
      const known = new Set(results.map((r) => r.id))
      const added = fresh.filter((r) => !known.has(r.id))
      if (added.length > 0) setResults((prev) => [...prev, ...added])

      const tagList = (json.tags || []).map((t: string) => `#${t}`).join(' ')
      if (added.length === 0) {
        // Say why nothing arrived. Instagram genuinely has little of most
        // products, and a silent no-op would read as a broken button.
        setReelsNote(
          json.error
            ? String(json.error)
            : `No matching Reels in ${tagList || 'those hashtags'}${
                json.examined ? ` (checked ${json.examined}, none were this product)` : ''
              }`,
        )
      } else {
        setReelsNote(`Added ${added.length} from ${tagList}`)
      }
    } catch (e) {
      setReelsNote(e instanceof Error ? e.message : 'Reels search failed')
    } finally {
      setReelsLoading(false)
    }
  }, [detected, results])

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

  /*
   * NO auto-run, by explicit instruction.
   *
   * This used to fire the photo search the moment the Studio opened. It is an
   * expensive, AI-backed, multi-provider fan-out, and firing it on open meant
   * every accidental dialog open spent credits and rate-limit budget on a search
   * nobody asked for. The search now happens only when "Search by this photo"
   * (or Find) is clicked.
   */

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

  /**
   * Turn a search hit into a queue job.
   *
   * `streamUrl` is the search result's own link and is only a hint: the worker
   * re-resolves a fresh watermark-free stream from `sourceUrl` first, because
   * TikTok CDN links are signed and expire long before a retry runs.
   */
  const asJob = (hit: VideoHit): QueueClipInput => ({
    id: hit.id,
    title: hit.title || 'Video',
    thumbUrl: coverSrc(hit),
    source: hit.platform || 'tiktok',
    // hit.id is the platform's own video id, so the library can recognise
    // this exact clip if it shows up in a future search
    sourceId: hit.id ? `video:${hit.id}` : null,
    // The page url, NOT the stream: stream urls are short-lived signed CDN
    // links that differ on every search, so storing one would never match
    // again and the dedupe check would silently always miss.
    sourceUrl: hit.pageUrl || null,
    streamUrl: hit.play || null,
  })

  /** Mark a batch, post it once, then reflect whether the queue accepted it. */
  const queue = (rawHits: VideoHit[]) => {
    // Last line of defence: a YouTube Short cannot be fetched server-side, so
    // queueing one would create a job that can only ever fail. The buttons are
    // already hidden for those, but bulk paths funnel through here too.
    const hits = rawHits.filter(canDownload)
    if (!onQueueClips || hits.length === 0) return
    setError('')
    setJobs((p) => {
      const next = { ...p }
      for (const h of hits) next[h.id] = 'queued'
      return next
    })
    void onQueueClips(hits.map(asJob)).then((ok) => {
      setJobs((p) => {
        const next = { ...p }
        for (const h of hits) next[h.id] = ok ? 'done' : 'failed'
        return next
      })
      if (!ok) setError('Could not start the download - check your connection and try again')
    })
  }

  const togglePhoto = (url: string) =>
    setPickedPhotos((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })

  /**
   * Save the ticked photos to this product's gallery.
   *
   * Reuses the existing `POST /images` route, which upserts on
   * `(product_id, image_url)` - so re-saving a photo already in the gallery is a
   * no-op rather than a duplicate row.
   *
   * Deliberately does NOT send `primaryUrl`: that would overwrite
   * `products.image_url`, silently changing the product's cover photo across
   * every other screen. Adding reference shots for a reel must not repaint the
   * catalogue.
   */
  const savePhotos = async () => {
    if (!productId || pickedPhotos.size === 0 || savingPhotos) return
    setSavingPhotos(true)
    setPhotoNote('')
    try {
      const res = await fetch('/api/product-master/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          productName: defaultQuery,
          images: [...pickedPhotos],
          source: '1688',
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save those photos')

      const n = pickedPhotos.size
      setPhotoNote(`${n} photo${n === 1 ? '' : 's'} saved to this product`)
      setPickedPhotos(new Set())
      // Refresh the Studio's gallery so the pictures are usable as a video
      // overlay immediately, not just after a reopen.
      onPhotosSaved?.()
    } catch (e) {
      setPhotoNote(e instanceof Error ? e.message : 'Could not save those photos')
    } finally {
      setSavingPhotos(false)
    }
  }

  const useInStudio = (hit: VideoHit) => {
    // Already added, in flight, or waiting - ignore the repeat click
    const state = jobs[hit.id]
    if (state === 'queued' || state === 'working' || state === 'done') return
    queue([hit])
  }

  /** One click to take every downloadable result on screen not added yet */
  const useAll = () => {
    queue(
      visibleResults.filter((h) => {
        if (!canDownload(h)) return false
        // Never bulk-download something already in the library - that is the
        // exact waste the dedupe check exists to prevent, and "Use all" is the
        // easiest way to trigger it by accident.
        if (savedIds.has(h.id)) return false
        const s = jobs[h.id]
        return s !== 'queued' && s !== 'working' && s !== 'done'
      }),
    )
  }

  const queuedCount = Object.values(jobs).filter((s) => s === 'queued' || s === 'working').length
  const doneCount = Object.values(jobs).filter((s) => s === 'done').length

  // What the grid actually renders. Kept as a separate value so the raw
  // `results` still drives paging and the "N hidden" count stays truthful.
  const visibleResults = hideSaved ? results.filter((r) => !savedIds.has(r.id)) : results
  const hiddenCount = results.length - visibleResults.length
  // "Use all" can only take TikTok hits, so the button must not promise a
  // number that includes Shorts it will silently skip.
  const takeableCount = visibleResults.filter(
    (h) => canDownload(h) && !savedIds.has(h.id) && !['queued', 'working', 'done'].includes(jobs[h.id] ?? ''),
  ).length
  /* shortsCount removed: "N Shorts are watch-only" is now stated once, on the
     YouTube Shorts group header, rather than as a separate global tally. */

  const publicImage = lensImage && /^https?:\/\//i.test(lensImage) ? lensImage : null

  /**
   * Videos are shown GROUPED BY SOURCE, in this fixed order.
   *
   * The server already ranks in this order, but a flat grid made that invisible -
   * it read as one arbitrary list. Grouping under a labelled row means you can
   * go straight to the platform you want to publish on, and it makes the useful
   * asymmetry obvious: 1688 clips film the real product, Shorts can only be
   * watched. Relevance still orders the cards WITHIN each group.
   */
  const SOURCE_ORDER = [
    { key: 'facebook', label: 'Facebook Reels', dot: 'bg-blue-600', match: isFacebook },
    { key: 'instagram', label: 'Instagram Reels', dot: 'bg-fuchsia-600', match: isInstagram },
    { key: 'tiktok', label: 'TikTok', dot: 'bg-foreground', match: (h: VideoHit) => !h.platform || h.platform === 'tiktok' },
    { key: 'alibaba', label: '1688 supplier', dot: 'bg-orange-600', match: isSupplier },
    // Above Shorts because these DO download. Must be listed explicitly: the
    // TikTok row above claims every hit with no platform, so a source that is
    // missing from this list does not vanish - it silently renders under the
    // wrong header, which is worse.
    { key: 'bilibili', label: 'Bilibili (China)', dot: 'bg-sky-400', match: isBilibili },
    { key: 'youtube', label: 'YouTube Shorts', dot: 'bg-red-600', match: isYouTube },
  ] as const

  const groups = SOURCE_ORDER.map((g) => ({
    ...g,
    hits: visibleResults.filter(g.match),
  })).filter((g) => g.hits.length > 0)

  return (
    <section className="flex flex-col gap-3">
      {/*
        ONE toolbar, one row.
        
        Replaces a heading, a two-line paragraph, a pill tab-bar, a 96px photo
        tile and three full-width buttons - roughly 200px of vertical space that
        said the same thing every time. The photo you are searching by is its own
        button: it shows what will be searched AND runs the search when clicked,
        which is the whole of what that block did.
      */}
      {/* -mx-6/px-6 must match the page's own padding, so the rule under the bar
          reads as a margin rule across the page rather than a floating box. */}
      <div className="sticky -top-4 z-20 -mx-6 flex flex-wrap items-center gap-2 border-b border-border bg-background/95 px-6 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            setMode('image')
            void runLensSearch()
          }}
          disabled={loading || !lensImage}
          title={lensImage ? 'Search every source using this photo' : 'No product photo yet - use Upload'}
          className="group flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 py-1 pl-1 pr-2.5 text-xs font-semibold transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-muted">
            {lensPreview ? (
              /* Display only - lensImage stays raw because it is POSTed and the
                 server fetches it itself. mediaSrc covers all three cases:
                 raw supplier URL (the alicdn 403), already-proxied path, and
                 data: URL from an upload. */
              <img src={mediaSrc(lensPreview) || '/placeholder.svg'} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              </span>
            )}
          </span>
          {loading && mode === 'image' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ScanSearch className="h-3.5 w-3.5 text-amber-500" />
          )}
          Search by photo
        </button>

        {/* Name search demoted to an inline box: it is the fallback, because the
            inventory label is often not what the product is filmed as. */}
        <div className="flex items-center gap-1.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
                e.preventDefault()
                setMode('text')
                runSearch(query)
              }
            }}
            placeholder="or search by name"
            aria-label="Search product videos by name"
            className="h-8 w-44 text-xs"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-2"
            onClick={() => {
              setMode('text')
              runSearch(query)
            }}
            disabled={loading || query.trim().length < 2}
            aria-label="Search by name"
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>

        <span className="h-5 w-px bg-border" />

        {/* Icon-only: these are occasional actions and were taking a full row */}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => {
            const next = !pickerOpen
            setPickerOpen(next)
            if (next && !pickSearched) runImageLookup(pickQuery || defaultQuery)
          }}
          title="Find a better photo to search with"
        >
          <Images className="h-3.5 w-3.5" />
          Better photo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => fileRef.current?.click()}
          title="Upload a photo to search with"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </Button>

        {/*
          Deep search. A toggle rather than a second button: it changes WHAT the
          next search covers, so the state has to stay visible after the search
          runs - a button would fire and leave no trace of why the grid has a
          Chinese source in it.
        */}
        <Button
          size="sm"
          variant={deepSearch ? 'default' : 'ghost'}
          className={`h-8 gap-1.5 px-2 text-xs ${deepSearch ? '' : 'text-muted-foreground'}`}
          onClick={() => setDeepSearch((v) => !v)}
          aria-pressed={deepSearch}
          title={
            deepSearch
              ? 'Deep search on: also searches Chinese video platforms (Bilibili) using the native product term'
              : 'Deep search off: turn on to also search Chinese video platforms for hands-on footage'
          }
        >
          <Globe className="h-3.5 w-3.5" />
          Deep
        </Button>

        {/* Pictures on demand - the point of collapsing them by default */}
        {photos.length > 0 && (
          <Button
            size="sm"
            variant={showPhotos ? 'default' : 'outline'}
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => setShowPhotos((v) => !v)}
            aria-expanded={showPhotos}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {photos.length} photos
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Result tally doubles as the key to the grouped grid below */}
          {visibleResults.length > 0 && (
            <span className="text-xs font-semibold text-foreground">
              {visibleResults.length} videos
            </span>
          )}
          {onQueueClips && takeableCount > 0 && (
            <Button size="sm" className="h-8 gap-1 px-2.5 text-xs" onClick={useAll}>
              <Plus className="h-3.5 w-3.5" />
              Use all {takeableCount}
            </Button>
          )}
          {hiddenCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => setHideSaved((v) => !v)}
            >
              {hideSaved ? `+${hiddenCount} saved` : 'Hide saved'}
            </Button>
          )}
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Clips already downloaded into your library"
          >
            <Library className="h-3.5 w-3.5" />
            {savedCount === null ? '\u2014' : savedCount}
          </span>
          {onRefreshLibrary && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={onRefreshLibrary}
              disabled={refreshingLibrary}
              aria-label="Refresh library index"
            >
              {refreshingLibrary ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/*
        The 96px photo tile, the "this photo is read by AI" paragraph, the three
        full-width buttons and the mode tab-bar all used to live here. They are
        the toolbar above now. What remains is only state worth reporting: which
        photo is in use if it is not the product's own, and a Reset.
      */}
      <div className="flex flex-col gap-3">
          {(lensSource || lensUpload) && (
            <div className="flex items-center gap-2 text-[11px] text-amber-400">
              <span>
                Searching with {lensSource ? `a photo from ${lensSource}` : 'an uploaded photo'} instead of the
                inventory thumbnail
              </span>
              {productImage && (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    setLensUpload(null)
                    setLensSource('')
                    setLensImage(productImage)
                    setLensPreview(productImage)
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          )}

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

          {detected && (
            <div className="flex flex-col gap-2">
              {/* One line: what it decided the product is, plus the reverse-image
                  engines as small trailing links rather than their own labelled
                  row. The per-source counts are gone from here - the grouped
                  headers below carry them, where they double as navigation. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-muted-foreground">Identified as</span>
                <span className="font-semibold text-amber-400">{detected.label || 'this product'}</span>
                {publicImage && (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {lensLinks(publicImage).map((l) => (
                      <a
                        key={l.name}
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        title={`Reverse image search on ${l.name}`}
                      >
                        {l.name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ))}
                  </span>
                )}
              </div>

              {/*
                The alias and searched-phrase chips ("Also sold as", "Searched:")
                used to sit here. Removed on instruction: they are how the search
                works internally, not something to act on, and they pushed the
                pictures and the videos - the only two things being judged - below
                the fold. The aliases are still generated and still fanned out
                server-side; they are simply not shown.
              */}

            {detected.partial && (
              <p className="mt-2 text-[11px] text-amber-400">
                TikTok search was unavailable ({detected.partial}) {'\u2014'} showing YouTube Shorts only.
                Those can be watched and opened, but not added to your feed.
              </p>
            )}

            {/*
              Facebook has no video search API at all, so reels are found through
              open web search - and the only engines that index reel permalinks
              rate-limit us. Saying "search engines refused" instead of showing
              nothing is the difference between a fact and a false negative.
            */}
            {detected.web && detected.web.found === 0 && detected.web.blockedEngines.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Facebook reels could not be searched right now {'\u2014'} the search engines that index them
                ({detected.web.blockedEngines.join(', ')}) refused this request. This is not
                {' '}&quot;no reels exist&quot;; try again in a few minutes.
              </p>
            )}

            {/*
              The same honesty for 1688. A refused photo, an expired token or an
              empty credit balance all used to render as simply no supplier row,
              which reads as "this product has no listing video" - the one
              conclusion the server never actually reached.
            */}
            {/*
              Deep search, held to the same rule as every other source: a failure
              and a genuine empty result must not look alike. The Chinese terms
              are shown on an empty result because a bad translation is the most
              likely cause, and it is the one thing the shop can act on.
            */}
            {detected.deep?.error && (
              <p className="mt-2 text-[11px] text-amber-500/90">
                Deep search (China) failed {'\u2014'} {detected.deep.error} This is not &quot;no footage exists&quot;.
              </p>
            )}
            {detected.deep && !detected.deep.error && detected.deep.videos === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Deep search found no Chinese footage for{' '}
                <span className="font-mono">{detected.deep.terms.join(', ') || '(no terms)'}</span>.
              </p>
            )}

            {detected.listing?.error && (
              <p className="mt-2 text-[11px] text-amber-500/90">
                1688 supplier videos could not be searched {'\u2014'} {detected.listing.error} This is not
                {' '}&quot;no supplier video exists&quot;.
              </p>
            )}

            {/*
              A genuine empty result, stated as such. Only shown when the search
              really did run (no error) and really did look at listings, so it
              can never be confused with the failure above.
            */}
            {detected.listing && !detected.listing.error && detected.listing.videos === 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                No supplier video on 1688 {'\u2014'} {detected.listing.checked} of {detected.listing.matched} matching
                listings were checked and none had a video.
              </p>
            )}

            {/*
              Product photos harvested from the supplier listings.

              These are not a side-effect: the reel editor burns a product photo
              onto the clip, so the pictures decide how many different ads this
              footage can make. They come free with the same paid detail calls
              that reveal the videos - the old Marketplace tab could only show
              one photo per listing (12 total), where this typically finds ~60.
            */}
            {photos.length > 0 && showPhotos && (
              <div className="mt-1 rounded-lg border border-border bg-background/40 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Tap to pick, then Save {'\u2014'} saved photos can be burned onto any clip in the editor
                  </span>
                  <div className="flex items-center gap-2">
                    {pickedPhotos.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setPickedPhotos(new Set())}
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPickedPhotos(new Set(photos))}
                      className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Select all
                    </button>
                    {/* No productId means the gallery has nowhere to save to,
                        so the button is disabled with the reason shown rather
                        than failing after the click. */}
                    <Button
                      type="button"
                      size="sm"
                      onClick={savePhotos}
                      disabled={!productId || pickedPhotos.size === 0 || savingPhotos}
                      title={productId ? 'Save the ticked photos to this product' : 'Open from a product to save photos'}
                      className="h-7 px-2.5 text-[11px]"
                    >
                      {savingPhotos ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-1.5 h-3 w-3" />
                      )}
                      Save {pickedPhotos.size > 0 ? pickedPhotos.size : ''}
                    </Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {photos.map((url) => {
                    const picked = pickedPhotos.has(url)
                    return (
                      <button
                        key={url}
                        type="button"
                        onClick={() => togglePhoto(url)}
                        aria-pressed={picked}
                        aria-label={picked ? 'Deselect this photo' : 'Select this photo'}
                        className={`relative h-14 w-14 overflow-hidden rounded border-2 transition ${
                          picked ? 'border-amber-500' : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        {/* mediaSrc() is required, not optional: 1688's CDN 403s
                            a browser by Referer while our server fetches it
                            fine, so hotlinking these renders empty squares. */}
                        <img
                          src={mediaSrc(url) || '/placeholder.svg'}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {picked && (
                          <span className="absolute right-0.5 top-0.5 rounded-full bg-amber-500 p-0.5">
                            <Check className="h-2.5 w-2.5 text-black" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {photoNote && <p className="mt-2 text-[11px] text-muted-foreground">{photoNote}</p>}
              </div>
            )}

              {/* Meta Reels: searchable only through Instagram hashtags, and
                  capped at ~30 unique tags a week, so it is a deliberate click
                  rather than part of the automatic fan-out. */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={runReelsSearch}
                  disabled={reelsLoading}
                  className="h-7 px-2.5 text-[11px]"
                  title="Search Instagram/Facebook Reels by hashtag and add any matches"
                >
                  {reelsLoading ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="mr-1.5 h-3 w-3" />
                  )}
                  Also search Meta Reels
                </Button>
                {/* The explanatory half of this ("Instagram hashtags - limited
                    to ~30 tags a week") is now the button's tooltip: it explains
                    why the button exists, which you need once, not every time. */}
                {reelsNote && <span className="text-[11px] text-muted-foreground">{reelsNote}</span>}
              </div>

            </div>
          )}
        </div>

      {error && (
        <div className="space-y-1">
          <p className="text-xs text-destructive">{error}</p>
          {/* A provider-side block is not something retrying fixes, so point at
              the routes that still work instead of leaving a dead end */}
          {/blocked|unreachable/i.test(error) && (
            <p className="text-xs text-muted-foreground">
              Searching by name is unavailable right now. You can still paste a video link below, or use the
              Marketplace listings tab.
            </p>
          )}
        </div>
      )}
      {note && <p className="text-xs text-amber-400">{note}</p>}

      {searched && !loading && results.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">No videos found. Try a shorter term or another photo.</p>
      )}

      {/* Only live progress stays out here - "Use all" and the saved-clips
          toggle moved into the toolbar, where they are always reachable
          instead of scrolling away above the grid. */}
      {(queuedCount > 0 || doneCount > 0) && (
        <div className="flex flex-wrap items-center gap-3">
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

      {/*
        Videos grouped by where they came from, in the fixed source order.
        Each group is a labelled row you can jump to, and the column count rises
        with the window - a 3120px screen fitted 4 cards before, so most of the
        wall was empty space and everything else was a scroll away.
      */}
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${group.dot}`} aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">{group.label}</h4>
            <span className="text-xs text-muted-foreground">{group.hits.length}</span>
            {/* Said once per group instead of once per card */}
            {group.key === 'youtube' && (
              <span className="text-[11px] text-muted-foreground">{'\u2014'} watch only, cannot be added</span>
            )}
            {group.key === 'alibaba' && (
              <span className="text-[11px] text-muted-foreground">
                {'\u2014'} films the actual product
              </span>
            )}
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Column counts are tuned for the LEFT PAGE of the spread (~58% of
              the window), not the whole window - hence 6 at 2xl rather than 10. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {group.hits.map((hit) => (
            <div
              key={hit.id}
              className={`flex flex-col overflow-hidden rounded-lg border bg-card ${
                savedIds.has(hit.id) ? 'border-emerald-500/60' : 'border-border'
              }`}
            >
              {/* A card with neither a thumbnail nor a stream has nothing to show
                  at portrait height - a Facebook reel is only a permalink until
                  it is added, so `aspect-[9/16]` gave it a ~600px column of
                  empty black that looked like a broken card and pushed every
                  real result off screen. Those collapse to one short strip. */}
              <div
                className={`relative bg-black ${
                  !hit.cover && !hit.play ? 'aspect-[16/7]' : 'aspect-[9/16]'
                }`}
              >
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
                    {hit.play ? (
                      /* Anything with a fetchable stream previews ITSELF, muted,
                         from PREVIEW_START while on screen. Supplier listings are
                         the reason: they were static covers of a coiled product,
                         so the grid gave no idea how the thing actually moves.
                         The cover is still the poster, so the card is never
                         blank while the first frames load. */
                      <AutoPreview
                        src={inlineUrl(hit.play)}
                        poster={coverSrc(hit)}
                        className="h-full w-full object-cover"
                      />
                    ) : hit.cover ? (
                      <img
                        src={coverSrc(hit) || '/placeholder.svg'}
                        alt={hit.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      /* No thumbnail AND no stream - say what it is rather than
                         render an empty box that reads as broken. */
                      <a
                        href={hit.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-full w-full items-center justify-center gap-2 bg-muted px-3 text-center transition-colors hover:bg-muted/70"
                      >
                        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-[11px] leading-tight text-muted-foreground">
                          Open on {isInstagram(hit) ? 'Instagram' : isFacebook(hit) ? 'Facebook' : 'the site'}
                        </span>
                      </a>
                    )}
                    {/* Shorts have no fetchable stream, so the overlay opens the
                        video on YouTube instead of failing to play in place. */}
                    {isYouTube(hit) ? (
                      <a
                        href={hit.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Watch ${hit.title} on YouTube`}
                        className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity hover:opacity-100"
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background/90">
                          <Play className="ml-0.5 h-5 w-5 fill-foreground text-foreground" />
                        </span>
                      </a>
                    ) : (
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
                    )}
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
                    {/*
                      Every clip is tagged with the source it came from, named
                      the way the shop refers to it rather than by platform id.
                      TikTok previously had NO badge at all, which made it the
                      only unlabelled source in a grid sorted BY source - so the
                      ordering looked arbitrary. Colours follow each brand so the
                      groups are scannable without reading.
                    */}
                    <span
                      className={`absolute bottom-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                        isFacebook(hit)
                          ? 'bg-blue-600'
                          : isInstagram(hit)
                            ? 'bg-fuchsia-600'
                            : isSupplier(hit)
                              ? 'bg-orange-600'
                              : isYouTube(hit)
                                ? 'bg-red-600'
                                : 'bg-foreground text-background'
                      }`}
                    >
                      {isFacebook(hit)
                        ? 'Facebook Reels'
                        : isInstagram(hit)
                          ? 'Instagram Reels'
                          : isSupplier(hit)
                            ? '1688'
                            : isYouTube(hit)
                              ? 'YouTube Shorts'
                              : 'TikTok'}
                    </span>
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

              {/*
                No title, no @handle.

                Both were two lines of text under every card and neither decides
                anything - supplier titles are Chinese, social titles are hashtag
                soup, and the picture already shows what the clip is. The title
                stays reachable as the card's tooltip and via the open-out link.
              */}
              <div className="flex flex-1 flex-col gap-1 p-1.5" title={hit.title}>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {/* A missing metric must not render as "0", which reads as a
                      real measurement of zero rather than "not reported".
                      Instagram hashtag media has no view count; supplier
                      listings and web-found Facebook reels have neither. */}
                  {!isInstagram(hit) && !isSupplier(hit) && !isFacebook(hit) && (
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {compact(hit.plays)}
                    </span>
                  )}
                  {!isYouTube(hit) && !isSupplier(hit) && !isFacebook(hit) && (
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {compact(hit.likes)}
                    </span>
                  )}
                  {/* Sales volume is what a supplier listing actually reports,
                      so show that instead of borrowed social metrics. */}
                  {isSupplier(hit) && hit.plays > 0 && (
                    <span className="flex items-center gap-1">
                      <Store className="h-3 w-3" />
                      {compact(hit.plays)} sold
                    </span>
                  )}
                  <a
                    href={hit.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto hover:text-foreground"
                    aria-label={
                      isYouTube(hit) ? 'Open on YouTube' : isInstagram(hit) ? 'Open on Instagram' : 'Open on TikTok'
                    }
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-auto flex gap-1.5 pt-1">
                  {/* Shorts cannot be fetched from OUR server (datacenter IP is
                      bot-walled - see SHORTS_GRABBERS), but they download fine
                      from the shop's own browser. So: watch here, or hand the
                      link to a grabber that runs on his connection. */}
                  {isYouTube(hit) ? (
                    <>
                      <a
                        href={hit.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium transition-colors hover:border-red-500/50 hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Watch
                      </a>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-[11px]"
                            aria-label="Download options for this Short"
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                          <DropdownMenuLabel className="text-[11px] font-normal leading-snug text-muted-foreground">
                            YouTube blocks downloads from our server, not from your PC. Open one of these and
                            the file saves normally, then add it with Upload.
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {SHORTS_GRABBERS.map((g) => (
                            <DropdownMenuItem key={g.label} asChild>
                              <a href={g.url(hit.pageUrl)} target="_blank" rel="noopener noreferrer">
                                <div className="flex flex-col">
                                  <span className="text-xs">{g.label}</span>
                                  <span className="text-[10px] text-muted-foreground">{g.hint}</span>
                                </div>
                              </a>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => {
                              void navigator.clipboard?.writeText(hit.pageUrl)
                              setCopied(hit.id)
                              window.setTimeout(() => setCopied((c) => (c === hit.id ? null : c)), 1500)
                            }}
                          >
                            <Copy className="mr-2 h-3 w-3" />
                            <span className="text-xs">
                              {copied === hit.id ? 'Link copied' : 'Copy link'}
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : (
                    <>
                  {onQueueClips && (
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
                    </>
                  )}
                </div>
              </div>
            </div>
            ))}
          </div>
        </div>
      ))}

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
