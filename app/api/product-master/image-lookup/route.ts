import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

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
  /(walmartimages|susercontent|alicdn|amazon|ssl-images-amazon|media-amazon|ebayimg|shopify|etsystatic|temu|kwcdn|lazada|aliexpress|target|homedepot|argos|wayfair)/i

/** DuckDuckGo image search needs a short-lived vqd token from the HTML page. */
async function getVqd(query: string) {
  const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) return null
  const html = await res.text()
  const m = html.match(/vqd=["']?([\d-]+)["']?/) || html.match(/vqd=([^&"']+)/)
  return m ? m[1] : null
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

    const vqd = await getVqd(query)
    if (!vqd) throw new Error('Image search is unavailable right now')

    const res = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
      { headers: { 'User-Agent': UA, Referer: 'https://duckduckgo.com/', Accept: 'application/json' } },
    )
    if (!res.ok) throw new Error('Image search is unavailable right now')

    const json = (await res.json()) as {
      results?: Array<{
        title?: string
        image?: string
        thumbnail?: string
        width?: number
        height?: number
        source?: string
        url?: string
      }>
    }

    const seen = new Set<string>()
    const hits: ImageHit[] = []

    for (const r of json.results || []) {
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

    hits.sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height)

    return NextResponse.json({ success: true, query, results: hits.slice(0, 24) })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Image lookup failed'
    console.error('image-lookup error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
