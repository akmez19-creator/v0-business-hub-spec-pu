/**
 * 1688 listing videos AND photos, found from the product photo.
 *
 * This is the "marketplace listings" logic merged into the Studio's photo-first
 * search. Both halves matter, and the photos are not a leftover: the reel editor
 * burns a product photo onto the clip as an overlay (`photoChoices` ->
 * `product_images`), so a video is only as good as the pictures available to it.
 * One picture means one possible ad.
 *
 * MEASURED on the 10M Hanging Rope, and the reason this file changed shape:
 *   - the old Marketplace tab harvested ONE image per listing, capped at 12
 *   - the detail record we ALREADY pay for carries `main_imgs` (~5 each) plus
 *     per-variant `sku_props` images
 *   - so the same calls yield 89 unique photos instead of 12, for no extra cost
 *
 * That is why enrichment is done locally here instead of calling `attachVideos`:
 * that helper keeps `video_url` and discards the galleries, so reusing it would
 * have meant paying for every detail record twice to see the pictures in it.
 *
 * Why this is worth a paid call when TikTok is free: a supplier's listing video
 * films the ACTUAL product on a plain background, which is exactly what a shop
 * ad needs. Social results are the same CATEGORY of thing filmed by strangers.
 *
 * Cost shape (measured, and the reason for the two-stage design):
 *  - image search itself is one call and returns ~20 listings, never any video
 *  - the video only exists on the per-item detail record, so revealing it is
 *    one extra paid call PER LISTING
 * So we only enrich the top matches rather than all 20.
 */
import {
  PLATFORM_BY_ID,
  TMAPI_BASE,
  apiError,
  convertImageUrl,
  extractList,
  normalizeHit,
  type MarketplaceHit,
} from './tmapi'
import type { MarketplacePlatform } from './tmapi'
import { prepareSearchImage, releaseSearchImage } from './search-image'

/** Only 1688 has both reverse-image search and listing video on this plan. */
const PLATFORM_ID = 'alibaba' as const

/**
 * How many image matches get the extra paid detail call.
 *
 * The top matches are the visually closest ones, so spending here buys the most
 * relevant videos. Roughly half of 1688 listings carry a video, so ~10 lookups
 * typically yields ~4-6 usable clips - enough to fill the grid without paying
 * for a full page of results the user will never scroll to.
 */
const ENRICH_LIMIT = 10

export type ListingVideo = {
  id: string
  title: string
  cover: string | null
  play: string
  pageUrl: string
  price: string
  sold: number
  supplier: string
}

export type ListingVideoOutcome = {
  videos: ListingVideo[]
  /**
   * Every distinct product photo seen while looking for those videos.
   *
   * Ordered best-first: gallery shots from the listings we opened come before
   * the search-row thumbnails, because `main_imgs[0]` is the seller's chosen
   * hero shot and tends to be the cleanest cut-out.
   */
  photos: string[]
  /** Listings found by the photo, before video enrichment - for honest reporting */
  matched: number
  /** How many were checked for a video (the paid part) */
  checked: number
  error: string
}

const empty = (error: string): ListingVideoOutcome => ({
  videos: [],
  photos: [],
  matched: 0,
  checked: 0,
  error,
})

/**
 * How many photos to hand back.
 *
 * ~89 are typically available and they are only URLs, but a grid of hundreds is
 * not a choice a person can make. This keeps the best of them without turning
 * the panel into a scroll marathon.
 */
const MAX_PHOTOS = 60

/** A 1688 detail record, reduced to the two things this feature wants. */
type Detail = { video: string | null; photos: string[] }

const asUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.startsWith('//') ? `https:${v}` : v
  return /^https?:\/\//i.test(s) ? s : null
}

/**
 * One paid call per listing, returning BOTH the video and the picture gallery.
 *
 * Shapes confirmed against a live response: `main_imgs` is a flat string array,
 * and `sku_props[].values[].imageUrl` holds the per-variant photos - which are
 * often the most useful ones, because they show the product per colour.
 */
async function fetchDetail(detailPath: string, itemId: string, token: string): Promise<Detail> {
  try {
    const res = await fetch(
      `${TMAPI_BASE}${detailPath}?item_id=${encodeURIComponent(itemId)}&apiToken=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), cache: 'no-store' },
    )
    if (!res.ok) return { video: null, photos: [] }
    const json = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null
    const d = json?.data
    if (!d || apiError(json)) return { video: null, photos: [] }

    const photos: string[] = []
    for (const raw of (d.main_imgs as unknown[]) ?? []) {
      const u = asUrl(raw)
      if (u) photos.push(u)
    }
    for (const prop of (d.sku_props as { values?: { imageUrl?: string; image?: string }[] }[]) ?? []) {
      for (const v of prop.values ?? []) {
        const u = asUrl(v.imageUrl ?? v.image)
        if (u) photos.push(u)
      }
    }

    return { video: asUrl(d.video_url) ?? asUrl(d.video), photos }
  } catch {
    // A single listing failing must never take down the search - it just means
    // no video and no extra pictures from that one
    return { video: null, photos: [] }
  }
}

/**
 * Search 1688 by photo and return only the listings that have a real video.
 *
 * `imageUrl` must be publicly reachable: Alibaba pulls the image from our URL
 * from inside China, so a signed or private link fails on their side, not ours.
 */
export async function findListingVideos(imageUrl: string): Promise<ListingVideoOutcome> {
  const token = process.env.TMAPI_TOKEN
  if (!token) return empty('1688 search is not configured')

  const platform = PLATFORM_BY_ID.get(PLATFORM_ID)
  if (!platform?.imagePath || !platform.convertPath) return empty('1688 image search is unavailable')

  // Their converter hard-refuses anything over 300KB, and MEASURED 56% of our
  // product photos are over it - so for most products the search below never
  // ran and the grid just showed no 1688 group. Shrink first when needed.
  const prepared = await prepareSearchImage(imageUrl)
  if (!prepared.url) return empty(prepared.error || 'Could not prepare the photo for 1688 search')

  try {
    // 1688 only recognises Alibaba-hosted images, so our own product photo has to
    // be re-hosted through their converter before it can be searched.
    const converted = await convertImageUrl(platform, prepared.url, token)
    if (!converted.url) return empty(converted.error || 'Could not upload the photo to 1688')

    return await searchWithConverted(platform, converted.url, token)
  } finally {
    // The shrunk copy exists only for Alibaba's fetch; drop it either way.
    await releaseSearchImage(prepared)
  }
}

/**
 * Everything after the photo is accepted. Split out so the temp-copy cleanup
 * above can wrap it in a single `finally` without indenting the whole body.
 */
async function searchWithConverted(
  platform: MarketplacePlatform,
  convertedUrl: string,
  token: string,
): Promise<ListingVideoOutcome> {
  const converted = { url: convertedUrl }

  let hits: MarketplaceHit[]
  try {
    const qs = new URLSearchParams({ img_url: converted.url, page: '1', apiToken: token })
    for (const [k, v] of Object.entries(platform.extraParams ?? {})) qs.set(k, v)

    const res = await fetch(`${TMAPI_BASE}${platform.imagePath}?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })
    if (!res.ok) {
      // 439 is TMAPI's own non-standard "out of credit" status - a billing
      // problem, not an empty result, so it must not read as "no videos"
      if (res.status === 439) return empty('No 1688 API credit left for image search')
      if (res.status === 401 || res.status === 403) return empty('1688 token rejected')
      if (res.status === 429) return empty('1688 rate limited - try again shortly')
      return empty(`1688 image search failed (HTTP ${res.status})`)
    }

    const json = await res.json().catch(() => null)
    if (!json) return empty('1688 returned an unreadable response')
    const failed = apiError(json)
    if (failed) return empty(failed)

    hits = extractList(json)
      .map((raw) => normalizeHit(raw, platform))
      .filter((h): h is MarketplaceHit => h !== null)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed'
    return empty(/timeout|abort/i.test(msg) ? '1688 image search timed out' : msg)
  }

  if (!hits.length) return { videos: [], photos: [], matched: 0, checked: 0, error: '' }

  const detailPath = platform.detailPath
  if (!detailPath) return empty('1688 detail lookup is unavailable')

  // Keep 1688's own ordering rather than re-sorting.
  //
  // MEASURED: image search returns sold=0 on EVERY row (the sales figure only
  // exists on the detail record), so sorting by sales here silently shuffles the
  // list on a field that is always zero. 1688 returns visual-similarity order,
  // which is exactly what we want when the photo is the query - the closest
  // looking listings get the paid detail calls.
  const targets = hits.slice(0, ENRICH_LIMIT)

  // One detail call per listing, in parallel. Each returns the video (if any)
  // AND that listing's whole picture gallery, so this single set of paid calls
  // fills both the video grid and the photo picker.
  const details = await Promise.all(targets.map((h) => fetchDetail(detailPath, h.id.slice(h.id.indexOf(':') + 1), token)))

  const videos: ListingVideo[] = []
  // Gallery photos first (hero + variant shots), search-row thumbnails after.
  const photos = new Set<string>()

  targets.forEach((h, i) => {
    const d = details[i]
    for (const p of d.photos) photos.add(p)
    if (d.video) {
      videos.push({
        id: `alibaba-${h.id}`,
        title: h.title,
        cover: h.image || d.photos[0] || null,
        play: d.video,
        pageUrl: h.pageUrl || '',
        price: h.price || '',
        sold: h.sold,
        supplier: h.seller.name || '1688 supplier',
      })
    }
  })

  // Thumbnails from listings we did not open still show the same product, so
  // they round out the picker once the richer gallery shots are in.
  for (const h of hits) if (h.image) photos.add(h.image)

  return {
    videos,
    photos: [...photos].slice(0, MAX_PHOTOS),
    matched: hits.length,
    checked: targets.length,
    error: '',
  }
}
