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
  | 'taobao'
  | 'lazada'
  | 'dhgate'
  | 'tiktok-shop'

export type MarketplacePlatform = {
  id: MarketplaceId
  label: string
  /** Path on api.tmapi.top for keyword search */
  path: string
  /** Shown in the UI so the cost/benefit of each source is visible up front */
  note: string
}

export const TMAPI_BASE = 'https://api.tmapi.top'

export const PLATFORMS: MarketplacePlatform[] = [
  { id: 'aliexpress', label: 'AliExpress', path: '/aliexpress/search/items', note: 'English titles, most listings have video' },
  { id: 'shopee', label: 'Shopee', path: '/shopee/search/items', note: 'Asia, lots of short listing videos' },
  { id: 'amazon', label: 'Amazon', path: '/amazon/search/items', note: 'High-quality photos, fewer videos' },
  { id: 'alibaba', label: '1688', path: '/ali/search/items', note: 'Supplier source, richest video, Chinese titles' },
  { id: 'taobao', label: 'Taobao', path: '/taobao/search/items', note: 'Chinese titles, strong video coverage' },
  { id: 'lazada', label: 'Lazada', path: '/lazada/search/items', note: 'Southeast Asia, decent video coverage' },
  { id: 'dhgate', label: 'DHgate', path: '/dhgate/search/items', note: 'Wholesale, English titles' },
  { id: 'tiktok-shop', label: 'TikTok Shop', path: '/tiktok-shop/search/items', note: 'Shop listings (not the TikTok feed)' },
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
export function apiError(json: unknown): string | null {
  const root = (json ?? {}) as Raw
  const code = root.code ?? root.status
  if (code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200') {
    return str(pick(root, ['msg', 'message', 'error', 'error_message'])) || `TMAPI error ${String(code)}`
  }
  return null
}
