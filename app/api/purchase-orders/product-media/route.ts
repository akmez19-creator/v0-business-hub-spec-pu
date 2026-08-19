import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TMAPI_BASE, apiError } from '@/lib/product-master/tmapi'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Raw = Record<string, unknown>

export interface MediaItem {
  url: string
  kind: 'image' | 'video'
  /** Poster frame for videos, when the listing provides one */
  poster?: string | null
}

/**
 * Pull the offer id out of a 1688 URL.
 *
 * Real-world links come in several shapes:
 *   https://detail.1688.com/offer/653481234567.html
 *   https://m.1688.com/offer/653481234567.html?spm=...
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

const pick = (o: Raw, ...keys: string[]): unknown => {
  for (const k of keys) if (o?.[k] != null) return o[k]
  return undefined
}

/**
 * Collect EVERY gallery photo from a 1688 item_detail payload. TMAPI does not
 * guarantee one shape, so all known keys are tried and anything unreadable is
 * skipped rather than allowed to throw. SKU-variant photos are included too:
 * they are frequently the cleanest shots of the actual item.
 */
function imagesFrom(data: Raw): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    const u = asUrl(v)
    if (u) out.push(u)
  }

  const single = pick(data, 'main_image', 'image', 'pic_url', 'cover')
  push(single)

  for (const key of ['main_imgs', 'images', 'image_list', 'item_imgs', 'pic_list', 'imgs', 'gallery', 'detail_imgs']) {
    const raw = data[key]
    if (!Array.isArray(raw)) continue
    for (const entry of raw) {
      if (typeof entry === 'string') push(entry)
      else push(pick(entry as Raw, 'url', 'img', 'image', 'pic', 'imgUrl'))
    }
  }

  // Per-variant photos live under the sku list on most payload shapes.
  for (const key of ['skus', 'sku_list', 'props_imgs', 'prop_imgs']) {
    const raw = data[key]
    if (!Array.isArray(raw)) continue
    for (const entry of raw) {
      push(pick(entry as Raw, 'image', 'img', 'url', 'pic', 'imgUrl'))
    }
  }

  return [...new Set(out)]
}

/** Listing videos. 1688 exposes these under a handful of different keys. */
function videosFrom(data: Raw): MediaItem[] {
  const out: MediaItem[] = []
  const poster = asUrl(pick(data, 'main_image', 'image', 'cover'))
  const push = (v: unknown, p?: unknown) => {
    const u = asUrl(v)
    // Guard against an image URL sneaking into a video field.
    if (u && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(u)) {
      out.push({ url: u, kind: 'video', poster: asUrl(p) ?? poster })
    }
  }

  push(pick(data, 'video_url', 'video', 'main_video', 'videoUrl'))

  for (const key of ['videos', 'video_list', 'item_videos']) {
    const raw = data[key]
    if (!Array.isArray(raw)) continue
    for (const entry of raw) {
      if (typeof entry === 'string') push(entry)
      else push(pick(entry as Raw, 'url', 'video_url', 'play_url', 'videoUrl'), pick(entry as Raw, 'cover', 'poster'))
    }
  }

  const seen = new Set<string>()
  return out.filter((v) => (seen.has(v.url) ? false : seen.add(v.url)))
}

/**
 * POST { link } -> every photo and video on that 1688 listing.
 *
 * Nothing is saved here. The reviewer picks what to keep, which is what the
 * PUT below persists. Listing lookups are read-only and safe to repeat.
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
    const link = String(body?.link || '').trim()
    const offerId = offerIdFrom(link)
    if (!offerId) {
      return NextResponse.json(
        { success: false, reason: 'bad-link', error: 'Not a recognisable 1688 listing link' },
        { status: 400 },
      )
    }

    const res = await fetch(
      `${TMAPI_BASE}/1688/item_detail?item_id=${encodeURIComponent(offerId)}&apiToken=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25_000), cache: 'no-store' },
    )
    if (res.status === 439) {
      return NextResponse.json({ success: false, reason: 'credit', error: 'No API credit left' }, { status: 402 })
    }
    const json = (await res.json().catch(() => null)) as Raw | null

    /**
     * Tell apart "this listing is gone" from "our data provider refused the
     * request". They demand opposite responses and were previously flattened
     * into one message, so the UI told a reviewer to paste a replacement link
     * for a listing that was never the problem.
     *
     * Verified against the live API:
     *   pulled/unknown listing -> HTTP 200 {"code":404,"msg":"Item not found"}
     *   bad or rejected token  -> HTTP 401 {"message":"Unauthorized"}
     * The gateway also answers 200 with a bare {"message":...} envelope (no
     * `code`) for plan and routing rejections, which is how the raw word
     * "Unauthorized" used to reach the screen.
     */
    const upstream = apiError(json)
    const code = String((json as Raw | null)?.code ?? '')
    const authRejected =
      res.status === 401 || res.status === 403 || /unauthorized|forbidden|api key|token/i.test(upstream ?? '')
    const missing = code === '404' || /not found|item.*(deleted|removed|offline)/i.test(upstream ?? '')

    if (authRejected) {
      // Logged with the request id so a recurrence can be taken to TMAPI.
      console.error('[v0] product-media: provider rejected the request -', {
        httpStatus: res.status,
        upstream,
        requestId: (json as Raw | null)?.request_id ?? null,
      })
      return NextResponse.json(
        {
          success: false,
          reason: 'provider-auth',
          error: 'Our listing data provider rejected the request',
        },
        { status: 502 },
      )
    }

    if (missing) {
      return NextResponse.json(
        { success: false, reason: 'not-found', error: 'This listing is no longer on 1688' },
        { status: 404 },
      )
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, reason: 'upstream', error: `Listing lookup failed (HTTP ${res.status})` },
        { status: 502 },
      )
    }
    if (upstream) {
      return NextResponse.json({ success: false, reason: 'upstream', error: upstream }, { status: 502 })
    }

    const data = (json?.data ?? {}) as Raw
    const images: MediaItem[] = imagesFrom(data).map((url) => ({ url, kind: 'image' as const }))
    const videos = videosFrom(data)

    return NextResponse.json({
      success: true,
      offerId,
      title: str(pick(data, 'title', 'subject', 'name')) || '',
      media: [...videos, ...images],
      counts: { images: images.length, videos: videos.length },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Listing lookup failed'
    console.error('[v0] po product-media error:', msg)
    return NextResponse.json(
      { success: false, error: /timeout|abort/i.test(msg) ? 'Listing lookup timed out' : msg },
      { status: 500 },
    )
  }
}

/**
 * PUT { productId, imageUrl } -> attach the chosen photo to the inventory item.
 *
 * Every photo here is an explicit human choice made in the media wizard, so it
 * is allowed to replace an existing photo.
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId = String(body?.productId || '').trim()
    const imageUrl = String(body?.imageUrl || '').trim()
    if (!productId || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ success: false, error: 'productId and a valid imageUrl are required' }, { status: 400 })
    }

    const { error } = await supabase.from('products').update({ image_url: imageUrl }).eq('id', productId)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, productId, imageUrl })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not save photo'
    console.error('[v0] po product-media save error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
