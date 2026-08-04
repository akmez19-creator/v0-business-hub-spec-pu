/**
 * TMAPI marketplace search.
 *
 * TMAPI is an e-commerce data API (product listings), NOT a social video API.
 * It cannot search TikTok/Instagram/YouTube feeds. What it gives us is the
 * listing video and gallery photos attached to a real product, which is the
 * material the Reels and Poster tools actually need.
 *
 * Endpoint paths could not be verified against the live API from the build
 * sandbox (api.tmapi.top is unreachable from here), and TMAPI's docs are
 * client-rendered so they could not be scraped either. Every path therefore
 * lives in PLATFORMS below and nowhere else - if a platform 404s, correcting
 * the single `path` string here fixes it everywhere. /api/product-master/
 * marketplace-search/diagnose reports which paths actually answer.
 */

export type MarketplaceId =
  | 'aliexpress'
  | 'shopee'
  | 'amazon'
  | 'alibaba'
  | 'lazada'
  | 'dhgate'

export type MarketplacePlatform = {
  id: MarketplaceId
  label: string
  /** Path on api.tmapi.top for keyword search */
  path: string
  /** Shown in the UI so the cost/benefit of each source is visible up front */
  note: string
  /** Platform-specific query params (e.g. 1688 accepts page_size) */
  extraParams?: Record<string, string>
  /** Reverse-image search path, when the platform offers one */
  imagePath?: string
  /**
   * Converts an arbitrary image URL into one the image search will accept.
   * 1688 only recognises Alibaba-hosted images, so our own Supabase product
   * photos have to be uploaded through this first.
   */
  convertPath?: string
  /**
   * Single-item lookup. Needed because search results never carry video_url -
   * the listing video only exists on the detail record.
   */
  detailPath?: string
}

/**
 * TMAPI serves its API over plain HTTP, not HTTPS.
 *
 * This is not a preference - https://api.tmapi.top fails the TLS handshake
 * because the certificate presented for that host is a shared Tencent CDN
 * cert (*.myqcloud.com, *.4399.com, ...) that does not list api.tmapi.top.
 * Node surfaces that as a bare "fetch failed", which is what every
 * marketplace was reporting. The vendor's own docs specify http://, and
 * http:// returns valid JSON. Switching this back to https:// will break
 * every marketplace search again.
 */
export const TMAPI_BASE = 'http://api.tmapi.top'

/**
 * Every path below was verified against the live API with a real token.
 *
 * Taobao and TikTok Shop used to be listed here and were removed on purpose:
 * TMAPI has no keyword-search endpoint for either (Taobao offers only
 * item-detail/shop lookups, and TikTok Shop is not a TMAPI product at all).
 * Both returned "no Route matched with those values" on every request, so
 * listing them only produced guaranteed failures in the UI.
 */
export const PLATFORMS: MarketplacePlatform[] = [
  // 1688 is the one confirmed returning live results on the current plan
  {
    id: 'alibaba',
    label: '1688',
    path: '/1688/search/items',
    note: 'Supplier source, richest photos, Chinese titles. Only source with image search and video.',
    extraParams: { page_size: '20' },
    imagePath: '/1688/search/image',
    convertPath: '/1688/tools/image/convert_url',
    detailPath: '/1688/item_detail',
  },
  { id: 'aliexpress', label: 'AliExpress', path: '/aliexpress/search/items', note: 'English titles, most listings have video' },
  { id: 'shopee', label: 'Shopee', path: '/shopee/search/items', note: 'Asia, lots of short listing videos' },
  { id: 'amazon', label: 'Amazon', path: '/amazon/search/items', note: 'High-quality photos, fewer videos' },
  { id: 'lazada', label: 'Lazada', path: '/lazada/search/items', note: 'Southeast Asia, decent video coverage' },
  { id: 'dhgate', label: 'DHgate', path: '/dhgate/search/items', note: 'Wholesale, English titles' },
]

export const PLATFORM_BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]))

/** A normalised marketplace listing. */
export type MarketplaceHit = {
  id: string
  platform: MarketplaceId
  platformLabel: string
  title: string
  /** Listing video, when the seller uploaded one */
  video: string | null
  /** Main photo, used as the tile and as a Poster Studio source */
  image: string | null
  /** Every gallery photo, so Poster Studio can offer a choice */
  images: string[]
  price: string | null
  sold: number
  pageUrl: string | null
}

/**
 * Marketplace payloads vary a lot between platforms and TMAPI does not
 * guarantee one shape, so every field is picked by trying the names these APIs
 * actually use rather than assuming one. A listing we cannot read is skipped,
 * never allowed to throw - one odd row must not blank the whole grid.
 */
type Raw = Record<string, unknown>

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

/** Marketplaces very often return protocol-relative URLs like //img.x.com/a.jpg */
const url = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  if (s.startsWith('//')) return `https:${s}`
  return s.startsWith('http') ? s : null
}

const pick = (o: Raw, keys: string[]): unknown => {
  for (const k of keys) {
    const v = o[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Pull an image list out of whatever shape the platform used. */
function imageList(o: Raw): string[] {
  const raw = pick(o, ['images', 'image_list', 'main_imgs', 'item_imgs', 'gallery', 'pic_list', 'imgs'])
  const out: string[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      // Some platforms send ["url", ...], others [{url: "..."}, ...]
      const u = typeof entry === 'string' ? url(entry) : url(pick((entry ?? {}) as Raw, ['url', 'img', 'image', 'pic']))
      if (u) out.push(u)
    }
  }
  return [...new Set(out)]
}

/** Price can be a number, a string, or a nested object depending on platform. */
function priceOf(o: Raw): string | null {
  const p = pick(o, ['price', 'sale_price', 'promotion_price', 'min_price', 'price_info', 'origin_price'])
  if (p && typeof p === 'object') {
    return str(pick(p as Raw, ['value', 'price', 'min', 'amount']))
  }
  return str(p)
}

export function normalizeHit(raw: Raw, platform: MarketplacePlatform): MarketplaceHit | null {
  const id = str(pick(raw, ['item_id', 'num_iid', 'product_id', 'id', 'goods_id', 'asin', 'itemId']))
  const title = str(pick(raw, ['title', 'name', 'product_name', 'subject', 'goods_name']))
  // Without an id and a title there is nothing meaningful to show
  if (!id || !title) return null

  const images = imageList(raw)
  const image = url(pick(raw, ['main_image', 'image', 'pic_url', 'img', 'main_img', 'cover', 'thumbnail'])) ?? images[0] ?? null
  const video = url(pick(raw, ['video', 'video_url', 'main_video', 'item_video', 'videoUrl']))

  return {
    id: `${platform.id}:${id}`,
    platform: platform.id,
    platformLabel: platform.label,
    title: title.slice(0, 160),
    video,
    image,
    // Keep the main photo first so the Poster Studio default matches the tile
    images: image ? [image, ...images.filter((i) => i !== image)] : images,
    price: priceOf(raw),
    sold: num(pick(raw, ['sold', 'sales', 'sold_count', 'volume', 'quantity_sold'])),
    pageUrl: url(pick(raw, ['detail_url', 'url', 'product_url', 'item_url', 'link'])),
  }
}

/**
 * TMAPI wraps results differently per platform (data.items, data.list,
 * data.products, or a bare array), so unwrap defensively rather than assuming.
 */
export function extractList(json: unknown): Raw[] {
  if (Array.isArray(json)) return json as Raw[]
  const root = (json ?? {}) as Raw
  const data = (root.data ?? root) as Raw
  for (const key of ['items', 'list', 'products', 'item_list', 'results', 'goods_list', 'data']) {
    const v = (data as Raw)[key]
    if (Array.isArray(v)) return v as Raw[]
  }
  return []
}

/**
 * TMAPI signals failure in the body with a non-zero code while still returning
 * HTTP 200, so the body has to be inspected - checking res.ok is not enough.
 * Returns null when the payload looks fine.
 */
/**
 * Is this image already hosted by Alibaba?
 *
 * Worth checking because 1688's image search accepts an alicdn URL directly -
 * verified returning a full 20 results with no conversion. Listing photos are
 * all alicdn-hosted, so re-searching from one costs a single call instead of
 * the convert + search pair our own Supabase photos need.
 */
export function isAlibabaHosted(imageUrl: string): boolean {
  try {
    const host = new URL(imageUrl).hostname
    return /(^|\.)(alicdn\.com|alibaba\.com|1688\.com)$/i.test(host)
  } catch {
    return false
  }
}

/**
 * Turn any image URL into one 1688's reverse-image search will accept.
 *
 * The image search endpoint only recognises Alibaba-hosted images, so passing
 * a Supabase (or any other) URL straight to it returns nothing useful. This
 * uploads the image to Alibaba and hands back their reference, which is a
 * short relative path like /search/imgextra5/123.jpg rather than a full URL -
 * pass it through to img_url exactly as given.
 */
export async function convertImageUrl(
  platform: MarketplacePlatform,
  imageUrl: string,
  token: string,
): Promise<{ url: string | null; error: string | null }> {
  if (!platform.convertPath) return { url: null, error: 'This marketplace has no image search' }
  try {
    const res = await fetch(`${TMAPI_BASE}${platform.convertPath}?apiToken=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: imageUrl, search_api_endpoint: '/search/image' }),
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    })
    if (res.status === 439) return { url: null, error: 'No API credit for image search' }
    if (!res.ok) return { url: null, error: `Image upload failed (HTTP ${res.status})` }

    const json = await res.json().catch(() => null)
    const failed = apiError(json)
    if (failed) return { url: null, error: failed }

    const data = ((json ?? {}) as Raw).data as Raw | undefined
    const converted = str(pick(data ?? {}, ['image_url', 'url', 'img_url']))
    if (!converted) return { url: null, error: 'Alibaba did not accept this image' }
    return { url: converted, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Image upload failed'
    return { url: null, error: /timeout|abort/i.test(msg) ? 'Image upload timed out' : msg }
  }
}

/**
 * Fill in video_url for listings that have one.
 *
 * Search responses never include video - only the per-item detail record does,
 * which is why "Only listings with a video" used to return nothing at all.
 * That makes video an extra paid call per listing, so this is only worth
 * running when the user actually asked to filter by video. Roughly half of
 * 1688 listings turn out to have a clip.
 */
export async function attachVideos(
  hits: MarketplaceHit[],
  token: string,
  limit = 20,
): Promise<MarketplaceHit[]> {
  const targets = hits.slice(0, limit)
  const CONCURRENCY = 5
  const out = [...hits]

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (hit) => {
        const platform = PLATFORM_BY_ID.get(hit.platform)
        if (!platform?.detailPath || hit.video) return
        // The composite id is "<platform>:<itemId>"
        const itemId = hit.id.slice(hit.id.indexOf(':') + 1)
        try {
          const res = await fetch(
            `${TMAPI_BASE}${platform.detailPath}?item_id=${encodeURIComponent(itemId)}&apiToken=${encodeURIComponent(token)}`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), cache: 'no-store' },
          )
          if (!res.ok) return
          const json = await res.json().catch(() => null)
          if (!json || apiError(json)) return

          const data = ((json ?? {}) as Raw).data as Raw | undefined
          const video = url(pick(data ?? {}, ['video_url', 'video', 'main_video']))
          if (!video) return

          const idx = out.findIndex((h) => h.id === hit.id)
          if (idx !== -1) out[idx] = { ...out[idx], video }
        } catch {
          // A detail lookup failing just means no video for that tile - it must
          // never take down the whole search
        }
      }),
    )
  }

  return out
}

export function apiError(json: unknown): string | null {
  const root = (json ?? {}) as Raw
  const code = root.code ?? root.status
  if (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200') {
    return str(pick(root, ['msg', 'message', 'error', 'error_message'])) || `TMAPI error ${String(code)}`
  }

  // Gateway-level failures ("Insufficient API balance", "No API key found in
  // request") come back as a bare {"message": "..."} with no code field at
  // all. The check above misses those, so they used to read as a successful
  // search with zero results - hiding a billing problem behind "no results".
  if (code === undefined || code === null) {
    const message = str(pick(root, ['message', 'error', 'error_message']))
    if (message && root.data === undefined) return message
  }

  return null
}
