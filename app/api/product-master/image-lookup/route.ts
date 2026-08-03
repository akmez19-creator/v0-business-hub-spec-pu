import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30
// The vqd token is single-use and short-lived. Without this, Next's Data Cache
// stores the GET responses below and replays a stale token forever - which is
// what made every lookup fail with "no vqd token".
export const dynamic = 'force-dynamic'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

type ImageHit = {
  id: string
  title: string
  image: string
  thumbnail: string
  width: number
  height: number
  source: string
  pageUrl: string
  score: number
}

// Shopping / marketplace CDNs tend to carry clean packshots on white, which
// is exactly what the vision pass reads best.
const SHOP_HOSTS =
  /(walmartimages|susercontent|alicdn|amazon|ssl-images-amazon|media-amazon|ebayimg|shopify|etsystatic|temu|kwcdn|lazada|slatic|mlstatic|daraz|jumia|noon|flipkart|aliexpress|target|homedepot|argos|wayfair)/i

// Aggregators and pin boards re-host watermarked or cropped copies, so they
// rank below a real listing photo
const RESHARE_HOSTS = /(pinimg|pinterest|ytimg|fbcdn|lookaside|blogspot|wordpress|wixstatic)/i

const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

/** DuckDuckGo image search needs a short-lived vqd token from the HTML page. */
async function getVqd(query: string) {
  const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: BROWSER_HEADERS,
    cache: 'no-store',
  })
  if (!res.ok) return null
  const html = await res.text()
  const m = html.match(/vqd=["']?([\d-]+)["']?/) || html.match(/vqd=([^&"']+)/)
  return m ? m[1] : null
}

type RawImage = {
  title?: string
  image?: string
  thumbnail?: string
  width?: number
  height?: number
  source?: string
  url?: string
}

/**
 * The vqd token is short-lived and the endpoint rate-limits per IP, so a single
 * attempt fails intermittently. Retry with a freshly minted token before giving
 * up, and report the real status so failures are diagnosable.
 */
async function fetchImages(query: string): Promise<RawImage[]> {
  let lastReason = 'unknown'

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt))

    const vqd = await getVqd(query)
    if (!vqd) {
      lastReason = 'no vqd token'
      continue
    }

    const res = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
      {
        headers: {
          ...BROWSER_HEADERS,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      lastReason = `http ${res.status}`
      continue
    }

    try {
      const json = (await res.json()) as { results?: RawImage[] }
      if (json.results?.length) return json.results
      lastReason = 'empty result set'
    } catch {
      lastReason = 'malformed response'
    }
  }

  throw new Error(`Image search is unavailable right now (${lastReason})`)
}

// POST { query } -> clean product photos from around the web.
// Used to replace a poor supplier thumbnail with a proper packshot before the
// photo is handed to the vision pass, so the product gets identified correctly.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const query = String(body?.query || '').trim().slice(0, 120)
    if (query.length < 2) {
      return NextResponse.json({ success: false, error: 'Type what the product is first' }, { status: 400 })
    }

    const raw = await fetchImages(query)

    const seen = new Set<string>()
    const hits: ImageHit[] = []

    for (const r of raw) {
      const image = r.image || ''
      const thumbnail = r.thumbnail || ''
      if (!/^https?:\/\//i.test(image) || !/^https?:\/\//i.test(thumbnail)) continue
      if (seen.has(image)) continue
      seen.add(image)

      const w = Number(r.width || 0)
      const h = Number(r.height || 0)
      // Skip tiny or heavily letterboxed images - bad input for the vision pass
      if (w < 300 || h < 300) continue
      const ratio = w / h
      if (ratio < 0.6 || ratio > 1.7) continue

      let host = ''
      try {
        host = new URL(image).hostname
      } catch {
        continue
      }

      // Prefer big, square, shop-hosted packshots
      let score = 0
      if (SHOP_HOSTS.test(host)) score += 3
      if (Math.abs(ratio - 1) < 0.08) score += 2
      if (w >= 800 && h >= 800) score += 1
      if (RESHARE_HOSTS.test(host)) score -= 2

      hits.push({
        id: image,
        title: (r.title || 'Product image').slice(0, 120),
        image,
        thumbnail,
        width: w,
        height: h,
        source: r.source || host,
        pageUrl: r.url || image,
        score,
      })
    }

    // Some niche products only have small or oddly cropped photos online - show
    // those rather than an empty grid
    if (!hits.length) {
      for (const r of raw) {
        const image = r.image || ''
        const thumbnail = r.thumbnail || ''
        if (!/^https?:\/\//i.test(image) || !/^https?:\/\//i.test(thumbnail)) continue
        let host = ''
        try {
          host = new URL(image).hostname
        } catch {
          continue
        }
        hits.push({
          id: image,
          title: (r.title || 'Product image').slice(0, 120),
          image,
          thumbnail,
          width: Number(r.width || 0),
          height: Number(r.height || 0),
          source: r.source || host,
          pageUrl: r.url || image,
          score: SHOP_HOSTS.test(host) ? 1 : 0,
        })
      }
    }

    hits.sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height)

    return NextResponse.json({ success: true, query, results: hits.slice(0, 24) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Image lookup failed'
    console.error('image-lookup error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
