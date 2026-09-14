import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  ALLOWED_HOSTS,
  UA,
  type Resolved,
  platformOf,
  resolveFacebook,
  resolveTikTok,
  resolveYouTube,
} from '@/lib/product-master/video-resolve'

// The resolvers themselves now live in lib/product-master/video-resolve.ts so
// the background clip-jobs worker can share them. A queued download has to
// re-resolve its own stream url at download time, because the signed CDN links
// these return expire within minutes.

export const maxDuration = 60

// POST { url } -> resolve platform and return direct stream metadata
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const url = String(body?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ success: false, error: 'Paste a valid video link' }, { status: 400 })
    }

    let resolved: Resolved
    const platform = platformOf(url)
    if (platform === 'tiktok') resolved = await resolveTikTok(url)
    else if (platform === 'facebook') resolved = await resolveFacebook(url)
    else if (platform === 'youtube') resolved = await resolveYouTube(url)
    else {
      return NextResponse.json(
        { success: false, error: 'Unsupported link. Use TikTok, Facebook or YouTube.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, ...resolved })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not fetch this video'
    console.error('video-fetch POST error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}

// GET ?src=<resolved cdn url>&filename=x.mp4 -> proxy-stream the file so the
// browser can save it despite CDN CORS. Host-allowlisted to prevent abuse.
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const src = searchParams.get('src') || ''
    const filename = (searchParams.get('filename') || 'video.mp4').replace(/[^\w.\- ]+/g, '_').slice(0, 100)
    // inline=1 streams for <img>/<video> playback instead of forcing a save
    const inline = searchParams.get('inline') === '1'

    let host: string
    try {
      host = new URL(src).hostname
    } catch {
      return NextResponse.json({ success: false, error: 'Bad src' }, { status: 400 })
    }
    if (!ALLOWED_HOSTS.test(host)) {
      return NextResponse.json({ success: false, error: 'Host not allowed' }, { status: 403 })
    }

    // Forward Range so inline <video> scrubbing works
    const range = request.headers.get('range')
    const upstream = await fetch(src, {
      headers: { 'User-Agent': UA, ...(inline && range ? { Range: range } : {}) },
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ success: false, error: `Upstream error ${upstream.status}` }, { status: 502 })
    }

    // Some 1688 CDN nodes answer without a content-type. Falling back to
    // octet-stream makes a <video> refuse to play, so guess from the path
    // before resorting to it.
    const fromExtension = (() => {
      const path = new URL(src).pathname.toLowerCase()
      if (path.endsWith('.webm')) return 'video/webm'
      if (path.endsWith('.mov')) return 'video/quicktime'
      if (path.endsWith('.mp4') || path.endsWith('.m4v')) return 'video/mp4'
      if (path.endsWith('.png')) return 'image/png'
      if (path.endsWith('.webp')) return 'image/webp'
      if (path.endsWith('.gif')) return 'image/gif'
      if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
      return null
    })()

    const headers = new Headers({
      'Content-Type':
        upstream.headers.get('content-type') || fromExtension || (inline ? 'application/octet-stream' : 'video/mp4'),
      'Content-Disposition': inline ? 'inline' : `attachment; filename="${filename}"`,
      'Cache-Control': inline ? 'public, max-age=3600' : 'no-store',
    })
    const len = upstream.headers.get('content-length')
    if (len) headers.set('Content-Length', len)
    if (inline) {
      headers.set('Accept-Ranges', 'bytes')
      const cr = upstream.headers.get('content-range')
      if (cr) headers.set('Content-Range', cr)
    }

    return new Response(upstream.body, { headers, status: upstream.status === 206 ? 206 : 200 })
  } catch (error) {
    console.error('video-fetch GET error:', error)
    return NextResponse.json({ success: false, error: 'Proxy failed' }, { status: 500 })
  }
}
