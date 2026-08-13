import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TMAPI_BASE, apiError } from '@/lib/product-master/tmapi'

// Each 1688 detail lookup is a network round-trip; a large PO can need many.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

type Raw = Record<string, unknown>

interface RequestItem {
  /** Inventory product the photo will be attached to */
  productId: string
  /** 1688 listing URL taken from the Excel "Link" column */
  link: string
}

interface ItemResult {
  productId: string
  status: 'done' | 'skipped' | 'failed'
  image: string | null
  note: string
}

/**
 * Pull the offer id out of a 1688 URL.
 *
 * Real-world links come in several shapes:
 *   https://detail.1688.com/offer/653481234567.html
 *   https://m.1688.com/offer/653481234567.html?spm=...
 *   https://detail.1688.com/offer/653481234567.html?sk=consign
 * The id is always the long digit run after /offer/.
 */
function offerIdFrom(link: string): string | null {
  const m = link.match(/\/offer\/(\d{6,})/) || link.match(/(?:id|offerId)=(\d{6,})/i)
  return m ? m[1] : null
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

/** Marketplaces often return protocol-relative URLs like //img.alicdn.com/a.jpg */
const asUrl = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  if (s.startsWith('//')) return `https:${s}`
  return s.startsWith('http') ? s : null
}

/**
 * Collect the gallery photos from a 1688 item_detail payload. TMAPI does not
 * guarantee one shape, so every known key is tried and anything unreadable is
 * skipped rather than allowed to throw.
 */
function imagesFrom(data: Raw): string[] {
  const out: string[] = []
  for (const key of ['main_imgs', 'images', 'image_list', 'item_imgs', 'pic_list', 'imgs', 'gallery']) {
    const raw = data[key]
    if (!Array.isArray(raw)) continue
    for (const entry of raw) {
      const u =
        typeof entry === 'string'
          ? asUrl(entry)
          : asUrl((entry as Raw)?.url ?? (entry as Raw)?.img ?? (entry as Raw)?.image ?? (entry as Raw)?.pic)
      if (u) out.push(u)
    }
  }
  const single = asUrl(data.main_image ?? data.image ?? data.pic_url ?? data.cover)
  if (single) out.unshift(single)
  return [...new Set(out)]
}

async function fetchListingImages(offerId: string, token: string): Promise<{ images: string[]; error: string | null }> {
  try {
    const res = await fetch(
      `${TMAPI_BASE}/1688/item_detail?item_id=${encodeURIComponent(offerId)}&apiToken=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000), cache: 'no-store' },
    )
    if (res.status === 439) return { images: [], error: 'No API credit left' }

    const json = (await res.json().catch(() => null)) as Raw | null
    if (!res.ok) return { images: [], error: `Listing lookup failed (HTTP ${res.status})` }
    const failed = apiError(json)
    if (failed) return { images: [], error: failed }

    const data = (json?.data ?? {}) as Raw
    const images = imagesFrom(data)
    return { images, error: images.length ? null : 'Listing has no photos' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Listing lookup failed'
    return { images: [], error: /timeout|abort/i.test(msg) ? 'Listing lookup timed out' : msg }
  }
}

/**
 * POST { items: [{ productId, link }] }
 *
 * Fills in inventory photos from the supplier's own 1688 listing. Products that
 * already carry an image are skipped on the SERVER (re-checked against the DB,
 * not trusted from the client) so an existing photo is never overwritten.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.TMAPI_TOKEN
    if (!token) {
      return NextResponse.json({ success: false, error: 'TMAPI_TOKEN is not configured' }, { status: 500 })
    }

    const body = await request.json()
    const items: RequestItem[] = Array.isArray(body?.items) ? body.items.slice(0, 400) : []
    if (!items.length) {
      return NextResponse.json({ success: false, error: 'No products to fetch images for' }, { status: 400 })
    }

    // Authoritative check: which of these products genuinely lack a photo.
    const ids = [...new Set(items.map((i) => i.productId).filter(Boolean))]
    const { data: existing } = await supabase.from('products').select('id, image_url').in('id', ids)
    const hasImage = new Map((existing || []).map((p) => [p.id as string, !!p.image_url]))

    const results: ItemResult[] = []
    const pending: RequestItem[] = []

    for (const item of items) {
      if (hasImage.get(item.productId)) {
        results.push({ productId: item.productId, status: 'skipped', image: null, note: 'Already has a photo' })
      } else if (!item.link || !offerIdFrom(item.link)) {
        results.push({ productId: item.productId, status: 'failed', image: null, note: 'No usable 1688 link' })
      } else {
        pending.push(item)
      }
    }

    // Bounded concurrency: fast enough for a few hundred rows without
    // hammering TMAPI into rate-limiting us.
    const CONCURRENCY = 5
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (item) => {
          const offerId = offerIdFrom(item.link)!
          const { images, error } = await fetchListingImages(offerId, token)
          const chosen = images[0] || null

          if (!chosen) {
            results.push({
              productId: item.productId,
              status: 'failed',
              image: null,
              note: error || 'No photo found',
            })
            return
          }

          // Link the chosen photo to the inventory product.
          const { error: dbError } = await supabase
            .from('products')
            .update({ image_url: chosen })
            .eq('id', item.productId)
            .is('image_url', null)

          results.push({
            productId: item.productId,
            status: dbError ? 'failed' : 'done',
            image: dbError ? null : chosen,
            note: dbError ? 'Could not save photo' : 'Photo linked from 1688',
          })
        }),
      )
    }

    const done = results.filter((r) => r.status === 'done').length
    return NextResponse.json({
      success: true,
      results,
      stats: {
        total: items.length,
        fetched: done,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Image fetch failed'
    console.error('[v0] po fetch-images error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
