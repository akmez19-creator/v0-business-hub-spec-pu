import { put } from '@vercel/blob'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Media an agent attaches to a reply.
 *
 * Meta downloads link media itself, so the URL we hand it must be public,
 * stable and served without a Referer check. Most product photos are hotlinked
 * from 1688's CDN (Referer 403 - see hotlinked-product-photos) and clips from
 * Taobao's signed video host, so every attachment is fetched by OUR server and
 * re-hosted on our public Blob store before sending. Uploads land there directly.
 */

export type OutboundMediaKind = 'image' | 'video'

export type StagedMedia = {
  url: string
  kind: OutboundMediaKind
  mime: string
  bytes: number
  /** What the agent picked, for the chip in the composer. */
  label: string
}

/** WhatsApp Cloud API limits (Messenger's are higher, so these bound both). */
export const MEDIA_LIMITS: Record<OutboundMediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp', 'video/quicktime'])

/** Where a product photo or clip may legitimately come from. Anything else is refused, never fetched. */
const SOURCE_HOSTS = [
  /(^|\.)alicdn\.com$/i,
  /(^|\.)taobao\.com$/i,
  /(^|\.)tbcdn\.cn$/i,
  /(^|\.)supabase\.co$/i,
  /(^|\.)public\.blob\.vercel-storage\.com$/i,
]

export function mediaKindFor(mime: string): OutboundMediaKind | null {
  const m = mime.toLowerCase().split(';')[0].trim()
  if (IMAGE_MIMES.has(m)) return 'image'
  if (VIDEO_MIMES.has(m)) return 'video'
  // WhatsApp only accepts MP4/3GP video; a MOV upload is re-labelled as MP4 only when
  // the browser reported it so, which most phones do for H.264 clips.
  return null
}

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', '3gp': 'video/3gpp', mov: 'video/quicktime' }[ext] ?? ''
}

function assertSize(kind: OutboundMediaKind, bytes: number) {
  if (bytes > MEDIA_LIMITS[kind]) {
    const mb = Math.round(MEDIA_LIMITS[kind] / 1024 / 1024)
    throw new Error(`${kind === 'image' ? 'Photos' : 'Videos'} must be under ${mb} MB to send on WhatsApp.`)
  }
}

async function store(kind: OutboundMediaKind, mime: string, body: Blob | ArrayBuffer, nameHint: string): Promise<string> {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime.startsWith('image/') ? 'jpg' : mime === 'video/3gpp' ? '3gp' : 'mp4'
  const safe = nameHint.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || kind
  const blob = await put(`inbox-outbound/${Date.now()}-${safe}.${ext}`, body, { access: 'public', contentType: mime })
  return blob.url
}

/** A file the agent uploaded from their device. */
export async function stageUpload(file: File): Promise<StagedMedia> {
  const mime = file.type || mimeFromName(file.name)
  const kind = mediaKindFor(mime)
  if (!kind) throw new Error('Only JPG, PNG, WebP photos and MP4 videos can be sent.')
  assertSize(kind, file.size)
  const sendMime = mime === 'video/quicktime' ? 'video/mp4' : mime
  const url = await store(kind, sendMime, file, file.name.replace(/\.[a-z0-9]+$/i, ''))
  return { url, kind, mime: sendMime, bytes: file.size, label: file.name }
}

/**
 * A stored product photo or clip. The URL must belong to the product it claims
 * to (the picker offers only those), so a caller cannot make us fetch arbitrary hosts.
 */
export async function stageProductMedia(productId: string, sourceUrl: string): Promise<StagedMedia> {
  const media = await listProductMedia(productId)
  const chosen = media.items.find((item) => item.url === sourceUrl)
  if (!chosen) throw new Error('That photo or clip does not belong to the selected product.')

  // Already on our public store: Meta can fetch it as is.
  if (/\.public\.blob\.vercel-storage\.com$/i.test(new URL(chosen.url).hostname)) {
    const head = await fetch(chosen.url, { method: 'HEAD' })
    const mime = head.headers.get('content-type') ?? (chosen.kind === 'image' ? 'image/jpeg' : 'video/mp4')
    const bytes = Number(head.headers.get('content-length') ?? 0)
    assertSize(chosen.kind, bytes)
    return { url: chosen.url, kind: chosen.kind, mime, bytes, label: media.productName }
  }

  const res = await fetch(chosen.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`The product ${chosen.kind === 'image' ? 'photo' : 'clip'} could not be fetched (${res.status}).`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared) assertSize(chosen.kind, declared)
  const buffer = await res.arrayBuffer()
  assertSize(chosen.kind, buffer.byteLength)
  const headerMime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  const mime = mediaKindFor(headerMime) === chosen.kind ? headerMime : chosen.kind === 'image' ? 'image/jpeg' : 'video/mp4'
  const url = await store(chosen.kind, mime, buffer, media.productName)
  return { url, kind: chosen.kind, mime, bytes: buffer.byteLength, label: media.productName }
}

export type ProductMediaItem = { url: string; kind: OutboundMediaKind; primary: boolean }

/** Every photo and clip stored for one product, primary photo first, clips last. */
export async function listProductMedia(productId: string): Promise<{ productName: string; items: ProductMediaItem[] }> {
  const db = createAdminClient()
  const [{ data: product }, { data: images }, { data: clips }] = await Promise.all([
    db.from('products').select('id,name,image_url').eq('id', productId).maybeSingle(),
    db.from('product_images').select('image_url,is_primary,position').eq('product_id', productId).order('position'),
    db.from('product_clips').select('file_url,created_at').eq('product_id', productId).order('created_at'),
  ])
  if (!product) throw new Error('Product not found.')

  const seen = new Set<string>()
  const items: ProductMediaItem[] = []
  const add = (url: string | null | undefined, kind: OutboundMediaKind, primary = false) => {
    if (!url || seen.has(url) || !allowedSource(url)) return
    seen.add(url)
    items.push({ url, kind, primary })
  }
  add(product.image_url, 'image', true)
  for (const row of [...(images ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) add(row.image_url, 'image', Boolean(row.is_primary) && items.length === 0)
  for (const row of clips ?? []) add(row.file_url, 'video')
  return { productName: product.name, items }
}

/**
 * Send routes accept only media this inbox staged: a public link on OUR Blob
 * store with a kind/mime pair we produce. Anything else is refused, so a
 * request cannot make the business number send an arbitrary internet file.
 */
export function validOutboundMedia(value: unknown): { url: string; kind: OutboundMediaKind; mime: string } | null {
  if (!value || typeof value !== 'object') return null
  const { url, kind, mime } = value as { url?: unknown; kind?: unknown; mime?: unknown }
  if (typeof url !== 'string' || typeof mime !== 'string' || (kind !== 'image' && kind !== 'video')) return null
  if (mediaKindFor(mime) !== kind) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || !/\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)) return null
    if (!u.pathname.startsWith('/inbox-outbound/')) return null
  } catch {
    return null
  }
  return { url, kind, mime }
}

function allowedSource(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && SOURCE_HOSTS.some((host) => host.test(u.hostname))
  } catch {
    return false
  }
}
