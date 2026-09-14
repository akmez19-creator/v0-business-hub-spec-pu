import { ALLOWED_HOSTS } from '@/lib/product-master/video-resolve'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * PUBLIC media proxy for the storefront.
 *
 * Why this exists rather than reusing /api/product-master/video-fetch: that
 * route calls supabase.auth.getUser() and 401s without a session, and the
 * middleware gates all of /api on top of it. The shop is browsed by customers
 * who are never signed in, so every one of the ~1,373 supplier photos and 389
 * taobao videos would render broken.
 *
 * It is NOT an open proxy. The host allowlist is shared with the authenticated
 * route (one regex, so the two can never drift apart), which means this can
 * only ever fetch from the supplier CDNs we already store media on.
 */

// Supplier CDNs 403 a browser by Referer but serve our server fine.
const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Referer: 'https://detail.1688.com/',
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get('src')
  if (!src) return new NextResponse('Missing src', { status: 400 })

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return new NextResponse('Bad src', { status: 400 })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return new NextResponse('Bad protocol', { status: 400 })
  }
  // The allowlist is the whole security model here - without it this route
  // would happily fetch internal addresses on behalf of any caller (SSRF).
  if (!ALLOWED_HOSTS.test(url.hostname)) {
    return new NextResponse('Host not allowed', { status: 403 })
  }

  try {
    // Forward Range so <video> can seek. Without a 206 the browser cannot jump
    // to a frame and silently refuses to scrub - which is how the Studio's
    // "preview from 3s" behaviour breaks if Range is dropped.
    const range = request.headers.get('range')
    const upstream = await fetch(url.toString(), {
      headers: range ? { ...UPSTREAM_HEADERS, Range: range } : UPSTREAM_HEADERS,
      // Supplier CDNs are slow; without a cap a stalled fetch holds the request
      signal: AbortSignal.timeout(20_000),
    })

    if (!upstream.ok && upstream.status !== 206) {
      return new NextResponse('Upstream error', { status: 502 })
    }

    const headers = new Headers()
    const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
    for (const h of pass) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream')
    // Supplier media is immutable once uploaded, so cache hard at the edge.
    // This is what keeps a 60-card grid from re-fetching 1688 on every scroll.
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    // Never let a proxied response be interpreted as a document on our origin.
    headers.set('x-content-type-options', 'nosniff')
    headers.set('content-disposition', 'inline')

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch {
    return new NextResponse('Fetch failed', { status: 502 })
  }
}
